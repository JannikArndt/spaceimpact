// GET /version payload. Stateless app (high scores and settings live in each
// browser's localStorage), so no `schema` field.
//
// The build id comes from BUILD_ID, which the Dockerfile writes at image
// build time with the same `node server/buildid.mjs` CI runs. Without the
// file (local run, tests) it is computed from the working tree.
import { readFileSync } from "node:fs";
import { buildId } from "./buildid.mjs";

const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");
const pkg = JSON.parse(read("../package.json"));
const STARTED_AT = new Date().toISOString();
let BUILD;
try {
  BUILD = read("../BUILD_ID").trim();
} catch {
  BUILD = buildId();
}

export function versionPayload() {
  return { version: pkg.version, build: BUILD, startedAt: STARTED_AT, node: process.versions.node };
}
