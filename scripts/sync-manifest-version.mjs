#!/usr/bin/env node
// Sync openclaw.plugin.json version with package.json version.
// Called by npm "version" lifecycle hook.
import { readFileSync, writeFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const manifestPath = "openclaw.plugin.json";
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));

if (manifest.version !== pkg.version) {
  manifest.version = pkg.version;
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
  console.log(`Synced openclaw.plugin.json version to ${pkg.version}`);
}
