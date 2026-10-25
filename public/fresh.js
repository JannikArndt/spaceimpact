// Client-side auto-update (the app-conventions skill's fresh.js, adapted).
// Notices a new build is live and reloads at a safe moment. Rules, most
// expensive to get wrong first:
//   1. Never mid-game: only when window.__spaceImpactQuiet() says so (title
//      or game-over screen, menu and name dialog closed).
//   2. Never twice for the same build (sessionStorage): one build behind
//      beats a reload loop.
//   3. Never in the first 20 s of a page's life.
//   4. No build in the page ("dev": opened as a file or on another host):
//      do nothing.
// Nothing is lost by the reload: scores and settings are in localStorage.

(() => {
  const MIN_PAGE_AGE_MS = 20_000;
  const POLL_MS = 5 * 60_000;
  const RETRY_MS = 2_000;
  const KEY = "spaceimpact.fresh.reloaded";
  const pageLoadedAt = Date.now();
  let reloading = false;
  let waiting = false;

  const currentBuild = () => document.querySelector('meta[name="app-build"]')?.content || "dev";

  function isQuiet() {
    try {
      return typeof window.__spaceImpactQuiet === "function" ? !!window.__spaceImpactQuiet() : true;
    } catch {
      return false;
    }
  }

  async function checkForNewBuild() {
    if (reloading || waiting) return;
    if (Date.now() - pageLoadedAt < MIN_PAGE_AGE_MS) return;
    const mine = currentBuild();
    if (mine === "dev") return;
    let live;
    try {
      const res = await fetch("/version", { cache: "no-store" });
      live = (await res.json()).build;
    } catch {
      return; // offline or the server is restarting: try again later
    }
    if (!live || live === mine) return;
    try {
      if (sessionStorage.getItem(KEY) === live) return; // tried once already
    } catch { /* storage blocked: the in-page flags still prevent a loop */ }
    waiting = true;
    reloadWhenQuiet(live);
  }

  // A run can last minutes: keep checking every 2 s, so the update lands on
  // the game-over or title screen right away rather than at the next poll.
  function reloadWhenQuiet(live) {
    if (reloading) return;
    if (document.visibilityState === "visible" && isQuiet()) {
      reloading = true;
      try { sessionStorage.setItem(KEY, live); } catch {}
      location.reload();
      return;
    }
    setTimeout(() => reloadWhenQuiet(live), RETRY_MS);
  }

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") checkForNewBuild();
  });
  // iOS restores Home Screen apps from memory; these fire when it does.
  window.addEventListener("pageshow", (e) => { if (e.persisted) checkForNewBuild(); });
  window.addEventListener("focus", () => checkForNewBuild());
  setInterval(checkForNewBuild, POLL_MS);
})();
