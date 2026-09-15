/*
 * match.js — the round manager.
 *
 * A match is a sequence of rounds over one World. This class owns the state
 * machine (countdown -> playing -> roundOver -> countdown ... -> matchOver),
 * the scores, and nothing else: it reports what happened as plain event
 * objects and lets the caller decide what to draw, play or say. Like the
 * World it has no DOM or Babylon in it, so a future host can run it in a
 * worker and forward the events to guests.
 *
 * Scoring is Kurve's: every time a rider crashes, every rider still alive
 * gets a point. First to POINTS_PER_RIVAL x rivals, alone in the lead, wins.
 * With `attract` set the match never ends — the title screen uses that to
 * keep a demo running behind the menu.
 */

import {
  COUNTDOWN_SECONDS,
  ROUND_OVER_SECONDS,
  POINTS_PER_RIVAL,
} from "../config.js";
import { aiThink } from "./ai.js";

export class Match {
  constructor(world, specs, { attract = false } = {}) {
    this.world = world;
    this.specs = specs;
    this.attract = attract;
    this.target = POINTS_PER_RIVAL * Math.max(1, specs.length - 1);
    this.scores = {};
    this.state = "idle";
    this.timer = 0;
    this.round = 0;
  }

  start(events) {
    this.world.setup(this.specs);
    for (const s of this.specs) this.scores[s.id] = 0;
    this.round = 0;
    this._nextRound(events);
  }

  /*
   * Advance one fixed step.
   *   humanTurns: Map of player id -> -1..1 for the human seats
   *   events: array to push onto
   */
  update(dt, humanTurns, events) {
    const world = this.world;
    for (const p of world.players) {
      if (p.kind === "human") p.turn = humanTurns.get(p.id) ?? 0;
    }

    switch (this.state) {
      case "countdown":
        world.steerOnly(dt);
        this.timer -= dt;
        if (this.timer <= 0) {
          this.state = "playing";
          events.push({ type: "go" });
        }
        break;

      case "playing": {
        for (const p of world.players) if (p.ai && p.alive) aiThink(world, p);
        const first = events.length;
        world.tick(dt, events);
        for (let i = first; i < events.length; i++) {
          if (events[i].type !== "eliminated") continue;
          for (const q of world.players) if (q.alive) this.scores[q.id]++;
        }
        const alive = world.alive();
        if (alive.length <= 1) {
          this.state = "roundOver";
          this.timer = ROUND_OVER_SECONDS;
          events.push({
            type: "roundOver",
            winnerId: alive[0]?.id ?? null,
          });
        }
        break;
      }

      case "roundOver":
        this.timer -= dt;
        if (this.timer <= 0) {
          const winner = this._matchWinner();
          if (winner && !this.attract) {
            this.state = "matchOver";
            events.push({ type: "matchOver", winnerId: winner });
          } else {
            this._nextRound(events);
          }
        }
        break;

      default:
        break;
    }
  }

  _nextRound(events) {
    this.round++;
    this.world.spawn();
    this.state = "countdown";
    this.timer = COUNTDOWN_SECONDS;
    events.push({ type: "roundStart", round: this.round });
  }

  /* Id of the sole leader at or past the target, else null. */
  _matchWinner() {
    let best = null;
    let bestScore = -1;
    let tied = false;
    for (const id in this.scores) {
      const s = this.scores[id];
      if (s > bestScore) {
        best = id;
        bestScore = s;
        tied = false;
      } else if (s === bestScore) {
        tied = true;
      }
    }
    return bestScore >= this.target && !tied ? best : null;
  }
}
