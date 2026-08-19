#!/usr/bin/env node
/**
 * Bundle the standalone Worker and fail if its transitive closure contains a
 * legacy database/runtime dependency. This is a local/CI read-only check; it
 * never deploys or contacts Cloudflare.
 */

import { build } from "esbuild";
import { readFile, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const out = resolve(process.env.NATIVE_BUNDLE_OUT || "/tmp/immi-cloudflare-native-bundle.mjs");
const entry = resolve(root, "workers/cloudflare-native.js");
const forbidden = [
  /from\s+["']postgres["']/i,
  /require\(["']postgres["']\)/i,
  /postgres\s*\(/i,
  /HYPERDRIVE/i,
  /SUPABASE_URL/i,
  /SUPABASE_SERVICE_ROLE_KEY/i,
  /FlaskBackend/i,
  /from\s+["']flask["']/i,
];

try {
  await build({
    entryPoints: [entry],
    bundle: true,
    format: "esm",
    platform: "neutral",
    target: "es2022",
    outfile: out,
    logLevel: "silent",
    external: ["cloudflare:*"],
  });
  const source = await readFile(out, "utf8");
  const hits = forbidden.filter((pattern) => pattern.test(source)).map(String);
  if (hits.length) {
    console.error("Cloudflare-native bundle blocked: legacy runtime markers found");
    for (const hit of hits) console.error(`- ${hit}`);
    process.exitCode = 1;
  } else {
    console.log(`Cloudflare-native bundle closure passed (${source.length} bytes): ${out}`);
  }
} finally {
  if (process.env.KEEP_NATIVE_BUNDLE !== "1") await rm(out, { force: true });
}
