/*
 * host.js — the authoritative peer.
 *
 * One player runs the simulation and everybody else sends steering and
 * receives the result. That is a host-authoritative star, not a mesh: a guest
 * holds exactly one connection, to the host, and never talks to another guest
 * (hub CLAUDE.md §8). The host is authoritative over everything that decides
 * the game — who crashed, who scored, when a round starts and ends — because
 * there is exactly one World and it is in this peer's worker.
 *
 * WHY NOT LOCKSTEP. NeonFox looked like the easy case for it: the sim is pure,
 * fixed-step and seeded, so in principle every peer could run the identical
 * World from one seed with two bits of turn per player per tick on the wire.
 * It was measured before it was believed, and it does not hold. Two runs in
 * one engine are bit-identical — but Math.cos, Math.sin, Math.atan2 and
 * Math.hypot are all implementation-defined in ECMAScript, and V8 and
 * JavaScriptCore disagree on them. A rider's step is
 * `x += Math.cos(heading) * SPEED * dt`, so one ULP of disagreement is a
 * position that drifts, and a position that drifts eventually falls on the
 * other side of a 0.1-unit collision cell. Desktop Chrome plus an iPad is the
 * ordinary case for this game, which is exactly V8 plus JavaScriptCore. See
 * docs/P2P.md for the measurement.
 *
 * So: snapshots, as fishtank does, with the twist NeonFox's own shape allows —
 * trails are a delta on the reliable lane rather than part of the snapshot,
 * because they only ever grow. protocol.js has the arithmetic.
 *
 * WHAT THIS FILE DOES NOT KNOW. It has never heard of WebRTC. It talks to
 * "channels": send(value, fast), onMessage, onClose. Everything real about
 * the transport is in webrtc.js and rendezvous.js, which is what makes the
 * two-tab BroadcastChannel path a genuine test of this code and not a
 * simulation of it.
 */

import { MAX_PLAYERS, PALETTE, ARENA_SIZES, TURN_MODES } from "../config.js";
import {
  MSG,
  NET_VERSION,
  KIND_INPUT,
  unpackInput,
  unpackState,
  unpackTrail,
  cleanName,
  cleanSeats,
  cleanTurn,
} from "./protocol.js";
import { ShadowWorld, createFeed } from "./shadow.js";
import { hostRendezvous } from "./rendezvous.js";
import { newCode } from "./codes.js";

export async function hostSession({
  arenaIndex,
  turnIndex,
  target,
  ais,
  name,
  seats,
  coarse,
}) {
  const code = newCode();
  const world = new ShadowWorld();
  const feed = createFeed(world);

  const session = {
    kind: "host",
    code,
    mode: "",
    detail: "",
    world,
    roster: [],
    seats: cleanSeats(seats, coarse),
    started: false,
    match: { state: "idle", round: 0, scores: {}, target },
    /* main.js and lobby.js set these. */
    onRoster: null,
    onStatus: null,
    onBegin: null,
    onClosed: null,
  };

  const peers = new Map(); // transport id -> { channel, name, seats, ids, spectator }
  const myIds = []; // this device's own player ids, by seat
  const lastSent = [0, 0]; // last turn posted to the worker, per local seat
  let rosterVersion = 1;
  let worker = null;
  let rendezvous = null;
  let arena =
    ARENA_SIZES[Math.max(0, Math.min(ARENA_SIZES.length - 1, arenaIndex))];
  const turn =
    TURN_MODES[Math.max(0, Math.min(TURN_MODES.length - 1, turnIndex))];
  /* What this room plays by, in words, for the lobby to print. The same
   * three settings travel to guests by name in every roster message, so both
   * ends can show one line and it says the same thing on each. */
  session.rules = { arenaName: arena.name, turnName: turn.name, target };
  let hostName = cleanName(name);

  const say = (text) => session.onStatus?.(text);

  /* ------------------------------------------------------------ roster --- */

  /*
   * Slots are handed out host first, then guests in the order they arrived,
   * then AI to fill. colorIndex follows the slot, so a rider's colour is the
   * same thing everywhere without anybody negotiating it — PALETTE is the
   * roster, exactly as it is in a solo game.
   *
   * The AI count is the host's menu choice clamped by how many people turned
   * up: six riders is the hard ceiling (the collision grid stores an owner in
   * a Uint8Array slot, and js/config.js says six), so a fourth guest costs a
   * rival rather than being refused.
   */
  function rebuildRoster() {
    const entries = [];
    const push = (name, kind, owner, seat) => {
      const i = entries.length;
      entries.push({
        id: "p" + i,
        slot: i + 1,
        name,
        colorIndex: i,
        kind,
        owner,
        seat,
      });
    };
    myIds.length = 0;
    for (let s = 0; s < session.seats && entries.length < MAX_PLAYERS; s++) {
      push(
        session.seats === 1 ? hostName : `${hostName} ${s + 1}`,
        "human",
        "me",
        s,
      );
      myIds.push(entries[entries.length - 1].id);
    }
    for (const peer of peers.values()) {
      peer.ids = [];
      if (peer.spectator) continue;
      for (let s = 0; s < peer.seats && entries.length < MAX_PLAYERS; s++) {
        push(
          peer.seats === 1 ? peer.name : `${peer.name} ${s + 1}`,
          "human",
          peer.key,
          s,
        );
        peer.ids.push(entries[entries.length - 1].id);
      }
    }
    const room = MAX_PLAYERS - entries.length;
    for (let i = 0; i < Math.min(ais, room); i++) {
      push(PALETTE[entries.length].name, "ai", null, -1);
    }
    session.roster = entries;
    rosterVersion = (rosterVersion + 1) & 0xff;
    if (rosterVersion === 0) rosterVersion = 1;
  }

  /* What a peer is told about the cast, including which riders are its own. */
  function rosterMessage(peer) {
    return {
      t: MSG.ROSTER,
      v: rosterVersion,
      arenaHalf: arena.half,
      arenaName: arena.name,
      turnName: turn.name,
      target,
      you: peer ? peer.ids : myIds,
      roster: session.roster.map((r) => ({
        id: r.id,
        slot: r.slot,
        name: r.name,
        colorIndex: r.colorIndex,
        kind: r.kind,
      })),
    };
  }

  function publishRoster() {
    for (const peer of peers.values())
      if (peer.hello) peer.channel.send(rosterMessage(peer));
    session.onRoster?.(session.roster);
  }

  /* The shadow world this device renders from. Ownership is `owner === "me"`,
   * which is what shadow.js turns into `kind: "human"`. */
  function applyRosterLocally() {
    world.setArena(arena.half);
    world.setRoster(
      session.roster.map((r) => ({
        id: r.id,
        slot: r.slot,
        name: r.name,
        colorIndex: r.colorIndex,
        mine: r.owner === "me",
        seat: r.seat,
      })),
    );
  }

  /* ------------------------------------------------------------- peers --- */

  const freeSeats = () => {
    let used = session.seats;
    for (const p of peers.values()) if (!p.spectator) used += p.seats;
    return Math.max(0, MAX_PLAYERS - used);
  };

  function onPeer(key, channel) {
    const peer = {
      key,
      channel,
      name: "",
      seats: 1,
      ids: [],
      hello: false,
      spectator: false,
    };
    peers.set(key, peer);
    channel.onClose = () => dropPeer(key);
    channel.onMessage = (value) => receive(peer, value);
  }

  function dropPeer(key) {
    const peer = peers.get(key);
    if (!peer) return;
    peers.delete(key);
    // Mid-match, the roster is frozen: a rider whose person left simply stops
    // steering, keeps its trail, and dies on the next wall it meets. Reseating
    // riders in the middle of a round would be a far bigger lie than that.
    if (!session.started) {
      rebuildRoster();
      applyRosterLocally();
      publishRoster();
    } else {
      for (const id of peer.ids)
        worker?.postMessage({ type: "INPUT", id, turn: 0 });
    }
    say(peer.name ? `${peer.name} left.` : "Someone dropped out.");
  }

  function refuse(peer, why) {
    peer.channel.send({ t: MSG.REFUSED, why });
    setTimeout(() => peer.channel.close(), 250); // let the message actually go
  }

  /*
   * Every byte a guest sends arrives here. Three facts come off the wire — a
   * name, a seat count and a steering direction — and all three are cleaned
   * before anything downstream can see them (protocol.js). There is no field
   * in which a guest could claim a position, a score or a life, which is a
   * cheaper guarantee than validating one away.
   */
  function receive(peer, value) {
    if (value instanceof Uint8Array) {
      if (value[0] !== KIND_INPUT) return; // a guest has nothing else to send
      const input = unpackInput(value);
      if (!input || peer.spectator) return;
      for (const s of input.seats) {
        const id = peer.ids[s.seat];
        if (!id) continue; // a seat this peer was never given
        worker?.postMessage({ type: "INPUT", id, turn: cleanTurn(s.turn) });
      }
      return;
    }
    if (!value || typeof value !== "object") return;
    if (value.t === MSG.HELLO) {
      if (peer.hello) return; // one hello per peer; the rest is noise
      if (value.v !== NET_VERSION)
        return refuse(
          peer,
          "That device is running a different build of NeonFox. Reload both and try again.",
        );
      peer.name = cleanName(value.name);
      peer.hello = true;
      if (session.started) {
        // The cast is fixed once a match begins, so a late arrival watches
        // instead of being turned away. The spectator camera already knows
        // what to do with a device that has no riders of its own.
        peer.spectator = true;
        peer.seats = 0;
        peer.channel.send({
          ...rosterMessage(peer),
          t: MSG.WELCOME,
          spectator: true,
          seats: 0,
        });
        worker?.postMessage({ type: "CATCH_UP", peer: peer.key });
        say(`${peer.name} is watching.`);
        return;
      }
      const wanted = cleanSeats(value.seats, value.coarse);
      const room = freeSeats();
      if (room <= 0)
        return refuse(
          peer,
          "This game is full — six riders is the most the arena holds.",
        );
      peer.seats = Math.min(wanted, room);
      rebuildRoster();
      applyRosterLocally();
      peer.channel.send({
        ...rosterMessage(peer),
        t: MSG.WELCOME,
        seats: peer.seats,
      });
      publishRoster();
      say(
        peer.seats < wanted
          ? `${peer.name} joined, with room for ${peer.seats} of their riders.`
          : `${peer.name} joined.`,
      );
      return;
    }
    if (value.t === MSG.BYE) dropPeer(peer.key);
  }

  /* ------------------------------------------------------------ worker --- */

  function bootWorker() {
    worker = new Worker(new URL("./host-worker.js", import.meta.url), {
      type: "module",
    });
    worker.onmessage = ({ data }) => {
      if (data.type === "FRAME") {
        // Reliable first, and events before trail: a roundStart has to reach
        // a guest before the points of the round it starts.
        if (data.events.length) {
          const message = {
            t: MSG.EVENT,
            events: data.events,
            scores: data.scores,
            state: data.matchState,
            round: data.round,
          };
          broadcast(message, false);
          for (const e of data.events) feed.pushEvent(e);
        }
        for (const bytes of data.trail) {
          broadcast(bytes, false);
          feed.pushTrail(unpackTrail(bytes));
        }
        broadcast(data.state, true);
        feed.pushState(unpackState(data.state), rosterVersion);
        session.match.scores = data.scores;
        session.match.state = data.matchState;
        session.match.round = data.round;
      } else if (data.type === "STARTED") {
        session.match.target = data.target;
        for (const e of data.events) feed.pushEvent(e);
        if (data.events.length)
          broadcast(
            {
              t: MSG.EVENT,
              events: data.events,
              scores: data.scores,
              state: data.matchState,
              round: data.round,
            },
            false,
          );
      } else if (data.type === "CAUGHT_UP") {
        const peer = peers.get(data.peer);
        if (!peer) return;
        for (const bytes of data.trail) peer.channel.send(bytes, false);
        peer.channel.send(data.state, true);
        peer.channel.send({
          t: MSG.EVENT,
          events: [],
          scores: data.scores,
          state: data.matchState,
          round: data.round,
        });
      }
    };
  }

  function broadcast(value, fast) {
    for (const peer of peers.values())
      if (peer.hello) peer.channel.send(value, fast);
  }

  /* ----------------------------------------------------------- session --- */

  session.setLocalTurn = (seat, turn) => {
    const id = myIds[seat];
    if (!id || !worker) return;
    const clean = cleanTurn(turn);
    if (lastSent[seat] === clean) return; // edge-triggered: 60 Hz of "still 0" is noise
    lastSent[seat] = clean;
    worker.postMessage({ type: "INPUT", id, turn: clean });
  };

  session.pump = (out) => feed.pump(out);

  session.startMatch = () => {
    if (session.started) return;
    session.started = true;
    rebuildRoster();
    applyRosterLocally();
    feed.rewind();
    lastSent[0] = lastSent[1] = 0;
    bootWorker();
    worker.postMessage({
      type: "SETUP",
      // A seed only has to be unpredictable, not reproducible-by-agreement:
      // nobody else runs this World. It travels in BEGIN so a bug report can
      // quote it (js/sim/rng.js).
      seed: (Date.now() ^ (Math.random() * 0xffffffff)) >>> 0,
      specs: session.roster.map((r) => ({
        id: r.id,
        name: r.name,
        colorIndex: r.colorIndex,
        kind: r.kind,
        seat: r.seat,
      })),
      arenaHalf: arena.half,
      turnRate: turn.rate,
      target,
      rosterVersion,
    });
    // Per peer, not broadcast: BEGIN carries `you`, and which riders are
    // yours is the one part of the roster that differs by who is reading it.
    for (const peer of peers.values())
      if (peer.hello)
        peer.channel.send({ ...rosterMessage(peer), t: MSG.BEGIN }, false);
    worker.postMessage({ type: "START" });
    session.onBegin?.();
  };

  /*
   * Another match with the same people. Everything the old match owned lived
   * in the worker, so throwing that away and standing a new one up is the
   * whole of it — the roster, the connections and the code all survive, which
   * is the point: nobody re-reads a code out loud between rounds of play.
   */
  session.rematch = () => {
    worker?.postMessage({ type: "STOP" });
    worker?.terminate();
    worker = null;
    session.started = false;
    session.startMatch();
  };

  session.leave = (why = "The host left, so the game is over.") => {
    broadcast({ t: MSG.BYE, why }, false);
    for (const peer of peers.values()) peer.channel.close();
    peers.clear();
    worker?.postMessage({ type: "STOP" });
    worker?.terminate();
    worker = null;
    rendezvous?.close();
    rendezvous = null;
    session.onClosed?.(null);
  };

  /* ------------------------------------------------------------- start --- */

  rebuildRoster();
  applyRosterLocally();
  rendezvous = await hostRendezvous(code, onPeer);
  session.mode = rendezvous.mode;
  session.detail = rendezvous.detail;
  session.watch = rendezvous.watch ?? null;
  return session;
}
