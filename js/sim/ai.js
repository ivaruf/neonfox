/*
 * ai.js — "good enough" rivals.
 *
 * Each AI re-plans every few ticks. It imagines five manoeuvres — hard left,
 * soft left, straight on, soft right, hard right — by running the real
 * movement rules forward for a second or so against the real collision grid,
 * and steers the way that survives longest. When straight ahead is clear for
 * the whole horizon it mostly holds course, but now and then it wanders into
 * a curve for a while, which is what turns six straight lines into a maze.
 *
 * Personality comes from three numbers rolled per rider: how often it looks
 * (reaction), how far it looks (horizon) and how restless it is (wander).
 * Slow lookers die to things a fast looker would have seen; that is the
 * whole difficulty model, and for a prototype it is a believable one.
 *
 * The lookahead steers at world.turnRate, never at a constant: turning is a
 * match setting, and an AI that planned with Classic's rate in a Glide match
 * would keep choosing turns its fox cannot make and die at every wall. The
 * manoeuvre hold times below are in seconds, so a hard turn is a wider or
 * tighter arc by mode, exactly as it is for a human holding the key.
 */

import { SPEED, HEAD_RADIUS } from "../config.js";

const STEP = 1 / 20; // lookahead resolution in seconds

/* turn for `hold` seconds, then straight to the horizon */
const MANEUVERS = [
  { turn: -1, hold: 0.75 },
  { turn: -1, hold: 0.3 },
  { turn: 0, hold: 0 },
  { turn: 1, hold: 0.3 },
  { turn: 1, hold: 0.75 },
];

export function createAiState(rng) {
  return {
    every: 2 + Math.floor(rng() * 4), // ticks between decisions
    timer: 0,
    turn: 0,
    horizon: 1.1 + rng() * 0.8, // seconds of lookahead
    wanderChance: 0.02 + rng() * 0.05, // per decision, when the way is clear
    wanderLeft: 0, // decisions left in the current wander
    rng,
  };
}

/* Sets p.turn for this tick. */
export function aiThink(world, p) {
  const ai = p.ai;
  if (--ai.timer > 0) {
    p.turn = ai.turn;
    return;
  }
  ai.timer = ai.every;

  const steps = Math.round(ai.horizon / STEP);
  const scores = MANEUVERS.map((m) => survive(world, p, m, steps));
  const straightClear = scores[2] >= steps;

  if (straightClear) {
    const wanderIdx = ai.turn > 0 ? 3 : 1;
    if (ai.wanderLeft > 0 && ai.turn !== 0 && scores[wanderIdx] >= steps) {
      ai.wanderLeft--; // keep curving while the curve is also safe
    } else if (ai.rng() < ai.wanderChance) {
      const dir = ai.rng() < 0.5 ? -1 : 1;
      ai.turn = dir * (0.35 + ai.rng() * 0.65);
      ai.wanderLeft = 4 + Math.floor(ai.rng() * 14);
    } else {
      ai.turn = 0;
      ai.wanderLeft = 0;
    }
  } else {
    // Trouble ahead: take the longest-lived manoeuvre. Ties go to whatever we
    // are already doing, then to straight, so the rider does not twitch.
    let bestIdx = 2;
    let bestScore = -1;
    for (let i = 0; i < MANEUVERS.length; i++) {
      let s = scores[i];
      if (Math.sign(MANEUVERS[i].turn) === Math.sign(ai.turn)) s += 0.5;
      if (MANEUVERS[i].turn === 0) s += 0.25;
      if (s > bestScore) {
        bestScore = s;
        bestIdx = i;
      }
    }
    ai.turn = MANEUVERS[bestIdx].turn;
    ai.wanderLeft = 0;
  }
  p.turn = ai.turn;
}

/* Steps survived (0..steps) following manoeuvre m from p's current state. */
function survive(world, p, m, steps) {
  let x = p.x;
  let y = p.y;
  let h = p.heading;
  const holdSteps = Math.round(m.hold / STEP);
  const side = HEAD_RADIUS * 0.8;
  for (let i = 0; i < steps; i++) {
    const t = i < holdSteps ? m.turn : 0;
    h += t * world.turnRate * STEP;
    x += Math.cos(h) * SPEED * STEP;
    y += Math.sin(h) * SPEED * STEP;
    if (world.blockedAt(x, y, p.slot)) return i;
    // Shoulders, so a trail grazing the side counts too.
    const nx = -Math.sin(h) * side;
    const ny = Math.cos(h) * side;
    if (world.blockedAt(x + nx, y + ny, p.slot)) return i;
    if (world.blockedAt(x - nx, y - ny, p.slot)) return i;
  }
  return steps;
}
