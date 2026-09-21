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
 *
 * THERE IS ONE PAIR OF VOLUME SLIDERS. There were two until v1.9 — the sound
 * menu's and the pause overlay's — with a volumePair() helper and a
 * _paintVolume() whose entire job was writing every change to both copies so
 * they could never be seen to disagree. The panels are one panel now, so the
 * sliders are one pair, and the helper that kept two of them honest is gone
 * along with the second of everything it was keeping honest.
 *
 * Panels are this file's other job. #menu and the one menu panel (#pause) are
 * shown and hidden here because that is DOM state, the same kind of thing
 * showMenu/hideMenu always were — and pointedly not because this file knows
 * what any of it MEANS. Whether a simulation stops when the panel goes up,
 * whether a peer-to-peer session is torn down when the player leaves,
 * whether any of it makes a sound: all main.js's, reported through the
 * constructor callbacks. showMenuPanel() takes `inPlay`, `live` and
 * `canRestart` as arguments for exactly that reason — this file is TOLD that
 * a net match cannot be stopped, it does not work it out.
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
      onOpenMenu,
      onCloseMenu,
      onMute,
      onResume,
      onRestart,
      onLeave,
    } = {},
  ) {
    this.root = root;
    this.onArena = onArena || (() => {});
    this.onTurn = onTurn || (() => {});
    this.onMusicVolume = onMusicVolume || (() => {});
    this.onSfxVolume = onSfxVolume || (() => {});
    this.onOpenMenu = onOpenMenu || (() => {});
    this.onCloseMenu = onCloseMenu || (() => {});
    this.onMute = onMute || (() => {});

    this.menuEl = root.querySelector("#menu");
    /* #corner-tools — menu, mute and fullscreen, top right — is deliberately
     * absent from this file as a thing to SHOW or HIDE. It is fixed page chrome:
     * the same three icons in the same place on the paddock, in the lobby,
     * mid-match and over the menu panel. It used to be taken away for a match
     * and put back afterwards, which is exactly what made fullscreen unreachable
     * once a round had started. Two of the three plates are wired below; the
     * fullscreen one belongs to js/screen.js end to end. */
    this.pauseEl = root.querySelector("#pause");
    this.pauseScrimEl = root.querySelector("#pause-scrim");
    this.pauseKickerEl = root.querySelector("#pause-kicker");
    this.pauseTitleEl = root.querySelector("#pause-title");
    this.pauseNoteEl = root.querySelector("#pause-note");
    this.pauseToolsEl = root.querySelector("#pause-tools");
    this.pauseRestartEl = root.querySelector("#pause-restart");
    this.resumeEl = root.querySelector("#resume");
    this.menuBackEl = root.querySelector("#menu-back");
    this.muteEl = root.querySelector("#mute-toggle");
    /* What the mute plate is showing, so the panel can say so too. This file
     * never decides it — main.js owns the audio and hands it down through
     * setMuted(). */
    this._muted = false;
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
     * One volume, one slider, one readout — each. There used to be two of each,
     * one set in the sound menu and one in the pause overlay, kept in step by a
     * helper; the two panels are one panel now and so is the pair of controls.
     */
    this.musicVol = volumeControl(root, "music-vol");
    this.sfxVol = volumeControl(root, "sfx-vol");

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
     * THE MENU PLATE, and the panel's own way back out. Both hand the press to
     * main.js and DECIDE NOTHING THEMSELVES, which matters because the plate is
     * on every screen: what it means depends on what the game is doing — a
     * pause in a local match, a panel over a round that carries on in a net one,
     * a mixer in the paddock — and none of that is knowable from here. main.js
     * also owns the unlock, since pressing this is a real user gesture and it is
     * the gesture that lets a drag of the effects slider actually be heard.
     *
     * The way out is one function shared with Escape, for the same reason as
     * ever: two ways out that do different things are two bugs waiting.
     */
    this.menuOpenEl = root.querySelector("#menu-open");
    this._panelFrom = null; // the panel the menu displaced, if any
    if (this.menuOpenEl) {
      this.menuOpenEl.addEventListener("click", () => this.onOpenMenu());
    }
    if (this.menuBackEl) {
      this.menuBackEl.addEventListener("click", () => this.onCloseMenu());
    }

    /*
     * THE MUTE PLATE, beside it, and deliberately not behind it. One press for
     * silence: it opens nothing, closes nothing, moves no focus and — the part
     * that matters mid-round — stops no game. Somebody walking into the room is
     * not a reason to lose the round you are riding. main.js does the rest;
     * this file only reports the press and draws the answer (setMuted, below).
     */
    if (this.muteEl) {
      this.muteEl.addEventListener("click", () => this.onMute());
    }

    /*
     * The menu panel's own buttons. This file shows and hides the panel (that
     * is DOM state, like every other panel here) and knows nothing about what
     * pausing means — whether a simulation stops, whether a net session is torn
     * down, whether a sound plays — which is main.js's to decide and does not
     * belong in a file that draws.
     */
    const bind = (id, fn) => {
      const el = root.querySelector(id);
      if (el && fn) el.addEventListener("click", () => fn());
    };
    bind("#resume", onResume);
    bind("#pause-restart", onRestart);
    bind("#pause-leave", onLeave);
    // There is no onEscape option any more. It existed so the in-match Pause
    // pill and the Escape key could be one function; the pill is gone, the
    // corner's menu plate opens the panel through onOpenMenu, and Escape is
    // main.js's own business again.

    // Leaving the whole arcade, not just this game's own menu (#to-menu
    // does that, from a match banner, back to #menu). arcade/exit.js is
    // another repository's file and may simply not be there, so this
    // button only appears — and only ever gets a click handler — when
    // window.ArcadeExit says it is. Its own verb() picks the label, so the
    // button can never promise something quit() will not actually do.
    //
    // AND ONLY WHEN THERE IS SOMEWHERE TO GO, which is not the same question as
    // whether quit() could do something: in a plain tab it could — the arcade is
    // a URL and a navigation always works — but somebody who typed this game's
    // address did not come from the arcade and may never have heard of it. So:
    // a launcher behind us, or an installed window that can genuinely close.
    //
    // ASKED THROUGH framed()/standalone() AND NOT THROUGH exit.js's own
    // offers(), which says exactly this but is new. The copy of exit.js that
    // answers may be OLDER than this code — it is fetched from ../arcade/, and a
    // service worker on this shared origin can hand back a version cached long
    // before offers() was written — and a guard built on the new name fails
    // CLOSED there: the way out disappears, inside the arcade, where it is the
    // one control that matters. These two predicates are as old as the file.
    const quitEl = root.querySelector("#quit");
    const exit = window.ArcadeExit;
    if (quitEl && exit && (exit.framed() || exit.standalone())) {
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
    this._wireVolume(this.musicVol, (v) => this.onMusicVolume(v));
    this._wireVolume(this.sfxVol, (v) => this.onSfxVolume(v));

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

  /** Keep one slider's readout with its thumb and report the new level, as a
   *  0..1 fraction. Null when index.html has no such control — the panel can
   *  be edited without this file caring. */
  _wireVolume(control, emit) {
    if (!control) return;
    control.input.addEventListener("input", () => {
      const pct = Number(control.input.value);
      control.out.textContent = String(pct);
      emit(pct / 100);
    });
  }

  /** Move one slider and its readout without firing anything. */
  _paintVolume(control, pct) {
    if (!control) return;
    control.input.value = String(pct);
    control.out.textContent = String(pct);
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
    // Whatever the menu panel displaced is not this file's business any more:
    // the paddock is being raised explicitly, so the panel simply goes rather
    // than putting something back on its way down.
    this._panelFrom = null;
    this._closePanel();
    this.hideBanner();
    this.hideHud();
    this.hideSpectate();
  }

  /*
   * hideMenu takes the menu panel with it, and every caller depends on that
   * without knowing it: the lobby, and a match started from the keyboard,
   * both only ask for the paddock to go away. Leaving a mixer floating over
   * a running round would be the bug.
   */
  hideMenu() {
    this.menuEl.hidden = true;
    this._panelFrom = null;
    this._closePanel();
  }

  /**
   * THE ONE MENU PANEL, wearing whichever face it was asked for.
   *
   * `inPlay` is what it is: a pause mid-match, a mixer anywhere else. The face
   * is decided by main.js, off the game it came from rather than off whoever
   * pressed what, so no route can offer Keep riding with nothing to go back to.
   *
   * `live` is the honest half of the pause. A net match is somebody else's
   * simulation and cannot be stopped from here, so the panel says what is
   * actually happening instead of calling itself Paused over a round that is
   * still being ridden — and the scrim stays down, because dimming an arena
   * the player may still need to steer in would be a lie told in CSS. Nothing
   * about the panel takes the keyboard away either: index.html's arrows are
   * read straight off the window (js/input.js), so a fox whose rider is
   * reading this is still steerable, exactly as the note promises.
   *
   * `canRestart` is false for a guest, where calling for another match is the
   * host's alone; a button that does nothing is worse than no button (the
   * same rule the match-over banner's Rematch already follows).
   *
   * Outside a match the panel stands in the place of whichever panel WAS
   * standing — usually the paddock, but the corner is on every screen, so the
   * multiplayer lobby (another .panel in the same middle of the screen,
   * mounted and owned by js/net/lobby.js) can be the one displaced. This only
   * hides it and puts it back; the session underneath carries on regardless.
   * Remembering which it was is the whole reason this is not just
   * `menuEl.hidden = true`: coming back to the paddock out of a room you were
   * sitting in would read as being thrown out of it.
   *
   * Focus follows the panel that appeared — hiding the element that holds focus
   * otherwise drops it on the body, which strands anyone steering by keyboard.
   */
  showMenuPanel({ inPlay = false, live = false, canRestart = true } = {}) {
    if (!this.pauseEl) return;
    if (inPlay) {
      // Mid-match nothing was standing to displace — the paddock and the lobby
      // are both long gone — so there is nothing to put back either. Said
      // explicitly rather than assumed, because a stale value here would mean
      // resuming a round re-raised the paddock over it.
      this._panelFrom = null;
    } else if (!this.menuPanelOpen) {
      const standing = [this.menuEl, this.root.querySelector("#lobby")].find(
        (panel) => panel && !panel.hidden,
      );
      this._panelFrom = standing || null;
      if (standing) standing.hidden = true;
    }
    this._paintPanel({ inPlay, live, canRestart });
    this.pauseEl.hidden = false;
    this.pauseEl.focus();
  }

  /** What the panel says and which of its buttons exist, given the face it was
   *  asked for. Nothing here is built twice: the two levels, the heading and
   *  the way out are the same nodes either way. */
  _paintPanel({ inPlay, live, canRestart }) {
    if (inPlay) {
      this.pauseKickerEl.textContent = live
        ? "The round carries on without you"
        : "Nothing moves until you say so";
      this.pauseTitleEl.textContent = live ? "Still riding" : "Paused";
      this.pauseNoteEl.textContent = live
        ? "A game on two screens cannot be stopped from one of them. Your fox is still out there, and the arrows still steer it."
        : "The arena is holding still. Pick up where you left off, or don't.";
    } else {
      this.pauseKickerEl.textContent = "How loud is the arena";
      this.pauseTitleEl.textContent = "Sound";
      this.pauseNoteEl.textContent = this._mixerNote();
    }
    if (this.resumeEl) this.resumeEl.hidden = !inPlay;
    // The two ways to throw a match away only exist while there is one.
    if (this.pauseToolsEl) this.pauseToolsEl.hidden = !inPlay;
    if (this.pauseRestartEl) this.pauseRestartEl.hidden = !canRestart;
    if (this.menuBackEl) {
      this.menuBackEl.hidden = inPlay;
      // Named for the room it actually goes back to. "Back" alone was true and
      // said nothing; a player who opened this from the lobby is going back to
      // a room they are still sitting in, and the label may as well say so.
      this.menuBackEl.textContent =
        this._panelFrom && this._panelFrom !== this.menuEl
          ? "Back to the room"
          : "Back to the paddock";
    }
    // Only a genuinely stopped match gets the scrim.
    if (this.pauseScrimEl) this.pauseScrimEl.hidden = !(inPlay && !live);
  }

  /** The line under the mixer's heading. A muted player looking at two
   *  live-looking sliders deserves to be told why nothing is coming out of
   *  them, and where the switch is. */
  _mixerNote() {
    return this._muted
      ? "Everything is muted — tap the speaker in the corner, or move a slider, and the arena comes back."
      : "The theme rides under the whole match. Effects are the yips, the crashes and the fanfare — drag that one and you will hear it.";
  }

  /** Take the panel down and put back whatever it displaced. Both the panel's
   *  own way out and Escape come through here — through main.js, which owns the
   *  noise — so the two cannot leave by different doors. */
  hideMenuPanel() {
    if (!this.pauseEl || this.pauseEl.hidden) return;
    // The mixer face is the one wearing its own way out, and it must always
    // leave SOMETHING standing — the paddock if it somehow displaced nothing.
    // A pause is the opposite case and gets no fallback: putting the paddock
    // back over a match that is only being resumed would be the bug.
    const wasMixer = !!this.menuBackEl && !this.menuBackEl.hidden;
    const back = this._panelFrom || (wasMixer ? this.menuEl : null);
    this._panelFrom = null;
    this._closePanel();
    if (back) {
      back.hidden = false;
      // Put the cursor back on the plate that opened it, rather than on the
      // body. Mid-match there was no panel to displace and focus is left where
      // it was, which is what a resumed round wants.
      this.menuOpenEl?.focus();
    }
  }

  /** The panel and its scrim, down, with nothing restored and nothing decided.
   *  The one place either is hidden. */
  _closePanel() {
    if (this.pauseEl) this.pauseEl.hidden = true;
    if (this.pauseScrimEl) this.pauseScrimEl.hidden = true;
  }

  /** Whether the menu panel is up, so Escape and the plate can know what they
   *  are backing out of. */
  get menuPanelOpen() {
    return !!this.pauseEl && !this.pauseEl.hidden;
  }

  /**
   * Draw the mute plate. aria-pressed carries the state, the CSS draws the
   * slash off it and the label is written in the same breath, so the picture
   * and what a screen reader is told come from one write and cannot drift.
   *
   * It touches the plate and the panel's note, and nothing else: no panel is
   * opened or closed here, no focus moves and no game stops. main.js has
   * already done the audio by the time this is called.
   */
  setMuted(muted) {
    this._muted = !!muted;
    if (!this.muteEl) return;
    const label = this._muted ? "Unmute" : "Mute";
    this.muteEl.setAttribute("aria-pressed", String(this._muted));
    this.muteEl.setAttribute("aria-label", label);
    this.muteEl.title = `${label} (M)`;
    // If the mixer is the face currently showing — its own way out is the one
    // button that only exists there — its note says whether there is any point
    // dragging the sliders, so that one line follows the switch. Nothing else
    // about the panel is touched.
    if (this.menuPanelOpen && this.menuBackEl && !this.menuBackEl.hidden) {
      this.pauseNoteEl.textContent = this._mixerNote();
    }
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

  /** Move both volume sliders and their readouts without firing the
   *  onMusicVolume/onSfxVolume callbacks. Used at boot to restore a saved mix,
   *  so restoring it doesn't itself count as the player moving them. */
  setVolumes(music, sfx) {
    const pct = (v) => Math.round(Math.max(0, Math.min(1, v)) * 100);
    this._paintVolume(this.musicVol, pct(music));
    this._paintVolume(this.sfxVol, pct(sfx));
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
 * One volume: its slider and the readout beside it. This used to return a PAIR
 * — `#<name>` in the sound menu and `#pause-<name>` in the pause overlay — and
 * every caller looped over both to keep two copies of one number in step. The
 * two panels are one panel now, so there is one of each, and null when
 * index.html does not carry it (a panel can be edited without this file
 * caring).
 */
function volumeControl(root, name) {
  const input = root.querySelector(`#${name}`);
  const out = root.querySelector(`#${name}-out`);
  return input && out ? { input, out } : null;
}
