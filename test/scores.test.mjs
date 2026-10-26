import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../server/index.mjs";
import { cleanName, createScores, maxScore, minSeconds, KEEP, SHOW } from "../server/scores.mjs";

const quiet = { error() {} };

// A store with a hand-driven clock.
function store(opts = {}) {
  let t = 1_700_000_000_000;
  const s = createScores({ now: () => t, log: quiet, ...opts });
  s.wait = (seconds) => { t += seconds * 1000; };
  return s;
}

test("a plausible run is accepted, ranked and can be renamed", () => {
  const s = store();
  const token = s.issueRun();
  s.wait(60);
  const r = s.submit({ token, diff: "normal", score: 900, level: 2, name: "  Ace\u0007 " });
  assert.equal(r.status, 201);
  assert.equal(r.body.rank, 1);
  assert.equal(r.body.top[0].name, "Ace");
  assert.deepEqual(s.top("easy"), []);

  assert.equal(s.rename(r.body.id, { key: "x".repeat(22), name: "Evil" }).status, 403);
  const ok = s.rename(r.body.id, { key: r.body.key, name: "Ace Pilot" });
  assert.equal(ok.status, 200);
  assert.equal(s.top("normal")[0].name, "Ace Pilot");
});

test("tokens are signed, single-use and expire", () => {
  const s = store();
  assert.equal(s.submit({ token: "nope", diff: "normal", score: 10, level: 1 }).status, 403);

  const token = s.issueRun();
  const [id, at, sig] = token.split(".");
  const forged = `${id}.${Number(at) - 600e3}.${sig}`;
  assert.equal(s.submit({ token: forged, diff: "normal", score: 10, level: 1 }).status, 403);

  assert.equal(s.submit({ token, diff: "normal", score: 10, level: 1 }).status, 201);
  assert.equal(s.submit({ token, diff: "normal", score: 10, level: 1 }).status, 409);

  const old = s.issueRun();
  s.wait(13 * 3600);
  assert.equal(s.submit({ token: old, diff: "normal", score: 10, level: 1 }).status, 403);
});

test("impossible scores and levels are rejected", () => {
  const s = store();
  const run = (seconds, score, level, diff = "normal") => {
    const token = s.issueRun();
    s.wait(seconds);
    return s.submit({ token, diff, score, level }).status;
  };
  assert.equal(run(30, maxScore(1, 30) + 1, 1), 422, "score above the level 1 maximum");
  assert.equal(run(30, maxScore(1, 30), 1), 201, "exactly the maximum is fine");
  assert.equal(run(20, 500, 3), 422, "level 3 after 20 s");
  assert.equal(run(minSeconds(3) + 10, 4000, 3), 201);
  assert.equal(run(10, 0, 1), 400);
  assert.equal(run(10, 1.5, 1), 400);
  assert.equal(run(10, 100000, 50), 400);
  assert.equal(run(10, 100, 1, "hard"), 400);
  // A rejected token is burnt, so the run can't be retried with a lower score.
  const token = s.issueRun();
  s.wait(10);
  assert.equal(s.submit({ token, diff: "normal", score: 99999, level: 1 }).status, 422);
  assert.equal(s.submit({ token, diff: "normal", score: 100, level: 1 }).status, 409);
});

test("the bounds grow with level and time and stay within the counter", () => {
  assert.equal(minSeconds(1), 0);
  for (let L = 2; L < 30; L++) {
    assert.ok(minSeconds(L) > minSeconds(L - 1));
    assert.ok(maxScore(L, 0) >= maxScore(L - 1, 0));
    assert.ok(maxScore(L, 600) >= maxScore(L, 0));
    assert.ok(maxScore(L, 1e9) <= 99999);
  }
  // Level 1 has no minion-spawning boss, so waiting doesn't raise it.
  assert.equal(maxScore(1, 0), maxScore(1, 3600));
});

test("boards keep the best 100, show 10, and break ties by time", () => {
  const s = store();
  for (let i = 1; i <= KEEP + 5; i++) {
    const token = s.issueRun();
    s.wait(1);
    s.submit({ token, diff: "easy", score: 10 + (i % 50), level: 1, name: "P" + i });
  }
  const top = s.top("easy");
  assert.equal(top.length, SHOW);
  assert.equal(top[0].score, 59);
  assert.equal(top[0].name, "P49", "earlier of the two 59s");
  const token = s.issueRun();
  s.wait(1);
  const low = s.submit({ token, diff: "easy", score: 1, level: 1 });
  assert.equal(low.status, 200);
  assert.equal(low.body.rank, 0);
  assert.equal(low.body.id, undefined);
});

test("scores and the signing key survive a restart", () => {
  const dir = mkdtempSync(join(tmpdir(), "si-scores-"));
  try {
    const a = store({ dataDir: dir });
    assert.equal(a.persistent, true);
    const t1 = a.issueRun();
    const pending = a.issueRun();
    a.wait(5);
    const r = a.submit({ token: t1, diff: "normal", score: 300, level: 1, name: "Keeper" });
    assert.equal(r.status, 201);
    assert.equal(JSON.parse(readFileSync(join(dir, "scores.json"), "utf8")).normal[0].name, "Keeper");

    const b = store({ dataDir: dir });
    assert.equal(b.top("normal")[0].name, "Keeper");
    assert.equal(b.submit({ token: t1, diff: "normal", score: 300, level: 1 }).status, 409, "replay after restart");
    b.wait(5);
    assert.equal(b.submit({ token: pending, diff: "normal", score: 200, level: 1 }).status, 201, "run spanning a deploy");
    assert.equal(b.rename(r.body.id, { key: r.body.key, name: "Still me" }).status, 200);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("names lose control and invisible formatting characters", () => {
  assert.equal(cleanName("‮evil​ name\n"), "evil name");
  assert.equal(cleanName("ABCDEFGHIJKLMNOP"), "ABCDEFGHIJKL");
  assert.equal(cleanName("🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀"), "🚀".repeat(12));
  assert.equal(cleanName(null), "");
});

async function withServer(fn) {
  const server = createApp({ dataDir: null });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await fn(base);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}
const post = (url, body, method = "POST") =>
  fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

test("HTTP API: run, submit, list, rename", () =>
  withServer(async (base) => {
    const { token } = await (await post(base + "/api/run", {})).json();
    const sub = await post(base + "/api/scores", { token, diff: "normal", score: 50, level: 1, name: "Web" });
    assert.equal(sub.status, 201);
    const { id, key, rank } = await sub.json();
    assert.equal(rank, 1);

    const list = await fetch(base + "/api/scores?diff=normal");
    assert.equal(list.headers.get("cache-control"), "no-store");
    assert.deepEqual((await list.json()).entries.map((e) => e.name), ["Web"]);

    const ren = await post(base + "/api/scores/" + id, { key, name: "Web2" }, "PATCH");
    assert.equal(ren.status, 200);
    assert.equal((await ren.json()).entry.name, "Web2");
  }));

test("HTTP API rejects bad requests", () =>
  withServer(async (base) => {
    const plain = await fetch(base + "/api/scores", { method: "POST", body: "{}" });
    assert.equal(plain.status, 415, "JSON content type required, so cross-site forms can't post");
    await plain.text();
    const big = await post(base + "/api/scores", { pad: "x".repeat(5000) });
    assert.equal(big.status, 413);
    await big.text();
    const bad = await fetch(base + "/api/scores", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: "{oops",
    });
    assert.equal(bad.status, 400);
    await bad.text();
    for (const [path, status] of [["/api/scores?diff=hard", 400], ["/api/nope", 404]]) {
      const res = await fetch(base + path);
      assert.equal(res.status, status, path);
      await res.text();
    }
    const getRun = await fetch(base + "/api/run");
    assert.equal(getRun.status, 405);
    await getRun.text();
  }));

test("HTTP API rate-limits per client", () =>
  withServer(async (base) => {
    let last;
    for (let i = 0; i < 31; i++) {
      last = await post(base + "/api/run", {}, "POST");
      await last.text();
    }
    assert.equal(last.status, 429);
    const other = await fetch(base + "/api/run", { method: "POST", headers: { "X-Real-IP": "203.0.113.9" } });
    assert.equal(other.status, 201);
    await other.text();
  }));
