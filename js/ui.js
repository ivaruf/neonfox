/*
 * ui.js — menu, scoreboard, banners, touch button visibility.
 *
 * This class shows what it is told and nothing more: it holds no round
 * state, no scores of its own, no notion of who is winning. main.js reads
 * the sim and match objects and calls showHud/setScores/banner accordingly;
 * this file only ever touches the DOM ids index.html already defines (never
 * invents new structure) and reports back through the constructor
 * callbacks. The one piece of real logic it does own — humans + ais capped
 * at MAX_PLAYERS — lives here because it is a property of the two segmented
 * rows themselves, not of a running match. The arena slider is the same
 * shape as the segmented rows in spirit (a menu choice main.js reads back),
 * but is its own control: setArena(i) moves it and repaints its label
 * silently, so main.js can restore a saved preference without that restore
 * itself firing onArena as if the player had just dragged it. The Turning
 * slider is the same control again — get turn / setTurn(i) / onTurn — for
 * the match's turn rate, an index into TURN_MODES. The two volume sliders
 * (music/effects, replacing the old single sound toggle) follow the same
 * "silent restore" shape: setVolumes(music, sfx) moves both without firing
 * onMusicVolume/onSfxVolume, so main.js can put a saved mix back on screen
 * at boot without that itself counting as the player choosing a new one.
 * Each volume is now TWO sliders, in the sound menu and in the pause
 * overlay, and _paintVolume is the only thing that writes either: two
 * windows onto one setting, never two settings.
 *
 * Panels are this file's other job. #menu, #sound and #pause are shown and
 * hidden here because that is DOM state, the same kind of thing
 * showMenu/hideMenu always were — and pointedly not because this file knows
 * what any of it MEANS. Whether a simulation stops when #pause goes up,
 * whether a peer-to-peer session is torn down when the player leaves,
 * whether any of it makes a sound: all main.js's, reported through the
 * constructor callbacks. showPause() takes `live` and `canRestart` as
 * arguments for exactly that reason — this file is told a net match cannot
 * be stopped, it does not work it out.
 */

import { MAX_PLAYERS, ARENA_SIZES, TURN_MODES } from "./config.js";
// The one place the DOM lane reaches into the sim lane: defaultTarget is a
// pure function of a headcount (no World, no DOM), used to keep the "Win
// at" slider's suggested value in step with the roster. Keep this import to
// that one function.
import { defaultTarget } from "./sim/match.js";

export class UI {
  constructor(
    root,
    {
      onStart,
      onRematch,
      onMenu,
      onArena,
      onTurn,
      onMusicVolume,
      onSfxVolume,
      onTogether,
      onSound,
      onResume,
      onRestart,
      onLeave,
      onEscape,
    } = {},
  ) {
    this.root = root;
    this.onArena = onArena || (() => {});
    this.onTurn = onTurn || (() => {});
    this.onMusicVolume = onMusicVolume || (() => {});
    this.onSfxVolume = onSfxVolume || (() => {});
    this.onSound = onSound || (() => {});

    this.menuEl = root.querySelector("#menu");
    this.soundEl = root.querySelector("#sound");
    /* Sound and fullscreen, top right. Up whenever the paddock or the sound
     * menu is, gone for a match — the Pause pill takes that corner once a
     * round is running, and two things cannot have one corner. */
    this.cornerEl = root.querySelector("#corner-tools");
    this.pauseEl = root.querySelector("#pause");
    this.pauseScrimEl = root.querySelector("#pause-scrim");
    this.pauseKickerEl = root.querySelector("#pause-kicker");
    this.pauseTitleEl = root.querySelector("#pause-title");
    this.pauseNoteEl = root.querySelector("#pause-note");
    this.pauseRestartEl = root.querySelector("#pause-restart");
    this.hudEl = root.querySelector("#hud");
    this.scoresEl = root.querySelector("#scores");
    this.targetEl = root.querySelector("#target-label");
    this.targetSliderEl = root.querySelector("#target");
    this.targetOutEl = root.querySelector("#target-out");
    this.bannerEl = root.querySelector("#banner");
    this.bannerSubEl = root.querySelector("#banner-sub");
    this.bannerTextEl = root.querySelector("#banner-text");
    this.bannerActionsEl = root.querySelector("#banner-actions");
    this.touchEl = root.querySelector("#touch");
    this.spectateEl = root.querySelector("#spectate");
    this.spectateTextEl = root.querySelector("#spectate-text");
    this.arenaSizeEl = root.querySelector("#arena-size");
    this.arenaNameEl = root.querySelector("#arena-name");
    this.turnModeEl = root.querySelector("#turn-mode");
    this.turnNameEl = root.querySelector("#turn-name");
    /*
     * Each volume is two sliders, not one: the sound menu's and the pause
     * overlay's. They are two places to reach ONE setting, never two
     * settings — every path that moves a value goes through _paintVolume,
     * which writes it to both — so a mix set mid-match is the mix the
     * paddock shows afterwards, and vice versa.
     */
    this.musicVols = volumePair(root, "music-vol");
    this.sfxVols = volumePair(root, "sfx-vol");

    const left = root.querySelector("#turn-left");
    const right = root.querySelector("#turn-right");
    this.touchButtons = { left, right };

    this.humansSeg = root.querySelector('.seg[data-seg="humans"]');
    this.aiSeg = root.querySelector('.seg[data-seg="ai"]');

    // Selecting a button presses it and un-presses its row-mates; changing
    // the humans row can also invalidate the current rivals selection, so
    // that row's wiring re-runs the cap afterwards. Either row changes the
    // headcount the "Win at" slider's suggestion is based on.
    this._wireSeg(this.humansSeg, () => {
      this._enforceCap();
      this._recomputeTarget();
    });
    this._wireSeg(this.aiSeg, () => this._recomputeTarget());
    this._enforceCap();

    // The host has not touched the target slider yet, so it still follows
    // the roster (see _recomputeTarget); seed it now to match the menu's
    // initial 1 human + 3 rivals rather than whatever value the markup
    // happens to hard-code.
    this._targetTouched = false;
    this._recomputeTarget();

    root.querySelector("#start").addEventListener("click", () => {
      if (onStart) onStart();
    });
    root.querySelector("#rematch").addEventListener("click", () => {
      if (onRematch) onRematch();
    });
    root.querySelector("#to-menu").addEventListener("click", () => {
      if (onMenu) onMenu();
    });

    // The way into multiplayer. index.html may not carry this button yet —
    // js/net/lobby.js inserts one after #start when it is missing — so this
    // wires it only if it is there, and the lobby wires its own otherwise.
    // Exactly one of the two ever attaches a listener.
    const together = root.querySelector("#together");
    if (together && onTogether)
      together.addEventListener("click", () => onTogether());

    /*
     * The door to the sound menu, and the way back out of it. Both hand the
     * press to main.js before swapping panels: opening the mixer is a real
     * user gesture, and it is the gesture that lets the glue unlock the
     * audio context, so by the time the effects slider is on screen dragging
     * it can actually be heard. Focus follows the panel that appeared —
     * hiding the element that currently holds focus otherwise drops it on
     * the body, which strands anyone steering this with a keyboard.
     */
    this.soundOpenEl = root.querySelector("#sound-open");
    const soundBack = root.querySelector("#sound-back");
    if (this.soundOpenEl) {
      this.soundOpenEl.addEventListener("click", () => {
        this.onSound();
        this.showSound();
      });
    }
    if (soundBack) {
      soundBack.addEventListener("click", () => {
        this.onSound();
        this.showMenu();
        this.soundOpenEl?.focus();
      });
    }

    /*
     * The pause overlay's three buttons. This file shows and hides the panel
     * (that is DOM state, like every other panel here) and knows nothing
     * about what pausing means — whether a simulation stops, whether a net
     * session is torn down, whether a sound plays — which is main.js's to
     * decide and does not belong in a file that draws.
     */
    const bind = (id, fn) => {
      const el = root.querySelector(id);
      if (el && fn) el.addEventListener("click", () => fn());
    };
    bind("#resume", onResume);
    bind("#pause-restart", onRestart);
    bind("#pause-leave", onLeave);

    // The in-match pill that opens it, for every device without an Escape
    // key. Same callback as the key, so the two can never mean different
    // things: main.js has one onEscape and this is the other way to it.
    this.pauseOpenEl = root.querySelector("#pause-open");
    this._pauseLive = false;
    bind("#pause-open", onEscape);

    // Leaving the whole arcade, not just this game's own menu (#to-menu
    // does that, from a match banner, back to #menu). arcade/exit.js is
    // another repository's file and may simply not be there, so this
    // button only appears — and only ever gets a click handler — when
    // window.ArcadeExit says it is. Its own verb() picks the label, so the
    // button can never promise something quit() will not actually do.
    const quitEl = root.querySelector("#quit");
    const exit = window.ArcadeExit;
    if (quitEl && exit) {
      quitEl.hidden = false;
      quitEl.textContent = exit.verb({
        arcade: "Back to arcade",
        app: "Close",
      });
      quitEl.addEventListener("click", () => {
        exit.quit().then((how) => {
          // 'refused': the browser declined to close a window it did not
          // open (an installed app on iOS, mostly). The game is still
          // running, so say so here rather than leave a dead button.
          if (how !== "refused") return;
          quitEl.textContent = "Close this tab yourself";
          quitEl.disabled = true;
        });
      });
    }

    // Two events on purpose: "input" fires on every tick of the drag, so the
    // label keeps up with the thumb; "change" fires once, when it is
    // released, which is when main.js actually rebuilds the arena and (in
    // attract mode) restarts the preview match. Firing that on every "input"
    // would rebuild the scene dozens of times per drag.
    this.arenaSizeEl.addEventListener("input", () => {
      this._paintArenaLabel(this.arena);
    });
    this.arenaSizeEl.addEventListener("change", () => {
      this.onArena(this.arena);
    });
    // Turning, the same two events for the same reason: the name follows the
    // thumb, and only the release restarts the attract match behind the
    // paddock so the player can watch the bots take the new radius.
    this.turnModeEl.addEventListener("input", () => {
      this._paintTurnLabel(this.turn);
    });
    this.turnModeEl.addEventListener("change", () => {
      this.onTurn(this.turn);
    });

    // The moment the host drags this even once, it is their number: stop
    // following the roster for the rest of the session (see
    // _recomputeTarget).
    this.targetSliderEl.addEventListener("input", () => {
      this._targetTouched = true;
      this.targetOutEl.textContent = `${this.target} pts`;
    });

    // Volume, unlike the arena size, is only ever "input": a level you
    // cannot hear until you let go of the thumb is not a volume control, so
    // both the readout and the callback update on every tick of the drag.
    // Whichever of the pair was dragged, both are repainted — the other one
    // is a second window onto the same number and must never be caught
    // showing the old one.
    this._wireVolume(this.musicVols, (v) => this.onMusicVolume(v));
    this._wireVolume(this.sfxVols, (v) => this.onSfxVolume(v));

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

  /** Wire every slider of one volume pair to repaint the whole pair and
   *  report the new level once, as a 0..1 fraction. */
  _wireVolume(controls, emit) {
    for (const control of controls) {
      control.input.addEventListener("input", () => {
        const pct = Number(control.input.value);
        this._paintVolume(controls, pct);
        emit(pct / 100);
      });
    }
  }

  /** Put a percentage on every slider and readout of one pair, silently.
   *  The only writer: the drag above and setVolumes() both come through
   *  here, which is what keeps the two copies from ever disagreeing. */
  _paintVolume(controls, pct) {
    for (const control of controls) {
      control.input.value = String(pct);
      control.out.textContent = String(pct);
    }
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

  get arena() {
    return Number(this.arenaSizeEl.value);
  }

  /** Move the slider and repaint its label without firing onArena — used at
   *  boot to restore a saved preference, so restoring it doesn't itself
   *  count as the player choosing a size. */
  setArena(i) {
    const clamped = Math.max(0, Math.min(ARENA_SIZES.length - 1, i));
    this.arenaSizeEl.value = String(clamped);
    this._paintArenaLabel(clamped);
  }

  _paintArenaLabel(i) {
    const name = ARENA_SIZES[i].name;
    this.arenaNameEl.textContent = name;
    this.arenaSizeEl.setAttribute("aria-valuetext", name);
  }

  /** Index into TURN_MODES from the Turning slider: how tightly every rider
   *  in the match turns. */
  get turn() {
    return Number(this.turnModeEl.value);
  }

  /** Move the Turning slider and repaint its name without firing onTurn —
   *  the silent restore, exactly as setArena. */
  setTurn(i) {
    const clamped = Math.max(0, Math.min(TURN_MODES.length - 1, i));
    this.turnModeEl.value = String(clamped);
    this._paintTurnLabel(clamped);
  }

  _paintTurnLabel(i) {
    const name = TURN_MODES[i].name;
    this.turnNameEl.textContent = name;
    this.turnModeEl.setAttribute("aria-valuetext", name);
  }

  get target() {
    return Number(this.targetSliderEl.value);
  }

  /** Keep the "Win at" slider following the roster until the host sets it
   *  themselves. Every crash pays every survivor, so a round of six hands
   *  out fifteen points where a round of two hands out one — a fixed
   *  default would mean a six-player match ends in a single round. Once
   *  _targetTouched is set (the host dragged the slider), this is a no-op
   *  for the rest of the session: their number is never overridden again. */
  _recomputeTarget() {
    if (this._targetTouched) return;
    const suggested = defaultTarget(this.humans + this.ais);
    const min = Number(this.targetSliderEl.min);
    const max = Number(this.targetSliderEl.max);
    const clamped = Math.max(min, Math.min(max, suggested));
    this.targetSliderEl.value = String(clamped);
    this.targetOutEl.textContent = `${clamped} pts`;
  }

  showMenu() {
    this.menuEl.hidden = false;
    if (this.soundEl) this.soundEl.hidden = true;
    if (this.cornerEl) this.cornerEl.hidden = false;
    // The menu and the in-match overlays are mutually exclusive states.
    this.hidePause();
    this.hideBanner();
    this.hideHud();
    this.hideSpectate();
  }

  /*
   * hideMenu takes the sound panel with it, and every caller depends on that
   * without knowing it: the lobby, and a match started from the keyboard,
   * both only ask for the paddock to go away. Leaving a mixer floating over
   * a running round would be the bug.
   */
  hideMenu() {
    this.menuEl.hidden = true;
    if (this.soundEl) this.soundEl.hidden = true;
    if (this.cornerEl) this.cornerEl.hidden = true;
  }

  /** The sound menu, in the paddock's place. */
  showSound() {
    if (!this.soundEl) return;
    this.menuEl.hidden = true;
    this.soundEl.hidden = false;
    this.soundEl.focus();
  }

  /** Whether the sound menu is the panel currently up, so Escape can know
   *  what it is backing out of. */
  get soundOpen() {
    return !!this.soundEl && !this.soundEl.hidden;
  }

  /*
   * The pause overlay.
   *
   * `live` is the honest half of this: a net match is somebody else's
   * simulation and cannot be stopped from here, so the panel says what is
   * actually happening instead of calling itself Paused over a round that is
   * still being ridden — and the scrim stays down, because dimming an arena
   * the player may still need to steer in would be a lie told in CSS.
   *
   * `canRestart` is false for a guest, where calling for another match is the
   * host's alone; a button that does nothing is worse than no button (the
   * same rule the match-over banner's Rematch already follows).
   */
  showPause({ live = false, canRestart = true } = {}) {
    if (!this.pauseEl) return;
    this.pauseKickerEl.textContent = live
      ? "The round carries on without you"
      : "Nothing moves until you say so";
    this.pauseTitleEl.textContent = live ? "Still riding" : "Paused";
    this.pauseNoteEl.textContent = live
      ? "A game on two screens cannot be stopped from one of them. Your fox is still out there, and the arrows still steer it."
      : "The arena is holding still. Pick up where you left off, or don't.";
    this.pauseRestartEl.hidden = !canRestart;
    if (this.pauseScrimEl) this.pauseScrimEl.hidden = live;
    this.pauseEl.hidden = false;
    this.pauseEl.focus();
  }

  hidePause() {
    if (this.pauseEl) this.pauseEl.hidden = true;
    if (this.pauseScrimEl) this.pauseScrimEl.hidden = true;
  }

  /*
   * The in-match pill that opens the overlay. `live` is remembered rather
   * than required, because the two things that move this button ask
   * different questions: a match beginning knows whether it is a net one and
   * says so once, while the overlay opening and closing only knows that the
   * button should go and come back.
   */
  setPauseButton(visible, live) {
    if (!this.pauseOpenEl) return;
    if (live !== undefined) this._pauseLive = live;
    this.pauseOpenEl.textContent = this._pauseLive ? "Menu" : "Pause";
    this.pauseOpenEl.hidden = !visible;
  }

  get pauseOpen() {
    return !!this.pauseEl && !this.pauseEl.hidden;
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

  /*
   * `rematch: false` leaves only the way back to the paddock. A net match is
   * the case: only the host may start another one, so a Rematch button on a
   * guest's screen would be a button that does nothing, which is worse than
   * no button at all.
   */
  banner(text, { sub = "", hex = "", actions = false, rematch = true } = {}) {
    this.bannerTextEl.textContent = text;
    this.bannerSubEl.textContent = sub;
    if (hex) this.bannerEl.style.setProperty("--c", hex);
    else this.bannerEl.style.removeProperty("--c");
    this.bannerActionsEl.hidden = !actions;
    const rematchEl = this.bannerActionsEl.querySelector("#rematch");
    if (rematchEl) rematchEl.hidden = !rematch;
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

  /** Move every volume slider and readout — both homes of both channels —
   *  without firing the onMusicVolume/onSfxVolume callbacks. Used at boot to
   *  restore a saved mix, so restoring it doesn't itself count as the player
   *  moving them. */
  setVolumes(music, sfx) {
    const pct = (v) => Math.round(Math.max(0, Math.min(1, v)) * 100);
    this._paintVolume(this.musicVols, pct(music));
    this._paintVolume(this.sfxVols, pct(sfx));
  }

  /** Caption above the touch buttons: whose ride the spectator camera has
   *  landed on once every human is out but the round plays on. hex tints the
   *  caption to the followed rider's colour via --c; an empty hex (the
   *  overview stop) clears the property instead of leaving a stale colour. */
  setSpectate(text, hex) {
    this.spectateTextEl.textContent = text;
    if (hex) this.spectateEl.style.setProperty("--c", hex);
    else this.spectateEl.style.removeProperty("--c");
    this.spectateEl.hidden = false;
  }

  hideSpectate() {
    this.spectateEl.hidden = true;
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

/*
 * One volume, in both of the places it can be reached: the sound menu's
 * `#<name>` and the pause overlay's `#pause-<name>`. Either may be missing —
 * a panel can be edited out of index.html without this file caring — so the
 * pair is whatever is actually there, and every loop over it simply runs
 * fewer times.
 */
function volumePair(root, name) {
  const controls = [];
  for (const id of [name, `pause-${name}`]) {
    const input = root.querySelector(`#${id}`);
    const out = root.querySelector(`#${id}-out`);
    if (input && out) controls.push({ input, out });
  }
  return controls;
}
