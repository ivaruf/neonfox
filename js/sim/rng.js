/*
 * rng.js — a tiny seedable generator (mulberry32).
 *
 * The simulation draws every random number from one of these so a round can
 * be replayed from its seed. That matters once a host runs the sim for other
 * peers (fishtank's P2P shape): guests can check a snapshot against a local
 * re-run, and bug reports come with a seed. Math.random() stays fine for
 * anything cosmetic on the render side.
 */

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* Uniform float in [lo, hi). */
export function range(rng, lo, hi) {
  return lo + rng() * (hi - lo);
}
