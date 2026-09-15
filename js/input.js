/*
 * input.js — keyboard + touch buttons -> turn per seat, plus one-shot
 * commands (start / menu), plus the spectator camera's own reads: a
 * drag/pinch/wheel accumulator and the up/down zoom keys.
 *
 * THERE IS NO RESTART KEY, and its absence is the design. R used to throw the
 * whole match away the instant it went down — one unmodified letter, a stray
 * reach from the A and D that rider two steers with, and nothing asked
 * first. Restarting is still one press, but it is on the pause overlay now,
 * which means stopping the game to get to it. 'menu' is Escape and no longer
 * abandons a match either; main.js turns it into that overlay.
 *
 * This module owns nothing but a live "what is currently held" picture: a
 * Set of key codes plus two touch flags. turn(seat) reads that picture on
 * demand every sim tick rather than pushing events, because steering is a
 * continuous quantity (held or not, this frame), while start/restart/menu
 * are discrete and belong on onCommand instead. Left is +1 throughout,
 * matching the sim's convention (ARCHITECTURE.md: steering left is a
 * positive turn) so this file never has to flip a sign main.js also has to
 * know about.
 *
 * No DOM structure is invented here: bindTouch() is handed the two button
 * elements index.html already defines and only ever reads/writes their
 * `held` class and pointer capture. bindDrag() is handed the arena canvas
 * itself and reads pointer/wheel events already scoped to it — CSS already
 * sets `touch-action: none` there, so a finger drag never scrolls the page,
 * and attaching to the canvas rather than window means the touch steering
 * buttons (their own elements, capturing their own pointers) never reach it.
 *
 * The drag/pinch/wheel picture is an accumulator, same idea as `held`: three
 * numbers (dx, dy, dz) that grow between takeDrag() calls and are handed
 * back and zeroed once a step, so a frame's worth of pointer motion is spent
 * exactly once by whoever asked for it (main.js, once a step, while
 * spectating — see ARCHITECTURE.md "Spinning while spectating").
 */

const SCROLL_KEYS = new Set([
  "ArrowLeft",
  "ArrowRight",
  "ArrowUp",
  "ArrowDown",
  "Space",
]);

// Elements the 'start' command must not fire from. The paddock is full of
// buttons and sliders, and Enter/Space on a focused one of these should do
// what that control does (a click, a value nudge) rather than ALSO launch
// a match out from under it. Arrows are deliberately not filtered the same
// way: a focused slider adjusting on an arrow key is correct browser
// behaviour, and during a match #menu (the only place these controls live)
// is hidden anyway, so turn()'s callers never need to know about focus.
const INTERACTIVE_TAGS = new Set(["BUTTON", "INPUT", "SELECT", "TEXTAREA"]);
function isInteractive(target) {
  if (!target) return false;
  if (target.isContentEditable) return true;
  return INTERACTIVE_TAGS.has(target.tagName);
}

export class Input {
  constructor() {
    /** @type {Set<string>} currently held KeyboardEvent.code values */
    this.held = new Set();

    /** (name: 'start' | 'menu') => void, set by main.js */
    this.onCommand = null;

    // Touch is tracked separately from `held` because a synthetic code
    // would be a fiction the rest of the class has to remember to check;
    // turn(0) simply ORs the two sources together instead.
    this._touchLeft = false;
    this._touchRight = false;

    // Drag/pinch/wheel accumulator (see the header comment) plus a second,
    // identically-shaped object that takeDrag() copies into and hands out —
    // so the object a caller is reading from is never the one this class is
    // still zeroing on the very next pointer event.
    this._drag = { dx: 0, dy: 0, dz: 0 };
    this._dragOut = { dx: 0, dy: 0, dz: 0 };

    window.addEventListener("keydown", (event) => {
      // Arrows and space must never scroll the page, even on the very
      // first (non-repeat) press, so this runs before the repeat check.
      if (SCROLL_KEYS.has(event.code)) event.preventDefault();

      this.held.add(event.code);

      // A held key auto-repeats keydown at the OS rate; commands are
      // one-shot, so a repeat must not re-fire 'start' a dozen times.
      if (event.repeat) return;

      if (!this.onCommand) return;
      if (event.code === "Enter" || event.code === "Space") {
        if (!isInteractive(event.target)) this.onCommand("start");
      } else if (event.code === "Escape") {
        this.onCommand("menu");
      }
    });

    window.addEventListener("keyup", (event) => {
      this.held.delete(event.code);
    });
  }

  /** -1 | 0 | 1 turn for the given seat; both directions held cancels to 0. */
  turn(seat) {
    let left;
    let right;
    if (seat === 0) {
      left = this.held.has("ArrowLeft") || this._touchLeft;
      right = this.held.has("ArrowRight") || this._touchRight;
    } else if (seat === 1) {
      left = this.held.has("KeyA") || this.held.has("KeyQ");
      right = this.held.has("KeyD") || this.held.has("KeyE");
    } else {
      return 0;
    }
    if (left === right) return 0;
    return left ? 1 : -1;
  }

  /** Whether either touch button is currently pressed (seat 0 only). */
  get touchActive() {
    return this._touchLeft || this._touchRight;
  }

  /** +1 ArrowUp (zoom in) | -1 ArrowDown (zoom out) | 0 neither or both held. */
  zoomKey() {
    const up = this.held.has("ArrowUp");
    const down = this.held.has("ArrowDown");
    if (up === down) return 0;
    return up ? 1 : -1;
  }

  /**
   * Wire the two on-screen steering buttons. Pointer capture (not a plain
   * click/press pair) means a thumb that drifts off the button while still
   * down keeps steering, and a lost capture (app switch, browser chrome)
   * releases it rather than latching a turn on forever.
   */
  bindTouch(leftButton, rightButton) {
    this.touchButtons = { left: leftButton, right: rightButton };

    const wire = (button, prop) => {
      const setHeld = (value) => {
        this[prop] = value;
        button.classList.toggle("held", value);
      };
      button.addEventListener("pointerdown", (event) => {
        event.preventDefault();
        try {
          button.setPointerCapture(event.pointerId);
        } catch {
          // Capture can fail (e.g. already released); the held flag below
          // still tracks state correctly from the up/cancel events.
        }
        setHeld(true);
      });
      const release = () => setHeld(false);
      button.addEventListener("pointerup", release);
      button.addEventListener("pointercancel", release);
      button.addEventListener("lostpointercapture", release);
      // A long-press must not pop the browser's context menu mid-round.
      button.addEventListener("contextmenu", (event) => event.preventDefault());
    };

    wire(leftButton, "_touchLeft");
    wire(rightButton, "_touchRight");
  }

  /**
   * Wire the spectator camera's drag/pinch/wheel input onto the arena
   * canvas. One pointer down accumulates its CSS-pixel motion straight into
   * dx/dy; a second pointer down switches to pinch, where it is the *change*
   * in the distance between the two pointers that accumulates, into dz —
   * fingers spreading apart shrink dz (zoom in), matching wheel-up below, so
   * main.js never has to know which gesture produced a given dz. Pointer
   * capture is per-pointer (not exclusive), so both fingers of a pinch can
   * be tracked at once without one stealing the other's events.
   */
  bindDrag(canvas) {
    const pointers = new Map(); // pointerId -> last {x, y} in CSS px
    let lastSpread = null; // distance between the two pointers, previous frame

    const spread = () => {
      if (pointers.size < 2) return null;
      const [a, b] = pointers.values();
      return Math.hypot(a.x - b.x, a.y - b.y);
    };

    canvas.addEventListener("pointerdown", (event) => {
      try {
        canvas.setPointerCapture(event.pointerId);
      } catch {
        // Capture can fail (e.g. the pointer already went away); the move
        // and up handlers below still key off the id in `pointers`.
      }
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      lastSpread = spread();
    });

    canvas.addEventListener("pointermove", (event) => {
      const p = pointers.get(event.pointerId);
      if (!p) return; // a pointer that never landed on the canvas (e.g. a touch button)
      const dx = event.clientX - p.x;
      const dy = event.clientY - p.y;
      p.x = event.clientX;
      p.y = event.clientY;

      if (pointers.size >= 2) {
        // Pinching: only the spread (zoom) is meaningful, so the pan/orbit
        // accumulator is left untouched while a second finger is down.
        const now = spread();
        if (lastSpread != null && now != null) {
          this._drag.dz += -(now - lastSpread);
        }
        lastSpread = now;
      } else {
        this._drag.dx += dx;
        this._drag.dy += dy;
      }
    });

    const release = (event) => {
      pointers.delete(event.pointerId);
      lastSpread = spread();
    };
    canvas.addEventListener("pointerup", release);
    canvas.addEventListener("pointercancel", release);

    // Wheel deltas arrive in one of three units; only "line" shows up on any
    // device likely to reach this game, so it is the only one normalised —
    // to about one text line's worth of pixels, the browsers' own rule of
    // thumb for DOM_DELTA_LINE.
    canvas.addEventListener(
      "wheel",
      (event) => {
        event.preventDefault();
        const scale = event.deltaMode === 1 ? 16 : 1;
        this._drag.dz += event.deltaY * scale;
      },
      { passive: false },
    );
  }

  /**
   * The drag/pinch/wheel accumulator since the last call, then zeroed. Hands
   * back `_dragOut` rather than `_drag` itself: main.js reads the returned
   * object after this call returns, by which point `_drag` is already back
   * at zero and free to accumulate the next step's motion, so there is no
   * object here that is simultaneously "what the caller is reading" and
   * "what a pointermove is still writing to".
   */
  takeDrag() {
    this._dragOut.dx = this._drag.dx;
    this._dragOut.dy = this._drag.dy;
    this._dragOut.dz = this._drag.dz;
    this._drag.dx = 0;
    this._drag.dy = 0;
    this._drag.dz = 0;
    return this._dragOut;
  }
}
