/*
 * input.js — keyboard + touch buttons -> turn per seat, plus one-shot
 * commands (start / restart / menu).
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
 * `held` class and pointer capture.
 */

const SCROLL_KEYS = new Set([
  "ArrowLeft",
  "ArrowRight",
  "ArrowUp",
  "ArrowDown",
  "Space",
]);

export class Input {
  constructor() {
    /** @type {Set<string>} currently held KeyboardEvent.code values */
    this.held = new Set();

    /** (name: 'start' | 'restart' | 'menu') => void, set by main.js */
    this.onCommand = null;

    // Touch is tracked separately from `held` because a synthetic code
    // would be a fiction the rest of the class has to remember to check;
    // turn(0) simply ORs the two sources together instead.
    this._touchLeft = false;
    this._touchRight = false;

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
        this.onCommand("start");
      } else if (event.code === "KeyR") {
        this.onCommand("restart");
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
}
