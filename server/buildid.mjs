// One hash over every file that actually ships, so `/version` can tell a
// browser (or the deploy workflow) "this is what's really running".
// Adapted from the timpanini skill's buildid.mjs.
//
// SERVED must match what the Dockerfile copies into the image. Tests,
// docs, scripts and CI config stay out: changing them must not force an
// open tab to reload.
//
// Usage:
//   node server/buildid.mjs                 -> prints the hash
//   import { buildId } from './buildid.mjs' -> use it from the server

import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

const SERVED = ["package.json", "public", "server"];

function walk(path) {
  const stat = statSync(path);
  if (stat.isFile()) return [path];
  return readdirSync(path).flatMap((entry) => walk(join(path, entry)));
}

export function buildId() {
  const hash = createHash("sha256");
  const files = SERVED.flatMap((p) => walk(join(ROOT, p))).sort((a, b) =>
    a.localeCompare(b),
  );
  for (const file of files) {
    hash.update(relative(ROOT, file));
    hash.update(readFileSync(file));
  }
  return hash.digest("hex").slice(0, 12);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(buildId());
}
