/*
 * shadow.js — a World-shaped thing fed from the wire instead of from physics.
 *
 * The render lane (rider.js, trails.js, main.js's render()) reads a small,
 * well-known part of a World: `players` with their poses and `strokes`,
 * `half`, `byId`. Nothing in it steps anything. So a peer that is not running
 * the simulation can hand the renderer one of these and every pixel of the
 * game draws through exactly the same code as solo play — no second renderer,
 * no "multiplayer mode" inside trails.js, nothing to keep in sync by hand.
 *
 * THE HOST USES ONE TOO, and that is deliberate. The host's real World lives
 * in a Web Worker (hub CLAUDE.md §8), so the host's page has no World either:
 * it renders the same packed frames it broadcasts. One consequence is worth
 * the cost of stating — the host sees precisely what its guests see, down to
 * the quantisation — and the cost itself is 1/320 of a unit of position error
 * on a rider 0.9 wide, which is nothing.
 *
 * Interpolation works unchanged because a state frame IS a tick: applying one
 * shifts (x, y, heading) into (px, py, ph) exactly as World.tick does, so
 * main.js's alpha blend between them needs no special case. When no frame has
 * arrived for a tick the pose is held still rather than extrapolated — a
 * rider frozen for 16 ms is invisible, a rider guessed forward and snapped
 * back is not.
 */

import { ARENA_HALF } from "../config.js";
import { OP_APPEND, OP_STROKE, OP_RESET } from "./protocol.js";

export class ShadowWorld {
  constructor() {
    this.half = ARENA_HALF;
    this.players = [];
    this.tickCount = 0;
    this._bySlot = new Map();
    this._byId = new Map();
  }

  /*
   * roster: [{ id, slot, name, colorIndex, mine }] in slot order.
   *
   * `kind` is set to "human" for riders this device steers and "ai" for
   * everyone else — including other people's riders, which are plainly not
   * AI. That reads like a lie and is a deliberate one: every downstream use
   * of `kind` in main.js is really asking "is this one of mine?". It decides
   * whether a crash shakes the camera hard or gently, when to hand the
   * spectator camera over because this device has nobody left alive, and
   * whether a winner is addressed as "You". All three want ownership, not
   * species, and a solo game's answers fall out of the same field. Renaming
   * it would mean editing main.js's every reader for no change in behaviour;
   * saying so here is cheaper and honest.
   */
  setRoster(roster) {
    this.players = roster.map((r) => ({
      id: r.id,
      slot: r.slot,
      name: r.name,
      colorIndex: r.colorIndex,
      kind: r.mine ? "human" : "ai",
      mine: !!r.mine,
      seat: r.seat ?? -1,
      x: 0,
      y: 0,
      heading: 0,
      px: 0,
      py: 0,
      ph: 0,
      turn: 0,
      alive: true,
      drawing: true,
      strokes: [[]],
    }));
    this._bySlot = new Map(this.players.map((p) => [p.slot, p]));
    this._byId = new Map(this.players.map((p) => [p.id, p]));
  }

  setArena(half) {
    this.half = half;
  }

  /* A new round: the arena is wiped, so every ribbon goes with it. Replacing
   * `strokes` wholesale is what World.spawn() does and what TrailRenderer's
   * rewound cursors expect. */
  resetRound() {
    for (const p of this.players) {
      p.strokes = [[]];
      p.alive = true;
      p.drawing = true;
      p.turn = 0;
    }
    this.tickCount = 0;
  }

  /* One decoded state frame = one tick. */
  applyState(frame) {
    this.tickCount = frame.tick;
    for (const r of frame.riders) {
      const p = this._bySlot.get(r.slot);
      if (!p) continue; // a frame packed against a roster we have not seen yet
      p.px = p.x;
      p.py = p.y;
      p.ph = p.heading;
      p.x = r.x;
      p.y = r.y;
      p.heading = r.heading;
      p.turn = r.turn;
      p.alive = r.alive;
      p.drawing = r.drawing;
    }
  }

  /* No frame this tick: stand still rather than guess. Keeping the previous
   * pose in (px, py, ph) as well means main.js's alpha blend interpolates
   * between two identical poses, which is a rider that does not move. */
  hold() {
    for (const p of this.players) {
      p.px = p.x;
      p.py = p.y;
      p.ph = p.heading;
    }
  }

  /* Decoded trail entries, in the order the reliable lane delivered them. */
  applyTrail(entries) {
    for (const e of entries) {
      const p = this._bySlot.get(e.slot);
      if (!p) continue;
      if (e.op === OP_RESET) p.strokes = [[]];
      else if (e.op === OP_STROKE) p.strokes.push([]);
      // An op we do not know belongs to a newer host. Drop those points
      // rather than guess where they go: the state frame still moves the
      // rider, so the cost is a short ribbon and not a wrong one.
      else if (e.op !== OP_APPEND) continue;
      const stroke = p.strokes[p.strokes.length - 1];
      for (let i = 0; i < e.points.length; i++) stroke.push(e.points[i]);
    }
  }

  byId(id) {
    return this._byId.get(id);
  }

  bySlot(slot) {
    return this._bySlot.get(slot);
  }

  alive() {
    return this.players.filter((p) => p.alive);
  }
}

/*
 * createFeed — the other half of a shadow world: how frames reach it.
 *
 * Host and guest share this. The host's frames arrive from its worker by
 * postMessage and the guest's from a data channel, but once decoded they are
 * the same three things, and the ordering rules that matter are the same too:
 *
 *   - Events and trail points share one queue because they share one lane,
 *     and their order relative to each other is load-bearing. A roundStart
 *     wipes the strokes; every trail point after it belongs to the new round
 *     and every point before it to the old one. Draining them in arrival
 *     order is what keeps that true, and draining them inside pump() rather
 *     than on arrival is what makes the shadow world and main.js cross the
 *     round boundary on the same tick.
 *   - State frames are their own queue, because they come down the lossy lane
 *     and have no ordering guarantee at all against the other two. A frame
 *     older than one already applied is dropped, and so is a frame packed
 *     against a roster this peer has not been told about yet.
 *
 * The jitter buffer is four lines and no more. The host's clock and this
 * peer's clock are both nominally 60 Hz and neither is authoritative over the
 * other, so the queue drifts: too full means run two frames this tick, empty
 * means hold the pose. Anything cleverer than that would be a filter to tune
 * with no way to measure it.
 */
export function createFeed(world) {
  const ordered = []; // { event } | { trail }
  const frames = [];
  let lastTick = -1;

  return {
    /* Reliable lane, in arrival order. */
    pushEvent: (event) => ordered.push({ event }),
    pushTrail: (entries) => ordered.push({ trail: entries }),

    /* Lossy lane. `version` is the roster the frame was packed against. */
    pushState(frame, version) {
      if (!frame) return;
      if (frame.rosterVersion !== (version & 0xff)) return;
      if (frame.tick <= lastTick) return; // stale, or a duplicate retransmit
      lastTick = frame.tick;
      frames.push(frame);
      // A burst this long means something stalled and then flushed; the
      // catch-up below will eat it, but do not let it grow without limit.
      while (frames.length > 8) frames.shift();
    },

    /* A new match: the tick counter starts again, so nothing is stale. */
    rewind() {
      ordered.length = 0;
      frames.length = 0;
      lastTick = -1;
    },

    /* Once a tick from main.js's step(). Fills `out` with game events. */
    pump(out) {
      for (const item of ordered.splice(0)) {
        if (item.trail) world.applyTrail(item.trail);
        else {
          if (item.event.type === "roundStart") world.resetRound();
          out.push(item.event);
        }
      }
      if (!frames.length) {
        world.hold();
        return;
      }
      let n = frames.length > 3 ? 2 : 1;
      while (n-- > 0 && frames.length) world.applyState(frames.shift());
    },
  };
}
