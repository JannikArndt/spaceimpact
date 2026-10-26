// Minimal server for Space Impact. No dependencies.
// Serves an allowlist of files from public/, stamps the build id into the
// HTML (<!--BUILD--> placeholder) for public/fresh.js, answers GET /version
// for both fresh.js and the deploy workflow, and hosts the global high score
// API under /api (see scores.mjs).

import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { versionPayload } from "./version.mjs";
import { DIFFS, createScores } from "./scores.mjs";

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

const BODY_MAX = 2048;

function sendJson(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  res.end(JSON.stringify(body));
}

function readJson(req, res) {
  return new Promise((resolve) => {
    if (!/^application\/json\b/i.test(req.headers["content-type"] || "")) return resolve({ error: 415 });
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size <= BODY_MAX) return chunks.push(c);
      // Answer right away and drop the connection once the reply is out.
      chunks.length = 0;
      res.setHeader("Connection", "close");
      res.on("finish", () => req.destroy());
      resolve({ error: 413 });
    });
    req.on("end", () => {
      try {
        resolve({ body: JSON.parse(Buffer.concat(chunks).toString("utf8")) });
      } catch {
        resolve({ error: 400 });
      }
    });
    req.on("error", () => resolve({ error: 400 }));
  });
}

// /api/run (POST), /api/scores?diff= (GET, POST), /api/scores/<id> (PATCH).
async function handleApi(req, res, pathname, searchParams, scores) {
  // CapRover's nginx sets X-Real-IP to the client address.
  const ip = req.headers["x-real-ip"] || req.socket.remoteAddress || "";
  const now = Date.now();
  const tooMany = () => sendJson(res, 429, { error: "too many requests, try again later" });

  if (pathname === "/api/run") {
    if (req.method !== "POST") return sendJson(res, 405, { error: "method not allowed" });
    if (!scores.limits.run(ip, now)) return tooMany();
    return sendJson(res, 201, { token: scores.issueRun() });
  }
  if (pathname === "/api/scores") {
    if (req.method === "GET" || req.method === "HEAD") {
      const diff = searchParams.get("diff") || "normal";
      if (!DIFFS.includes(diff)) return sendJson(res, 400, { error: "unknown difficulty" });
      return sendJson(res, 200, { diff, entries: scores.top(diff) });
    }
    if (req.method !== "POST") return sendJson(res, 405, { error: "method not allowed" });
    if (!scores.limits.submit(ip, now)) return tooMany();
    const { body, error } = await readJson(req, res);
    if (error) return sendJson(res, error, { error: "expected a small JSON body" });
    const r = scores.submit(body);
    return sendJson(res, r.status, r.body);
  }
  const m = /^\/api\/scores\/([0-9a-f]{16})$/.exec(pathname);
  if (m) {
    if (req.method !== "PATCH") return sendJson(res, 405, { error: "method not allowed" });
    if (!scores.limits.rename(ip, now)) return tooMany();
    const { body, error } = await readJson(req, res);
    if (error) return sendJson(res, error, { error: "expected a small JSON body" });
    const r = scores.rename(m[1], body);
    return sendJson(res, r.status, r.body);
  }
  return sendJson(res, 404, { error: "not found" });
}

// dataDir: where scores.json lives; without one, scores are kept in memory.
export function createApp({ dataDir = process.env.DATA_DIR } = {}) {
  const version = versionPayload();
  const scores = createScores({ dataDir });
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

  const server = createServer((req, res) => {
    // Not new URL(req.url, base): for "//version" that parses "version" as a
    // host name and serves the page instead (a trailing slash in APP_URL
    // produces exactly that request).
    const q = req.url.indexOf("?");
    const pathname = (q < 0 ? req.url : req.url.slice(0, q)).replace(/^\/{2,}/, "/");
    const searchParams = new URLSearchParams(q < 0 ? "" : req.url.slice(q + 1));
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");

    if (pathname.startsWith("/api/")) {
      handleApi(req, res, pathname, searchParams, scores).catch((e) => {
        console.error(e);
        if (!res.headersSent) sendJson(res, 500, { error: "server error" });
      });
      return;
    }

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
  server.scores = scores;
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT) || 80;
  const server = createApp().listen(port, () => {
    const store = server.scores.persistent ? process.env.DATA_DIR : "memory only";
    console.log(`Space Impact listening on :${port}, build ${versionPayload().build}, scores: ${store}`);
  });
  const stop = () => server.close(() => process.exit(0));
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
}
