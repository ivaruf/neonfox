/*
 * guest.js — the peer that does not simulate.
 *
 * A guest holds exactly one connection, to the host, and does exactly two
 * things with it: it sends the steering of its own seats, and it renders what
 * comes back. It runs no World, keeps no scores of its own and decides
 * nothing — which is the whole point of host-authoritative play, and also why
 * this file is a quarter the size of host.js.
 *
 * It renders through the same ShadowWorld the host renders through, fed by
 * the same createFeed, so there is one path from a packed frame to a rider on
 * screen and it cannot drift between the two sides.
 *
 * Input goes out on the lossy lane, once a tick, and carries only the current
 * turn per seat. There is no redundancy window and no resend, because there is
 * nothing to recover: a lost input packet means the host steers this rider
 * with a 16 ms old value, and the next packet is already on its way. (Lockstep
 * would need every tick's input to arrive; snapshots do not. See host.js for
 * why this is not lockstep.)
 */

import {
  MSG,
  NET_VERSION,
  KIND_STATE,
  KIND_TRAIL,
  packInput,
  unpackState,
  unpackTrail,
  cleanName,
  cleanSeats,
} from "./protocol.js";
import { ShadowWorld, createFeed } from "./shadow.js";
import { joinRendezvous } from "./rendezvous.js";
import { parseCode } from "./codes.js";

export async function joinSession({ code, name, seats, coarse }) {
  const parsed = parseCode(code);
  if (!parsed) throw new Error("That is not a code. Tap three pictures.");

  const world = new ShadowWorld();
  const feed = createFeed(world);

  const session = {
    kind: "guest",
    code: parsed,
    mode: "",
    detail: "",
    world,
    roster: [],
    seats: cleanSeats(seats, coarse),
    spectator: false,
    started: false,
    match: { state: "idle", round: 0, scores: {}, target: 0 },
    onRoster: null,
    onStatus: null,
    onBegin: null,
    onClosed: null,
  };

  const myIds = [];
  let rosterVersion = 0;
  let tick = 0;
  const turns = [0, 0];
  let dirty = false;

  const joined = await joinRendezvous(parsed);
  session.mode = joined.mode;
  session.detail = joined.detail ?? "";
  const channel = joined.channel;

  /* Take a roster message (WELCOME, ROSTER or BEGIN — they carry the same
   * fields) and make it this device's view of the cast. */
  function takeRoster(value) {
    rosterVersion = value.v & 0xff;
    myIds.length = 0;
    for (const id of value.you ?? []) myIds.push(id);
    session.roster = value.roster ?? [];
    session.match.target = value.target ?? session.match.target;
    world.setArena(value.arenaHalf ?? world.half);
    world.setRoster(
      session.roster.map((r) => ({
        id: r.id,
        slot: r.slot,
        name: r.name,
        colorIndex: r.colorIndex,
        mine: myIds.includes(r.id),
        seat: myIds.indexOf(r.id),
      })),
    );
    session.onRoster?.(session.roster);
  }

  channel.onClose = () => {
    // No host migration: guests only ever hold a connection to the host, so
    // there is nobody left to promote. Say so plainly rather than leaving a
    // frozen arena that looks like a bug (docs/P2P.md, "what we accept").
    session.onClosed?.("The host left, so the game is over.");
  };

  channel.onMessage = (value) => {
    if (value instanceof Uint8Array) {
      if (value[0] === KIND_STATE)
        feed.pushState(unpackState(value), rosterVersion);
      else if (value[0] === KIND_TRAIL)
        feed.pushTrail(unpackTrail(value) ?? []);
      return;
    }
    if (!value || typeof value !== "object") return;
    switch (value.t) {
      case MSG.WELCOME:
        session.spectator = !!value.spectator;
        session.seats = value.seats ?? session.seats;
        takeRoster(value);
        session.onStatus?.(
          session.spectator
            ? "A match is already running — you are watching this one."
            : "You are in. Waiting for the host to start.",
        );
        // A spectator arrives mid-round, so the host is about to catch it up
        // and the match is already begun as far as this device is concerned.
        if (session.spectator && !session.started) {
          session.started = true;
          session.onBegin?.();
        }
        break;
      case MSG.ROSTER:
        takeRoster(value);
        break;
      case MSG.BEGIN:
        takeRoster(value);
        feed.rewind();
        session.started = true;
        session.onBegin?.();
        break;
      case MSG.EVENT:
        if (value.scores) session.match.scores = value.scores;
        if (value.state) session.match.state = value.state;
        if (typeof value.round === "number") session.match.round = value.round;
        for (const e of value.events ?? []) feed.pushEvent(e);
        break;
      case MSG.REFUSED:
        session.onClosed?.(value.why || "The host turned this device away.");
        break;
      case MSG.BYE:
        session.onClosed?.(value.why || "The host left, so the game is over.");
        break;
      default:
        break;
    }
  };

  session.setLocalTurn = (seat, turn) => {
    if (seat >= session.seats) return;
    const clean = turn > 0.5 ? 1 : turn < -0.5 ? -1 : 0;
    if (turns[seat] !== clean) dirty = true;
    turns[seat] = clean;
  };

  /*
   * Once a tick. Sending only on a change would halve the traffic and cost
   * far more than it saves: the lossy lane drops packets, and a dropped
   * "stopped turning" that is never repeated is a rider that keeps turning
   * into a wall. So an unchanged turn is resent for a few ticks after it
   * settles, which is cheap (8 bytes) and self-healing.
   */
  let repeat = 0;
  session.pump = (out) => {
    if (!session.spectator && channel.open) {
      if (dirty) {
        dirty = false;
        repeat = 8;
      }
      if (repeat > 0) {
        repeat--;
        channel.send(packInput(tick, turns.slice(0, session.seats)), true);
      } else if (tick % 6 === 0) {
        // A slow heartbeat while nothing changes, so a host that missed the
        // whole burst is never more than a tenth of a second wrong.
        channel.send(packInput(tick, turns.slice(0, session.seats)), true);
      }
    }
    tick++;
    feed.pump(out);
  };

  // Only a host may start or restart a match. main.js reads these being
  // absent as "this device does not get that button", which is a truer thing
  // to show a guest than a button that quietly does nothing.
  session.startMatch = null;
  session.rematch = null;
  session.leave = () => {
    try {
      channel.send({ t: MSG.BYE, why: "left" });
    } catch {
      /* Already gone. */
    }
    channel.close();
    joined.close?.();
  };

  channel.send({
    t: MSG.HELLO,
    v: NET_VERSION,
    name: cleanName(name),
    seats: session.seats,
    coarse: !!coarse,
  });

  return session;
}
