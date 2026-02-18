import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const __dirname = dirname(fileURLToPath(import.meta.url));
// From dist/test/ we need ../../ to reach the project root
const projectRoot = resolve(__dirname, "..", "..");
const manifest = JSON.parse(
  readFileSync(resolve(projectRoot, "openclaw.plugin.json"), "utf8"),
);
const schema = manifest.configSchema;

/**
 * Minimal JSON Schema validator (draft-07 subset) so we don't need ajv as a
 * dev dependency. Covers the keywords actually used in our configSchema.
 */
function validate(
  value: unknown,
  s: Record<string, unknown>,
): { ok: boolean; errors: string[] } {
  const errors: string[] = [];

  if (s.type === "object") {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      errors.push("expected object");
      return { ok: false, errors };
    }
    const obj = value as Record<string, unknown>;
    const props = (s.properties ?? {}) as Record<
      string,
      Record<string, unknown>
    >;

    // additionalProperties
    if (s.additionalProperties === false) {
      for (const key of Object.keys(obj)) {
        if (!(key in props)) {
          errors.push(`unexpected property: ${key}`);
        }
      }
    }

    // required
    if (Array.isArray(s.required)) {
      for (const key of s.required as string[]) {
        if (!(key in obj)) errors.push(`missing required: ${key}`);
      }
    }

    // validate each known property
    for (const [key, propSchema] of Object.entries(props)) {
      if (key in obj) {
        const sub = validate(obj[key], propSchema);
        if (!sub.ok) errors.push(...sub.errors.map((e) => `${key}: ${e}`));
      }
    }
  }

  if (s.type === "string" && typeof value !== "undefined") {
    if (typeof value !== "string") errors.push("expected string");
  }
  if (s.type === "number" && typeof value !== "undefined") {
    if (typeof value !== "number") errors.push("expected number");
  }
  if (s.type === "integer" && typeof value !== "undefined") {
    if (typeof value !== "number" || !Number.isInteger(value))
      errors.push("expected integer");
  }
  if (s.type === "boolean" && typeof value !== "undefined") {
    if (typeof value !== "boolean") errors.push("expected boolean");
  }

  if (s.enum && typeof value !== "undefined") {
    if (!(s.enum as unknown[]).includes(value))
      errors.push(`must be one of: ${(s.enum as unknown[]).join(", ")}`);
  }

  return { ok: errors.length === 0, errors };
}

test("configSchema: empty config is valid", () => {
  const result = validate({}, schema);
  assert.ok(result.ok, `errors: ${result.errors.join(", ")}`);
});

test("configSchema: typical config is valid", () => {
  const result = validate(
    {
      model: "mlx-community/Kokoro-82M-bf16",
      port: 19280,
      speed: 1.0,
      langCode: "auto",
      workers: 1,
    },
    schema,
  );
  assert.ok(result.ok, `errors: ${result.errors.join(", ")}`);
});

test("configSchema: unknown fields do NOT cause validation failure", () => {
  const result = validate(
    {
      model: "mlx-community/Kokoro-82M-bf16",
      someFutureField: true,
      anotherOne: "hello",
    },
    schema,
  );
  assert.ok(
    result.ok,
    `unknown fields should be allowed but got: ${result.errors.join(", ")}`,
  );
});

test("configSchema: additionalProperties is not false", () => {
  assert.notEqual(
    schema.additionalProperties,
    false,
    "additionalProperties must not be false — it blocks OpenClaw startup on unknown fields",
  );
});

test("manifest version matches package.json version", () => {
  const pkg = JSON.parse(
    readFileSync(resolve(projectRoot, "package.json"), "utf8"),
  );
  assert.equal(
    manifest.version,
    pkg.version,
    "openclaw.plugin.json version must match package.json version",
  );
});
