/*
 * world.js — the simulation. Where the gameplay lives.
 *
 * Riders move at constant speed, steer at a constant rate, paint their trail
 * into the collision grid where they stand, and die when their head touches
 * paint or the wall. Everything here is plain numbers: no DOM, no Babylon,
 * so the same file can run in a Web Worker on a host and feed snapshots to
 * guests when multiplayer arrives (see README). The renderer only reads.
 *
 * Coordinates: x to the right, y "up" the screen (the renderer maps y to
 * Babylon's z). Heading is the usual maths angle, so steering left is a
 * positive turn.
 *
 * Trails are exposed two ways. The grid is the truth for collision. For
 * drawing, each rider keeps `strokes`: an array of flat [x, y, heading, ...]
 * arrays, one per unbroken run of trail, sampled every TRAIL_POINT_SPACING
 * units. A gap simply ends one stroke and starts the next.
 */

import {
  ARENA_HALF,
  SPAWN_INSET,
  SPAWN_SEPARATION,
  SPAWN_RUNWAY,
  SPEED,
  TURN_RATE,
  HEAD_RADIUS,
  TRAIL_HALF_WIDTH,
  GAP_INTERVAL,
  GAP_LENGTH,
  SELF_IGNORE_TICKS,
  GRID_CELL,
  TRAIL_POINT_SPACING,
} from "../config.js";
import { Grid } from "./grid.js";
import { mulberry32, range } from "./rng.js";
import { createAiState } from "./ai.js";

const TAU = Math.PI * 2;

/* Head probe: the centre plus a ring of eight, 0.35 apart on the ring, which
 * is closer than the 0.6 a solid trail is wide, so nothing slips between. */
const PROBE = [[0, 0]];
for (let i = 0; i < 8; i++) {
  const a = (i / 8) * TAU;
  PROBE.push([Math.cos(a) * HEAD_RADIUS, Math.sin(a) * HEAD_RADIUS]);
}

export class World {
  constructor(seed = (Date.now() ^ (Math.random() * 0xffffffff)) >>> 0) {
    this.seed = seed;
    this.rng = mulberry32(seed);
    this.half = ARENA_HALF; // the square runs -half..half on both axes
    this.grid = new Grid(ARENA_HALF, GRID_CELL);
    this.players = [];
    this.tickCount = 0;
  }

  /*
   * specs: [{ id, name, colorIndex, kind: 'human' | 'ai', seat }]
   * Slots are 1-based because 0 means empty in the grid.
   */
  setup(specs) {
    this.players = specs.map((s, i) => ({
      id: s.id,
      slot: i + 1,
      name: s.name,
      colorIndex: s.colorIndex,
      kind: s.kind,
      seat: s.seat ?? -1,
      x: 0,
      y: 0,
      heading: 0,
      turn: 0, // -1..1, positive is left
      alive: true,
      drawing: true,
      gapTimer: 0, // seconds of solid trail left before the next gap
      gapLeft: 0, // units of gap left to travel
      strokes: [],
      lastX: 0,
      lastY: 0,
      ai: s.kind === "ai" ? createAiState(this.rng) : null,
    }));
  }

  /*
   * Wipe the arena and scatter the riders. Positions are random inside the
   * inner part of the square and kept apart from each other; headings are
   * random too, but rerolled until the straight run to the nearest wall is
   * at least SPAWN_RUNWAY, so nobody opens a round already doomed. If the
   * dice refuse fifty times, the rider simply faces the centre.
   */
  spawn() {
    this.grid.clear();
    this.tickCount = 0;
    const inset = this.half * SPAWN_INSET;
    const placed = [];
    for (const p of this.players) {
      let x = 0;
      let y = 0;
      for (let attempt = 0; attempt < 50; attempt++) {
        x = range(this.rng, -inset, inset);
        y = range(this.rng, -inset, inset);
        let clear = true;
        for (const q of placed) {
          if (Math.hypot(x - q[0], y - q[1]) < SPAWN_SEPARATION) {
            clear = false;
            break;
          }
        }
        if (clear) break;
      }
      placed.push([x, y]);

      let heading = range(this.rng, -Math.PI, Math.PI);
      for (let attempt = 0; attempt < 50; attempt++) {
        if (runway(x, y, heading, this.half) >= SPAWN_RUNWAY) break;
        heading = range(this.rng, -Math.PI, Math.PI);
      }
      if (runway(x, y, heading, this.half) < SPAWN_RUNWAY) {
        heading = Math.atan2(-y, -x);
      }

      p.x = x;
      p.y = y;
      p.heading = heading;
      p.turn = 0;
      p.alive = true;
      p.drawing = true;
      p.gapTimer = range(this.rng, GAP_INTERVAL[0], GAP_INTERVAL[1]);
      p.gapLeft = 0;
      p.strokes = [[]];
      this._point(p);
      if (p.ai) {
        p.ai.turn = 0;
        p.ai.timer = 0;
        p.ai.wanderLeft = 0;
      }
    }
  }

  /* Countdown: riders may aim but not move. Same as Kurve's pre-round. */
  steerOnly(dt) {
    for (const p of this.players) {
      if (!p.alive) continue;
      p.heading += p.turn * TURN_RATE * dt;
    }
  }

  /* One fixed step. Pushes {type:'eliminated', id, by} onto `events`. */
  tick(dt, events) {
    this.tickCount++;
    const tick = this.tickCount;
    const grid = this.grid;

    for (const p of this.players) {
      if (!p.alive) continue;

      p.heading += p.turn * TURN_RATE * dt;
      if (p.heading > Math.PI) p.heading -= TAU;
      else if (p.heading < -Math.PI) p.heading += TAU;
      const step = SPEED * dt;
      p.x += Math.cos(p.heading) * step;
      p.y += Math.sin(p.heading) * step;

      // Gaps run on a timer while painting and on distance while open, so a
      // gap is always the same length on the floor whatever else happens.
      if (p.drawing) {
        p.gapTimer -= dt;
        if (p.gapTimer <= 0) {
          this._point(p, true); // close the stroke exactly here
          p.drawing = false;
          p.gapLeft = GAP_LENGTH;
        }
      } else {
        p.gapLeft -= step;
        if (p.gapLeft <= 0) {
          p.drawing = true;
          p.gapTimer = range(this.rng, GAP_INTERVAL[0], GAP_INTERVAL[1]);
          p.strokes.push([]);
          this._point(p, true);
        }
      }

      if (p.drawing) {
        grid.stampDisc(p.x, p.y, TRAIL_HALF_WIDTH, p.slot, tick);
        this._point(p);
      }

      // Wall first, then paint. The wall is the edge of the square.
      if (
        Math.abs(p.x) + HEAD_RADIUS > this.half ||
        Math.abs(p.y) + HEAD_RADIUS > this.half
      ) {
        this._kill(p, "wall", events);
        continue;
      }
      const hit = this._probe(p, tick);
      if (hit) this._kill(p, hit, events);
    }
  }

  /* Is a point solid for rider slot `self`? Used by the AI's lookahead. */
  blockedAt(x, y, self) {
    const edge = this.half - HEAD_RADIUS;
    if (Math.abs(x) > edge || Math.abs(y) > edge) return true;
    return (
      this.grid.blocked(x, y, self, this.tickCount, SELF_IGNORE_TICKS) !== 0
    );
  }

  alive() {
    return this.players.filter((p) => p.alive);
  }

  byId(id) {
    return this.players.find((p) => p.id === id);
  }

  bySlot(slot) {
    return this.players[slot - 1];
  }

  _probe(p, tick) {
    const grid = this.grid;
    for (let i = 0; i < PROBE.length; i++) {
      const o = grid.blocked(
        p.x + PROBE[i][0],
        p.y + PROBE[i][1],
        p.slot,
        tick,
        SELF_IGNORE_TICKS
      );
      if (o) return o;
    }
    return 0;
  }

  _kill(p, by, events) {
    p.alive = false;
    p.turn = 0;
    if (p.drawing) this._point(p, true); // trail reaches the crash site
    events.push({
      type: "eliminated",
      id: p.id,
      by: by === "wall" ? "wall" : this.bySlot(by).id,
    });
  }

  /* Record a trail sample when far enough from the last, or when forced. */
  _point(p, force = false) {
    const stroke = p.strokes[p.strokes.length - 1];
    if (!force && stroke.length) {
      const dx = p.x - p.lastX;
      const dy = p.y - p.lastY;
      if (dx * dx + dy * dy < TRAIL_POINT_SPACING * TRAIL_POINT_SPACING) return;
    }
    stroke.push(p.x, p.y, p.heading);
    p.lastX = p.x;
    p.lastY = p.y;
  }
}

/*
 * Straight-line distance from (x, y) along heading h to the square's edge.
 * Each axis contributes the distance to whichever side the ray is moving
 * toward; the nearer of the two is where the ray leaves the arena.
 */
function runway(x, y, h, half) {
  const cx = Math.cos(h);
  const cy = Math.sin(h);
  const tx =
    cx > 1e-9 ? (half - x) / cx : cx < -1e-9 ? (-half - x) / cx : Infinity;
  const ty =
    cy > 1e-9 ? (half - y) / cy : cy < -1e-9 ? (-half - y) / cy : Infinity;
  return Math.min(tx, ty);
}
