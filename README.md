# Space Impact

A touch-screen side-scrolling shooter in the spirit of the old Nokia phone
games, with three graphics styles: Nokia (monochrome LCD), Pixel and HD.

Live at https://spaceimpact.jannikarndt.de (also https://spaceimpact.timpanini.com).

## Controls

Swipe up or down anywhere to steer, tap to fire. On a keyboard: arrow keys or
W/S to move, Space to fire, P to pause, Esc for the menu.

## Layout

| Path | What it is |
| --- | --- |
| `public/index.html` | The whole game (single file, no build step) |
| `public/fresh.js` | Reloads an open tab when a new build is live, only on the title or game-over screen |
| `server/index.mjs` | Dependency-free Node server: allowlisted static files, build id stamped into the HTML, `GET /version` |
| `server/buildid.mjs` | Hash over everything that ships (`package.json`, `public/`, `server/`) |
| `test/` | `node --test` checks for the server |
| `scripts/caprover-app.sh` | One-time: registers the CapRover app and mints the deploy token |

## Run locally

```sh
PORT=8080 npm start   # http://localhost:8080
npm test
```

## Deploy

Every push to `main` runs the tests, deploys to CapRover at
`captain.timpanini.com`, then polls `$APP_URL/version` until the live build
matches `node server/buildid.mjs`. Needs the repository secrets
`CAPROVER_APP` and `CAPROVER_APP_TOKEN` and the repository variable
`APP_URL`.
