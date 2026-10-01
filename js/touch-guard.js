/*
 * touch-guard.js — stop the browser treating the paddock as a page of text.
 *
 * On a tablet the riders are steered by two big round buttons a thumb sits
 * on for a whole round, and the paddock is rows of labels — Arena, Turning,
 * Win at, rider names, a room code. To Safari a resting thumb is a long press
 * and a drag that starts on a label is a selection, so it highlights a rider's
 * name or the scoreboard and offers Copy / Look Up mid-round. css/style.css
 * turns selection and the callout off; this is the half CSS cannot promise,
 * for the engines and the edges where it is not honoured (hub CLAUDE.md §2,
 * "a game is not a document"):
 *
 *   selectstart   cancelled unless it begins in a real text field
 *   contextmenu   cancelled likewise — on touch it IS the long-press menu.
 *                 js/input.js already cancels it on the two steer buttons;
 *                 this covers everything else, and the two never disagree.
 *   selectionchange  anything that slipped through anyway is cleared, unless
 *                 a field has focus. The paddock has no text field today;
 *                 the exemption is there so the day one arrives it works.
 *
 * The cost, written down: no right-click menu over the game on desktop
 * either. Nothing in a game wants one, and devtools stay a keystroke away.
 *
 * A classic script, self-contained, importing nothing, for the same reason
 * screen.js stands apart from main.js: a failure anywhere in the module
 * graph must not take this down with it, and this must not take anything
 * else down. It is a same-repo file that loads, so it carries no
 * data-handled — if it ever fails, the crash bar should say so.
 */
(function () {
  "use strict";

  function editable(node) {
    return !!(
      node &&
      node.closest &&
      node.closest('input, textarea, select, [contenteditable="true"]')
    );
  }

  document.addEventListener("selectstart", function (e) {
    if (!editable(e.target)) e.preventDefault();
  });

  document.addEventListener("contextmenu", function (e) {
    if (!editable(e.target)) e.preventDefault();
  });

  document.addEventListener("selectionchange", function () {
    if (editable(document.activeElement)) return;
    var sel = window.getSelection && window.getSelection();
    if (sel && sel.rangeCount && !sel.isCollapsed) sel.removeAllRanges();
  });
})();
