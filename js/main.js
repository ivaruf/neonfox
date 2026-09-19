/*
 * main.js — the glue.
 *
 * Everything else in this game is deliberately deaf to everything else: the
 * sim knows nothing of Babylon, the renderer knows nothing of the round
 * state machine, the UI knows nothing of either. This file is the only place
 * that knows all of them, and it does three jobs and no more:
 *
 *   1. Build the world. One createScene, one World, one rider per player,
 *      one TrailRenderer, and wire the UI's buttons to functions here.
 *   2. Drive the clock. A fixed-timestep accumulator steps the sim at TICK
 *      whatever the display is doing, so a 144 Hz laptop and a 30 Hz phone
 *      play the same game (hub CLAUDE.md §10).
 *   3. Route events. Match.update hands back plain objects — roundStart, go,
 *      eliminated, roundOver, matchOver — and this file turns each of them
 *      into the sound, the shake, the burst and the banner it deserves.
 *
 * Two modes share all of it. `menu` runs a four-AI match in attract mode
 * behind the panel with the camera orbiting; `match` runs the chosen field
 * with the camera parked. Attract mode is a real match, not a loop of
 * recorded footage, which is why the menu screen is never the same twice —
 * and why the event routing below keeps asking whether we are in a match
 * before it plays a sound or writes a banner at somebody who is reading the
 * title screen.
 */

import {
  TICK,
  GO_FLASH_SECONDS,
  CRASH_VIEW_HOLD_SECONDS,
  MAX_PLAYERS,
  PALETTE,
  ARENA_SIZES,
  ARENA_DEFAULT,
  TURN_MODES,
  TURN_DEFAULT,
  SPIN_HOLD_SECONDS,
  SPIN_RATE,
  ZOOM_KEY_RATE,
} from "./config.js";
import { World } from "./sim/world.js";
import { Match } from "./sim/match.js";
import { createScene } from "./render/scene.js";
import { createRider, preloadRiders } from "./render/rider.js";
import { createMarker } from "./render/marker.js";
import { TrailRenderer } from "./render/trails.js";
import { createEffects } from "./render/effects.js";
import { Input } from "./input.js";
import { UI } from "./ui.js";
import { Sfx } from "./audio.js";
import { createLobby, mountEntry } from "./net/lobby.js";

/*
 * index.html loads Babylon from a pinned CDN with vendor/babylon.js behind
 * it, so getting here without the global means both were blocked. Say so in
 * the crash bar rather than throwing a ReferenceError into a dark canvas —
 * a player with a filter list that aggressive deserves a sentence they can
 * act on. (Hub CLAUDE.md §2: read the blocker's log before theorising.)
 */
if (!window.BABYLON) {
  const bar = document.getElementById("crash");
  if (bar) {
    bar.textContent =
      "Babylon.js could not load — both the CDN copy and vendor/babylon.js were blocked. " +
      "Check your content blocker's request log for babylon.js.";
    bar.hidden = false;
  }
} else {
  boot();
}

/*
 * A saved menu index — the arena size, the turning mode — read back from
 * localStorage, or `fallback` when there is none, it is out of range for the
 * list it indexes (a mode removed between builds), or storage is unavailable.
 * try/catch per hub CLAUDE.md §6: private mode and quota limits are real.
 */
function savedIndex(key, length, fallback) {
  try {
    const parsed = parseInt(localStorage.getItem(key), 10);
    if (Number.isInteger(parsed) && parsed >= 0 && parsed < length) {
      return parsed;
    }
  } catch {
    // localStorage unavailable; the default stands.
  }
  return fallback;
}

function boot() {
  const view = createScene(document.getElementById("arena"));

  /*
   * The rider is a glTF model loaded asynchronously (10 MB); createRider
   * picks whatever is available the instant it is called, falling back to
   * the procedural rider until the real one lands. The title screen must
   * appear immediately regardless, so the load happens behind it rather
   * than gating boot — once it resolves, restarting the attract match (the
   * same trick the arena slider uses to preview a new size) is enough to
   * pick up the real model, and only if we are still sat on the menu; a
   * match already running keeps its fallback riders until the next one
   * starts. A rejection means rider.js has already console.warned and every
   * rider quietly stays on the fallback, so there is nothing to do here.
   */
  preloadRiders(view.scene).then(
    () => {
      if (mode === "menu") enterMenu();
    },
    () => {},
  );

  /*
   * The real simulation, which solo and attract play step here in the page.
   * In a net match `world` is repointed at the session's ShadowWorld — the
   * same shape, fed from the wire instead of from physics (js/net/shadow.js)
   * — so every reader below this line is untouched by multiplayer existing.
   * The host's own World is not here at all: it lives in a Web Worker, so
   * the host renders the frames it broadcasts, exactly as its guests do.
   */
  const soloWorld = new World();
  let world = soloWorld;
  const input = new Input();
  const sfx = new Sfx();
  const ui = new UI(document.getElementById("ui"), {
    onStart,
    onRematch,
    onMenu,
    onMusicVolume,
    onSfxVolume,
    onArena,
    onTurn,
    onTogether,
    onSound,
    onResume: () => setPaused(false),
    onRestart: onPauseRestart,
    onLeave: onPauseLeave,
    onEscape,
  });

  // Restore the saved arena size and turning mode before the very first
  // match (the attract one, below) ever spawns, so the title screen already
  // shows the settings the player left rather than flashing the defaults for
  // a frame. Both are silent restores: setArena/setTurn move the slider
  // without firing the callbacks, so putting a choice back is not itself a
  // choice.
  ui.setArena(
    savedIndex("neonfox.arena.v1", ARENA_SIZES.length, ARENA_DEFAULT),
  );
  ui.setTurn(savedIndex("neonfox.turn.v1", TURN_MODES.length, TURN_DEFAULT));

  const trails = new TrailRenderer(view.scene);
  const fx = createEffects(view.scene);
  const riders = new Map(); // player id -> rider from createRider
  /*
   * player id -> marker, and only for the riders somebody on THIS device is
   * steering: the arrow overhead and the ring that pulses through the
   * countdown. `kind === "human"` is the whole test and it is right in both
   * modes — js/net/shadow.js already reduces "the host says these ids are
   * yours" to the same field, so a guest marks its own riders and not the
   * strangers it is sharing the arena with. Attract mode has no humans, so
   * the paddock never grows arrows. Deliberately sparser than `riders`:
   * usually four of six ids are simply absent from it, so every lookup below
   * is written to expect a miss.
   */
  const markers = new Map();

  input.bindTouch(ui.touchButtons.left, ui.touchButtons.right);
  input.bindDrag(document.getElementById("arena"));
  ui.setVolumes(sfx.musicVolume, sfx.sfxVolume);

  let match = null;
  let net = null; // the peer-to-peer session, when there is one (js/net/)
  let mode = "menu"; // 'menu' (attract) | 'match' | 'net'
  /* A round is being fought over, wherever the simulation happens to run.
   * Everything the player is told, and the spectator camera, key off this
   * rather than off which of the two it is. */
  const inPlay = () => mode === "match" || mode === "net";
  /*
   * The pause overlay is up. It is deliberately not the same thing as the
   * game being stopped, because only one of the two modes can stop: a local
   * match is a simulation this page owns and may hold wherever it likes,
   * while a net match is the host's simulation and carries on regardless —
   * so Escape there raises the same panel over a round that is still being
   * ridden, and the panel says so. frozen() is the narrower question, and it
   * is the one the clock asks.
   */
  let paused = false;
  const frozen = () => paused && mode === "match";
  let acc = 0; // leftover frame time owed to the sim
  let time = 0; // seconds since load, for the riders' idle bob
  let goTimer = 0; // seconds of "Go!" banner left, counted in sim time

  /*
   * Spectating (ARCHITECTURE.md "Spectating" and "Spinning while
   * spectating"): once every human rider is out but the round is still being
   * fought over by the AI, steering stops steering a corpse. A tap of a
   * seat's steering control instead cycles the camera through a chase view
   * of whoever is still alive, with an overview stop at one end of the
   * cycle; holding it past SPIN_HOLD_SECONDS spins that view instead of
   * switching it. spectateStop indexes into stops() below: 0 is the
   * overview, 1.. are living riders in roster order.
   */
  let spectating = false;
  let crashViewHold = 0;
  let spectateStop = 0;
  let lastSpectateCaption = null; // last text handed to ui.setSpectate, so a step where nothing changed writes to the DOM zero times instead of sixty a second
  let lastResolvedStop; // last value read from stops()[spectateStop]; deliberately starts undefined, which never equals a real stop (null or an id), so the very first resolve always counts as a change
  let followId = null; // id of the player the chase camera should be posed on this frame, or null (overview / not spectating); step() decides who, render() poses the camera so it uses the same interpolated coordinates as the rider model
  const holdTime = [0, 0]; // seconds seat 0/1's steering control has been held continuously, while spectating
  const heldDir = [0, 0]; // the direction each seat was steering, remembered so its release can be judged a tap or the end of a spin

  /* One Map, refilled every step: the sim reads it and never keeps it, so
   * there is no reason to allocate a new one sixty times a second. */
  const humanTurns = new Map();

  /*
   * Palette slots are the roster. Humans take 0 and 1 because those are the
   * two colours the keyboard hints in index.html are written against; the AI
   * fill in behind them and answer to the names in PALETTE. The clamp matters:
   * the menu offers 2 riders and 5 rivals, which is one more than the six
   * slots the grid's Uint8Array owner field has room for.
   */
  function buildSpecs(humans, ais) {
    const total = Math.min(MAX_PLAYERS, humans + ais);
    const specs = [];
    for (let i = 0; i < total; i++) {
      const human = i < humans;
      specs.push({
        id: "p" + i,
        name: human ? (humans === 1 ? "You" : "P" + (i + 1)) : PALETTE[i].name,
        colorIndex: i,
        kind: human ? "human" : "ai",
        seat: human ? i : -1,
      });
    }
    return specs;
  }

  /*
   * Throw away the cast of the previous match and build one for whoever
   * `world.players` now holds: a rider per player, a marker for the ones
   * steered from this device, and the trail renderer bound to both. Both
   * kinds of match arrive here — the local one below and the net one further
   * down — because they differ in where the players came from and in nothing
   * else, and two copies of this loop would be two places to forget the
   * markers.
   */
  function spawnCast() {
    for (const rider of riders.values()) rider.dispose();
    riders.clear();
    for (const marker of markers.values()) marker.dispose();
    markers.clear();

    const hexById = new Map();
    for (const p of world.players) {
      const hex = PALETTE[p.colorIndex].hex;
      riders.set(p.id, createRider(view.scene, hex));
      if (p.kind === "human") markers.set(p.id, createMarker(view.scene, hex));
      hexById.set(p.id, hex);
    }
    trails.bind(world.players, hexById);
  }

  /* The countdown ring, on every marker at once. roundStart raises it and go
   * releases it, both only while actually in a match — the attract game
   * behind the paddock has no humans and therefore no markers, but saying it
   * here as well keeps the rule in one place if that ever changes. */
  function setReady(ready) {
    for (const marker of markers.values()) marker.setReady(ready, time);
  }

  /*
   * Tear down the previous field and stand up a new one. Riders are built
   * after match.start() because that is what calls world.setup() and gives
   * us the player list; the events start() produced are routed last, once
   * there is something on screen for them to talk about.
   */
  function startMatch(specs, opts) {
    world = soloWorld; // a local match always steps the World in this page

    // The arena is sized before the world places anyone; the scene only
    // rebuilds the floor, beams and camera fit when the half-size actually
    // changed, so re-picking the same size between rounds is nearly free.
    const half = ARENA_SIZES[ui.arena].half;
    world.setArena(half);
    view.setArena(half);
    // And everyone turns at the rate the Turning slider names — the attract
    // match too, so the bots behind the paddock preview the mode the same way
    // the floor previews the arena size.
    world.setTurnRate(TURN_MODES[ui.turn].rate);

    // opts.attract's own match never ends and must keep scaling its target
    // to the field (target: 0); a real match instead uses whatever the host
    // set on the "Win at" slider, read here rather than baked into opts by
    // the caller so beginMatch() doesn't have to know Match's own contract.
    match = new Match(world, specs, {
      ...opts,
      target: opts.attract ? 0 : ui.target,
    });
    const events = [];
    match.start(events);

    spawnCast();

    handleEvents(events);
  }

  /* Four places need the spectator camera forgotten, and they kept drifting
   * apart by a line each. */
  function clearSpectate() {
    spectating = false;
    crashViewHold = 0;
    spectateStop = 0;
    lastSpectateCaption = null;
    lastResolvedStop = undefined;
    followId = null;
    ui.hideSpectate();
  }

  function enterMenu() {
    // Whatever was holding still, stop holding it: this is reached from a
    // paused match as well as from a finished one, and the attract game is
    // about to start behind the panel.
    setPaused(false);
    // Leaving for the paddock ends a net game for this device, whichever end
    // of it we were, and closes the lobby if that is where we still are. The
    // host's guests are told; a guest simply goes.
    lobby.close();
    net = null;
    mode = "menu";
    view.setMode("orbit");
    goTimer = 0;
    clearSpectate();
    view.resetOrbit();
    // Four rivals is enough to fill the arena with trails without the field
    // wiping itself out while someone is still reading the title.
    startMatch(buildSpecs(0, 4), { attract: true });
    ui.showMenu();
    ui.hideHud();
    ui.hideBanner();
    ui.setTouchVisible(false);
    ui.setPauseButton(false);
  }

  function beginMatch() {
    setPaused(false);
    mode = "match";
    view.setMode("play");
    goTimer = 0;
    clearSpectate();
    view.resetOrbit();
    ui.hideMenu();
    startMatch(buildSpecs(ui.humans, ui.ais), {});
    ui.showHud(
      world.players.map((p) => ({
        id: p.id,
        name: p.name,
        hex: PALETTE[p.colorIndex].hex,
      })),
      match.target,
    );
    // The first roundStart fired inside startMatch, before the scoreboard
    // rows existed, so paint the zeroes onto the fresh HUD here.
    ui.setScores(match.scores, aliveMap());
    ui.setTouchVisible(true);
    ui.setPauseButton(true, false);
  }

  function onStart() {
    sfx.unlock();
    sfx.click();
    beginMatch();
  }

  /*
   * Multiplayer lives behind one door in the paddock, and everything on the
   * other side of it is js/net/. The lobby reads five of the paddock's own
   * settings when it opens a game — arena, turning, target and bots stay the
   * host's to set and travel to guests on join (js/net/host.js); local
   * players is this device's alone and decides how many seats it brings.
   * None of the five is asked for twice: the lobby has no controls of its
   * own for any of them.
   * It hands back a session once a match actually begins.
   */
  const lobby = createLobby({
    root: document.getElementById("ui"),
    ui,
    settings: {
      arenaIndex: () => ui.arena,
      turnIndex: () => ui.turn,
      target: () => ui.target,
      ais: () => ui.ais,
      // Local players, answered in the paddock before anyone opens this
      // screen. The lobby used to ask a second time in its own words; one
      // number with two controls is one number that can disagree with itself.
      humans: () => ui.humans,
    },
    onPlay: (session) => {
      sfx.unlock();
      net = session;
      beginNetMatch();
    },
    onBack: () => {
      net = null;
      enterMenu();
    },
    /*
     * The host closed their tab, or the connection died. There is no host
     * migration — a guest only ever holds a connection to the host, so there
     * is nobody left to promote — so the honest thing is to stop the arena
     * where it is and say why, with the way back to the paddock under it.
     * Freezing beats snapping to a menu: the player can see what happened.
     */
    onEnded: (why) => {
      net = null;
      if (mode !== "net") return;
      ui.setTouchVisible(false);
      ui.hideSpectate();
      ui.banner(why || "The game ended.", {
        sub: "no host, no game",
        actions: true,
        rematch: false,
      });
    },
  });
  // index.html may not carry the button yet; this inserts one after Blaze!
  // when it does not, and adopts the real one the moment it lands.
  mountEntry(onTogether);

  function onTogether() {
    sfx.unlock();
    sfx.click();
    lobby.open();
  }

  /*
   * A net match, from this device's side. The only differences from
   * beginMatch() are where the riders come from (the session's roster, which
   * the host decided) and that nothing here steps a simulation: `world` is
   * the session's ShadowWorld and `match` is the scoreboard the host keeps
   * sending. Everything downstream — riders, trails, banners, the spectator
   * camera — is the same code the solo game runs.
   */
  function beginNetMatch() {
    setPaused(false);
    mode = "net";
    view.setMode("play");
    goTimer = 0;
    clearSpectate();
    view.resetOrbit();
    ui.hideMenu();
    ui.hideBanner();

    world = net.world;
    match = net.match;
    view.setArena(world.half);

    spawnCast();
    trails.reset();

    ui.showHud(
      world.players.map((p) => ({
        id: p.id,
        name: p.name,
        hex: PALETTE[p.colorIndex].hex,
      })),
      match.target,
    );
    ui.setScores(match.scores, aliveMap());
    ui.setTouchVisible(true);
    // "Menu", not "Pause": this one does not stop.
    ui.setPauseButton(true, true);
  }

  /* Rematch is the same field again — the menu still holds the choice. In a
   * net match the field is the host's roster rather than this menu's, and
   * only the host may call for another one (js/net/host.js `rematch`); a
   * guest never sees the button, so this cannot be reached from one. */
  function onRematch() {
    sfx.click();
    if (mode === "net") net?.rematch?.();
    else beginMatch();
  }

  function onMenu() {
    sfx.click();
    enterMenu();
  }

  /*
   * Raise or lower the pause overlay.
   *
   * Only a local match actually stops, and it stops in one place — the render
   * loop, below — rather than by each system being told to hold still. What
   * happens here is the rest of it: the panel, and the touch buttons, which
   * would otherwise sit under the panel steering a rider that is not moving.
   * A net match keeps its buttons: its rider IS still moving, and taking the
   * controls away from a player whose fox is alive would be the one genuinely
   * unfair thing this overlay could do.
   *
   * scene.animationsEnabled is what stops the foxes jogging on the spot. It
   * is Babylon's own clips — the gait, the backflip — which run off the
   * engine's clock and know nothing about our accumulator, so freezing `time`
   * alone would leave a still arena full of running animals.
   */
  function setPaused(next) {
    if (next === paused || (next && !inPlay())) return;
    paused = next;
    if (next) {
      if (mode === "match") view.scene.animationsEnabled = false;
      // A net rider is still out there and still steerable, so it keeps its
      // buttons; a stopped one would be steering a statue from under the
      // panel, so it does not.
      ui.setTouchVisible(mode === "net");
      ui.setPauseButton(false);
      ui.showPause({
        live: mode === "net",
        canRestart: mode !== "net" || !!net?.rematch,
      });
    } else {
      // Unconditional, and not the mirror of the line above on purpose: this
      // is reached both by a match resuming and by one being abandoned, and
      // in the second case `mode` has often already moved on. Whatever froze
      // the clips, they run again — the attract match behind the paddock must
      // never inherit a still scene.
      view.scene.animationsEnabled = true;
      ui.hidePause();
      ui.setPauseButton(inPlay());
      // Coming back from a pause on a finished match must not put the
      // steering buttons back over the Rematch banner (matchOver took them
      // away on purpose).
      if (inPlay()) ui.setTouchVisible(match?.state !== "matchOver");
    }
  }

  /* The pause overlay's two ways out. Both drop the overlay first, so
   * whatever they do next starts from a game that is running again — a
   * restart into a scene with animationsEnabled still false would deal a
   * fresh round of statues. */
  function onPauseRestart() {
    setPaused(false);
    onRematch();
  }

  function onPauseLeave() {
    setPaused(false);
    onMenu();
  }

  /*
   * Escape, which used to abandon the match outright — the same one-keypress
   * hazard R was, and worse for sitting on the key a player reaches for to
   * get OUT of things. It is the pause overlay now, opened and closed, and it
   * no longer destroys anything at all; leaving is a button on the panel.
   * That is also why a finished match is not a special case here: there is
   * nothing left to protect it from, and the overlay is a perfectly good
   * place to turn the music down after the fanfare.
   *
   * ui.js is handed this same function for the in-match Pause pill, so the
   * key and the button can never come to mean different things.
   *
   * Outside a match it backs out of whatever is sitting over the paddock: the
   * sound menu, or the lobby (which enterMenu closes). In the bare paddock it
   * restarts the attract match, which is what it has always done and is
   * harmless.
   */
  function onEscape() {
    if (inPlay()) {
      sfx.click();
      setPaused(!paused);
      return;
    }
    if (ui.soundOpen) {
      sfx.click();
      ui.showMenu();
      return;
    }
    onMenu();
  }

  /*
   * The sound menu opening or closing. ui.js has already decided which panel
   * is on screen; this is only the noise that press deserves — and the
   * unlock, because opening the mixer is a genuine user gesture and the
   * whole point of standing in front of the effects slider is to hear it
   * move. Doing that here rather than the first time the slider is dragged
   * means the very first drag makes a sound too.
   */
  function onSound() {
    sfx.unlock();
    sfx.click();
  }

  function onMusicVolume(v) {
    sfx.setMusicVolume(v);
  }

  // Dragging the effects slider is itself a gesture, and unlocking here lets
  // the player hear what they are setting straight away.
  function onSfxVolume(v) {
    sfx.setSfxVolume(v);
    sfx.unlock();
  }

  /* The slider fires this on release (ui.js's "change", not "input"). Only
   * the menu's attract match restarts to preview the new size live; a size
   * picked mid-match just waits for the next round to start or end. */
  function onArena(index) {
    try {
      localStorage.setItem("neonfox.arena.v1", String(index));
    } catch {
      // localStorage unavailable; the choice just won't survive a reload.
    }
    sfx.click();
    if (mode === "menu") enterMenu();
  }

  /* The Turning slider, on release, the same way: remember it, and let the
   * attract match show the bots taking the new radius. A local match already
   * running keeps its rate — a rule of the match does not change under the
   * riders mid-round — and picks the new one up at the next Blaze!. */
  function onTurn(index) {
    try {
      localStorage.setItem("neonfox.turn.v1", String(index));
    } catch {
      // localStorage unavailable; the choice just won't survive a reload.
    }
    sfx.click();
    if (mode === "menu") enterMenu();
  }

  /*
   * There is no 'restart' command any more. R used to throw the whole match
   * away on one unmodified keypress, a stray reach from the A/D rider two
   * steers with, and nothing asked first. Restarting is still one press —
   * it is on the pause overlay, next to the way out — but you have to stop
   * the game to reach it, which is exactly the deliberation the key was
   * missing. See js/input.js, which no longer sends one.
   */
  input.onCommand = (name) => {
    if (name === "start") {
      if (mode === "menu") onStart();
      else if (match && match.state === "matchOver") {
        // Enter on a finished net match is the host's rematch, and nothing
        // at all for a guest — same rule as the button.
        if (mode !== "net" || net?.rematch) onRematch();
      }
    } else if (name === "menu") {
      onEscape();
    }
  };

  /* Browsers will not make noise until the player has touched the page, and
   * the menu's own buttons are not the only way in — the keyboard starts a
   * match too. Both listeners are one-shot; unlock() is safe either way. */
  window.addEventListener("pointerdown", () => sfx.unlock(), { once: true });
  window.addEventListener("keydown", () => sfx.unlock(), { once: true });

  /* id -> alive, the shape ui.setScores wants for dimming the dead. */
  function aliveMap() {
    const map = {};
    for (const p of world.players) map[p.id] = p.alive;
    return map;
  }

  /* Whether either seat's own rider is still standing. */
  function humansAlive() {
    return world.players.some((p) => p.kind === "human" && p.alive);
  }

  /*
   * Winner wording (ARCHITECTURE.md "Glue"): a lone human is named "You",
   * so a fixed "<name> takes the round" reads as "You takes the round" —
   * wrong agreement, and a missed chance to make a win feel personal. Ask
   * instead whether the winner *is* the solo player reading the screen:
   * that is only true for a human rider in a field with exactly one human.
   * Two humans share a screen (P1/P2), so neither of them is "you" even
   * though both are human, and every AI winner is third person regardless.
   */
  function winnerPhrase(player, { match = false } = {}) {
    const solo =
      player.kind === "human" &&
      world.players.filter((p) => p.kind === "human").length === 1;
    if (solo) return match ? "You win the match!" : "You win!";
    return match
      ? `${player.name} wins the match!`
      : `${player.name} takes the round`;
  }

  /*
   * The spectator cycle: an overview stop (null) followed by every living
   * rider's id, in roster order. Called at most once a step and only while
   * spectating, so the small allocation here never touches the hot path a
   * live match runs the rest of the time.
   */
  function stops() {
    const list = [null];
    for (const p of world.players) if (p.alive) list.push(p.id);
    return list;
  }

  /*
   * A tap — a steering control released before it spun the view — moves the
   * spectator one stop in the direction it was held: left (+1) back toward
   * the overview, right (-1) forward through the living riders. Same cycle
   * the direction ran under the old press-edge switch this replaces.
   */
  function cycleStop(dir) {
    const list = stops();
    const delta = dir > 0 ? -1 : 1;
    spectateStop = (spectateStop + delta + list.length) % list.length;
    sfx.click();
  }

  function step() {
    // The "Go!" flash is counted in sim time, not by setTimeout: a paused or
    // backgrounded tab must not come back to a banner that expired while
    // nothing was moving.
    if (goTimer > 0) {
      goTimer -= TICK;
      if (goTimer <= 0) {
        goTimer = 0;
        ui.hideBanner();
      }
    }

    const events = [];
    if (mode === "net") {
      /*
       * A net match steps nothing here. This device's steering goes out —
       * clamped to -1/0/+1 on the way, and again by the host, because a guest
       * must not be able to claim its own state — and the world comes back as
       * frames somebody else's simulation produced. net.pump() applies them
       * and hands up the same round events Match would have.
       */
      if (net) {
        for (let seat = 0; seat < net.seats; seat++)
          net.setLocalTurn(seat, input.turn(seat));
        net.pump(events);
      }
    } else {
      humanTurns.clear();
      for (const p of world.players) {
        if (p.kind === "human") humanTurns.set(p.id, input.turn(p.seat));
      }
      match.update(TICK, humanTurns, events);
    }
    handleEvents(events);

    // Human turns above still reach the sim exactly as before; a dead
    // rider's seat is simply ignored there. Spectating only decides what the
    // camera does with the same seats once nobody is left to steer.
    if (
      inPlay() &&
      match.state === "playing" &&
      !humansAlive() &&
      !spectating
    ) {
      // Sim-time delay: the crash remains visible and pausing freezes the wait.
      // Requiring an active round prevents a late chase during round-over.
      crashViewHold += TICK;
      if (crashViewHold >= CRASH_VIEW_HOLD_SECONDS) {
        spectating = true;
        spectateStop = 1; // the first living rider; stops()[0] is the overview
        view.setMode("follow");
      }
    } else {
      crashViewHold = 0;
    }

    if (spectating && inPlay()) {
      // Tap vs hold, per seat: released before SPIN_HOLD_SECONDS cycles the
      // stop (cycleStop, below — the same switch the old press-edge version
      // did); held past it spins the view instead, continuously, for as long
      // as it stays down. Both seats are tracked independently because a
      // solo death still leaves the second seat free on a two-player
      // keyboard, and their spin contributions are simply summed, so holding
      // opposite directions on both seats cancels rather than fighting.
      let spinYaw = 0;
      for (let seat = 0; seat < 2; seat++) {
        const t = input.turn(seat);
        if (t !== 0) {
          holdTime[seat] += TICK;
          heldDir[seat] = t;
          if (holdTime[seat] >= SPIN_HOLD_SECONDS) spinYaw += t;
        } else if (holdTime[seat] > 0) {
          if (holdTime[seat] < SPIN_HOLD_SECONDS) cycleStop(heldDir[seat]);
          holdTime[seat] = 0;
          heldDir[seat] = 0;
        }
      }
      // Sign chosen so holding right orbits the camera to the right of the
      // rider: turn() gives left = +1 / right = -1, the opposite sign from
      // the yaw we want, hence the negation. Flip it here if it reads
      // backwards on screen — scene.js does not need to change either way.
      if (spinYaw !== 0) view.spin(-spinYaw * SPIN_RATE * TICK, 0);

      // Drag, pinch and wheel, then the zoom keys — each read once a step so
      // a frame's worth of pointer motion is spent exactly once.
      const d = input.takeDrag();
      if (d.dx || d.dy) view.spin(d.dx * 0.006, -d.dy * 0.004);
      if (d.dz) view.zoom(Math.exp(d.dz * 0.0015));
      const zk = input.zoomKey();
      // zoomKey() gives +1 for ArrowUp, which must zoom IN — a factor below
      // 1 — the opposite sign from a literal reading of the constant, hence
      // the negation here.
      if (zk) view.zoom(Math.exp(-zk * ZOOM_KEY_RATE * TICK));

      const list = stops();
      // A rider dying between switches can shrink the list out from under
      // the current index; clamp rather than index past the end, which
      // walks the view on to whoever is left.
      if (spectateStop >= list.length) {
        spectateStop = list.length ? list.length - 1 : 0;
      }
      const stop = list[spectateStop];
      // Any change of stop — a tap, or the clamp above moving on from a
      // rider who just died — snaps the orbit back to its default offset,
      // so a wild spin never carries over onto whoever is followed next.
      if (stop !== lastResolvedStop) {
        lastResolvedStop = stop;
        view.resetOrbit();
      }
      if (stop === null) {
        view.setMode("play");
        followId = null;
        if (lastSpectateCaption !== "Overview") {
          lastSpectateCaption = "Overview";
          ui.setSpectate("Overview", "");
        }
      } else {
        const p = world.byId(stop);
        view.setMode("follow");
        // step() only decides *whom* to follow; render() poses the camera,
        // once a frame, on that player's interpolated position so the
        // camera and the rider model it is chasing never visibly disagree.
        followId = p.id;
        const caption = "Riding with " + p.name;
        if (lastSpectateCaption !== caption) {
          lastSpectateCaption = caption;
          ui.setSpectate(caption, PALETTE[p.colorIndex].hex);
        }
      }
    } else {
      // Not spectating: steering still reaches the sim exactly as before
      // (above), and any pointer motion or held-key time collected while
      // this was just a menu or an ordinary match must not pile up and
      // detonate into a stray spin the moment spectating begins.
      input.takeDrag();
      holdTime[0] = 0;
      holdTime[1] = 0;
      heldDir[0] = 0;
      heldDir[1] = 0;
      followId = null;
    }
  }

  /*
   * alpha is how far the frame sits into the next sim tick (0..1; see the
   * render loop below). The sim moves in fixed TICK steps but this runs once
   * a frame, so on a display faster than 60 Hz most frames land between two
   * ticks — without blending, a rider only advances on the frames that also
   * ran a step, which is invisible at 60 Hz but reads as a visible tremor at
   * 120+ (every other frame stands still). Blending from last tick's pose
   * (px, py, ph) to this tick's (x, y, heading) instead shows a frame that
   * is up to one tick (16 ms) stale — an age nobody can see — in exchange
   * for removing motion everybody can (ARCHITECTURE.md "Fixed timestep").
   * Trails keep drawing to the raw head (world.js already samples strokes
   * off x/y); the orb riding slightly behind it covers the gap.
   */
  function render(alpha) {
    for (const p of world.players) {
      const ix = p.px + (p.x - p.px) * alpha;
      const iy = p.py + (p.y - p.py) * alpha;
      // Shortest-arc lerp: heading wraps at +-PI, so a naive lerp across
      // that seam would spin the rider the long way round once a tick.
      let dh = p.heading - p.ph;
      if (dh > Math.PI) dh -= Math.PI * 2;
      else if (dh < -Math.PI) dh += Math.PI * 2;
      const ih = p.ph + dh * alpha;

      riders.get(p.id).setPose(ix, iy, ih, p.turn, time);

      // Only the seats on this device have one, so this is a lookup that
      // misses four times out of six and does nothing when it does. The
      // marker takes the same interpolated position as the model above and
      // none of its rotation: an arrow and a ground ring must not wear the
      // rider's bank (js/render/marker.js explains why it keeps its own root).
      const marker = markers.get(p.id);
      if (marker) {
        marker.setPose(ix, iy);
        marker.update(time);
      }

      // The chase camera used to be posed inside step(), at sim rate, which
      // is exactly the tremor this function exists to remove; posing it
      // here instead, from the same interpolated coordinates as the rider
      // model, means camera and rider glide together every frame.
      if (followId !== null && p.id === followId && p.alive) {
        view.setFollow(ix, iy, ih);
      }
    }
    trails.update(world);
  }

  /*
   * The whole presentation layer, in one switch. Everything physical — the
   * burst, the camera kick, hiding the crashed rider — happens in both modes,
   * because the attract screen is a real match and should look like one.
   * Everything the player is being *told* is gated on being in a match.
   */
  function handleEvents(events) {
    const inMatch = inPlay();
    for (const e of events) {
      switch (e.type) {
        case "roundStart": {
          trails.reset();
          for (const rider of riders.values()) rider.setAlive(true);
          for (const marker of markers.values()) marker.setAlive(true);
          // A fresh round means everyone is alive again, so any spectator
          // camera from the round before belongs to a race that is over.
          clearSpectate();
          view.resetOrbit();
          if (inMatch) {
            // Clearing the state above is not enough on its own: the camera
            // is still in 'follow', and with followId now null nothing poses
            // it, so it would hang behind a rider from the round before.
            // Attract mode is left alone, since its camera is the menu orbit.
            view.setMode("play");
            ui.setScores(match.scores, aliveMap());
            ui.banner("Steer to aim", { sub: "Round " + e.round });
            sfx.ready();
            // "Steer to aim" is the instruction; the ring is what says which
            // rider it is addressed to. Up for the whole countdown, which is
            // the one stretch of a round where nobody has laid any trail yet
            // and the six of them are hardest to tell apart.
            setReady(true);
          }
          break;
        }

        case "go": {
          // Attract mode plays silently behind the menu, like every other cue.
          if (inMatch) {
            ui.banner("Go!", { sub: "" });
            goTimer = GO_FLASH_SECONDS;
            sfx.go();
            // Released rather than switched off: marker.js swells and dims it
            // over a third of a second. The arrow overhead stays for the rest
            // of the round.
            setReady(false);
          }
          break;
        }

        case "eliminated": {
          const p = world.byId(e.id);
          // A net match can in principle carry an id this device has no
          // rider for — a frame packed against a roster it has not been told
          // about yet. Say nothing rather than throw into the render loop.
          if (!p) break;
          riders.get(e.id)?.setAlive(false);
          // An arrow hanging over an empty patch of floor is worse than no
          // arrow, so the marker goes out with the rider it belongs to.
          markers.get(e.id)?.setAlive(false);
          fx.burst(p.x, p.y, PALETTE[p.colorIndex].hex);
          // Your own crash is worth more shake than a rival's.
          view.kick(p.kind === "human" ? 0.9 : 0.4);
          // The fox whose trail did the killing gloats — but never a wall,
          // never your own trail (that's e.by === e.id, not a kill), and
          // never a corpse: two riders can cut each other's trails on the
          // same tick, and the one who "won" that exchange may already be
          // dead too.
          const killer =
            e.by !== "wall" && e.by !== e.id ? world.byId(e.by) : null;
          if (killer?.alive) riders.get(e.by)?.celebrate();
          if (inMatch) {
            sfx.crash();
            // The crash lands first, then the gloat — attract mode stays
            // silent even though its foxes still flip.
            if (killer?.alive) sfx.taunt(killer.colorIndex);
            ui.setScores(match.scores, aliveMap());
          }
          break;
        }

        case "roundOver": {
          // The surviving winner gets to gloat too — attract mode included,
          // like the burst and kick above, since there are a couple of
          // seconds of round-over banner with nothing else happening. null
          // when everybody crashed on the same tick, so nobody celebrates.
          if (e.winnerId) riders.get(e.winnerId)?.celebrate(2);
          if (inMatch) {
            goTimer = 0; // a pending "Go!" hide must not wipe this banner
            const winner = e.winnerId ? world.byId(e.winnerId) : null;
            if (winner) {
              ui.banner(winnerPhrase(winner), {
                hex: PALETTE[winner.colorIndex].hex,
              });
              // Two taunts under the two flips: the clip is 1.133 s, so the
              // second lands as the second flip starts.
              sfx.taunt(winner.colorIndex);
              sfx.taunt(winner.colorIndex, 1.13);
            } else {
              ui.banner("Everyone crashed", { sub: "no winner this round" });
            }
            sfx.roundWin();
            ui.setScores(match.scores, aliveMap());
          }
          break;
        }

        case "matchOver": {
          if (inMatch) {
            goTimer = 0;
            const winner = world.byId(e.winnerId);
            ui.banner(winnerPhrase(winner, { match: true }), {
              hex: PALETTE[winner.colorIndex].hex,
              actions: true,
              // Only a host may call for another match, so a guest gets the
              // way back to the paddock and no button that does nothing.
              rematch: mode !== "net" || !!net?.rematch,
              sub: "first to " + match.target,
            });
            sfx.matchWin();
            // The delay lets the fanfare open first; the fox answers it.
            // The steering buttons would sit on top of Rematch; the match is
            // over, so there is nothing left to steer anyway.
            ui.setTouchVisible(false);
            // And with those buttons gone a spectator has no way back to the
            // overview, so take them there: a winner banner reads badly over
            // a camera still parked behind somebody's tail.
            clearSpectate();
            view.resetOrbit();
            view.setMode("play");
          }
          break;
        }

        default:
          break;
      }
    }
  }

  view.engine.runRenderLoop(() => {
    // Clamp the frame: a tab that was hidden for a minute owes the sim a
    // minute of ticks, and paying that debt would freeze the page. Better to
    // drop the time than to spiral.
    const dt = Math.min(0.1, view.engine.getDeltaTime() / 1000);

    /*
     * The one place a pause actually happens, and the reason nothing else in
     * this file had to learn about it. Neither the sim nor `time` advances —
     * `time` being the clock the riders' lean, the markers' bob and the ring's
     * pulse all read, so freezing it is what makes the picture still rather
     * than merely motionless. The camera is deliberately still updated: a
     * phone rotated or a window resized while paused must reframe, and the
     * scene is still rendered, because a paused game is a picture of a game.
     * The accumulator is zeroed rather than left standing, so coming back does
     * not pay out a lump of ticks the player never saw.
     */
    if (frozen()) {
      acc = 0;
      view.update(dt);
      view.scene.render();
      return;
    }

    time += dt;
    acc += dt;
    let steps = 0;
    while (acc >= TICK && steps < 4) {
      step();
      acc -= TICK;
      steps++;
    }
    if (steps === 4) acc = 0; // hit the cap: stop owing time we will never repay
    // How far into the next tick this frame sits, for render()'s
    // interpolation; a capped frame already zeroed acc above, so it renders
    // at exactly the latest tick (alpha 0) rather than guessing further.
    const alpha = acc / TICK;
    render(alpha);
    view.update(dt);
    view.scene.render();
  });

  enterMenu();
}
