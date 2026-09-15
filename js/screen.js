/*
 * screen.js — the fullscreen toggle in the top-right corner cluster.
 *
 * DELIBERATELY SELF-CONTAINED, the same shape as js/update.js: it imports
 * nothing and exports nothing, and no other module knows it exists.
 * index.html loads it as its own module script, independent of js/main.js,
 * so a game that fails to boot for some unrelated reason does not also take
 * down the one button that might make the arena easier to see on a phone.
 *
 * NOT NAMED fullscreen.js, and the word does not appear in this path at
 * all. uBlock Origin's default filter lists carry a rule matching any repo
 * under github.io whose basename is "fullscreen.js", which blanked
 * fishtank for every visitor running it, because a blocked import aborts
 * the whole module graph (hub CLAUDE.md §2). This file is the renamed
 * shape fishtank landed on.
 *
 * SUPPORT IS NOT UNIVERSAL. Safari on iPhone has no Element.requestFullscreen
 * at all — fullscreen there is reserved for <video> — and a button that does
 * nothing when pressed is worse than no button, so the very first thing this
 * file does is check for a working pair of APIs and leave the button hidden
 * (as index.html already has it) when there is none. The cluster it sits in
 * shrinks to the one remaining icon; nothing else has to know.
 *
 * Escape leaves fullscreen without ever touching this button, so the label
 * and aria-pressed are kept in sync from the fullscreenchange event rather
 * than only from the click handler.
 *
 * It works inside the arcade's iframe: the arcade's iframe allow list
 * already grants `fullscreen`.
 */

const button = document.getElementById("screen-toggle");
const root = document.documentElement;

// webkit-prefixed forms are the fallback for older Safari; everywhere else
// this game runs, the unprefixed standard names are what exist.
const request = root.requestFullscreen || root.webkitRequestFullscreen || null;
const exit = document.exitFullscreen || document.webkitExitFullscreen || null;

function isFullscreen() {
  return !!(document.fullscreenElement || document.webkitFullscreenElement);
}

/*
 * Keep the label and aria-pressed matching reality, whoever changed it.
 *
 * The button is a glyph in the corner cluster now rather than a word pill in
 * the menu, so this writes aria-label and title where it used to write
 * textContent — and that is not a downgrade in what it says, it is the only
 * thing that says anything at all. The picture is swapped by CSS off the same
 * aria-pressed, so the two cannot drift: four corners pushing out, or the
 * same four pulled in.
 *
 * The words stay plain, against this hub's usual habit of naming controls the
 * way the game would. The pair this once carried — "Fill the arena" /
 * "Shrink the arena" — described the arena rather than the browser and left a
 * player guessing whether it moved the camera, the arena size slider, or the
 * window. Fullscreen is not part of the fiction; it is a thing the browser
 * does, it has one name everywhere, and the player already knows it.
 */
function paint() {
  const active = isFullscreen();
  const label = active ? "Exit fullscreen" : "Fullscreen";
  button.setAttribute("aria-pressed", String(active));
  button.setAttribute("aria-label", label);
  button.title = label;
}

if (button && request && exit) {
  button.hidden = false;
  paint();

  button.addEventListener("click", () => {
    const result = isFullscreen() ? exit.call(document) : request.call(root);
    // Either call returns a promise that can reject — a permissions policy
    // refusing it, or the player backing out of a browser prompt. paint()
    // via fullscreenchange already covers what actually happened, so this
    // only exists to stop a refusal from surfacing as an unhandled
    // rejection on index.html's own crash bar.
    if (result && typeof result.catch === "function") {
      result.catch(() => {});
    }
  });

  // The button is not the only way out of fullscreen — Escape, or the
  // browser's own chrome — so the label has to be able to catch up from
  // outside the click handler too.
  document.addEventListener("fullscreenchange", paint);
  document.addEventListener("webkitfullscreenchange", paint);
}
