#!/usr/bin/env node
/**
 * Verify that MlxAudioConfig interface keys in config.ts match
 * openclaw.plugin.json → configSchema.properties keys.
 *
 * Run: node scripts/check-schema-sync.mjs
 */
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// 1. Extract keys from openclaw.plugin.json
const manifest = JSON.parse(readFileSync(resolve(root, "openclaw.plugin.json"), "utf-8"));
const schemaKeys = new Set(Object.keys(manifest.configSchema?.properties ?? {}));

// 2. Extract keys from MlxAudioConfig interface in config.ts
const configSrc = readFileSync(resolve(root, "src/config.ts"), "utf-8");
const interfaceMatch = configSrc.match(/export interface MlxAudioConfig\s*\{([^}]+)\}/);
if (!interfaceMatch) {
  console.error("❌ Could not find MlxAudioConfig interface in src/config.ts");
  process.exit(1);
}
const tsKeys = new Set(
  [...interfaceMatch[1].matchAll(/^\s*(\w+)\??:/gm)].map((m) => m[1])
);

// 3. Compare
const inTsOnly = [...tsKeys].filter((k) => !schemaKeys.has(k));
const inSchemaOnly = [...schemaKeys].filter((k) => !tsKeys.has(k));

let ok = true;
if (inTsOnly.length) {
  console.error(`❌ Keys in MlxAudioConfig but missing from openclaw.plugin.json: ${inTsOnly.join(", ")}`);
  ok = false;
}
if (inSchemaOnly.length) {
  console.error(`❌ Keys in openclaw.plugin.json but missing from MlxAudioConfig: ${inSchemaOnly.join(", ")}`);
  ok = false;
}

if (ok) {
  console.log(`✅ Schema sync OK (${schemaKeys.size} keys)`);
} else {
  console.error("\nFix: update both openclaw.plugin.json AND src/config.ts, then re-run.");
  process.exit(1);
}
