import { test } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../server/index.mjs";
import { buildId } from "../server/buildid.mjs";

async function withServer(fn) {
  const server = createApp();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await fn(base);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}

test("serves the game with the build id stamped in", () =>
  withServer(async (base) => {
    const res = await fetch(base + "/");
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type"), /text\/html/);
    const html = await res.text();
    assert.ok(html.includes(`<meta name="app-build" content="${buildId()}">`));
    assert.ok(!html.includes("<!--BUILD-->"));
    assert.ok(html.includes("window.__spaceImpactQuiet"));
  }));

test("/version reports the same build CI computes", () =>
  withServer(async (base) => {
    const res = await fetch(base + "/version");
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("cache-control"), "no-store");
    const body = await res.json();
    assert.equal(body.build, buildId());
    assert.equal(typeof body.version, "string");
  }));

test("every asset the page links to is served", () =>
  withServer(async (base) => {
    for (const [path, type] of [
      ["/fresh.js", /javascript/],
      ["/manifest.webmanifest", /manifest\+json/],
      ["/icon-192.png", /image\/png/],
      ["/icon-512.png", /image\/png/],
      ["/apple-touch-icon.png", /image\/png/],
    ]) {
      const res = await fetch(base + path);
      assert.equal(res.status, 200, path);
      assert.match(res.headers.get("content-type"), type, path);
      await res.arrayBuffer();
    }
  }));

test("revalidation returns 304 for an unchanged build", () =>
  withServer(async (base) => {
    const first = await fetch(base + "/");
    await first.text();
    const res = await fetch(base + "/", { headers: { "If-None-Match": first.headers.get("etag") } });
    assert.equal(res.status, 304);
  }));

test("unknown paths and methods are rejected", () =>
  withServer(async (base) => {
    const missing = await fetch(base + "/server/index.mjs");
    assert.equal(missing.status, 404);
    await missing.text();
    const post = await fetch(base + "/", { method: "POST" });
    assert.equal(post.status, 405);
    await post.text();
  }));

test("//version answers like /version (a trailing slash in APP_URL produces it)", () =>
  withServer(async (base) => {
    const res = await fetch(base + "//version");
    assert.equal(res.status, 200);
    assert.equal((await res.json()).build, buildId());
  }));
