// Client-side auto-update, adapted from the timpanini skill's fresh.js.
// Notices a new build is live and reloads, but only at a safe moment:
// never mid-game, never with the menu open, never in the first 20 seconds,
// never twice. The game defines "safe" via window.__voidLanceQuiet().

(() => {
  const MIN_PAGE_AGE_MS = 20_000;
  const POLL_MS = 5 * 60_000;
  const pageLoadedAt = Date.now();
  let alreadyReloaded = false;

  function currentBuild() {
    return document.querySelector('meta[name="app-build"]')?.content || "dev";
  }

  function isQuiet() {
    // Title screen or game-over screen, menu closed. A paused run is not
    // quiet: reloading would throw the run away.
    try {
      return typeof window.__voidLanceQuiet === "function" ? !!window.__voidLanceQuiet() : true;
    } catch {
      return false;
    }
  }

  async function checkForNewBuild() {
    if (alreadyReloaded) return;
    if (Date.now() - pageLoadedAt < MIN_PAGE_AGE_MS) return;
    if (currentBuild() === "dev") return; // opened as a plain file or on another host: stay quiet

    let live;
    try {
      const res = await fetch("/version", { cache: "no-store" });
      live = (await res.json()).build;
    } catch {
      return; // offline or server down: try again next tick
    }

    if (live && live !== currentBuild() && isQuiet()) {
      alreadyReloaded = true;
      location.reload();
    }
  }

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") checkForNewBuild();
  });
  setInterval(checkForNewBuild, POLL_MS);
  // Also re-check shortly after a run ends, so a waiting update lands on
  // the game-over or title screen instead of hours later.
  setInterval(() => { if (isQuiet()) checkForNewBuild(); }, 30_000);
})();
