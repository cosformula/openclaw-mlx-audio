import assert from "node:assert/strict";
import http from "node:http";
import net from "node:net";
import test from "node:test";
import register from "../index.js";

type RegisteredService = {
  id: string;
  start: () => Promise<void> | void;
  stop: () => Promise<void> | void;
};

type RegisteredCommand = {
  name: string;
  handler: (ctx: { args?: string }) => { text: string } | Promise<{ text: string }>;
};

type RegisteredTool = {
  name: string;
  execute: (id: string, params: Record<string, unknown>) => Promise<unknown>;
};

type PluginApiLike = {
  logger: {
    info: (message: string) => void;
    warn: (message: string) => void;
    error: (message: string) => void;
  };
  config: {
    plugins: {
      entries: Record<string, { enabled: boolean; config: Record<string, unknown> }>;
    };
  };
  getPluginConfig: () => unknown;
  getConfig: () => unknown;
  registerService: (svc: RegisteredService) => void;
  registerCommand: (cmd: RegisteredCommand) => void;
  registerTool: (tool: RegisteredTool) => void;
};

async function getFreePort(): Promise<number> {
  const server = net.createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    throw new Error("Failed to allocate free port");
  }
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
  return address.port;
}

async function isPortFree(port: number): Promise<boolean> {
  const server = net.createServer();
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(port, "127.0.0.1", () => resolve());
    });
    return true;
  } catch {
    return false;
  } finally {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  }
}

async function getFreePortPair(): Promise<number> {
  for (let attempt = 0; attempt < 50; attempt++) {
    const port = await getFreePort();
    if (port >= 65535) continue;
    const companionPort = port + 1;
    if (await isPortFree(companionPort)) {
      return port;
    }
  }
  throw new Error("Failed to allocate a free single-port pair");
}

async function request(port: number, path: string): Promise<{ statusCode: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { hostname: "127.0.0.1", port, method: "GET", path, timeout: 2000 },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          resolve({
            statusCode: res.statusCode ?? 0,
            body: Buffer.concat(chunks).toString("utf8"),
          });
        });
      },
    );
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", reject);
    req.end();
  });
}

test("e2e: reload applies config without gateway restart and updates single-port endpoint", async () => {
  const initialPort = await getFreePortPair();
  const updatedPort = await getFreePortPair();
  let currentConfig: Record<string, unknown> = {
    port: initialPort,
    autoStart: false,
  };

  let service: RegisteredService | null = null;
  const commands = new Map<string, RegisteredCommand>();
  const tools = new Map<string, RegisteredTool>();
  const logs: string[] = [];

  const api: PluginApiLike = {
    logger: {
      info: (message) => logs.push(message),
      warn: (message) => logs.push(message),
      error: (message) => logs.push(message),
    },
    config: {
      plugins: {
        entries: {
          "openclaw-mlx-audio": {
            enabled: true,
            config: currentConfig,
          },
        },
      },
    },
    getPluginConfig: () => currentConfig,
    getConfig: () => currentConfig,
    registerService: (svc) => {
      service = svc;
    },
    registerCommand: (cmd) => {
      commands.set(cmd.name, cmd);
    },
    registerTool: (tool) => {
      tools.set(tool.name, tool);
    },
  };

  register(api as unknown as Parameters<typeof register>[0]);
  if (!service) {
    throw new Error("service must be registered");
  }
  assert.ok(commands.has("mlx-tts"), "command must be registered");
  assert.ok(tools.has("mlx_audio_tts"), "tool must be registered");

  await (service as RegisteredService).start();
  try {
    // Proxy is alive, upstream is intentionally unavailable so non-health paths return 502.
    const firstProbe = await request(initialPort, "/probe");
    assert.equal(firstProbe.statusCode, 502);

    currentConfig = {
      ...currentConfig,
      port: updatedPort,
      model: "mlx-community/Qwen3-TTS-12Hz-0.6B-Base-bf16",
      langCode: "z",
    };
    api.config.plugins.entries["openclaw-mlx-audio"]!.config = currentConfig;

    const command = commands.get("mlx-tts")!;
    const reload = await command.handler({ args: "reload" });
    assert.match(reload.text, /Configuration reloaded/);

    await assert.rejects(request(initialPort, "/probe"));
    const secondProbe = await request(updatedPort, "/probe");
    assert.equal(secondProbe.statusCode, 502);

    const status = await command.handler({ args: "status" });
    assert.match(status.text, new RegExp(`Ports: tts=${updatedPort}`));
    assert.match(status.text, /single-port/);

    const tool = tools.get("mlx_audio_tts")!;
    const rawToolStatus = await tool.execute("1", { action: "status" });
    assert.ok(rawToolStatus && typeof rawToolStatus === "object");
  } finally {
    await (service as RegisteredService).stop();
  }

  assert.equal(logs.some((line) => line.includes("Configuration applied")), true);
});
