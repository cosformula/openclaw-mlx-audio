/** Lightweight HTTP proxy that injects TTS preset params. */

import http from "node:http";
import type { MlxAudioConfig } from "./config.js";
import { buildInjectedParams } from "./config.js";

const MAX_REQUEST_BODY_BYTES = 1024 * 1024;

export class TtsProxy {
  private server: http.Server | null = null;

  constructor(
    private cfg: MlxAudioConfig,
    private logger: { info: (m: string) => void; error: (m: string) => void },
  ) {}

  async start(): Promise<void> {
    if (this.server) return;

    this.server = http.createServer((req, res) => {
      this.handleRequest(req, res);
    });

    return new Promise((resolve, reject) => {
      this.server!.listen(this.cfg.proxyPort, "127.0.0.1", () => {
        this.logger.info(`[mlx-audio] Proxy listening on 127.0.0.1:${this.cfg.proxyPort}`);
        resolve();
      });
      this.server!.on("error", reject);
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

  private handleRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
    // Only handle POST /v1/audio/speech
    if (req.method !== "POST" || req.url !== "/v1/audio/speech") {
      // Pass through other requests directly to upstream
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
        const parsed = JSON.parse(body);
        const injected = buildInjectedParams(this.cfg);
        // Merge: original fields preserved, injected fields added/overridden
        const merged = { ...parsed, ...injected };
        // Keep original input text
        if (parsed.input) merged.input = parsed.input;

        const upstreamBody = JSON.stringify(merged);
        this.forwardToUpstream(upstreamBody, res);
      } catch (err) {
        this.logger.error(`[mlx-audio] Proxy parse error: ${err}`);
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Invalid request body" }));
      }
    });
  }

  private forwardToUpstream(body: string, res: http.ServerResponse): void {
    const options: http.RequestOptions = {
      hostname: "127.0.0.1",
      port: this.cfg.port,
      path: "/v1/audio/speech",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body),
      },
    };

    const upstream = http.request(options, (upstreamRes) => {
      res.writeHead(upstreamRes.statusCode ?? 500, upstreamRes.headers);
      upstreamRes.pipe(res);
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

    upstream.on("error", (err) => {
      if (!res.headersSent) {
        res.writeHead(502, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "mlx-audio server unavailable", detail: err.message }));
      }
    });

    req.pipe(upstream);
  }
}
