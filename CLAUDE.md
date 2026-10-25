# Space Impact

Touch-screen side-scrolling shooter in the style of Nokia's Space Impact.
Deployed to CapRover (captain.timpanini.com) following the timpanini skill's
pattern. Live at https://spaceimpact.timpanini.com and
https://spaceimpact.jannikarndt.de.

## Ground rules

Follows the app-conventions skill (claude-skills repo).

- All work happens directly on `main`. No branches, no PRs.
- A change isn't done until it's live:

| command | does | last line |
|---|---|---|
| `npm run verify` | what CI runs (`npm test`), before every push | `VERIFY: PASS` |
| `npm run ship` | clean tree → verify → push `main` → waits until live | `LIVE: <build>` |
| `npm run live` | is this tree's build live? (`-- --wait` to poll) | `LIVE: <build>` / `NOT LIVE: …` |
| `npm run logs` | the container's log (needs `CAPROVER_URL`, `CAPROVER_PASSWORD`) | — |
| `npm start` | the server on `PORT` (default 80) | — |
| `npm test` | all tests, incl. `test/deploy-contract.test.mjs` | — |

- Keep `npm run verify` green.

## Project layout

- `public/index.html`: the entire game in one file, no build step, wrapped in
  a single IIFE.
  - `STYLES` defines the three graphics styles (nokia, pixel, hd). Each has a
    scale factor `s`; every distance and speed is multiplied by `s`. Anything
    new must follow the same rule.
  - `G` holds the game state. `stepRun(dt)` runs the per-tick logic: player
    movement, waves, collisions.
  - Swipe input accumulates in `G.dragDy`. Keyboard input is in `keys.up` /
    `keys.down`. The active steering finger is tracked in `steerId`.
  - Settings pattern (copy it for new settings), e.g. graphics style:
    - set via `applyStyle` / `setStyle`;
    - saved in localStorage under `voidlance.style`;
    - shown in the menu sheet's "Graphics" section (`#styleOpts`) and the
      title-screen pills (`#titlePick`);
    - kept in sync by `updateUI()`.
  - Difficulty follows the same pattern: `DIFFS` / `DF`, `setDifficulty`,
    localStorage `voidlance.difficulty` (`normal` | `easy`, default `normal`),
    menu section `#diffOpts`, shown on title and game-over canvases. Applies
    mid-run without a restart.
  - High scores are per difficulty (`HIS`): `voidlance.hi` (normal),
    `voidlance.hi.easy`. A run that used Easy at any point (`G.runEasy`)
    counts toward the Easy table.
  - Top-10 boards per difficulty (`BOARDS`), browser-local only: localStorage
    `voidlance.board` / `voidlance.board.easy` (JSON `[{name, score, level,
    at}]`). `gameOver` inserts a qualifying run under the last used name
    (`voidlance.name`, default `PLAYER`) and sets `G.pendingName`; `step`
    opens the name dialog (`#nameSheet`, `openNamePrompt`) 0.8 s later. The
    menu's "High scores" section lists the boards; any row can be renamed. An
    old `voidlance.hi` without a board shows up as an unnamed entry.
  - Easy = aim assist (`aimAssist` in `stepRun`): eases the ship into a
    target's row; paused while steering input is active (`G.assistHold`).
  - localStorage keys keep the old `voidlance.` prefix (the game was called
    Void Lance) so existing high scores and settings survive. Don't rename.
  - Six stages (`STAGES` = `SECTORS.length`): level n uses sector and boss
    `(n - 1) % STAGES`; each full cycle makes bosses fire faster. A new stage
    needs a sector, colour boss (`colorSet`), mono boss (`MONO.boss`),
    muzzles (`MUZ_PX` and nokia `muz`), `BOSS_PAL` entry and a `bossFire`
    branch.
  - Enemy types: `EDEF`, sprites in `ART` and `MONO`, hitboxes in `HB_PX`
    and nokia `HB`, movement in `updateEnemies`, legend in `LEGEND`.
  - `window.__spaceImpactQuiet` is read by `public/fresh.js`: when a new build
    is live, the page only reloads itself on the title or game-over screen
    with the menu closed.
- `server/index.mjs`: dependency-free Node server.
  - Serves only the files listed in `ROUTES` from `public/`.
  - Stamps the build id into the HTML at `<!--BUILD-->`.
  - Answers `GET /version`.
  - Any new file in `public/` must be added to `ROUTES` and to the asset test.
- `server/buildid.mjs`: hash over `INPUTS` (Dockerfile, package.json,
  package-lock.json, `server/`, `public/`, minus `*.md`). The Dockerfile
  copies exactly these and stamps `BUILD_ID` with this script;
  `server/version.mjs` reads it (computes it when the file is missing,
  e.g. locally). `test/deploy-contract.test.mjs` keeps Dockerfile,
  `.dockerignore` and `INPUTS` in step.
- `test/`: `server.test.mjs` (server, routes, `/version`, `//version`) and
  `deploy-contract.test.mjs` (deploy conventions: pins, permissions,
  timeouts, documented scripts). Run with `npm test`.
- `Dockerfile`: one stage, `node:24-alpine` by digest, runs as `node`, with
  a `HEALTHCHECK` on `/version`.
- `.github/workflows/deploy.yml`: push to `main` → verify → `caprover
  deploy` → waits until `/version` reports this build (falls back to
  https://spaceimpact.timpanini.com when the `APP_URL` variable is unset).
  Secrets `CAPROVER_APP`, `CAPROVER_APP_TOKEN`. Pull requests run verify
  only.
- `.github/dependabot.yml` + `workflows/dependabot-merge.yml`: weekly action
  SHA and base image digest updates that merge and deploy themselves on
  green.
- `scripts/`: `verify.mjs`, `live.mjs`, `ship.mjs`, `logs.mjs` (the
  commands above).
- CapRover app `spaceimpact`, also at https://spaceimpact.jannikarndt.de
  (custom domain, HTTPS forced). Registering apps and domains: the
  timpanini skill.
