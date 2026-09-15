/*
 * config.js — every tuning number in one place.
 *
 * Units are arena units: the arena is a circle of ARENA_RADIUS, so 60 across.
 * A head is 0.9 wide and a trail 0.6, which is about one hundredth of the
 * arena — the same proportion as the original Kurve's pixel-wide line on a
 * 640-wide field. Speeds and turn rates were chosen so a full U-turn takes
 * about seven trail-widths of room: tight enough to escape, wide enough that
 * you have to plan it.
 */

export const ARENA_RADIUS = 30;

/* Simulation runs on a fixed 60 Hz tick regardless of frame rate. */
export const TICK = 1 / 60;

export const SPEED = 9; // units per second
export const TURN_RATE = 2.6; // radians per second at full steer
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

/* Visual-only numbers. */
export const TRAIL_HEIGHT = 0.34;
export const TRAIL_POINT_SPACING = 0.25; // ribbon vertex spacing along the trail
export const RIDER_SCALE = 0.8; // concept model units -> arena units

/* Round flow. Kurve awards a point to every survivor whenever someone crashes,
 * and the match goes to the first past a target that scales with the field. */
export const COUNTDOWN_SECONDS = 2.2;
export const GO_FLASH_SECONDS = 0.7;
export const ROUND_OVER_SECONDS = 2.6;
export const POINTS_PER_RIVAL = 5;
export const MAX_PLAYERS = 6;

/* Six riders, six colours. Names are the AI riders' names; humans are "You",
 * or "P1" and "P2" when two share a keyboard. */
export const PALETTE = [
  { name: "Bolt", hex: "#3aa0ff" },
  { name: "Mochi", hex: "#ff5fb4" },
  { name: "Kiwi", hex: "#5cf07a" },
  { name: "Tango", hex: "#ffa03c" },
  { name: "Plum", hex: "#b07cff" },
  { name: "Zippy", hex: "#ffe14a" },
];
