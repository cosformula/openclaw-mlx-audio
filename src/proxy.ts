/** Lightweight HTTP proxy that injects TTS preset params. */

import { execFileSync } from "node:child_process";
import http from "node:http";
import type { MlxAudioConfig } from "./config.js";
import { buildInjectedParams } from "./config.js";

const MAX_REQUEST_BODY_BYTES = 1024 * 1024;

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

  async start(): Promise<void> {
    if (this.server) return;
    this.assertProxyPortAvailable();

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
      this.server!.listen(this.cfg.proxyPort, "127.0.0.1", () => {
        this.logger.info(`[mlx-audio] Proxy listening on 127.0.0.1:${this.cfg.proxyPort}`);
        resolve();
      });
      this.server!.on("error", (err) => {
        reject(new Error(`[mlx-audio] Failed to start proxy on port ${this.cfg.proxyPort}: ${(err as Error).message}`));
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
    // Only handle POST /v1/audio/speech
    if (req.method !== "POST" || req.url !== "/v1/audio/speech") {
      // Pass through other requests directly to upstream
      this.proxyRaw(req, res);
      return;
    }

    if (this.ensureUpstreamReady) {
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

        const injected = buildInjectedParams(this.cfg);
        // Merge: original fields preserved, injected fields added/overridden
        const merged: Record<string, unknown> = { ...parsed, ...injected };
        // Keep original input text
        merged.input = parsed.input;

        const upstreamBody = JSON.stringify(merged);
        this.forwardToUpstream(req, upstreamBody, res);
      } catch (err) {
        this.logger.error(`[mlx-audio] Proxy parse error: ${err}`);
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Invalid request body" }));
      }
    });
  }

  private forwardToUpstream(req: http.IncomingMessage, body: string, res: http.ServerResponse): void {
    const headers: http.OutgoingHttpHeaders = { ...req.headers };
    delete headers.host;
    delete headers["content-length"];
    delete headers["transfer-encoding"];
    headers["content-type"] = "application/json";
    headers["content-length"] = Buffer.byteLength(body);

    const options: http.RequestOptions = {
      hostname: "127.0.0.1",
      port: this.cfg.port,
      path: "/v1/audio/speech",
      method: "POST",
      headers,
    };

    const upstream = http.request(options, (upstreamRes) => {
      res.writeHead(upstreamRes.statusCode ?? 500, upstreamRes.headers);
      upstreamRes.pipe(res);
    });

    upstream.setTimeout(600_000, () => {
      this.logger.error("[mlx-audio] Upstream request timed out (600s)");
      upstream.destroy(new Error("Upstream timeout"));
    });

    upstream.on("error", (err) => {
      this.logger.error(`[mlx-audio] Upstream error: ${err.message}`);
      if (!res.headersSent) {
        res.writeHead(502, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "mlx-audio server unavailable", detail: err.message }));
      }
    });

    upstream.write(body);
    upstream.end();
  }

  private proxyRaw(req: http.IncomingMessage, res: http.ServerResponse): void {
    const options: http.RequestOptions = {
      hostname: "127.0.0.1",
      port: this.cfg.port,
      path: req.url,
      method: req.method,
      headers: req.headers,
    };

    const upstream = http.request(options, (upstreamRes) => {
      res.writeHead(upstreamRes.statusCode ?? 500, upstreamRes.headers);
      upstreamRes.pipe(res);
    });

    upstream.setTimeout(600_000, () => {
      this.logger.error("[mlx-audio] Upstream request timed out (600s)");
      upstream.destroy(new Error("Upstream timeout"));
    });

    upstream.on("error", (err) => {
      if (!res.headersSent) {
        res.writeHead(502, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "mlx-audio server unavailable", detail: err.message }));
      }
    });

    req.pipe(upstream);
  }

  private assertProxyPortAvailable(): void {
    const owners = this.listListeningPids(this.cfg.proxyPort);
    if (owners.length === 0) return;
    const desc = owners
      .map((pid) => {
        const command = this.getProcessCommand(pid);
        return `${pid}${command ? ` (${command})` : ""}`;
      })
      .join(", ");
    throw new Error(
      `[mlx-audio] Proxy port ${this.cfg.proxyPort} is already in use by: ${desc}. ` +
      "Stop that process or change proxyPort.",
    );
  }

  private listListeningPids(port: number): number[] {
    try {
      const output = execFileSync("/usr/sbin/lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"], {
        encoding: "utf-8",
        timeout: 5000,
      }).trim();
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

  private getProcessCommand(pid: number): string {
    try {
      return execFileSync("ps", ["-p", String(pid), "-o", "command="], {
        encoding: "utf-8",
        timeout: 5000,
      }).trim();
    } catch {
      return "";
    }
  }
}
