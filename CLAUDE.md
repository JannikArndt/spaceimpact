# Space Impact

Touch-screen side-scrolling shooter in the style of Nokia's Space Impact.
Deployed to CapRover (captain.timpanini.com) following the timpanini skill's
pattern. Live at https://spaceimpact.timpanini.com and
https://spaceimpact.jannikarndt.de.

## Ground rules

- All work happens directly on `main`. No branches, no PRs.
- Every change gets deployed:
  1. Commit and push to `main`.
  2. Watch the Actions run (`gh run watch`).
  3. Confirm `curl -s https://spaceimpact.timpanini.com/version` reports the
     same `build` as `node server/buildid.mjs`.
- A change isn't done until it's live.
- Keep `npm test` green.

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
- `server/buildid.mjs`: hash over `package.json`, `public/` and `server/`. It
  must cover exactly what the `Dockerfile` copies.
- `test/server.test.mjs`: tests, run with `node --test` (`npm test`).
- `.github/workflows/deploy.yml`: on push to `main`: test, `caprover deploy`,
  then poll `$APP_URL/version` until it matches. Needs secrets
  `CAPROVER_APP`, `CAPROVER_APP_TOKEN` and variable `APP_URL`.
- `scripts/caprover-app.sh`: registers the app on CapRover and mints the
  deploy token.
- `caprover api` quirk: a call without `-d` opens an interactive prompt and
  fails non-interactively; always pass `-d` (use `'{}'` for GET).
