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
  MAX_PLAYERS,
  PALETTE,
  ARENA_SIZES,
  ARENA_DEFAULT,
} from "./config.js";
import { World } from "./sim/world.js";
import { Match } from "./sim/match.js";
import { createScene } from "./render/scene.js";
import { createRider } from "./render/rider.js";
import { TrailRenderer } from "./render/trails.js";
import { createEffects } from "./render/effects.js";
import { Input } from "./input.js";
import { UI } from "./ui.js";
import { Sfx } from "./audio.js";

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

function boot() {
  const view = createScene(document.getElementById("arena"));
  const world = new World();
  const input = new Input();
  const sfx = new Sfx();
  const ui = new UI(document.getElementById("ui"), {
    onStart,
    onRematch,
    onMenu,
    onSound,
    onArena,
  });

  // Restore the saved arena size before the very first match (the attract
  // one, below) ever spawns, so the title screen already shows the size the
  // player left it on rather than flashing "Classic" for a frame. try/catch
  // per hub CLAUDE.md §6: private mode and quota limits are real.
  let savedArena = ARENA_DEFAULT;
  try {
    const parsed = parseInt(localStorage.getItem("trailblazers.arena.v1"), 10);
    if (Number.isInteger(parsed) && parsed >= 0 && parsed < ARENA_SIZES.length) {
      savedArena = parsed;
    }
  } catch {
    // localStorage unavailable; the default stands.
  }
  ui.setArena(savedArena);

  const trails = new TrailRenderer(view.scene);
  const fx = createEffects(view.scene);
  const riders = new Map(); // player id -> rider from createRider

  input.bindTouch(ui.touchButtons.left, ui.touchButtons.right);
  ui.setSound(sfx.enabled);

  let match = null;
  let mode = "menu"; // 'menu' (attract) | 'match'
  let acc = 0; // leftover frame time owed to the sim
  let time = 0; // seconds since load, for the riders' idle bob
  let goTimer = 0; // seconds of "Go!" banner left, counted in sim time

  /*
   * Spectating (ARCHITECTURE.md "Spectating"): once every human rider is out
   * but the round is still being fought over by the AI, steering stops
   * steering a corpse and instead cycles the camera through a chase view of
   * whoever is still alive, with an overview stop at one end of the cycle.
   * spectateStop indexes into stops() below: 0 is the overview, 1.. are
   * living riders in roster order. prevTurn holds each seat's turn from the
   * previous step so a press can be told from a held key (an edge, not a
   * level) the same way input.js already treats start/restart/menu.
   */
  let spectating = false;
  let spectateStop = 0;
  let lastSpectateCaption = null; // last text handed to ui.setSpectate, so a step where nothing changed writes to the DOM zero times instead of sixty a second
  const prevTurn = [0, 0];

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
   * Tear down the previous field and stand up a new one. Riders are built
   * after match.start() because that is what calls world.setup() and gives
   * us the player list; the events start() produced are routed last, once
   * there is something on screen for them to talk about.
   */
  function startMatch(specs, opts) {
    for (const rider of riders.values()) rider.dispose();
    riders.clear();

    // The arena is sized before the world places anyone; the scene only
    // rebuilds the floor, beams and camera fit when the half-size actually
    // changed, so re-picking the same size between rounds is nearly free.
    const half = ARENA_SIZES[ui.arena].half;
    world.setArena(half);
    view.setArena(half);

    match = new Match(world, specs, opts);
    const events = [];
    match.start(events);

    const hexById = new Map();
    for (const p of world.players) {
      const hex = PALETTE[p.colorIndex].hex;
      riders.set(p.id, createRider(view.scene, hex));
      hexById.set(p.id, hex);
    }
    trails.bind(world.players, hexById);

    handleEvents(events);
  }

  function enterMenu() {
    mode = "menu";
    view.setMode("orbit");
    goTimer = 0;
    spectating = false;
    spectateStop = 0;
    lastSpectateCaption = null;
    ui.hideSpectate();
    // Four rivals is enough to fill the arena with trails without the field
    // wiping itself out while someone is still reading the title.
    startMatch(buildSpecs(0, 4), { attract: true });
    ui.showMenu();
    ui.hideHud();
    ui.hideBanner();
    ui.setTouchVisible(false);
  }

  function beginMatch() {
    mode = "match";
    view.setMode("play");
    goTimer = 0;
    spectating = false;
    spectateStop = 0;
    lastSpectateCaption = null;
    ui.hideSpectate();
    ui.hideMenu();
    startMatch(buildSpecs(ui.humans, ui.ais), {});
    ui.showHud(
      world.players.map((p) => ({
        id: p.id,
        name: p.name,
        hex: PALETTE[p.colorIndex].hex,
      })),
      match.target
    );
    // The first roundStart fired inside startMatch, before the scoreboard
    // rows existed, so paint the zeroes onto the fresh HUD here.
    ui.setScores(match.scores, aliveMap());
    ui.setTouchVisible(true);
  }

  function onStart() {
    sfx.unlock();
    sfx.click();
    beginMatch();
  }

  /* Rematch is the same field again — the menu still holds the choice. */
  function onRematch() {
    sfx.click();
    beginMatch();
  }

  function onMenu() {
    sfx.click();
    enterMenu();
  }

  function onSound(enabled) {
    sfx.setEnabled(enabled);
    sfx.unlock(); // turning sound on is itself the gesture that permits it
  }

  /* The slider fires this on release (ui.js's "change", not "input"). Only
   * the menu's attract match restarts to preview the new size live; a size
   * picked mid-match just waits for the next round to start or end. */
  function onArena(index) {
    try {
      localStorage.setItem("trailblazers.arena.v1", String(index));
    } catch {
      // localStorage unavailable; the choice just won't survive a reload.
    }
    sfx.click();
    if (mode === "menu") enterMenu();
  }

  input.onCommand = (name) => {
    if (name === "start") {
      if (mode === "menu") onStart();
      else if (match && match.state === "matchOver") onRematch();
    } else if (name === "restart") {
      if (mode === "match") beginMatch(); // R throws the whole match away
    } else if (name === "menu") {
      onMenu();
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

    // Press-edge detection for the spectator switch, ahead of reading the
    // same seats for the sim's own steering: a held direction must move the
    // view exactly once, on the frame it is first pressed, not once per tick
    // for as long as the button stays down.
    let pressedDir = 0; // +1 left / -1 right, the sim's own turn convention
    for (let seat = 0; seat < 2; seat++) {
      const t = input.turn(seat);
      const pressed = t !== 0 && prevTurn[seat] === 0;
      prevTurn[seat] = t;
      if (pressed) pressedDir = t;
    }

    humanTurns.clear();
    for (const p of world.players) {
      if (p.kind === "human") humanTurns.set(p.id, input.turn(p.seat));
    }

    const events = [];
    match.update(TICK, humanTurns, events);
    handleEvents(events);

    // Human turns above still reach the sim exactly as before; a dead
    // rider's seat is simply ignored there. Spectating only decides what the
    // camera does with the same presses once nobody is left to steer.
    if (
      mode === "match" &&
      match.state === "playing" &&
      !humansAlive() &&
      !spectating
    ) {
      spectating = true;
      spectateStop = 1; // the first living rider; stops()[0] is the overview
      view.setMode("follow");
    }

    if (spectating && mode === "match") {
      const list = stops();
      if (pressedDir !== 0) {
        // Left (+1) steps back toward the overview, right (-1) steps forward
        // through the riders — the opposite sign from the sim's own steering
        // because this is a menu of stops, not a heading.
        const delta = pressedDir > 0 ? -1 : 1;
        spectateStop = (spectateStop + delta + list.length) % list.length;
        sfx.click();
      }
      // A rider dying between switches shrinks the list; clamp rather than
      // index past the end, which walks the view on to whoever is left.
      if (spectateStop >= list.length) {
        spectateStop = list.length ? list.length - 1 : 0;
      }
      const stop = list[spectateStop];
      if (stop === null) {
        view.setMode("play");
        if (lastSpectateCaption !== "Overview") {
          lastSpectateCaption = "Overview";
          ui.setSpectate("Overview", "");
        }
      } else {
        const p = world.byId(stop);
        view.setMode("follow");
        view.setFollow(p.x, p.y, p.heading);
        const caption = "Riding with " + p.name;
        if (lastSpectateCaption !== caption) {
          lastSpectateCaption = caption;
          ui.setSpectate(caption, PALETTE[p.colorIndex].hex);
        }
      }
    }
  }

  function render() {
    for (const p of world.players) {
      riders.get(p.id).setPose(p.x, p.y, p.heading, p.turn, time);
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
    const inMatch = mode === "match";
    for (const e of events) {
      switch (e.type) {
        case "roundStart": {
          trails.reset();
          for (const rider of riders.values()) rider.setAlive(true);
          // A fresh round means everyone is alive again, so any spectator
          // camera from the round before belongs to a race that is over.
          spectating = false;
          spectateStop = 0;
          lastSpectateCaption = null;
          ui.hideSpectate();
          if (inMatch) {
            ui.setScores(match.scores, aliveMap());
            ui.banner("Steer to aim", { sub: "Round " + e.round });
            sfx.ready();
          }
          break;
        }

        case "go": {
          // Attract mode plays silently behind the menu, like every other cue.
          if (inMatch) {
            ui.banner("Go!", { sub: "" });
            goTimer = GO_FLASH_SECONDS;
            sfx.go();
          }
          break;
        }

        case "eliminated": {
          const p = world.byId(e.id);
          riders.get(e.id).setAlive(false);
          fx.burst(p.x, p.y, PALETTE[p.colorIndex].hex);
          // Your own crash is worth more shake than a rival's.
          view.kick(p.kind === "human" ? 0.9 : 0.4);
          if (inMatch) {
            sfx.crash();
            ui.setScores(match.scores, aliveMap());
          }
          break;
        }

        case "roundOver": {
          if (inMatch) {
            goTimer = 0; // a pending "Go!" hide must not wipe this banner
            const winner = e.winnerId ? world.byId(e.winnerId) : null;
            if (winner) {
              ui.banner(winner.name + " takes the round", {
                hex: PALETTE[winner.colorIndex].hex,
              });
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
            ui.banner(winner.name + " wins the match!", {
              hex: PALETTE[winner.colorIndex].hex,
              actions: true,
              sub: "first to " + match.target,
            });
            sfx.matchWin();
            // The steering buttons would sit on top of Rematch; the match is
            // over, so there is nothing left to steer anyway.
            ui.setTouchVisible(false);
            ui.hideSpectate();
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
    time += dt;
    acc += dt;
    let steps = 0;
    while (acc >= TICK && steps < 4) {
      step();
      acc -= TICK;
      steps++;
    }
    if (steps === 4) acc = 0; // hit the cap: stop owing time we will never repay
    render();
    view.update(dt);
    view.scene.render();
  });

  enterMenu();
}
