import assert from "node:assert/strict";
import http from "node:http";
import net from "node:net";
import test from "node:test";
import { resolveConfig } from "../src/config.js";
import { TtsProxy } from "../src/proxy.js";

type Logger = {
  info: (message: string) => void;
  error: (message: string) => void;
};

type HttpResponse = {
  statusCode: number;
  body: string;
  headers: http.IncomingHttpHeaders;
};

function createLoggerStore(): { logger: Logger; infos: string[]; errors: string[] } {
  const infos: string[] = [];
  const errors: string[] = [];
  return {
    logger: {
      info: (message) => infos.push(message),
      error: (message) => errors.push(message),
    },
    infos,
    errors,
  };
}

async function closeServer(server: http.Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

async function createUpstream(
  handler: (req: http.IncomingMessage, res: http.ServerResponse) => void,
): Promise<{ server: http.Server; port: number }> {
  const server = http.createServer(handler);
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    await closeServer(server);
    throw new Error("Failed to resolve upstream address");
  }
  return { server, port: address.port };
}

async function getFreePort(): Promise<number> {
  const server = net.createServer();
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
    throw new Error("Failed to resolve free port");
  }
  const { port } = address;
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
  return port;
}

async function request(
  port: number,
  method: string,
  path: string,
  body?: string,
  headers: http.OutgoingHttpHeaders = {},
): Promise<HttpResponse> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port,
        method,
        path,
        headers,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          resolve({
            statusCode: res.statusCode ?? 0,
            body: Buffer.concat(chunks).toString("utf8"),
            headers: res.headers,
          });
        });
      },
    );

    req.on("error", reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

test("TtsProxy injects config params for /v1/audio/speech", async () => {
  const upstreamBodies: Array<Record<string, unknown>> = [];
  let upstreamHits = 0;
  const upstream = await createUpstream((req, res) => {
    upstreamHits += 1;
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      upstreamBodies.push(JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    });
  });

  const proxyPort = await getFreePort();
  const { logger } = createLoggerStore();
  const cfg = resolveConfig({
    port: upstream.port,
    proxyPort,
    model: "mlx-community/Kokoro-82M-8bit",
    speed: 1.25,
    langCode: "z",
    temperature: 0.5,
    topP: 0.8,
    topK: 20,
    repetitionPenalty: 1.1,
    refAudio: "/tmp/ref.wav",
    refText: "reference",
    instruct: "calm",
  });
  const proxy = new TtsProxy(cfg, logger);

  try {
    await proxy.start();
    const response = await request(
      proxyPort,
      "POST",
      "/v1/audio/speech",
      JSON.stringify({
        input: "hello world",
        voice: "af_bella",
        model: "client-overridden",
      }),
      { "Content-Type": "application/json" },
    );

    assert.equal(response.statusCode, 200);
    assert.equal(upstreamHits, 1);
    assert.equal(upstreamBodies.length, 1);
    const upstreamBody = upstreamBodies[0];
    assert.equal(upstreamBody.input, "hello world");
    assert.equal(upstreamBody.voice, "af_bella");
    assert.equal(upstreamBody.model, "mlx-community/Kokoro-82M-8bit");
    assert.equal(upstreamBody.speed, 1.25);
    assert.equal(upstreamBody.lang_code, "z");
    assert.equal(upstreamBody.temperature, 0.5);
    assert.equal(upstreamBody.top_p, 0.8);
    assert.equal(upstreamBody.top_k, 20);
    assert.equal(upstreamBody.repetition_penalty, 1.1);
    assert.equal(upstreamBody.response_format, "mp3");
    assert.equal(upstreamBody.ref_audio, "/tmp/ref.wav");
    assert.equal(upstreamBody.ref_text, "reference");
    assert.equal(upstreamBody.instruct, "calm");
  } finally {
    await proxy.stop();
    await closeServer(upstream.server);
  }
});

test("TtsProxy waits for ensureUpstreamReady on /v1/audio/speech", async () => {
  let upstreamHits = 0;
  const upstream = await createUpstream((req, res) => {
    upstreamHits += 1;
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(Buffer.concat(chunks));
    });
  });

  const proxyPort = await getFreePort();
  const { logger } = createLoggerStore();
  const cfg = resolveConfig({ port: upstream.port, proxyPort });
  let ensureCalls = 0;
  const proxy = new TtsProxy(cfg, logger, async () => {
    ensureCalls += 1;
    await new Promise((resolve) => setTimeout(resolve, 25));
  });

  try {
    await proxy.start();
    const response = await request(
      proxyPort,
      "POST",
      "/v1/audio/speech",
      JSON.stringify({ input: "hello from ensure" }),
      { "Content-Type": "application/json" },
    );

    assert.equal(response.statusCode, 200);
    assert.equal(ensureCalls, 1);
    assert.equal(upstreamHits, 1);
    assert.deepEqual(JSON.parse(response.body), {
      input: "hello from ensure",
      model: cfg.model,
      speed: cfg.speed,
      lang_code: cfg.langCode,
      temperature: cfg.temperature,
      top_p: cfg.topP,
      top_k: cfg.topK,
      repetition_penalty: cfg.repetitionPenalty,
      response_format: "mp3",
    });
  } finally {
    await proxy.stop();
    await closeServer(upstream.server);
  }
});

test("TtsProxy returns 503 when ensureUpstreamReady fails", async () => {
  let upstreamHits = 0;
  const upstream = await createUpstream((_req, res) => {
    upstreamHits += 1;
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
  });

  const proxyPort = await getFreePort();
  const { logger } = createLoggerStore();
  const cfg = resolveConfig({ port: upstream.port, proxyPort });
  const proxy = new TtsProxy(cfg, logger, async () => {
    throw new Error("ensure failed");
  });

  try {
    await proxy.start();
    const response = await request(
      proxyPort,
      "POST",
      "/v1/audio/speech",
      JSON.stringify({ input: "hello" }),
      { "Content-Type": "application/json" },
    );

    assert.equal(response.statusCode, 503);
    assert.equal(upstreamHits, 0);
    assert.equal((JSON.parse(response.body) as { error?: string }).error, "mlx-audio server unavailable");
  } finally {
    await proxy.stop();
    await closeServer(upstream.server);
  }
});

test("TtsProxy passes through non-TTS routes", async () => {
  let upstreamHits = 0;
  const upstream = await createUpstream((req, res) => {
    upstreamHits += 1;
    assert.equal(req.method, "GET");
    assert.equal(req.url, "/v1/models");
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ data: ["model-a"] }));
  });

  const proxyPort = await getFreePort();
  const { logger } = createLoggerStore();
  const cfg = resolveConfig({ port: upstream.port, proxyPort });
  const proxy = new TtsProxy(cfg, logger);

  try {
    await proxy.start();
    const response = await request(proxyPort, "GET", "/v1/models");

    assert.equal(response.statusCode, 200);
    assert.equal(upstreamHits, 1);
    assert.deepEqual(JSON.parse(response.body), { data: ["model-a"] });
  } finally {
    await proxy.stop();
    await closeServer(upstream.server);
  }
});

test("TtsProxy rejects /v1/audio/speech without non-empty input", async () => {
  let upstreamHits = 0;
  const upstream = await createUpstream((_req, res) => {
    upstreamHits += 1;
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
  });

  const proxyPort = await getFreePort();
  const { logger } = createLoggerStore();
  const cfg = resolveConfig({ port: upstream.port, proxyPort });
  const proxy = new TtsProxy(cfg, logger);

  try {
    await proxy.start();
    const response = await request(
      proxyPort,
      "POST",
      "/v1/audio/speech",
      JSON.stringify({ voice: "af_bella" }),
      { "Content-Type": "application/json" },
    );

    assert.equal(response.statusCode, 400);
    assert.deepEqual(JSON.parse(response.body), {
      error: "Request body must include a non-empty string field: input",
    });
    assert.equal(upstreamHits, 0);
  } finally {
    await proxy.stop();
    await closeServer(upstream.server);
  }
});

test("TtsProxy returns 502 when upstream is unavailable", async () => {
  const upstreamPort = await getFreePort();
  const proxyPort = await getFreePort();
  const { logger, errors } = createLoggerStore();
  const cfg = resolveConfig({ port: upstreamPort, proxyPort });
  const proxy = new TtsProxy(cfg, logger);

  try {
    await proxy.start();
    const response = await request(
      proxyPort,
      "POST",
      "/v1/audio/speech",
      JSON.stringify({ input: "hello" }),
      { "Content-Type": "application/json" },
    );

    assert.equal(response.statusCode, 502);
    const payload = JSON.parse(response.body) as { error?: string };
    assert.equal(payload.error, "mlx-audio server unavailable");
    assert.equal(errors.some((message) => message.includes("Upstream error")), true);
  } finally {
    await proxy.stop();
  }
});
