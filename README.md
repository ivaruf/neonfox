# NeonFox

Foxes running on glowing balls, leaving neon trails in a small arena. Touch a
trail or the wall and you are out; the last one riding takes the round. A 3D
take on *Achtung, die Kurve*.

The directory and the GitHub repo are still called `trailblazers`, which was
the working name. The slug is the published URL and the storage prefix, so
renaming the repo to `neonfox` is worth doing before this is published, and
it is the owner's to do.

Part of the [games hub](../CLAUDE.md). In development: not deployed and not
in the arcade yet.

## Run it

Serve the directory over HTTP and open it. Any static server works:

```sh
python3 -m http.server
# then http://localhost:8000/
```

`file://` does not work: the game is ES modules. Babylon.js and its glTF
loader load from jsDelivr pinned to 8.56.2 with integrity hashes, and the
`vendor/` copies are the byte-identical fallbacks when the CDN is blocked or
you are offline.

## Controls

| Action                          | Keys                         | Touch                       |
| ------------------------------- | ---------------------------- | --------------------------- |
| Rider one steers                | `←` `→`                      | the two on-screen buttons   |
| Rider two steers (two on one keyboard) | `A` `D` or `Q` `E`    | —                           |
| Aim before the round starts     | steer during the countdown   | same                        |
| Start / rematch                 | `Enter` or `Space`           | Blaze! / Rematch            |
| Pause (and the way out)         | `Esc`                        | the Pause pill, top right   |
| Restart the match               | on the pause overlay         | same                        |
| Out of the round: switch view   | `←` `→` cycle survivors and overview | the same two buttons |
| Out of the round: spin / zoom   | hold `←` `→` to spin, `↑` `↓` to zoom, or drag and wheel | hold a button to spin, drag to spin, pinch to zoom |

Once every human rider is out, the camera drops in behind one of the
survivors and the steering controls cycle the view through them and back to
the overview.

`Esc` and the Pause pill open the same overlay: volume, restart, and the way
back to the paddock. A local match genuinely stops behind it. A game played
together does not — it is the host's simulation and cannot be held from one
screen, so the panel says so and your fox keeps riding while it is up.

There is no restart key. `R` used to throw the whole match away on one
unmodified press, a stray reach from the `A`/`D` rider two steers with;
restarting is still one press, but it is on the pause overlay, which means
stopping the game to get at it.

Crash into another fox's trail and it throws a backflip at you. Survive the
round and you throw two.

Every rider moves at constant speed and can only turn — how tightly is the
match's Turning setting, four modes from Hairpin to Glide, and the same for
every fox in the round. Trails break for a
short gap every few seconds; slip through one if you time it. Starts are
random, as in the original, but never pointed straight at a nearby wall.

Scoring is Kurve's: every time a rider crashes, every rider still alive
scores a point. The match goes to the first rider alone past the target,
which the menu's "Win at" slider sets. It follows the field size until you
move it, because a round of six hands out fifteen points where a round of
two hands out one.

## Art and sound

The fox, the logo and the icons are codex's. `codex-concepts/` holds the
Blender sources, the generated branding and the prompts behind them;
`icons/README.md` says which file each shipped PNG came from. The models the
game actually loads live in `models/`, and the title logo in `art/`.

## Architecture

`ARCHITECTURE.md` is the module contract and the map. The short version:

```
js/sim/        the game: riders, trails, collisions, AI, rounds — plain numbers, no Babylon, no DOM
js/render/     draws the sim with Babylon.js: scene, riders, trails, effects
js/input.js    keyboard and touch -> a turn per seat
js/ui.js       menu, scoreboard, banners
js/audio.js    synthesized sound and the looping theme
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

The rider is codex's detailed fox, loaded once through Babylon's glTF loader
and instantiated per player with its fur, accents and orb tinted to the
player's colour and its clip looping from a random phase. Two versions exist
and `RIDER_MODEL` in `js/config.js` picks between them: `fox-running.glb`,
where the fox runs on top of a ball that rolls beneath it, and
`fox-detailed.glb`, where it crouches on a gliding orb. The running one is
the current concept and the default. It is a
10 MB, 276k-vertex model: the top quality tier. The lower-detail
`orange-fox` is earmarked for the lowest quality setting once quality tiers
exist. Until the GLB has arrived, and if it ever fails, riders fall back to
the procedural cat from `js/render/blue-cat.js` (Concept 01), and below that
to a primitive orb and capsule, each with a console warning naming what was
missing. The title screen's attract match restarts once the fox arrives.

### Checks

```sh
node --check js/**/*.js        # syntax
node tools/sim-smoke.mjs       # runs five AI riders through a whole match headless
```

The smoke test is the only automated check. Everything visual is verified by
playing it.

## Intentionally simplified

- **The service worker caches code and media separately.** Precaching 27 MB
  of models and audio would make every release cost more than the install,
  so the code cache turns over with `VERSION` and the media cache only when
  a model or a track actually changes.
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
- **Turning is a rule of the match, not of a rider.** Four modes on the
  paddock's Turning slider — Hairpin, Classic, Wide, Glide — set one turn
  rate for every fox; Classic is the game as the first playtest tuned it and
  Wide is where it launched. Crossed with the arena sizes that is a grid of
  quite different games: Hairpin on Tiny is a knife fight, Glide on Vast is
  about reading lines. A host's choice travels to guests with the roster and
  the lobby says it out loud.
- **Sound is half migrated.** The hub rule changed on 2026-09-15: sound is
  composed in Sonic Pi and rendered, rather than synthesized at runtime. The
  theme is a render; the small cues are still WebAudio oscillators from
  before the rule changed and want moving. Music and effects have separate
  volume sliders, behind the paddock's Sound pill rather than on the title
  screen itself: they are set once, so they do not need to be permanently in
  front of a player who came here to ride.
- **Multiplayer has no host migration and no TURN.** Both doors out of the
  paddock — Blaze! and Multiplayer — are the same size, but the peer-to-peer
  one carries the honest limits `docs/P2P.md` writes down: the host closing
  its tab ends the game, and a network pair that needs a relay never connects.
