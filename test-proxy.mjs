/**
 * Standalone proxy test: starts proxy on 19281 → forwards to server on 19280
 * Then sends a TTS request through the proxy and saves the result.
 */
import http from "node:http";
import fs from "node:fs";

const UPSTREAM_PORT = 19280;
const PROXY_PORT = 19281;

// Injected params (simulating what buildInjectedParams produces)
const INJECTED = {
  model: "mlx-community/Kokoro-82M-bf16",
  speed: 1.0,
  lang_code: "a",
  temperature: 0.7,
  top_p: 0.95,
  top_k: 40,
  repetition_penalty: 1.0,
  response_format: "mp3",
};

// --- Proxy server ---
const proxy = http.createServer((req, res) => {
  if (req.method === "POST" && req.url === "/v1/audio/speech") {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const body = Buffer.concat(chunks).toString("utf8");
      let parsed;
      try {
        parsed = JSON.parse(body);
      } catch {
        res.writeHead(400);
        res.end("Bad JSON");
        return;
      }
      const merged = { ...parsed, ...INJECTED };
      if (parsed.input) merged.input = parsed.input;

      const upBody = JSON.stringify(merged);
      console.log("[proxy] Forwarding:", JSON.stringify(merged, null, 2));

      const upstream = http.request(
        {
          hostname: "127.0.0.1",
          port: UPSTREAM_PORT,
          path: "/v1/audio/speech",
          method: "POST",
          headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(upBody) },
        },
        (upRes) => {
          console.log(`[proxy] Upstream responded: ${upRes.statusCode}`);
          res.writeHead(upRes.statusCode, upRes.headers);
          upRes.pipe(res);
        }
      );
      upstream.on("error", (err) => {
        console.error("[proxy] Upstream error:", err.message);
        res.writeHead(502);
        res.end(JSON.stringify({ error: err.message }));
      });
      upstream.write(upBody);
      upstream.end();
    });
  } else {
    // passthrough
    const upstream = http.request(
      { hostname: "127.0.0.1", port: UPSTREAM_PORT, path: req.url, method: req.method, headers: req.headers },
      (upRes) => { res.writeHead(upRes.statusCode, upRes.headers); upRes.pipe(res); }
    );
    upstream.on("error", (err) => { res.writeHead(502); res.end(err.message); });
    req.pipe(upstream);
  }
});

proxy.listen(PROXY_PORT, "127.0.0.1", () => {
  console.log(`[proxy] Listening on 127.0.0.1:${PROXY_PORT}`);

  // --- Send test request through proxy ---
  const testBody = JSON.stringify({ input: "Testing the proxy layer. One two three." });
  console.log("[test] Sending TTS request through proxy...");
  const t0 = Date.now();

  const req = http.request(
    {
      hostname: "127.0.0.1",
      port: PROXY_PORT,
      path: "/v1/audio/speech",
      method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(testBody) },
      timeout: 180000,
    },
    (res) => {
      console.log(`[test] Response: HTTP ${res.statusCode}, content-type: ${res.headers["content-type"]}`);
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        const audio = Buffer.concat(chunks);
        const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
        console.log(`[test] Received ${audio.length} bytes in ${elapsed}s`);

        if (res.statusCode === 200 && audio.length > 100) {
          const outPath = "/tmp/mlx-proxy-test.mp3";
          fs.writeFileSync(outPath, audio);
          console.log(`[test] SUCCESS — saved to ${outPath}`);
        } else {
          console.log(`[test] FAILED — status=${res.statusCode}, body=${audio.toString().slice(0, 200)}`);
        }
        proxy.close();
        process.exit(res.statusCode === 200 && audio.length > 100 ? 0 : 1);
      });
    }
  );
  req.on("timeout", () => { req.destroy(new Error("timeout")); });
  req.on("error", (err) => { console.error("[test] Error:", err.message); proxy.close(); process.exit(1); });
  req.write(testBody);
  req.end();
});
