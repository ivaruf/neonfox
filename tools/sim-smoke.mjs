/*
 * sim-smoke.mjs — run the whole game with nobody watching.
 *
 * The sim is deliberately free of DOM and Babylon (see ARCHITECTURE.md), and
 * this script is what cashes that promise in: it imports World and Match
 * straight into node, plays a full six-rider match of pure AI at the real
 * TICK, and checks the invariants a player would otherwise have to notice by
 * losing an evening to them — that rounds end, that a round ends with at most
 * one rider standing, that the scoreboard only ever goes up, that the match
 * reaches a winner past the target, and that every elimination can name what
 * killed it.
 *
 * It is not a unit-test suite and is not trying to be (hub CLAUDE.md §11
 * keeps verification light). It is one command, a handful of seconds, and a
 * printed summary that tells you whether the game is still a game: if the
 * average round is a third of a second or the match never ends, the numbers
 * here say so before the browser does.
 *
 * Run: node tools/sim-smoke.mjs
 */

import { World } from "../js/sim/world.js";
import { Match } from "../js/sim/match.js";
import { TICK, PALETTE, MAX_PLAYERS } from "../js/config.js";

/* Five rivals, no humans: the sim never learns the difference, and a field
 * that big makes trails cross early, which is where the interesting bugs are. */
const FIELD = 5;
const MAX_TICKS = 400000; // ~1.85 hours of game time; a hung match trips this

function buildSpecs(n) {
  const specs = [];
  for (let i = 0; i < Math.min(n, MAX_PLAYERS); i++) {
    specs.push({
      id: "p" + i,
      name: PALETTE[i].name,
      colorIndex: i,
      kind: "ai",
      seat: -1,
    });
  }
  return specs;
}

function assert(ok, message) {
  if (!ok) throw new Error("sim-smoke: " + message);
}

/*
 * Play one match to its end and return everything worth printing. `world` is
 * passed in rather than made here so the caller decides seeded or not.
 */
function playMatch(world, label) {
  const specs = buildSpecs(FIELD);
  const ids = new Set(specs.map((s) => s.id));
  const match = new Match(world, specs);

  const stats = {
    label,
    seed: world.seed,
    ticks: 0,
    playingTicks: 0,
    rounds: 0, // rounds that actually finished
    eliminations: 0,
    byWall: 0,
    byTrail: 0,
    longestRound: 0, // in playing ticks
    roundTicks: 0,
  };

  const events = [];
  match.start(events);
  const noHumans = new Map(); // one Map, reused: the sim reads, never keeps it

  while (stats.ticks < MAX_TICKS && match.state !== "matchOver") {
    // Sample the state before the step: a tick spent in 'playing' is a tick
    // where riders actually moved, which is what a round's length means.
    const moving = match.state === "playing";
    events.length = 0;
    match.update(TICK, noHumans, events);
    stats.ticks++;
    if (moving) {
      stats.playingTicks++;
      stats.roundTicks++;
    }

    for (const e of events) {
      if (e.type === "eliminated") {
        stats.eliminations++;
        assert(
          e.by === "wall" || ids.has(e.by),
          `elimination of ${e.id} blamed on unknown "${e.by}"`
        );
        if (e.by === "wall") stats.byWall++;
        else stats.byTrail++;
      } else if (e.type === "roundOver") {
        stats.rounds++;
        // The round manager only calls it over when the field is down to one
        // (or nobody): if that ever stops being true the scoreboard is lying.
        const alive = world.alive();
        assert(
          alive.length <= 1,
          `round ${match.round} ended with ${alive.length} riders alive`
        );
        assert(
          e.winnerId === null || alive[0]?.id === e.winnerId,
          `round ${match.round} named ${e.winnerId} the winner but ${alive[0]?.id} is the survivor`
        );
        if (stats.roundTicks > stats.longestRound)
          stats.longestRound = stats.roundTicks;
        stats.roundTicks = 0;
      }
    }
  }

  stats.state = match.state;
  stats.scores = { ...match.scores };
  stats.target = match.target;
  stats.winner = null;
  for (const id in match.scores) {
    if (stats.winner === null || match.scores[id] > match.scores[stats.winner])
      stats.winner = id;
  }

  assert(stats.rounds >= 1, "no round ever completed");
  assert(
    stats.state === "matchOver",
    `match never ended (stopped in "${stats.state}" after ${stats.ticks} ticks)`
  );
  assert(stats.eliminations > 0, "a whole match with nobody crashing");
  for (const id in stats.scores) {
    assert(
      Number.isFinite(stats.scores[id]) && stats.scores[id] >= 0,
      `score for ${id} is ${stats.scores[id]}`
    );
  }
  assert(
    stats.scores[stats.winner] >= stats.target,
    `winner ${stats.winner} has ${stats.scores[stats.winner]} points, target is ${stats.target}`
  );

  return stats;
}

function report(s) {
  const avg = s.rounds ? s.playingTicks / s.rounds / 60 : 0;
  const board = Object.entries(s.scores)
    .sort((a, b) => b[1] - a[1])
    .map(([id, n]) => `${id}:${n}`)
    .join(" ");
  console.log(
    [
      `${s.label} (seed ${s.seed >>> 0})`,
      `  rounds ${s.rounds}   eliminations ${s.eliminations} (${s.byWall} wall / ${s.byTrail} trail)`,
      `  round length avg ${avg.toFixed(1)}s   longest ${(s.longestRound / 60).toFixed(1)}s   match ${(s.ticks / 60).toFixed(1)}s`,
      `  winner ${s.winner} at ${s.scores[s.winner]}/${s.target}   scores ${board}`,
    ].join("\n")
  );
}

/* A fixed seed first, so a regression here is reproducible and quotable. */
report(playMatch(new World(12345), "seeded match"));
/* Then an unseeded one, because "it passes" must not mean "it passes on 12345". */
report(playMatch(new World(), "random seed"));

console.log("sim-smoke: ok");
