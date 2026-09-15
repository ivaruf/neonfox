# Peer to peer

One player hosts the simulation and the others connect straight to them, so a
static site with no game server can run multiplayer. Everything below was
measured, not assumed, and where a number appears it came out of a run rather
than an estimate.

The shape is fishtank's — host-authoritative star, two data channels, a
simulation in a Web Worker, three tiers of signalling — because that shape was
earned there and hub `CLAUDE.md` §8 is written from it. Two things are
NeonFox's own and are the interesting part of this document: why it is not
lockstep, and how trails get across.

## Lockstep, and why not

NeonFox looked like the easy case. `js/sim/` has no DOM and no Babylon, it
runs on a fixed 60 Hz tick, and every random draw comes from one seeded
`mulberry32`. In principle every peer could run the identical `World` and
`Match` from one seed and put nothing on the wire but each player's turn —
two bits, per player, per tick.

It holds inside one engine. Two `World` + `Match` instances built from the
same seed and fed the same scripted inputs for 6,000 ticks (100 seconds, five
rounds, 23 eliminations) hash identically, over every position, heading, trail
point, AI personality and occupancy-grid cell; change one player's input for
one second at tick 140 and the hash diverges, so the check can see what it
claims to.

It does not hold across engines, and the reason is `Math`:

| function | V8 (node 22 / Chrome) | JavaScriptCore (Safari) |
| -------- | --------------------- | ----------------------- |
| `cos`    | 2935928859            | 665887881               |
| `sin`    | 97078592              | 285910406               |
| `atan2`  | 2722678793            | 4273314956              |
| `hypot`  | 1455171877            | 1524463503              |
| `sqrt`   | 1735694478            | 1735694478              |

Each is an FNV-1a hash over 200,000 pseudo-random arguments. `sqrt` agrees
because IEEE-754 requires it to be exactly rounded; the transcendentals are
implementation-defined in ECMAScript, and the two engines simply differ.

Run the whole simulation under both and the damage is visible but small: after
6,000 ticks a single trail sample differed, `0.08041369689599016` against
`0.08041369689599015`, one ULP, and no elimination, score or round outcome
changed. That is luck, not a guarantee. A rider steps by
`x += Math.cos(heading) * SPEED * dt`, the collision grid is 0.1 units a cell,
and one ULP of drift compounds until it lands on the other side of a cell
boundary — at which point one peer's rider is dead and the other's is not, and
the two games are unrelated from then on. Round boundaries hide it, because
`spawn()` re-scatters everyone from the shared RNG and wipes the drift.

The owner's own constraint says the target case out loud: one player joins
from a phone or tablet. That is desktop Chrome plus mobile Safari — V8 plus
JavaScriptCore, the exact pair above. So: **snapshots**.

Reproduce the measurement with the scripts in the session scratchpad, or
re-derive it in four lines: hash `Math.cos` over a fixed sequence under `node`
and under
`/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc`.

## What is authoritative

The host. It runs the only `World` and the only `Match` in the game, in a Web
Worker, and it decides who crashed, who scored, and when a round begins and
ends. A guest sends its steering and renders what comes back; it has no
simulation to disagree with.

Arena size, the "win at" target and the bot count are the host's settings,
taken from the paddock's own controls when the game is opened and pushed to
each guest with its welcome. How many riders a device itself brings is not a
host setting and not a lobby one either: it is that device's Local players
row, read at the moment it opens or joins, clamped to one on a touch device
and clamped again host-side in `cleanSeats()` because a guest must not be
able to claim its own state.

## The two lanes

| lane                     | carries                                       |
| ------------------------ | --------------------------------------------- |
| `game` ordered, reliable | joins, roster, round events, **trail points** |
| `fast` unordered, 0 retx | the per-tick state frame, the per-tick input  |

`channel.send(value, fast)` takes the lane as an argument rather than
inferring it from the value's type. Trail points are binary and must not be
lost, so a codec that guessed "binary means lossy" would drop the one thing in
this game you can die on.

## The state frame: every tick, 61 bytes

Seven bytes of header plus nine a rider — slot, flags, x, y, heading, turn.
Positions quantise to 1/320 of a unit (the collision grid is 0.1 and a trail
is 0.6 wide, so this is 32× finer than anything that matters); headings to
1/10000 rad, wrapped into −π..π first, because an i16 silently clamps a
steadily-turning heading that has run past π and points the rider somewhere it
is not. That was fishtank's bug and it is cheaper to inherit the fix.

Measured over 50 seconds of a six-rider match: **61.0 B a frame, 28.6 kbit/s
to one guest**. Five guests cost the host 0.14 Mbit/s up. There was no reason
to send fewer than one frame a tick, and one good reason to send exactly one:
a frame _is_ a tick, so applying one shifts `(x, y, heading)` into
`(px, py, ph)` exactly as `World.tick` does and main.js's existing alpha blend
works with no extrapolation and no smoothing filter to tune.

The frame number on the wire is a monotonic counter, **not** `world.tickCount`
— `spawn()` resets that every round, and a queue that drops anything not newer
would have stalled every guest's arena at the first round boundary. Measured
with the bug in place: 1,411 of 2,999 frames applied. With it fixed: 2,999.

## Trails: a delta, not a snapshot

A NeonFox round is mostly trail, and re-sending the arena every frame would be
fishtank's 17 KB problem with none of fishtank's excuse. But a trail only ever
grows — points are appended to a stroke, a gap ends one stroke and starts the
next, and a round start throws them all away — so the host sends each new
sampled point exactly once, in order, on the reliable lane.

Three operations: append to the current stroke, start a new one, or reset this
rider entirely. Measured: **650 B/s for six riders**, largest message 68 bytes
against a 16 KB interoperable limit. Total to one guest, state and trail
together: **33.7 kbit/s**.

Reset is how a guest that joins mid-round gets a beginning, because a delta
stream does not have one. A late arrival receives every point up to the shared
broadcast cursor and then joins the same stream; replayed against a guest that
had been there the whole time, 4,887 trail floats compared **identical, zero
mismatches**.

## The host's simulation is in a worker

Because a backgrounded tab throttles `setInterval` badly, and a host who looks
at another tab must not freeze everybody else's game. `js/sim/` was written to
allow this and the promise held: `host-worker.js` imports `World` and `Match`
and nothing else. The worker clock corrects for drift against real elapsed
time and caps at four ticks a wake-up, so a descheduled worker catches up
rather than either freezing or bursting.

One consequence worth stating: the host's page has no `World` either. It
renders the same packed frames it broadcasts, through the same `ShadowWorld`,
so **the host sees exactly what its guests see** and there is one path from a
frame to a rider on screen rather than two that can drift apart.

## Signalling

Three tiers, tried in order: an explicit `<meta name="signal-url">` relay, then
PeerJS's public broker with codes namespaced `neonfox-v1-<code>`, then
`BroadcastChannel` for tabs in one browser.

PeerJS here carries **signalling only**. fishtank uses its data connection as
the game connection and pays with a single reliable lane on the broker path;
a PeerJS connection cannot be given `maxRetransmits: 0`. So the broker
connection is a pipe for OFFER/ANSWER/ICE and every tier then negotiates the
same `RTCPeerConnection` with the same two lanes. The cost is real: two
handshakes rather than one, so joining through the broker takes a second or so
longer. The gain is that the lane rules are true everywhere rather than true on
the transport nobody uses.

`peerjs@1.5.5` is pinned with an SRI hash and **`vendor/peerjs.js` is
committed behind it**, verified byte-identical to the CDN file
(`sha384-x0YgkOr/3UOZP2CRDxGW9e0Q+2Qjyr3uJrm4xU32Y7ZCNAo7Cc7bjhrZMi/dwczu`).
Hub `CLAUDE.md` §1 names fishtank's missing local copy as a gap rather than a
pattern; this is that gap closed. It loads lazily, on the first attempt to
host or join, so a player who never touches multiplayer never fetches it.

A public broker is a real trade: a third party with no promises, which sees
room codes and connection metadata and never sees game data. If it is down, no
_new_ games can start; games already connected are untouched, because it
carries no game traffic. It also drops a peer whose heartbeat stops and
releases the id with it — a locked screen is enough — so the host reclaims its
id on `disconnected`, on a five-second beat, and the lobby reports whether the
code is actually reachable rather than assuming it stayed so.

## One rider per phone

The owner's rule: a phone or tablet contributes exactly one rider, because it
has one pair of touch buttons and one person holding it. A desktop peer may
still seat two on one keyboard.

It is said out loud in the join screen — the "two riders" pill is disabled on
a coarse pointer with a sentence explaining why — and enforced by the host
regardless of what the guest claims, because the guest is the one device that
cannot be trusted to answer. `isCoarsePointer()` asks the question the same way
`ui.js` asks it before showing the touch buttons, so the cap and the controls
a player actually gets cannot disagree.

## What a guest may say

Three facts come off the wire and all three are distrusted:

- **turn** — clamped to −1, 0 or +1. `NaN`, `Infinity`, `7` and `"left"` all
  become 0. Cleaned on the page and again in the worker.
- **name** — an allowlist (letters, digits, space, hyphen, apostrophe),
  capped at 14 characters, rolled from a short list if empty. No control
  character or zero-width anything reaches a scoreboard chip.
- **seats** — 1 or 2, forced to 1 for a coarse pointer, and clamped again
  against the seats actually left in the arena.

There is no field in which a guest could claim a position, a score or a life.
That is a cheaper guarantee than validating one away.

## What we accept

- **No TURN.** Roughly a connection in ten will not establish, and there is no
  free way around it: a relay costs bandwidth by the gigabyte, which is what
  this whole exercise avoids. The join failure says so rather than blaming the
  code the player typed.
- **No host migration.** A guest only ever holds a connection to the host, so
  when the host closes the tab there is nobody to promote. The arena freezes
  where it is and a banner says why, with the way back to the paddock under
  it; a frozen arena you can see beats a snap to a menu you cannot.
- **The host can cheat**, because the host is authoritative. For "my kid wants
  to show his friends", that is an entirely acceptable threat model.
- **Same-network play still needs the internet** to shake hands, even for two
  devices on one wifi. There is no browser-only way around that.
- **The roster is fixed when a match starts.** A guest who arrives later
  watches rather than being turned away, and a guest who leaves mid-match
  leaves a rider that stops steering and dies on the next wall it meets.
  Reseating riders mid-round would be a bigger lie than that.

## Files

```
js/net/protocol.js     message types, the binary codecs, and every validator
js/net/codes.js        three-picture room codes
js/net/webrtc.js       RTCPeerConnection, the two lanes, two signalling transports
js/net/rendezvous.js   the three tiers, and PeerJS as a signalling pipe
js/net/host-worker.js  World + Match, off the page
js/net/host.js         seats, roster, validation, fan-out
js/net/guest.js        steering out, frames in
js/net/shadow.js       a World-shaped thing fed from the wire, and its frame feed
js/net/lobby.js        the screen where a game is opened or found
```
