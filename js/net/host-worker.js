/*
 * host-worker.js — the host's simulation, off the page.
 *
 * A browser throttles setInterval hard in a backgrounded tab. fishtank
 * measured what that does to a host: 3 snapshots against 62 over the same
 * fifteen seconds, with the round timer stopped — the host looks at another
 * tab and everybody else's game freezes. Worker timers are not throttled the
 * same way, and this also gets the simulation off the render thread, which
 * matters because the host does strictly more work than any guest.
 *
 * js/sim/ was written to allow exactly this (ARCHITECTURE.md: "Nothing under
 * js/sim/ may import Babylon or touch document/window"), and that promise is
 * the only reason this file is twelve imports shorter than it could be.
 *
 * The worker owns the World and the Match and nothing else. It never sees a
 * data channel, a peer id or a name that has not already been cleaned: the
 * page hands it validated turns and takes back packed bytes. Keeping it a
 * pure simulation is what lets the same World run here, in a Node smoke test,
 * and in a solo game with no worker at all.
 */

import { TICK } from "../config.js";
import { World } from "../sim/world.js";
import { Match } from "../sim/match.js";
import {
  packState,
  packTrail,
  cleanTurn,
  OP_APPEND,
  OP_STROKE,
  OP_RESET,
  TRAIL_CHUNK,
} from "./protocol.js";

let world = null;
let match = null;
let ticker = null;
let rosterVersion = 0;
let last = 0;
let acc = 0;
/*
 * The frame number on the wire is NOT world.tickCount. spawn() resets that to
 * zero at the start of every round, and the guest's frame queue drops
 * anything not newer than the last frame it applied — so a round boundary
 * would silently stall every guest's arena until the new round's tick count
 * climbed past the old one's. This counter only ever goes up, for the life of
 * the match, which is the one property the queue actually needs.
 */
let frameNo = 0;

/* Per rider: how much of its trail every guest has already been sent. One
 * cursor set, not one per peer — the deltas are broadcast, so a peer that
 * joins late is caught up with a full dump taken at exactly this cursor and
 * then joins the same stream. */
let cursors = new Map();

/* The turn every player is currently holding. The page writes this from its
 * own keyboard and from guests' input packets; nothing else can. */
const turns = new Map();

function resetCursors() {
  cursors = new Map();
  for (const p of world.players)
    cursors.set(p.slot, { strokeIdx: 0, pointIdx: 0, op: OP_APPEND });
}

/*
 * Everything committed since the last call, in order, chunked so no single
 * message approaches the 16 KB interoperable limit. A stroke that is still
 * growing is left at its cursor: its live head is drawn from the state frame
 * instead, exactly as trails.js already does for a solo game.
 */
function drainTrail() {
  const entries = [];
  for (const p of world.players) {
    const c = cursors.get(p.slot);
    if (!c) continue;
    while (c.strokeIdx < p.strokes.length) {
      const stroke = p.strokes[c.strokeIdx];
      const available = stroke.length - c.pointIdx;
      if (available >= 3) {
        const take = Math.min(available - (available % 3), TRAIL_CHUNK * 3);
        entries.push({
          slot: p.slot,
          op: c.op,
          points: stroke.slice(c.pointIdx, c.pointIdx + take),
        });
        c.op = OP_APPEND;
        c.pointIdx += take;
        continue;
      }
      // The last stroke is the one still being painted; stop on it and keep
      // the cursor there. Any earlier stroke is finished for good, and the
      // break between them is the gap the rider flew through.
      if (c.strokeIdx === p.strokes.length - 1) break;
      c.strokeIdx++;
      c.pointIdx = 0;
      c.op = OP_STROKE;
    }
  }
  return entries;
}

/*
 * A delta stream has no beginning, so a guest seated mid-round would decode
 * an arena with nobody's trail in it but its own from here on. (fishtank hit
 * exactly this and answered it with a full() alongside the welcome.) This is
 * that: everything up to the shared cursor, so the guest lands precisely in
 * step with the broadcast that follows.
 */
function fullTrail() {
  const entries = [];
  for (const p of world.players) {
    const c = cursors.get(p.slot);
    if (!c) continue;
    let op = OP_RESET; // wipe whatever the guest had, then start stroke zero
    for (let s = 0; s <= c.strokeIdx && s < p.strokes.length; s++) {
      const stroke = p.strokes[s];
      const end = s === c.strokeIdx ? c.pointIdx : stroke.length;
      if (end === 0) {
        // An empty stroke still has to exist on the guest, or the next
        // append lands in the wrong one.
        entries.push({ slot: p.slot, op, points: [] });
        op = OP_STROKE;
        continue;
      }
      for (let i = 0; i < end; i += TRAIL_CHUNK * 3) {
        entries.push({
          slot: p.slot,
          op,
          points: stroke.slice(i, Math.min(end, i + TRAIL_CHUNK * 3)),
        });
        op = OP_APPEND;
      }
      op = OP_STROKE;
    }
  }
  return entries;
}

/* Split a list of entries into messages small enough to never be a question. */
function packEntries(entries) {
  const messages = [];
  let batch = [];
  let points = 0;
  for (const e of entries) {
    const n = e.points.length / 3;
    if (batch.length && (points + n > TRAIL_CHUNK || batch.length >= 255)) {
      messages.push(packTrail(batch));
      batch = [];
      points = 0;
    }
    batch.push(e);
    points += n;
  }
  if (batch.length) messages.push(packTrail(batch));
  return messages;
}

function step() {
  const events = [];
  match.update(TICK, turns, events);
  for (const e of events) if (e.type === "roundStart") resetCursors();

  const state = packState(++frameNo, rosterVersion, world.players);
  const trail = packEntries(drainTrail());
  const message = {
    type: "FRAME",
    state,
    trail,
    events,
    // The scoreboard is cheap and only changes on an event, but sending it
    // with every frame means a guest that missed an EVENT still shows the
    // right number rather than a stale one nothing will ever correct.
    scores: match.scores,
    matchState: match.state,
    round: match.round,
  };
  const transfer = [state.buffer, ...trail.map((t) => t.buffer)];
  postMessage(message, transfer);
}

/*
 * A drift-correcting clock. A plain setInterval at 16.67 ms accumulates error
 * and the round timer slowly lies; measuring real elapsed time instead keeps
 * the match clock honest. Capped at four ticks a wake-up for the same reason
 * main.js caps its own: a worker that was descheduled for a second owes the
 * sim a second of ticks, and paying that debt in one go is a freeze, not a
 * catch-up.
 */
function pump() {
  const now = Date.now();
  acc += Math.min(0.1, (now - last) / 1000);
  last = now;
  let steps = 0;
  while (acc >= TICK && steps < 4) {
    step();
    acc -= TICK;
    steps++;
  }
  if (steps === 4) acc = 0;
}

onmessage = ({ data }) => {
  switch (data.type) {
    case "SETUP": {
      world = new World(data.seed);
      world.setArena(data.arenaHalf);
      world.setTurnRate(data.turnRate);
      match = new Match(world, data.specs, { target: data.target });
      rosterVersion = data.rosterVersion & 0xff;
      frameNo = 0;
      turns.clear();
      break;
    }

    case "START": {
      const events = [];
      // start() is what calls world.setup(), so there are no players to keep
      // a cursor for until after it returns.
      match.start(events);
      resetCursors();
      postMessage({
        type: "STARTED",
        events,
        scores: match.scores,
        matchState: match.state,
        round: match.round,
        target: match.target,
      });
      last = Date.now();
      acc = 0;
      ticker = setInterval(pump, 1000 / 60);
      break;
    }

    /* The page has already validated this; clamping again costs nothing and
     * means the simulation cannot be reached by a bug in the page either. */
    case "INPUT":
      turns.set(data.id, cleanTurn(data.turn));
      break;

    /* A guest just arrived: hand the page everything it needs to catch that
     * one peer up, taken at this instant so it lands in step. */
    case "CATCH_UP": {
      const trail = packEntries(fullTrail());
      const state = packState(frameNo, rosterVersion, world.players);
      postMessage(
        {
          type: "CAUGHT_UP",
          peer: data.peer,
          state,
          trail,
          scores: match.scores,
          matchState: match.state,
          round: match.round,
          target: match.target,
        },
        [state.buffer, ...trail.map((t) => t.buffer)],
      );
      break;
    }

    case "STOP":
      if (ticker) clearInterval(ticker);
      ticker = null;
      world = null;
      match = null;
      break;

    default:
      break;
  }
};
