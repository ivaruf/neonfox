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
  SPIN_HOLD_SECONDS,
  SPIN_RATE,
  ZOOM_KEY_RATE,
} from "./config.js";
import { World } from "./sim/world.js";
import { Match } from "./sim/match.js";
import { createScene } from "./render/scene.js";
import { createRider, preloadRiders } from "./render/rider.js";
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
  preloadRiders(view.scene).then(() => {
    if (mode === "menu") enterMenu();
  }, () => {});

  const world = new World();
  const input = new Input();
  const sfx = new Sfx();
  const ui = new UI(document.getElementById("ui"), {
    onStart,
    onRematch,
    onMenu,
    onMusicVolume,
    onSfxVolume,
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
  input.bindDrag(document.getElementById("arena"));
  ui.setVolumes(sfx.musicVolume, sfx.sfxVolume);

  let match = null;
  let mode = "menu"; // 'menu' (attract) | 'match'
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

    // opts.attract's own match never ends and must keep scaling its target
    // to the field (target: 0); a real match instead uses whatever the host
    // set on the "Win at" slider, read here rather than baked into opts by
    // the caller so beginMatch() doesn't have to know Match's own contract.
    match = new Match(world, specs, { ...opts, target: opts.attract ? 0 : ui.target });
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
    lastResolvedStop = undefined;
    followId = null;
    ui.hideSpectate();
    view.resetOrbit();
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
    lastResolvedStop = undefined;
    followId = null;
    ui.hideSpectate();
    view.resetOrbit();
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

    humanTurns.clear();
    for (const p of world.players) {
      if (p.kind === "human") humanTurns.set(p.id, input.turn(p.seat));
    }

    const events = [];
    match.update(TICK, humanTurns, events);
    handleEvents(events);

    // Human turns above still reach the sim exactly as before; a dead
    // rider's seat is simply ignored there. Spectating only decides what the
    // camera does with the same seats once nobody is left to steer.
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
          lastResolvedStop = undefined;
          followId = null;
          ui.hideSpectate();
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
              sub: "first to " + match.target,
            });
            sfx.matchWin();
            // The delay lets the fanfare open first; the fox answers it.
            // The steering buttons would sit on top of Rematch; the match is
            // over, so there is nothing left to steer anyway.
            ui.setTouchVisible(false);
            ui.hideSpectate();
            // And with those buttons gone a spectator has no way back to the
            // overview, so take them there: a winner banner reads badly over
            // a camera still parked behind somebody's tail.
            spectating = false;
            spectateStop = 0;
            lastSpectateCaption = null;
            lastResolvedStop = undefined;
            followId = null;
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
