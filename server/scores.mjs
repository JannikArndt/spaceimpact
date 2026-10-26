// Global high scores: top 100 per difficulty, kept in DATA_DIR/scores.json
// (a CapRover persistent directory in production).
//
// Anti-cheat is plausibility only; there are no accounts, so a determined
// cheater can still script a believable run. Each run starts with a signed
// token from POST /api/run, so the server knows when it started. A
// submission is rejected if its level couldn't be reached in the elapsed time
// or its score is above the most the game can award by that level and time
// (rules below mirror public/index.html). Tokens are single-use, requests are
// rate-limited per IP, and names are sanitised.

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const DIFFS = ["normal", "easy"];
export const KEEP = 100;
export const SHOW = 10;
export const NAME_MAX = 12;
export const NAME_DEFAULT = "PLAYER";
export const SCORE_MAX = 99999;
export const LEVEL_MAX = 999;
const TOKEN_TTL = 12 * 3600e3;

/* ---- Game rules, mirrored from public/index.html. Keep in sync. ---- */

// beginLevel: G.wavesLeft; the wave timer in stepRun.
const waves = (L) => Math.min(10 + 2 * L, 22);
const waveGap = (L) => Math.max(1.6, 3.4 - 0.2 * L);
// Most a single wave can award: 60 points (6 birds in snake or pair, or 2
// rocks) over at most 6 kills; from level 4 a bonus wave of 3 chargers (45
// points) can join it. EDEF scores.
const wavePts = (L) => 60 + (L >= 4 ? 45 : 0);
const waveKills = (L) => 6 + (L >= 4 ? 3 : 0);
const BOSS_BONUS = 250; // hurtBoss: 250 * level
// Bosses that spawn minions can be farmed indefinitely, so time adds score:
// boss 1 spawns a drone (5) every 6 volleys at 0.55 s / rate, boss 3 a mine
// (20) every 3 volleys at 0.8 s / rate (bossFire).
const bossRate = (L) => 1 + 0.2 * Math.floor((L - 1) / 6) + 0.04 * (L - 1);
const farm = (L) =>
  L >= 4 ? { pts: 20 / 2.4, kills: 1 / 2.4 } : L >= 2 ? { pts: 5 / 3.3, kills: 1 / 3.3 } : { pts: 0, kills: 0 };
// Each pickup is worth 50 (collect). Drops are random: at most 30 % per kill
// plus a sure one every 25th kill (maybeDrop), so more than half of all kills
// plus 8 is beyond any real run (odds well under 1 in 10,000).
const PICKUP = 50;
const pickups = (kills) => 0.5 * kills + 8;

// Highest score a run can have while on `level` after `seconds` of play.
export function maxScore(level, seconds) {
  let pts = 0, kills = 0;
  for (let k = 1; k <= level; k++) {
    pts += waves(k) * wavePts(k) + BOSS_BONUS * k;
    kills += waves(k) * waveKills(k);
  }
  const f = farm(level), t = Math.max(0, seconds) * bossRate(level);
  pts += f.pts * t;
  kills += f.kills * t;
  return Math.min(SCORE_MAX, Math.ceil(pts + PICKUP * pickups(kills)));
}

// Shortest possible time in seconds to reach `level`: per cleared level the
// 2.0 s intro, the first wave at 0.3 s, the wave gaps, the 2.4 s warning, the
// 1.6 s boss death and the 2.8 s "stage clear" (stepRun, updateBoss).
export function minSeconds(level) {
  let t = 0;
  for (let k = 1; k < level; k++) t += 2.0 + 0.3 + (waves(k) - 1) * waveGap(k) + 2.4 + 1.6 + 2.8;
  return t;
}
// Allowance for request latency and clock jitter between token and submit.
const timeOk = (level, seconds) => seconds >= 0.9 * minSeconds(level) - 5;

/* ---- Helpers ---- */

export function cleanName(v) {
  const s = String(v ?? "").replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, "").replace(/\s+/g, " ").trim();
  return Array.from(s).slice(0, NAME_MAX).join("");
}

function validEntry(r) {
  return r && typeof r.id === "string" && /^[0-9a-f]{16}$/.test(r.id) &&
    Number.isInteger(r.score) && r.score > 0 && r.score <= SCORE_MAX &&
    Number.isInteger(r.level) && r.level >= 1 && r.level <= LEVEL_MAX && typeof r.name === "string";
}

const byRank = (a, b) => b.score - a.score || a.at - b.at;
const pub = ({ id, name, score, level, at }) => ({ id, name, score, level, at });

function limiter(max, windowMs) {
  const hits = new Map();
  return (key, now) => {
    if (hits.size > 10000) for (const [k, v] of hits) if (v.reset <= now) hits.delete(k);
    let h = hits.get(key);
    if (!h || h.reset <= now) hits.set(key, (h = { n: 0, reset: now + windowMs }));
    return ++h.n <= max;
  };
}

/* ---- Store ---- */

export function createScores({ dataDir, now = Date.now, log = console } = {}) {
  let persist = Boolean(dataDir);
  const file = persist ? join(dataDir, "scores.json") : null;
  let secret;
  let boards = { normal: [], easy: [] };

  if (persist) {
    try {
      mkdirSync(dataDir, { recursive: true });
      try {
        secret = Buffer.from(readFileSync(join(dataDir, "secret.key"), "utf8").trim(), "hex");
      } catch {}
      if (!secret || secret.length < 32) {
        secret = randomBytes(32);
        writeFileSync(join(dataDir, "secret.key"), secret.toString("hex") + "\n", { mode: 0o600 });
      }
      try {
        const raw = JSON.parse(readFileSync(file, "utf8"));
        for (const d of DIFFS) {
          if (Array.isArray(raw[d])) boards[d] = raw[d].filter(validEntry).map(pub).sort(byRank).slice(0, KEEP);
        }
      } catch (e) {
        if (e.code !== "ENOENT") log.error(`scores: could not read ${file}: ${e.message}`);
      }
    } catch (e) {
      log.error(`scores: ${dataDir} is not writable (${e.message}); keeping scores in memory only`);
      persist = false;
    }
  }
  if (!secret) secret = randomBytes(32);

  const sign = (s) => createHmac("sha256", secret).update(s).digest("base64url");
  const same = (a, b) => {
    const x = Buffer.from(String(a)), y = Buffer.from(String(b));
    return x.length === y.length && timingSafeEqual(x, y);
  };
  const editKey = (id) => sign("edit:" + id).slice(0, 22);

  // Run ids already submitted and still within the token lifetime.
  const used = new Map();

  function save() {
    if (!persist) return;
    try {
      const tmp = file + ".tmp";
      writeFileSync(tmp, JSON.stringify(boards));
      renameSync(tmp, file);
    } catch (e) {
      log.error(`scores: could not write ${file}: ${e.message}`);
    }
  }

  function issueRun() {
    const id = randomBytes(8).toString("hex");
    const body = `${id}.${now()}`;
    return `${body}.${sign("run:" + body)}`;
  }

  function checkToken(token) {
    const m = /^([0-9a-f]{16})\.(\d{1,15})\.([\w-]{43})$/.exec(typeof token === "string" ? token : "");
    if (!m || !same(m[3], sign(`run:${m[1]}.${m[2]}`))) return { error: "invalid run token" };
    const started = Number(m[2]), t = now();
    if (started > t + 60e3 || t - started > TOKEN_TTL) return { error: "run token expired" };
    if (used.has(m[1]) || DIFFS.some((d) => boards[d].some((r) => r.id === m[1]))) {
      return { error: "run already submitted", status: 409 };
    }
    return { id: m[1], seconds: (t - started) / 1000 };
  }

  // -> { status, body }
  function submit(input) {
    const { token, diff, score, level } = input || {};
    if (!DIFFS.includes(diff)) return { status: 400, body: { error: "unknown difficulty" } };
    if (!Number.isInteger(score) || score < 1 || score > SCORE_MAX) return { status: 400, body: { error: "bad score" } };
    if (!Number.isInteger(level) || level < 1 || level > LEVEL_MAX) return { status: 400, body: { error: "bad level" } };
    const run = checkToken(token);
    if (run.error) return { status: run.status || 403, body: { error: run.error } };
    // Burn the token before judging it, so a rejected run can't be retried.
    const t = now();
    used.set(run.id, t + TOKEN_TTL);
    for (const [k, exp] of used) if (exp <= t) used.delete(k);
    if (!timeOk(level, run.seconds)) return { status: 422, body: { error: "level reached too fast" } };
    if (score > maxScore(level, run.seconds)) return { status: 422, body: { error: "score not possible" } };

    const entry = { id: run.id, name: cleanName(input.name) || NAME_DEFAULT, score, level, at: t };
    const b = boards[diff];
    b.push(entry);
    b.sort(byRank);
    const rank = b.indexOf(entry) + 1;
    b.length = Math.min(b.length, KEEP);
    if (rank > KEEP) return { status: 200, body: { rank: 0, top: top(diff) } };
    save();
    return { status: 201, body: { id: entry.id, key: editKey(entry.id), rank, top: top(diff) } };
  }

  function rename(id, input) {
    const { key, name } = input || {};
    if (typeof id !== "string" || !same(key, editKey(id))) return { status: 403, body: { error: "not your entry" } };
    for (const d of DIFFS) {
      const r = boards[d].find((e) => e.id === id);
      if (!r) continue;
      r.name = cleanName(name) || NAME_DEFAULT;
      save();
      return { status: 200, body: { entry: pub(r) } };
    }
    return { status: 404, body: { error: "entry no longer on the board" } };
  }

  const top = (diff) => boards[diff].slice(0, SHOW).map(pub);

  return {
    issueRun,
    submit,
    rename,
    top,
    limits: { run: limiter(30, 600e3), submit: limiter(30, 600e3), rename: limiter(30, 600e3) },
    get persistent() {
      return persist;
    },
  };
}
