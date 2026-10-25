// GET /version payload. Stateless app (high score and style live in each
// browser's localStorage), so no `schema` field.
import { readFileSync } from "node:fs";
import { buildId } from "./buildid.mjs";

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const STARTED_AT = new Date().toISOString();
const BUILD = buildId();

export function versionPayload() {
  return { version: pkg.version, build: BUILD, startedAt: STARTED_AT };
}
