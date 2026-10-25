// One hash over every file that ships, so `/version` can say what is really
// running: not the git SHA (it changes on commits that touch nothing a
// browser downloads) and not a version number someone forgets to bump.
// Open tabs reload when it changes (public/fresh.js); CI and `npm run live`
// wait for it after a deploy.
//
// INPUTS is the contract: everything that changes what the container serves.
// The Dockerfile is in it, so a new base image counts as a new build. Docs
// (*.md), tests and tooling are not: changing them must not reload anyone's
// game. test/deploy-contract.test.mjs holds INPUTS against the Dockerfile's
// COPY lines and .dockerignore.
//
//   node server/buildid.mjs                 -> prints the id (CI, Dockerfile)
//   import { buildId } from "./buildid.mjs" -> from code

import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
export const INPUTS = ["Dockerfile", "package.json", "package-lock.json", "server", "public"];

const walk = (p) => (statSync(p).isFile() ? [p] : readdirSync(p).flatMap((e) => walk(join(p, e))));

export function buildId() {
  const hash = createHash("sha256");
  const files = INPUTS.filter((p) => existsSync(join(ROOT, p)))
    .flatMap((p) => walk(join(ROOT, p)))
    .map((f) => relative(ROOT, f).split(sep).join("/"))
    .filter((f) => !f.endsWith(".md"))
    .sort();
  for (const f of files) {
    hash.update(f + "\0");
    hash.update(readFileSync(join(ROOT, f)));
  }
  return hash.digest("hex").slice(0, 12);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(buildId());
}
