/** Lightweight HTTP proxy that injects TTS preset params. */

import http from "node:http";
import type { MlxAudioConfig } from "./config.js";
import { buildInjectedParams, resolvePortBinding } from "./config.js";
import { runCommand } from "./run-command.js";

const MAX_REQUEST_BODY_BYTES = 1024 * 1024;

/** OpenAI TTS voice names that are not understood by local models. */
const OPENAI_VOICE_NAMES = new Set([
  "alloy", "ash", "ballad", "coral", "echo", "fable", "nova", "onyx", "sage", "shimmer", "verse",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export class TtsProxy {
  private server: http.Server | null = null;

  constructor(
    private cfg: MlxAudioConfig,
    private logger: { info: (m: string) => void; error: (m: string) => void },
    private ensureUpstreamReady?: () => Promise<void>,
  ) {}

  updateConfig(cfg: MlxAudioConfig): void {
    this.cfg = cfg;
  }

  async start(): Promise<void> {
    if (this.server) return;
    const { publicPort } = resolvePortBinding(this.cfg);
    await this.assertProxyPortAvailable(publicPort);

    this.server = http.createServer((req, res) => {
      void this.handleRequest(req, res).catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.error(`[mlx-audio] Proxy request failed: ${msg}`);
        if (!res.headersSent) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Proxy internal error", detail: msg }));
        }
      });
    });

    return new Promise((resolve, reject) => {
      this.server!.listen(publicPort, "127.0.0.1", () => {
        this.logger.info(`[mlx-audio] Proxy listening on 127.0.0.1:${publicPort}`);
        resolve();
      });
      this.server!.on("error", (err) => {
        reject(new Error(`[mlx-audio] Failed to start proxy on port ${publicPort}: ${(err as Error).message}`));
      });
    });
  }

  async stop(): Promise<void> {
    if (!this.server) return;
    const server = this.server;
    return new Promise((resolve) => {
      server.close(() => {
        this.server = null;
        resolve();
      });
    });
  }

  private async handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const isSpeechRequest = req.method === "POST" && req.url === "/v1/audio/speech";
    const isModelsRequest = req.method === "GET" && req.url === "/v1/models";

    if (this.ensureUpstreamReady && (isSpeechRequest || isModelsRequest)) {
      try {
        await this.ensureUpstreamReady();
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.error(`[mlx-audio] Upstream not ready: ${msg}`);
        res.writeHead(503, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "mlx-audio server unavailable", detail: msg }));
        return;
      }
    }

    // Only handle POST /v1/audio/speech for request body injection.
    if (!isSpeechRequest) {
      this.proxyRaw(req, res);
      return;
    }

    const chunks: Buffer[] = [];
    let bodySize = 0;
    let tooLarge = false;

    req.on("data", (chunk: Buffer) => {
      if (tooLarge) return;
      bodySize += chunk.length;
      if (bodySize > MAX_REQUEST_BODY_BYTES) {
        tooLarge = true;
        res.writeHead(413, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Request body too large (max 1MB)" }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (tooLarge) return;
      const body = Buffer.concat(chunks).toString("utf8");
      try {
        const parsed: unknown = JSON.parse(body);
        if (!isRecord(parsed)) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Request body must be a JSON object" }));
          return;
        }
        if (typeof parsed.input !== "string" || parsed.input.trim().length === 0) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Request body must include a non-empty string field: input" }));
          return;
        }

        const inputText = typeof parsed.input === "string" ? parsed.input : "";
        const injected = buildInjectedParams(this.cfg, inputText);
        // Merge: original fields preserved, injected fields added/overridden
        const merged: Record<string, unknown> = { ...parsed, ...injected };
        // Keep original input text
        merged.input = parsed.input;
        // Strip OpenAI-specific voice names that cause upstream models like
        // Kokoro to silently fail with empty output. Model-native voice names
        // (e.g. Kokoro's af_heart, af_bella) are preserved.
        if (typeof merged.voice === "string" && OPENAI_VOICE_NAMES.has(merged.voice)) {
          delete merged.voice;
        }

        const upstreamBody = JSON.stringify(merged);
        this.forwardToUpstream(req, upstreamBody, res);
      } catch (err) {
        this.logger.error(`[mlx-audio] Proxy parse error: ${err}`);
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Invalid request body" }));
      }
    });
  }

  private watchClientDisconnect(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    upstream: http.ClientRequest,
    route: string,
  ): () => boolean {
    let disconnected = false;

    const cancelUpstream = (reason: string): void => {
      if (disconnected) return;
      disconnected = true;
      this.logger.info(`[mlx-audio] Client disconnected (${route}: ${reason}), canceling upstream request`);
      upstream.destroy(new Error("Client disconnected"));
    };

    const onRequestAborted = (): void => {
      cancelUpstream("request aborted");
    };
    const onRequestClose = (): void => {
      if (!req.complete) {
        cancelUpstream("request closed before completion");
      }
    };
    const onResponseClose = (): void => {
      if (!res.writableEnded) {
        cancelUpstream("response closed before completion");
      }
    };

    const cleanup = (): void => {
      req.off("aborted", onRequestAborted);
      req.off("close", onRequestClose);
      res.off("close", onResponseClose);
      res.off("finish", cleanup);
      upstream.off("close", cleanup);
    };

    req.on("aborted", onRequestAborted);
    req.on("close", onRequestClose);
    res.on("close", onResponseClose);
    res.once("finish", cleanup);
    upstream.once("close", cleanup);

    return () => disconnected;
  }

  private forwardToUpstream(req: http.IncomingMessage, body: string, res: http.ServerResponse): void {
    const { serverPort } = resolvePortBinding(this.cfg);
    const headers: http.OutgoingHttpHeaders = { ...req.headers };
    delete headers.host;
    delete headers["content-length"];
    delete headers["transfer-encoding"];
    headers["content-type"] = "application/json";
    headers["content-length"] = Buffer.byteLength(body);

    const options: http.RequestOptions = {
      hostname: "127.0.0.1",
      port: serverPort,
      path: "/v1/audio/speech",
      method: "POST",
      headers,
    };

    const upstream = http.request(options, (upstreamRes) => {
      const statusCode = upstreamRes.statusCode ?? 500;

      // For non-success responses, forward immediately (error bodies are small).
      if (statusCode >= 300) {
        res.writeHead(statusCode, upstreamRes.headers);
        upstreamRes.pipe(res);
        return;
      }

      // For success responses with chunked transfer-encoding, defer writeHead
      // until the first data chunk arrives. If the upstream closes without
      // sending any data (e.g. model not loaded, generator crash), return 502
      // instead of an empty 200 that produces a 0-byte file downstream.
      let headersSent = false;

      upstreamRes.on("data", (chunk: Buffer) => {
        if (!headersSent) {
          headersSent = true;
          res.writeHead(statusCode, upstreamRes.headers);
        }
        res.write(chunk);
      });

      upstreamRes.on("end", () => {
        if (!headersSent) {
          // Upstream returned 200 but sent zero bytes of audio data.
          this.logger.error("[mlx-audio] Upstream returned 200 but sent no audio data (empty chunked response)");
          if (!res.destroyed) {
            res.writeHead(502, { "Content-Type": "application/json" });
            res.end(JSON.stringify({
              error: "mlx-audio server returned empty response",
              detail: "The server acknowledged the request but produced no audio data. This usually means the model failed to generate output. Check server logs.",
            }));
          }
          return;
        }
        res.end();
      });

      upstreamRes.on("error", (err) => {
        if (!headersSent && !res.destroyed) {
          res.writeHead(502, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Upstream stream error", detail: err.message }));
        } else if (!res.destroyed) {
          res.destroy(err);
        }
      });
    });
    const wasDisconnected = this.watchClientDisconnect(req, res, upstream, "/v1/audio/speech");

    upstream.setTimeout(600_000, () => {
      if (wasDisconnected()) return;
      this.logger.error("[mlx-audio] Upstream request timed out (600s)");
      upstream.destroy(new Error("Upstream timeout"));
    });

    upstream.on("error", (err) => {
      if (wasDisconnected()) return;
      this.logger.error(`[mlx-audio] Upstream error: ${err.message}`);
      if (!res.headersSent && !res.destroyed) {
        res.writeHead(502, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "mlx-audio server unavailable", detail: err.message }));
      }
    });

    upstream.write(body);
    upstream.end();
  }

  private proxyRaw(req: http.IncomingMessage, res: http.ServerResponse): void {
    const { serverPort } = resolvePortBinding(this.cfg);
    const options: http.RequestOptions = {
      hostname: "127.0.0.1",
      port: serverPort,
      path: req.url,
      method: req.method,
      headers: req.headers,
    };

    const upstream = http.request(options, (upstreamRes) => {
      res.writeHead(upstreamRes.statusCode ?? 500, upstreamRes.headers);
      upstreamRes.pipe(res);
    });
    const wasDisconnected = this.watchClientDisconnect(req, res, upstream, req.url ?? "raw");

    upstream.setTimeout(600_000, () => {
      if (wasDisconnected()) return;
      this.logger.error("[mlx-audio] Upstream request timed out (600s)");
      upstream.destroy(new Error("Upstream timeout"));
    });

    upstream.on("error", (err) => {
      if (wasDisconnected()) return;
      if (!res.headersSent && !res.destroyed) {
        res.writeHead(502, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "mlx-audio server unavailable", detail: err.message }));
      }
    });

    req.pipe(upstream);
  }

  private async assertProxyPortAvailable(port: number): Promise<void> {
    const owners = await this.listListeningPids(port);
    if (owners.length === 0) return;
    const ownerDescriptions: string[] = [];
    for (const pid of owners) {
      const command = await this.getProcessCommand(pid);
      ownerDescriptions.push(`${pid}${command ? ` (${command})` : ""}`);
    }
    const desc = ownerDescriptions.join(", ");
    throw new Error(
      `[mlx-audio] Proxy port ${port} is already in use by: ${desc}. ` +
      "Stop that process or change port.",
    );
  }

  private async listListeningPids(port: number): Promise<number[]> {
    try {
      const { stdout } = await this.runCommand(
        "/usr/sbin/lsof",
        ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"],
        { timeoutMs: 5000, allowExitCodes: [1] },
      );
      const output = stdout.trim();
      if (!output) return [];
      return output
        .split("\n")
        .map((line) => Number(line.trim()))
        .filter((pid) => Number.isInteger(pid) && pid > 0);
    } catch {
      // If lsof is unavailable, we fall back to listen() error handling.
      return [];
    }
  }

  private async getProcessCommand(pid: number): Promise<string> {
    try {
      const { stdout } = await this.runCommand(
        "ps",
        ["-p", String(pid), "-o", "command="],
        { timeoutMs: 5000, allowExitCodes: [1] },
      );
      return stdout.trim();
    } catch {
      return "";
    }
  }

  private runCommand = runCommand;
}
