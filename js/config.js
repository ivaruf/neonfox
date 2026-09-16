/*
 * config.js — every tuning number in one place.
 *
 * Units are arena units: the arena is a square, `half` each way from the
 * centre, 60 across at the classic size (see ARENA_SIZES). It was a circle
 * at first; a square fills a phone screen far better under a fixed camera.
 * A head is 0.9 wide and a trail 0.6, which is about one hundredth of the
 * arena — the same proportion as the original Kurve's pixel-wide line on a
 * 640-wide field. Speed over turn rate is the turning radius: 9 / 3.8 is
 * about 2.4 units, so a full U-turn needs some eight trail-widths of room.
 * It started at 2.6 (radius 3.5) and the first playtest wanted it tighter.
 */

/*
 * Arena sizes the menu offers. Riders, trails and speed stay the same
 * absolute size, so a bigger arena is more room and smaller riders on
 * screen — a zoom, in effect. "Classic" keeps the original proportions: a
 * head one hundredth of the arena, like Kurve's pixel on a 640-wide field.
 */
export const ARENA_SIZES = [
  { half: 18, name: "Tiny" },
  { half: 24, name: "Snug" },
  { half: 30, name: "Classic" },
  { half: 38, name: "Roomy" },
  { half: 48, name: "Vast" },
];
export const ARENA_DEFAULT = 2; // index into ARENA_SIZES
export const ARENA_HALF = ARENA_SIZES[ARENA_DEFAULT].half;

/*
 * Spawns are random, which is most of what made the original fun: nobody
 * gets the same opening twice. Riders start inside the inner SPAWN_INSET of
 * the arena, at least SPAWN_SEPARATION apart, and never pointed at a wall
 * closer than SPAWN_RUNWAY along their heading (about 1.5 s of travel).
 */
export const SPAWN_INSET = 0.8;
export const SPAWN_SEPARATION = 10;
export const SPAWN_RUNWAY = 14;

/* Simulation runs on a fixed 60 Hz tick regardless of frame rate. */
export const TICK = 1 / 60;

export const SPEED = 9; // units per second
export const TURN_RATE = 3.8; // radians per second at full steer
export const HEAD_RADIUS = 0.45; // collision radius of the orb
export const TRAIL_HALF_WIDTH = 0.3; // trail is 0.6 wide, solid all the way through

/* Gaps: after a random interval the trail stops for a fixed distance. */
export const GAP_INTERVAL = [2.0, 4.5]; // seconds of solid trail between gaps
export const GAP_LENGTH = 2.6; // units of travel with no trail (about 4 trail widths)

/*
 * Own trail younger than this many ticks is not solid to its owner. The head
 * stamps the grid where it stands, so without this every rider would die on
 * its own fresh paint. Ten ticks is 1.5 units back; at maximum turn rate the
 * head is 1.5 units away from that point, well clear of the 0.75 unit
 * contact distance, so the window can never be exploited by a hard turn.
 */
export const SELF_IGNORE_TICKS = 10;

/* Collision grid resolution. 0.1 gives a 600x600 grid, 360 KB, and a stamp
 * disc six cells wide, so the 0.15 units moved per tick never leave holes. */
export const GRID_CELL = 0.1;

/*
 * Which rider model rides. Both are codex's detailed fox and differ only in
 * what the rider does: 'gliding' crouches on a floating orb (Cruise_Wind),
 * 'running' runs on top of a ball that rolls (Run_On_Orb, twelve leg bones,
 * plus the backflip it throws when a rival dies on its trail).
 * The running one is a concept under evaluation, so this stays a one-line
 * switch until it is settled.
 */
export const RIDER_MODELS = {
  running: "models/fox-celebration.glb",
  gliding: "models/fox-detailed.glb",
};

/*
 * Clips are picked by name, never by index: the celebration model lists the
 * backflip first, so taking the first group would loop a somersault. The
 * gliding model has neither name and falls back to its only clip.
 */
export const CLIP_RUN = "Run_On_Orb";
export const CLIP_CELEBRATE = "Stream_Tag_Backflip";
export const RIDER_MODEL = RIDER_MODELS.running;

/*
 * The ball rolls without slipping: one turn per circumference travelled. The
 * model's orb is 1.44 across before RIDER_SCALE, so the radius below is what
 * turns distance into rotation. Stride follows the same speed, so the paws
 * plant on a surface moving at the speed the fox is actually going.
 */
export const ORB_RADIUS = (1.44 / 2) * 0.8; // model diameter x RIDER_SCALE
export const STRIDE_REFERENCE_SPEED = 9; // clip authored to read right at this speed

/* Spectator camera: hold a steering control this long and it spins the view
 * instead of switching it; the spin runs at SPIN_RATE while held. */
export const SPIN_HOLD_SECONDS = 0.3;
export const SPIN_RATE = 1.8; // radians per second
export const ZOOM_KEY_RATE = 1.0; // natural-log units per second while an arrow is held

/* Visual-only numbers. */
export const TRAIL_HEIGHT = 0.34;
export const TRAIL_POINT_SPACING = 0.25; // ribbon vertex spacing along the trail
export const RIDER_SCALE = 0.8; // concept model units -> arena units

/* Round flow. Kurve awards a point to every survivor whenever someone crashes,
 * and the match goes to the first past a target that scales with the field. */
export const COUNTDOWN_SECONDS = 2.2;
export const GO_FLASH_SECONDS = 0.7;
// Leave the crash burst in view before starting the spectator camera.
export const CRASH_VIEW_HOLD_SECONDS = 0.9;
export const ROUND_OVER_SECONDS = 2.6;
export const POINTS_PER_RIVAL = 5;
export const MAX_PLAYERS = 6;

/* Six riders, six colours. Names are the AI riders' names; humans are "You",
 * or "P1" and "P2" when two share a keyboard. */
// Deeper violet separates Plum from pink; Tango keeps its original orange.
export const PALETTE = [
  { name: "Bolt", hex: "#3aa0ff" },
  { name: "Mochi", hex: "#ff5fb4" },
  { name: "Kiwi", hex: "#5cf07a" },
  { name: "Tango", hex: "#ffa03c" },
  { name: "Plum", hex: "#7838e8" },
  { name: "Zippy", hex: "#ed3038" },
];
