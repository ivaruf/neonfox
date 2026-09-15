# Trailblazers

Riders gliding on glowing orbs, leaving neon trails in a small arena. Touch a
trail or the wall and you are out; the last rider standing takes the round.
A 3D take on *Achtung, die Kurve*, built as a playable proof of concept.

Part of the [games hub](../CLAUDE.md). In development: not deployed and not
in the arcade yet.

## Run it

Serve the directory over HTTP and open it. Any static server works:

```sh
python3 -m http.server
# then http://localhost:8000/
```

`file://` does not work: the game is ES modules. Babylon.js loads from
jsDelivr pinned to 8.56.2 with an integrity hash, and `vendor/babylon.js` is
the byte-identical fallback when the CDN is blocked or you are offline.

## Controls

| Action                          | Keys                         | Touch                       |
| ------------------------------- | ---------------------------- | --------------------------- |
| Rider one steers                | `←` `→`                      | the two on-screen buttons   |
| Rider two steers (two on one keyboard) | `A` `D` or `Q` `E`    | —                           |
| Aim before the round starts     | steer during the countdown   | same                        |
| Start / rematch                 | `Enter` or `Space`           | Blaze! / Rematch            |
| Restart the match               | `R`                          | —                           |
| Back to the menu                | `Esc`                        | Back to the paddock         |
| Out of the round: switch view   | `←` `→` cycle survivors and overview | the same two buttons |

Once every human rider is out, the camera drops in behind one of the
survivors and the steering controls cycle the view through them and back to
the overview.

Every rider moves at constant speed and can only turn. Trails break for a
short gap every few seconds; slip through one if you time it. Starts are
random, as in the original, but never pointed straight at a nearby wall.

Scoring is Kurve's: every time a rider crashes, every rider still alive
scores a point. The match goes to the first rider alone past
`POINTS_PER_RIVAL × rivals` points.

## Architecture

`ARCHITECTURE.md` is the module contract and the map. The short version:

```
js/sim/        the game: riders, trails, collisions, AI, rounds — plain numbers, no Babylon, no DOM
js/render/     draws the sim with Babylon.js: scene, riders, trails, effects
js/input.js    keyboard and touch -> a turn per seat
js/ui.js       menu, scoreboard, banners
js/audio.js    synthesized sound
js/main.js     fixed-timestep loop and event routing
```

**Core gameplay logic lives in `js/sim/world.js`** (movement, trail painting,
gaps, collision) with `js/sim/match.js` running rounds and scores and
`js/sim/ai.js` steering the rivals. All tuning numbers are in `js/config.js`.

Collision is an occupancy grid (`js/sim/grid.js`), the way the original Kurve
tested its framebuffer: each trail is stamped into a 600×600 cell grid as it
is painted, a head is nine array reads per tick, and the AI marches its
lookahead through the same array. A rider ignores its own paint for the last
ten ticks so it does not die on the trail it is laying.

The sim/render split is the point of the structure. The plan is fishtank's
host-authoritative peer-to-peer: one browser runs `World` and `Match` in a
Web Worker and the others render snapshots. Nothing under `js/sim/` touches
Babylon or the DOM, and every random number comes from a seeded generator so
a round can be replayed from its seed.

The rider model is `codex-concepts/blue-cat.js` (Concept 01), adapted into
`js/render/blue-cat.js` as a module, tinted per player and merged into one
mesh. If it fails to build, a primitive orb-and-capsule placeholder takes its
place with a console warning.

### Checks

```sh
node --check js/**/*.js        # syntax
node tools/sim-smoke.mjs       # runs five AI riders through a whole match headless
```

The smoke test is the only automated check. Everything visual is verified by
playing it.

## Intentionally simplified

- **No service worker, manifest or icons yet.** The hub's PWA layer is added
  when the game heads for the arcade; leaving it out avoids stale-cache pain
  while the code changes daily.
- **Collision is grid-based and approximate**, a tenth of a unit. It is
  deliberate: reliable and cheap beats exact.
- **The AI looks ahead with five fixed manoeuvres** and no memory. It is
  believable, not strong. Its three personality numbers are rolled per rider.
- **Touch steers rider one only.** Two riders on one touchscreen is not
  supported.
- **Rider models are one merged rigid mesh**: no rig, no animation beyond a
  lean into turns and a glide bob.
- **One arena shape**, a square, fitted edge to edge by the fixed camera in
  both portrait and landscape. It was a circle first; a square fills a phone
  screen far better. Five sizes on the menu slider, from Tiny to Vast; riders
  and trails keep their size, so it is a zoom in effect.
- **No multiplayer networking.** The structure is ready for it; the code is
  not written.
