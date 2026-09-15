/*
 * protocol.js — what goes on the wire, and what is allowed in off it.
 *
 * Two lanes, and the split is the whole design (hub CLAUDE.md §8):
 *
 *   reliable + ordered   joins, the roster, round events, trail points.
 *                        Every one of these is a discrete thing that happened
 *                        once. Losing one is not recoverable by waiting.
 *   unreliable, 0 retx   the per-tick state frame and the per-tick input.
 *                        Both are superseded 60 times a second, so a late one
 *                        is worthless — a newer one is already in flight — and
 *                        waiting for a retransmit only buys latency.
 *
 * Nothing discrete ever goes on the lossy lane. That is the rule that makes
 * the rest of this file readable: if you can lose it without noticing, it is
 * binary and fast; if you cannot, it is JSON (or ordered binary) and reliable.
 *
 * WHY TRAILS ARE A DELTA. A NeonFox round is mostly trail, and a trail only
 * ever grows: strokes are appended to, and a round start throws them all away.
 * Re-sending the whole arena every frame would be fishtank's 17 KB problem
 * with none of fishtank's excuse, so the host instead sends each new sampled
 * point exactly once, in order, on the reliable lane. A rider lays about 36
 * points a second (SPEED 9 over TRAIL_POINT_SPACING 0.25), which is 216 bytes
 * a second per rider, so a six-rider arena costs roughly 1.3 KB/s of trail —
 * and it is exact rather than approximate, which matters because the trail is
 * the thing you die on.
 *
 * WHY THE STATE FRAME IS EVERY TICK. A frame is 7 + 9 bytes a rider: 61 bytes
 * for a full arena. At the sim's own 60 Hz that is 3.7 KB/s to one guest,
 * 0.03 Mbit/s, and five guests still only cost the host 0.15 Mbit/s up. Since
 * a frame is a tick, the guest can apply one per tick and main.js's existing
 * (px, py, ph) -> (x, y, heading) interpolation works unchanged, with no
 * extrapolation and no smoothing filter to tune. Lowering the rate would save
 * bandwidth that was never the problem and cost the one property that makes
 * the guest's renderer identical to the host's.
 *
 * Quantisation: positions at 1/320 of a unit (finer than the collision grid's
 * 0.1 cell by a factor of 32, and the trail is 0.6 wide), headings at 1/10000
 * rad. Headings are wrapped into -PI..PI before quantising — fishtank found
 * the hard way that a steadily turning entity reaches -4.712 rad and an i16
 * silently clamps it to a heading it is not facing.
 */

export const NET_VERSION = 1;

/* Reliable lane, JSON. The host is authoritative for every one of these. */
export const MSG = Object.freeze({
  HELLO: "HELLO", // guest -> host: name, how many seats, is this a phone
  WELCOME: "WELCOME", // host -> guest: you are these riders, here are the settings
  REFUSED: "REFUSED", // host -> guest: full, wrong version, match already running
  ROSTER: "ROSTER", // host -> guest: the cast changed
  BEGIN: "BEGIN", // host -> guest: the lobby is over, this is the field
  EVENT: "EVENT", // host -> guest: roundStart / go / eliminated / roundOver / matchOver
  BYE: "BYE", // either way: I am leaving, and why
});

/* Lossy lane, binary. */
export const KIND_STATE = 1;
export const KIND_TRAIL = 2; // reliable, despite being binary: see the header
export const KIND_INPUT = 3;

export const POS_SCALE = 320;
export const HEAD_SCALE = 10000;
export const MAX_NAME = 14;
export const MAX_SEATS = 2;
/* A trail message stays well inside the 16 KB interoperable data channel
 * limit; 180 points is 1080 bytes of payload, so even a burst of them cannot
 * approach it. */
export const TRAIL_CHUNK = 180;

const TAU = Math.PI * 2;

/* Wrap into -PI..PI. See the header: an unwrapped heading quantises wrong. */
export function wrapAngle(a) {
  let x = a % TAU;
  if (x > Math.PI) x -= TAU;
  else if (x < -Math.PI) x += TAU;
  return x;
}

const clampI16 = (v) => (v > 32767 ? 32767 : v < -32768 ? -32768 : v);
const q = (v, scale) => clampI16(Math.round(v * scale));

/* ---------------------------------------------------------------- state --- */

/*
 * riders: the host's live players, in slot order. Only what a renderer needs
 * and nothing a guest could use to cheat: no grid, no scores, no AI state.
 */
export function packState(tick, rosterVersion, riders) {
  const n = riders.length;
  const buf = new ArrayBuffer(7 + n * 9);
  const view = new DataView(buf);
  view.setUint8(0, KIND_STATE);
  view.setUint8(1, rosterVersion & 0xff);
  view.setUint32(2, tick >>> 0);
  view.setUint8(6, n);
  let o = 7;
  for (const p of riders) {
    view.setUint8(o, p.slot);
    view.setUint8(o + 1, (p.alive ? 1 : 0) | (p.drawing ? 2 : 0));
    view.setInt16(o + 2, q(p.x, POS_SCALE));
    view.setInt16(o + 4, q(p.y, POS_SCALE));
    view.setInt16(o + 6, q(wrapAngle(p.heading), HEAD_SCALE));
    // turn is -1..1 and only ever used for the rider model's lean, so a
    // single byte at 1/100 is two decimal places more than the eye needs.
    view.setInt8(
      o + 8,
      Math.max(-100, Math.min(100, Math.round(p.turn * 100))),
    );
    o += 9;
  }
  return new Uint8Array(buf);
}

export function unpackState(bytes) {
  if (bytes.length < 7) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint8(0) !== KIND_STATE) return null;
  const rosterVersion = view.getUint8(1);
  const tick = view.getUint32(2);
  const n = view.getUint8(6);
  if (bytes.length < 7 + n * 9) return null;
  const riders = [];
  let o = 7;
  for (let i = 0; i < n; i++) {
    const flags = view.getUint8(o + 1);
    riders.push({
      slot: view.getUint8(o),
      alive: (flags & 1) !== 0,
      drawing: (flags & 2) !== 0,
      x: view.getInt16(o + 2) / POS_SCALE,
      y: view.getInt16(o + 4) / POS_SCALE,
      heading: view.getInt16(o + 6) / HEAD_SCALE,
      turn: view.getInt8(o + 8) / 100,
    });
    o += 9;
  }
  return { tick, rosterVersion, riders };
}

/* ---------------------------------------------------------------- trail --- */

/*
 * One entry is "slot S, do OP, then take these points".
 *   OP_APPEND  add to the stroke this rider is already drawing
 *   OP_STROKE  that stroke is finished (a gap opened); start a new one
 *   OP_RESET   throw away everything this rider has and start from scratch
 *
 * OP_RESET is how a guest that joins mid-round gets a beginning: a delta
 * stream does not have one, which fishtank discovered when a guest seated
 * mid-game decoded a tank containing only itself.
 */
export const OP_APPEND = 0;
export const OP_STROKE = 1;
export const OP_RESET = 2;

export function packTrail(entries) {
  let size = 2;
  for (const e of entries) size += 3 + e.points.length * 2; // points is flat x,y,h
  const buf = new ArrayBuffer(size);
  const view = new DataView(buf);
  view.setUint8(0, KIND_TRAIL);
  view.setUint8(1, entries.length);
  let o = 2;
  for (const e of entries) {
    const n = e.points.length / 3;
    view.setUint8(o, e.slot);
    view.setUint8(o + 1, e.op);
    view.setUint8(o + 2, n);
    o += 3;
    for (let i = 0; i < e.points.length; i += 3) {
      view.setInt16(o, q(e.points[i], POS_SCALE));
      view.setInt16(o + 2, q(e.points[i + 1], POS_SCALE));
      view.setInt16(o + 4, q(wrapAngle(e.points[i + 2]), HEAD_SCALE));
      o += 6;
    }
  }
  return new Uint8Array(buf);
}

export function unpackTrail(bytes) {
  if (bytes.length < 2) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint8(0) !== KIND_TRAIL) return null;
  const count = view.getUint8(1);
  const entries = [];
  let o = 2;
  for (let i = 0; i < count; i++) {
    if (o + 3 > bytes.length) return null;
    const slot = view.getUint8(o);
    const op = view.getUint8(o + 1);
    const n = view.getUint8(o + 2);
    o += 3;
    if (o + n * 6 > bytes.length) return null;
    const points = new Array(n * 3);
    for (let k = 0; k < n; k++) {
      points[k * 3] = view.getInt16(o) / POS_SCALE;
      points[k * 3 + 1] = view.getInt16(o + 2) / POS_SCALE;
      points[k * 3 + 2] = view.getInt16(o + 4) / HEAD_SCALE;
      o += 6;
    }
    entries.push({ slot, op, points });
  }
  return entries;
}

/* ---------------------------------------------------------------- input --- */

/*
 * A guest sends its own seats' steering and nothing else. It cannot send a
 * position, a score or a life: there is no field here for one, which is a
 * cheaper guarantee than validating one away.
 */
export function packInput(tick, turns) {
  const n = turns.length;
  const buf = new ArrayBuffer(6 + n * 2);
  const view = new DataView(buf);
  view.setUint8(0, KIND_INPUT);
  view.setUint32(1, tick >>> 0);
  view.setUint8(5, n);
  for (let i = 0; i < n; i++) {
    view.setUint8(6 + i * 2, i);
    view.setInt8(7 + i * 2, cleanTurn(turns[i]));
  }
  return new Uint8Array(buf);
}

export function unpackInput(bytes) {
  if (bytes.length < 6) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint8(0) !== KIND_INPUT) return null;
  const tick = view.getUint32(1);
  const n = view.getUint8(5);
  if (bytes.length < 6 + n * 2 || n > MAX_SEATS) return null;
  const seats = [];
  for (let i = 0; i < n; i++) {
    seats.push({
      seat: view.getUint8(6 + i * 2),
      turn: cleanTurn(view.getInt8(7 + i * 2)),
    });
  }
  return { tick, seats };
}

/* ----------------------------------------------------------- validation --- */

/*
 * Everything a guest says arrives here first. The rule is the hub's: a guest
 * must not be able to claim its own state, so the host takes three facts off
 * the wire — a name, a seat count, a steering direction — and distrusts all
 * three. A guest that sends nonsense gets a sane default, not an error: this
 * is a game for children, and a malformed packet is far more likely to be an
 * old build than an attack.
 */

/* -1, 0 or +1. NaN, Infinity, 7 and "left" all become 0. */
export function cleanTurn(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  if (n > 0.5) return 1;
  if (n < -0.5) return -1;
  return 0;
}

/*
 * Names are an allowlist, not a blocklist: letters, digits, spaces, hyphens
 * and apostrophes survive and everything else is dropped, so no control
 * character, no markup and no zero-width anything reaches a scoreboard chip
 * that is written with textContent but read by a person.
 */
const NAME_ALLOWED = /[^\p{L}\p{N} '-]/gu;
const ROLLED = [
  "Streak",
  "Comet",
  "Flick",
  "Dart",
  "Neon",
  "Swift",
  "Jinx",
  "Vapor",
];

export function cleanName(name) {
  const stripped = String(name ?? "")
    .replace(NAME_ALLOWED, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_NAME);
  return stripped || ROLLED[Math.floor(Math.random() * ROLLED.length)];
}

/*
 * THE OWNER'S CONSTRAINT, enforced here rather than trusted from the guest.
 * A phone or a tablet contributes exactly one rider, because it has one pair
 * of touch buttons and one person holding it. A desktop peer may still seat
 * two on one keyboard. The joining device says whether its pointer is coarse
 * and the join screen says so out loud, but the host clamps regardless: a
 * guest asking for two seats from a phone gets one, the same as a guest
 * asking for nine.
 */
export function cleanSeats(seats, coarse) {
  if (coarse) return 1;
  const n = Math.floor(Number(seats));
  if (!Number.isFinite(n)) return 1;
  return Math.max(1, Math.min(MAX_SEATS, n));
}
