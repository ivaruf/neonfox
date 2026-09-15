/*
 * ui.js — menu, scoreboard, banners, touch button visibility.
 *
 * This class shows what it is told and nothing more: it holds no round
 * state, no scores of its own, no notion of who is winning. main.js reads
 * the sim and match objects and calls showHud/setScores/banner accordingly;
 * this file only ever touches the DOM ids index.html already defines (never
 * invents new structure) and reports back through the four constructor
 * callbacks. The one piece of real logic it does own — humans + ais capped
 * at MAX_PLAYERS — lives here because it is a property of the two segmented
 * rows themselves, not of a running match.
 */

import { MAX_PLAYERS } from "./config.js";

export class UI {
  constructor(root, { onStart, onRematch, onMenu, onSound } = {}) {
    this.root = root;

    this.menuEl = root.querySelector("#menu");
    this.hudEl = root.querySelector("#hud");
    this.scoresEl = root.querySelector("#scores");
    this.targetEl = root.querySelector("#target");
    this.bannerEl = root.querySelector("#banner");
    this.bannerSubEl = root.querySelector("#banner-sub");
    this.bannerTextEl = root.querySelector("#banner-text");
    this.bannerActionsEl = root.querySelector("#banner-actions");
    this.touchEl = root.querySelector("#touch");
    this.soundEl = root.querySelector("#sound");

    const left = root.querySelector("#turn-left");
    const right = root.querySelector("#turn-right");
    this.touchButtons = { left, right };

    this.humansSeg = root.querySelector('.seg[data-seg="humans"]');
    this.aiSeg = root.querySelector('.seg[data-seg="ai"]');

    // Selecting a button presses it and un-presses its row-mates; changing
    // the humans row can also invalidate the current rivals selection, so
    // that row's wiring re-runs the cap afterwards.
    this._wireSeg(this.humansSeg, () => this._enforceCap());
    this._wireSeg(this.aiSeg, () => {});
    this._enforceCap();

    root.querySelector("#start").addEventListener("click", () => {
      if (onStart) onStart();
    });
    root.querySelector("#rematch").addEventListener("click", () => {
      if (onRematch) onRematch();
    });
    root.querySelector("#to-menu").addEventListener("click", () => {
      if (onMenu) onMenu();
    });

    this.soundEl.addEventListener("click", () => {
      const next = this.soundEl.getAttribute("aria-pressed") !== "true";
      this.setSound(next);
      if (onSound) onSound(next);
    });

    // Once a touch has ever landed on the page, treat the pointer as
    // coarse even on a device whose media query disagrees (some hybrid
    // laptops report "fine" while the user is plainly using a finger).
    this._touchSeen = false;
    window.addEventListener(
      "touchstart",
      () => {
        this._touchSeen = true;
      },
      { once: true, passive: true },
    );
  }

  /** One button per row is pressed at a time; clicking sets that and clears the rest. */
  _wireSeg(seg, onChange) {
    seg.addEventListener("click", (event) => {
      const button = event.target.closest("button");
      if (!button || button.disabled || button.parentElement !== seg) return;
      for (const sibling of seg.querySelectorAll("button")) {
        sibling.setAttribute("aria-pressed", String(sibling === button));
      }
      onChange();
    });
  }

  /** Disable rivals options that would exceed MAX_PLAYERS, moving the
   *  selection down if the pressed one no longer fits. */
  _enforceCap() {
    const humans = this.humans;
    const buttons = [...this.aiSeg.querySelectorAll("button")];
    let highestAllowed = null;
    for (const button of buttons) {
      const value = Number(button.dataset.v);
      const allowed = humans + value <= MAX_PLAYERS;
      button.disabled = !allowed;
      if (allowed) highestAllowed = value;
    }
    const pressed = this.aiSeg.querySelector('button[aria-pressed="true"]');
    if (pressed && pressed.disabled && highestAllowed !== null) {
      for (const button of buttons) {
        const isNewPick = Number(button.dataset.v) === highestAllowed;
        button.setAttribute("aria-pressed", String(isNewPick));
      }
    }
  }

  get humans() {
    return Number(
      this.humansSeg.querySelector('button[aria-pressed="true"]').dataset.v,
    );
  }

  get ais() {
    return Number(
      this.aiSeg.querySelector('button[aria-pressed="true"]').dataset.v,
    );
  }

  showMenu() {
    this.menuEl.hidden = false;
    // The menu and the in-match overlays are mutually exclusive states.
    this.hideBanner();
    this.hideHud();
  }

  hideMenu() {
    this.menuEl.hidden = true;
  }

  /** players: [{ id, name, hex }]; rebuilds the chip list from scratch. */
  showHud(players, target) {
    this.scoresEl.innerHTML = "";
    for (const player of players) {
      const li = document.createElement("li");
      li.className = "chip";
      li.dataset.id = player.id;
      li.style.setProperty("--c", player.hex);

      const dot = document.createElement("span");
      dot.className = "dot";

      const name = document.createElement("span");
      name.className = "name";
      name.textContent = player.name;

      const pts = document.createElement("span");
      pts.className = "pts";
      pts.textContent = "0";

      li.append(dot, name, pts);
      this.scoresEl.appendChild(li);
    }
    this.targetEl.textContent = `First to ${target}`;
    this.hudEl.hidden = false;
  }

  hideHud() {
    this.hudEl.hidden = true;
  }

  /** Update existing chips in place; never rebuilds the list. */
  setScores(scores, aliveById) {
    for (const li of this.scoresEl.children) {
      const id = li.dataset.id;
      if (scores && scores[id] !== undefined) {
        const pts = li.querySelector(".pts");
        if (pts) pts.textContent = String(scores[id]);
      }
      const alive = aliveById ? aliveById[id] !== false : true;
      li.classList.toggle("out", !alive);
    }
  }

  banner(text, { sub = "", hex = "", actions = false } = {}) {
    this.bannerTextEl.textContent = text;
    this.bannerSubEl.textContent = sub;
    if (hex) this.bannerEl.style.setProperty("--c", hex);
    else this.bannerEl.style.removeProperty("--c");
    this.bannerActionsEl.hidden = !actions;
    this.bannerEl.hidden = false;

    // Force a reflow between clearing and restoring the animation so the
    // keyframe pop replays even when the new text is identical to the old.
    this.bannerTextEl.style.animation = "none";
    void this.bannerTextEl.offsetWidth;
    this.bannerTextEl.style.animation = "";
  }

  hideBanner() {
    this.bannerEl.hidden = true;
  }

  setSound(enabled) {
    this.soundEl.setAttribute("aria-pressed", String(!!enabled));
    this.soundEl.textContent = enabled ? "Sound on" : "Sound off";
  }

  /** Shown only on a coarse (touch) pointer, and only when the caller wants it. */
  setTouchVisible(visible) {
    let coarse = this._touchSeen;
    try {
      coarse = coarse || window.matchMedia("(pointer: coarse)").matches;
    } catch {
      // matchMedia is unavailable in some embedded contexts; fall back to
      // whatever _touchSeen already knows.
    }
    this.touchEl.hidden = !(visible && coarse);
  }
}
