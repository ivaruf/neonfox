/*
 * update.js — registering the service worker, and the one button that accepts
 * a new build.
 *
 * DELIBERATELY SELF-CONTAINED. It imports nothing and exports nothing, and no
 * other module knows it exists. index.html loads it as its own module script,
 * BEFORE js/main.js, so that a game that fails to boot can still be updated out
 * of whatever broke it — a module graph aborts as a whole when one import
 * fails (see the note on filenames in the hub's CLAUDE.md), and an update
 * button living inside main.js's graph would die with it.
 *
 * THE CONTRACT WITH sw.js
 *   Registered with { updateViaCache: 'none' } and update() called at launch,
 *   so a changed sw.js is noticed on every visit instead of whenever the
 *   browser feels like revalidating it. A new worker precaches and then WAITS.
 *   This file shows #update when one is waiting; the tap is the ONLY thing in
 *   the game that posts SKIP_WAITING, and the reload happens only after a
 *   takeover WE asked for.
 *
 * WHY THE BUTTON IS IN THE MENU PANEL
 *   #menu is hidden for the whole of a match, so the button is unreachable
 *   while a round is running. That is the mechanism behind "a deploy must never
 *   destroy a run in progress": not a check in the click handler, but a control
 *   that does not exist on screen until the player is back in the paddock.
 *
 * WHY THE FIRST INSTALL IS NOT AN UPDATE
 *   On a first visit the worker installs with no controller to replace, and it
 *   activates immediately. Offering "update ready" there would be a button that
 *   reloads the page for no reason, so every path below checks that a
 *   controller already exists before treating an installed worker as news.
 */

const button = document.getElementById("update");
const buildLine = document.getElementById("build");

/*
 * Did WE ask for the takeover? `controllerchange` also fires for reasons that
 * are none of our business — another tab of the same game accepting the update,
 * most obviously — and reloading on those would be exactly the mid-run reload
 * the waiting worker exists to prevent. Only our own tap sets this.
 */
let accepted = false;

/** Show the button, wired to the specific worker that is waiting. */
function offer(worker) {
  if (!button || !worker) return;
  button.hidden = false;
  button.onclick = () => {
    accepted = true;
    button.disabled = true;
    const sub = button.querySelector(".update-sub");
    if (sub) sub.textContent = "Taking the new build…";
    worker.postMessage({ type: "SKIP_WAITING" });
  };
}

/*
 * Keep Enter and Space on this button from ALSO starting a match.
 *
 * js/input.js binds Enter and Space on `window` as "start", with no check for
 * what has focus. That is fine for the paddock's other controls — starting a
 * match from the arena slider is harmless — but pressing Enter on this button
 * would accept the update AND launch a round, and the reload would then land a
 * second later on a match that had just begun. Capture phase on the same target
 * runs before input.js's bubble listener and stops the event reaching it, so
 * the button activates and nothing else does. preventDefault is for Space,
 * which input.js would otherwise have swallowed on our behalf.
 *
 * This guard belongs here and not in input.js because input.js is not this
 * file's to change, and because a button that needs its key handling explained
 * should carry the explanation.
 */
if (button) {
  window.addEventListener(
    "keydown",
    (event) => {
      if (event.target !== button) return;
      if (event.code !== "Enter" && event.code !== "Space") return;
      event.preventDefault();
      event.stopPropagation();
      button.click();
    },
    true,
  );
}

/**
 * Ask the worker which build is actually serving this session and print it.
 *
 * Worth the twelve lines: the string baked into a page is the build the page
 * came from, which during a botched release is the one question you cannot
 * answer by looking. A MessageChannel gives the worker somewhere to reply.
 */
function showBuild() {
  const worker = navigator.serviceWorker.controller;
  if (!worker || !buildLine) return;
  try {
    const channel = new MessageChannel();
    channel.port1.onmessage = (event) => {
      const version = event.data && event.data.version;
      if (!version) return;
      buildLine.textContent = `Build ${version}`;
      buildLine.hidden = false;
    };
    worker.postMessage({ type: "GET_VERSION" }, [channel.port2]);
  } catch {
    // No version line. The game is entirely unaffected, which is the point.
  }
}

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!accepted) return;
    // The new worker is in charge. Reload so every module in this session comes
    // from the same build — and we can only be here from the menu, because
    // that is the only place the button exists.
    location.reload();
  });

  navigator.serviceWorker
    .register("sw.js", { updateViaCache: "none" })
    .then((reg) => {
      // Already waiting when we arrived: a previous visit precached it and the
      // player closed the tab before accepting.
      if (reg.waiting && navigator.serviceWorker.controller) offer(reg.waiting);

      reg.addEventListener("updatefound", () => {
        const fresh = reg.installing;
        if (!fresh) return;
        fresh.addEventListener("statechange", () => {
          if (fresh.state === "installed" && navigator.serviceWorker.controller) {
            offer(fresh);
          }
        });
      });

      // Check for a new sw.js now rather than waiting for the browser to think
      // of it. Harmless when there is nothing new; it is one conditional GET.
      reg.update().catch(() => {});
    })
    .catch((err) => {
      // An insecure origin, a private window that blocks workers, a user who
      // has turned them off. The game runs perfectly without one — it simply
      // loses offline play and the install prompt.
      console.warn("NeonFox: no service worker this session", err);
    });

  if (navigator.serviceWorker.controller) showBuild();
  else navigator.serviceWorker.ready.then(showBuild).catch(() => {});
}
