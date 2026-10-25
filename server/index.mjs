// Minimal static server for Space Impact. No dependencies.
// Serves an allowlist of files from public/, stamps the build id into the
// HTML (<!--BUILD--> placeholder) for public/fresh.js, and answers
// GET /version for both fresh.js and the deploy workflow.

import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { versionPayload } from "./version.mjs";

const PUBLIC = new URL("../public/", import.meta.url);

// path -> [file in public/, content type, cache policy]
const ROUTES = {
  "/": ["index.html", "text/html; charset=utf-8", "no-cache"],
  "/index.html": ["index.html", "text/html; charset=utf-8", "no-cache"],
  "/fresh.js": ["fresh.js", "text/javascript; charset=utf-8", "no-cache"],
  "/manifest.webmanifest": ["manifest.webmanifest", "application/manifest+json", "no-cache"],
  "/icon-192.png": ["icon-192.png", "image/png", "public, max-age=86400"],
  "/icon-512.png": ["icon-512.png", "image/png", "public, max-age=86400"],
  "/apple-touch-icon.png": ["apple-touch-icon.png", "image/png", "public, max-age=86400"],
};

export function createApp() {
  const version = versionPayload();
  const files = new Map();
  for (const [, [file]] of Object.entries(ROUTES)) {
    if (files.has(file)) continue;
    let body = readFileSync(new URL(file, PUBLIC));
    if (file === "index.html") {
      body = Buffer.from(
        body.toString("utf8").replace("<!--BUILD-->", `<meta name="app-build" content="${version.build}">`),
      );
    }
    files.set(file, body);
  }

  return createServer((req, res) => {
    const { pathname } = new URL(req.url, "http://localhost");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");

    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405, { Allow: "GET, HEAD" }).end();
      return;
    }

    if (pathname === "/version") {
      res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
      res.end(req.method === "HEAD" ? undefined : JSON.stringify(version));
      return;
    }

    const route = ROUTES[pathname];
    if (!route) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }).end("Not found");
      return;
    }

    const [file, type, cache] = route;
    const etag = `"${version.build}-${file}"`;
    if (req.headers["if-none-match"] === etag) {
      res.writeHead(304, { ETag: etag, "Cache-Control": cache }).end();
      return;
    }
    const body = files.get(file);
    res.writeHead(200, { "Content-Type": type, "Content-Length": body.length, "Cache-Control": cache, ETag: etag });
    res.end(req.method === "HEAD" ? undefined : body);
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT) || 80;
  const server = createApp().listen(port, () => {
    console.log(`Space Impact listening on :${port}, build ${versionPayload().build}`);
  });
  const stop = () => server.close(() => process.exit(0));
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
}
