# Trailblazers — architecture and lane contract

A Kurve-style arena game: riders on glowing orbs leave solid trails, touch a
trail or the wall and you are out, last rider standing takes the round. This
file is the contract between the modules (and between the agents that build
them): who owns which file, what each exports, and the conventions that let
them meet without reading each other's code. Change a contract here first,
then in the code.

## The split

```
index.html           page shell: canvas + DOM overlay + pinned Babylon tags
css/style.css        overlay styling; rider colour arrives as --c
js/config.js         every tuning number and the six-colour PALETTE
js/sim/              THE GAME. Plain numbers, no DOM, no Babylon.
  rng.js             seedable mulberry32
  grid.js            occupancy grid: owner + stamp tick per cell
  world.js           riders, movement, trail painting, gaps, collisions
  ai.js              lookahead rivals
  match.js           round state machine and Kurve scoring, emits events
js/render/           reads the sim, draws it with Babylon
  scene.js           engine, camera fit, lights, arena, glow, shake
  blue-cat.js        the codex concept rider, adapted to an ES module
  rider.js           one rider per player: GLB fox, or procedural cat, or primitives
  trails.js          chunked neon ribbons built from world strokes
  effects.js         elimination burst
js/input.js          keyboard + touch buttons -> turn per seat, commands
js/ui.js             menu, scoreboard, banners, touch button visibility
js/audio.js          WebAudio blips and the looping theme, lazily created on first gesture
audio/               shipped sound: theme.m4a and fox-say.m4a
tools/audio/         the Sonic Pi pieces those are rendered from (hub §9)
js/main.js           glue: fixed-timestep loop, event routing, modes
tools/sim-smoke.mjs  runs sim + match headless under node, no Babylon
vendor/babylon.js    byte-identical local fallback for the pinned CDN file
vendor/loaders.js    same, for the glTF loader
models/              rider GLBs from codex-concepts (fox-detailed.glb today)
```

The sim/render split is deliberate and load-bearing: the plan is fishtank's
host-authoritative P2P, where one peer runs `World` + `Match` in a Web Worker
and the others render snapshots. Nothing under `js/sim/` may import Babylon or
touch `document`/`window`.

## Coordinates and conventions

- Sim space is 2D: `x` right, `y` up the screen, heading is the maths angle
  (`cos`, `sin`), steering **left is a positive turn**. Arena is a square,
  `-ARENA_HALF..ARENA_HALF` on both axes, centred on the origin.
- Render maps sim `(x, y)` to Babylon `(x, 0, y)`: sim y becomes Babylon z.
  The play camera sits on the `-z` side looking at the origin, so `+z` is up
  the screen and `+x` is right, matching the sim.
- A rider model faces `-z` in its own space (the codex concept's convention).
  To face sim heading `h`: `root.rotation.y = Math.atan2(-Math.cos(h), -Math.sin(h))`.
- Colours are hex strings from `PALETTE[colorIndex].hex`; convert with
  `BABYLON.Color3.FromHexString` where needed.
- **glTF nodes arrive with a `rotationQuaternion`,** which makes the Euler
  `rotation` silently inert. Null the quaternion before writing `rotation` on
  any node that came out of a loaded model. This cost time once already.
- Fixed timestep: `main.js` steps the sim at `TICK` with an accumulator,
  clamps frame dt to 0.1 s and runs at most 4 steps per frame. **Render
  interpolation:** after stepping, `alpha = acc / TICK` is how far the frame
  sits into the next tick; riders and the follow camera are posed at
  `lerp(px, x, alpha)`, `lerp(py, y, alpha)` and the shortest-arc lerp of
  `ph → heading`. Trails keep using the raw head; the orb covers the gap.
- The chase camera follows a smoothed heading (`scene.js` eases the given
  heading at a few radians per second) so AI steering flips do not shake it.
- No per-frame allocation in draw code: preallocate typed arrays, reuse
  vectors. Sim-side pushes onto stroke arrays are fine.
- Comments are narrative: every file opens with a purpose block and every
  non-obvious decision says why.
- Never start a dev server; the owner runs `python3 -m http.server`.

## Sim API (already written; read, do not edit)

```js
// world.js
const world = new World(seed?);
world.setArena(half);      // arena size, from ARENA_SIZES; before setup(). Reallocates the grid.
world.setup(specs);        // specs: [{ id, name, colorIndex, kind: 'human'|'ai', seat }]
world.spawn();             // new round: clears grid, scatters riders with a safe runway
world.steerOnly(dt);       // countdown: aim in place
world.tick(dt, events);    // one step; pushes { type:'eliminated', id, by: id|'wall' }
world.blockedAt(x, y, slot) // AI lookahead helper
world.alive(); world.byId(id); world.players; world.half; world.tickCount
// each player: { id, slot, name, colorIndex, kind, seat, x, y, heading,
//   px, py, ph (pose at the start of the latest tick), turn, alive, drawing,
//   strokes, ... }
// strokes: array of flat arrays [x0, y0, h0, x1, y1, h1, ...], one per
//   unbroken run of trail; a gap ends a stroke, the next begins after it.
//   Points are ~TRAIL_POINT_SPACING apart; the head is NOT a point until the
//   stroke closes, so a live trail should be drawn to (p.x, p.y) as well.

// match.js
const match = new Match(world, specs, { attract, target });  // target 0 = scale with the field
export function defaultTarget(players)  // POINTS_PER_RIVAL x rivals
match.start(events);
match.update(TICK, humanTurns /* Map id -> -1..1 */, events);
match.state    // 'countdown' | 'playing' | 'roundOver' | 'matchOver'
match.scores   // { [id]: points }
match.target   // points needed
match.round
// events: { type:'roundStart', round } { type:'go' }
//         { type:'eliminated', id, by } { type:'roundOver', winnerId|null }
//         { type:'matchOver', winnerId }
```

## Render lane contracts

```js
// scene.js
export function createScene(canvas) => ({
  engine, scene,
  update(dt),            // once per frame before scene.render(): camera + shake decay
  setMode(mode),         // 'play' whole-arena view | 'orbit' slow menu orbit | 'follow' chase cam
  setFollow(x, y, heading), // sim pose of the rider to chase; call every frame while in 'follow'
  spin(dYaw, dPitch),    // spectator orbit: accumulate a yaw/pitch offset (radians); pitch clamped
  zoom(factor),          // multiply the spectator distance scale (clamped 0.35..3)
  resetOrbit(),          // yaw, pitch and zoom back to defaults (round start, stop changes)
  kick(amount),          // camera shake impulse in arena units (0.4 small, 0.9 big)
  setArena(half),        // rebuild floor, beams and slabs for a new half-size; refit camera
});
// Owns: Engine (DPR capped at 2), Scene, TargetCamera with an exact corner
// fit that runs the square arena edge to edge in portrait AND landscape
// (bisection on distance, then vertical centring by shifting the target),
// hemispheric + directional light, square floor with a procedural
// DynamicTexture (faint grid), four glowing rim beams, four low translucent
// wall slabs excluded from glow, a gradient background Layer, a
// GlowLayer (mainTextureFixedSize 512), resize handling. Play tilt about
// 0.45 rad from vertical; orbit mode tilts to ~1.0 rad, comes 30% closer
// and rotates slowly; transitions between modes are smoothed.

// rider.js
export function preloadRiders(scene) => Promise<void>
// Loads models/fox-detailed.glb into an AssetContainer once. Resolves when
// riders can be built from it; rejects (after a console.warn naming the
// asset) if the loader or the file is missing. Never throws synchronously.
export function createRider(scene, hex) => ({
  root,                               // TransformNode
  setPose(x, y, heading, turn, time), // sim coords; turn -1..1 for a lean; time for a glide bob
  setAlive(alive),                    // hide when false (and pause its animation)
  celebrate(times = 1),               // one-shot backflips, then back to the run; a request while one is in the air tops up the count rather than restarting; no-op on a model without the clip
  dispose(),
});
// Three tiers, best available at call time, each with the same contract:
//   1. the codex fox GLB named by RIDER_MODEL, instantiated from the
//      preloaded container with cloned materials tinted to hex, its one clip
//      looping from a random phase at a speed-derived rate. Clips are looked
//      up by the names in config (CLIP_RUN, CLIP_CELEBRATE), never by index:
//      the celebration model lists the backflip first. The ball under
//      OrbRoot rolls: rider.js accumulates distance from successive setPose
//      calls and turns OrbRoot about its local X by distance / ORB_RADIUS,
//      and paints panel seams on the orb material so the roll is visible at
//      all (a smooth emissive sphere spinning looks like one standing still);
//   2. blue-cat.js procedural cat, tinted and merged (the old path);
//   3. a primitive orb + capsule.
// A failure at any tier console.warns and drops to the next. Scale root by
// RIDER_SCALE in every tier (all models share the orb at y 0.78, d 1.44).

// blue-cat.js
export function createBlueCat(scene) => ({ root, materials })
// codex-concepts/blue-cat.js verbatim as a module, plus uvs on the ear
// meshes so merging works. Header credits Concept 01.

// trails.js
export class TrailRenderer {
  constructor(scene)
  bind(players, hexById)   // world.players and a Map id -> hex; call once per match
  reset()                  // new round: dispose chunk meshes, rewind cursors
  update(world)            // per frame: consume new stroke points, follow live heads
  dispose()
}
// Ribbon with height TRAIL_HEIGHT and half-width TRAIL_HALF_WIDTH: 4 verts per
// point (left-bottom, left-top, right-top, right-bottom), side+top+side quads
// per segment, caps at the ends. Chunks of 256 points in preallocated
// Float32Arrays, updatable mesh; unused slots collapse onto the latest point
// so nothing stray draws. The live chunk's next slot follows (p.x, p.y)
// every frame while p.alive && p.drawing. Emissive StandardMaterial,
// disableLighting, backFaceCulling off, alwaysSelectAsActiveMesh.

// effects.js
export function createEffects(scene) => ({ burst(x, y, hex) })  // sim coords
// Additive ParticleSystem, ~140 particles, manualEmitCount, disposeOnStop.
```

## DOM lane contracts

```js
// input.js
export class Input {
  constructor()                       // listens on window
  turn(seat)                          // -1 | 0 | 1; seat 0: ArrowLeft/ArrowRight + touch; seat 1: A/D and Q/E
  bindTouch(leftButton, rightButton)  // pointer events with capture; toggles .held
  bindDrag(canvas)                    // pointer drag, wheel and two-finger pinch on the arena
  takeDrag()                          // {dx, dy, dz} accumulated since last call, then zeroed (reused object);
                                      // dx/dy drag in CSS px, dz zoom in wheel-pixel units (pinch is converted: 1 px of pinch spread = -1 dz)
  zoomKey()                           // +1 ArrowUp (in) | -1 ArrowDown (out) | 0, held state
  onCommand = null                    // (name) => void: 'start' Enter/Space, 'restart' R, 'menu' Escape
}
// Left is +1. Prevent default on arrows and space so the page never scrolls.

// ui.js
export class UI {
  constructor(root, { onStart, onRematch, onMenu, onArena, onMusicVolume, onSfxVolume })
  get humans()   // 1 | 2 from the Riders row
  get ais()      // 1..5 from the Rivals row; humans + ais <= MAX_PLAYERS enforced by disabling
  get arena()    // index into ARENA_SIZES from the slider
  get target()   // winning score from the "Win at" slider
  // The target slider follows the roster (defaultTarget for the current field)
  // until the host moves it, after which their number sticks for the session.
  setArena(i)    // move the slider and its label without firing onArena
  // onArena(index) fires on the slider's `change` (release); the name label follows `input` live
  showMenu(); hideMenu();
  showHud(players /* [{ id, name, hex }] */, target); hideHud();
  setScores(scores /* id -> points */, aliveById /* id -> bool */)
  banner(text, { sub = '', hex = '', actions = false } = {}); hideBanner();
  setTouchVisible(visible)   // shows only when matchMedia('(pointer: coarse)') matches
  setSpectate(text, hex)     // caption above the touch buttons: whose ride the camera is on
  hideSpectate()
  setVolumes(music, sfx)     // move both sliders and their readouts without firing the callbacks
  // The volume sliders fire onMusicVolume(0..1) / onSfxVolume(0..1) on `input`,
  // live while dragging, because a volume you cannot hear until you let go is
  // not a volume control.
  touchButtons               // { left, right } HTMLButtonElements
}
// Uses the ids already in index.html. No new DOM structure without updating index.html.

// audio.js
export class Sfx {
  constructor()               // volumes from localStorage, try/catch, defaults 0.6 music / 0.8 effects
  get musicVolume(); setMusicVolume(v)   // 0..1, persisted 'trailblazers.vol.music.v1'
  get sfxVolume();   setSfxVolume(v)     // 0..1, persisted 'trailblazers.vol.sfx.v1'
  unlock()                    // create/resume AudioContext on first gesture; starts the theme
  click(); ready(); go(); crash(); roundWin(); matchWin()
  taunt(voice = 0, delay = 0)  // the yip a fox makes when it celebrates; `voice`
                               // is the rider's palette index, so each fox has
                               // its own pitch, and `delay` is seconds ahead
  foxSay(voice = 0, delay = 0) // the "ring ding ding ding ding" the winner
                               // says. A Sonic Pi render (audio/fox-say.m4a,
                               // composed in tools/audio/fox-say.rb), pitched
                               // per rider with playbackRate.
}
// Two gain nodes hang off the destination, one per slider, so a cue and the
// theme are mixed independently and either can be taken to silence. Cues stay
// synthesized (house rule); the theme is the one shipped file, audio/theme.m4a,
// fetched and decoded once on the first gesture and looped. Loop start is
// found by scanning the decoded buffer for the first sample above a noise
// floor, because AAC decoders reintroduce priming silence that would otherwise
// put a gap in the seam (hub CLAUDE.md §9). A failed fetch or decode warns and
// leaves the game silent but playable.
```

## Glue (main.js)

- Winner wording: a lone human is addressed as "You" and needs the verb to
  agree, so the banner asks the winner whether it is the player rather than
  pasting a name in front of a fixed phrase. Two humans share a screen, so
  neither is "you" and both get their label.
- Volumes: `onMusicVolume`/`onSfxVolume` pass straight to the Sfx setters and
  are restored onto the sliders at boot with `ui.setVolumes(...)`.
- Modes: `menu` runs an attract match (4 AI, `attract: true`) behind the
  panel with the camera in `orbit`; `match` runs the chosen field with the
  camera in `play`. R restarts the match, Escape returns to the menu, Enter or
  Space starts from the menu.
- Arena size: `ARENA_SIZES[ui.arena].half` is applied with `world.setArena` and
  `view.setArena` before every match, attract included, so the menu previews
  the size live; the choice persists in localStorage `trailblazers.arena.v1`.
- Humans take palette slots 0 and 1; AI fill the rest in order. Names: "You"
  for a solo human, "P1"/"P2" for two, `PALETTE[i].name` for AI.
- Routes events: roundStart -> trails.reset, riders alive, banner "Round N /
  steer to aim"; go -> banner "Go!" briefly; eliminated -> rider hidden,
  burst, kick, crash sound, scores, and `celebrate()` on the owner of the
  trail that did it when that is another rider still alive (never a wall,
  never your own trail), with `sfx.taunt(colorIndex)` to match; roundOver -> banner in the winner's colour;
  matchOver -> banner with Rematch / menu actions, and `foxSay` from the
  winner: it is the one moment in a match that earns it, so it stays rare by
  happening exactly once, when somebody reaches the target. roundOver also gives the
  surviving winner `celebrate(2)`: the round is over, so there are a couple
  of seconds with nothing to do but watch them gloat, with a taunt under each
  of the two flips.
- Attract mode shows no HUD or banners.
- **Spectating.** Once no human rider is alive in a match (solo: you died;
  two on one keyboard: both did) and the round is still running, the camera
  drops into 'follow' on the first living rider and the steering controls
  change meaning: a fresh press of right (or the right touch button) moves to
  the next stop, left to the previous, through the cycle
  `[overview, alive rider 1, alive rider 2, ...]`. Presses are edges, not
  holds. If the followed rider dies the view moves on to the next living one.
  The caption names who you are riding with; roundStart returns to 'play' and
  hides it.
- **Spinning while spectating.** Dragging on the arena orbits the camera:
  horizontal drag is yaw, vertical is pitch, `view.spin(dx * 0.006, -dy * 0.004)`
  per step from `input.takeDrag()`. Holding a steering control for longer than
  `SPIN_HOLD_SECONDS` (0.3) spins yaw continuously at `SPIN_RATE` (1.8 rad/s)
  in that direction while held; a control released before that threshold
  counts as a tap and cycles the stop on release. In 'follow' the offset
  orbits around the followed rider (azimuth = heading + π + yaw, elevation
  base + pitch); in the overview stop it rotates the whole arena view (alpha
  target = yaw, beta target = PLAY_BETA + pitch). Zoom: `view.zoom(Math.exp(dz * 0.0015))`
  from the same `takeDrag()`, and `view.zoom(Math.exp(zoomKey() * ZOOM_KEY_RATE * TICK))`
  while an arrow is held; the scale multiplies the follow distance and the
  overview fit distance. `resetOrbit()` on every stop change and round start.

## Ownership

| Lane   | Files                                   |
| ------ | --------------------------------------- |
| sim    | js/sim/*, js/config.js (done)           |
| scene  | js/render/scene.js, js/render/effects.js|
| rider  | js/render/blue-cat.js, js/render/rider.js|
| trails | js/render/trails.js                     |
| dom    | js/input.js, js/ui.js, js/audio.js      |
| glue   | js/main.js, tools/sim-smoke.mjs         |

One file, one owner. A lane that needs something from another lane asks for
a contract change here rather than editing the other file.
