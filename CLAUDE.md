# Void Lance

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
  - `window.__voidLanceQuiet` is read by `public/fresh.js`: when a new build
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
- `scripts/connect-domain.sh`: adds the custom domain, gets its certificate
  and forces HTTPS.
- `caprover api` quirk: a call without `-d` opens an interactive prompt and
  fails non-interactively; always pass `-d` (use `'{}'` for GET).
