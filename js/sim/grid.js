/*
 * grid.js — the collision world as an occupancy grid.
 *
 * Every solid trail is stamped into a square grid of cells that covers the
 * arena. Collision is then a handful of array reads per rider per tick, and
 * the AI can march a ray through the same array to see how far ahead is
 * clear. No segment lists, no spatial hashing, no geometry maths: the
 * original Kurve did exactly this against its framebuffer, and it is still
 * the simplest thing that reliably works.
 *
 * Two arrays, same indexing:
 *   owner[i]  0 for empty, otherwise the slot (1..6) of the rider who painted it
 *   stamp[i]  the tick it was painted, so a rider can ignore its own fresh paint
 *
 * First paint wins: a cell is never overwritten, so a rider crossing another
 * trail hits the older owner, which is also who the scoreboard should blame.
 */

export class Grid {
  constructor(radius, cell) {
    this.radius = radius;
    this.cell = cell;
    // One cell of padding on each side so a stamp at the very edge never
    // needs a bounds check per cell.
    this.size = Math.ceil((radius * 2) / cell) + 2;
    this.owner = new Uint8Array(this.size * this.size);
    this.stamp = new Uint32Array(this.size * this.size);
  }

  clear() {
    this.owner.fill(0);
    this.stamp.fill(0);
  }

  /* World coordinate -> cell index along one axis. */
  toCell(v) {
    return Math.floor((v + this.radius) / this.cell) + 1;
  }

  /* Flat index for a world point, or -1 outside the grid. */
  index(x, y) {
    const i = this.toCell(x);
    const j = this.toCell(y);
    if (i < 0 || j < 0 || i >= this.size || j >= this.size) return -1;
    return j * this.size + i;
  }

  /* Paint a solid disc. Compares against cell centres in world units. */
  stampDisc(x, y, r, owner, tick) {
    const cell = this.cell;
    const rc = Math.ceil(r / cell) + 1;
    const ci = this.toCell(x);
    const cj = this.toCell(y);
    const r2 = r * r;
    const i0 = Math.max(0, ci - rc);
    const i1 = Math.min(this.size - 1, ci + rc);
    const j0 = Math.max(0, cj - rc);
    const j1 = Math.min(this.size - 1, cj + rc);
    for (let j = j0; j <= j1; j++) {
      const wy = (j - 1 + 0.5) * cell - this.radius;
      const dy = wy - y;
      const row = j * this.size;
      for (let i = i0; i <= i1; i++) {
        const wx = (i - 1 + 0.5) * cell - this.radius;
        const dx = wx - x;
        if (dx * dx + dy * dy > r2) continue;
        const k = row + i;
        if (this.owner[k] !== 0) continue;
        this.owner[k] = owner;
        this.stamp[k] = tick;
      }
    }
  }

  /*
   * Who is solid at this point for rider `self`? Returns the owner slot, or 0
   * for clear. The rider's own paint younger than `ignoreTicks` is clear.
   * Points off the grid read as clear; the wall is the world's job.
   */
  blocked(x, y, self, tick, ignoreTicks) {
    const k = this.index(x, y);
    if (k < 0) return 0;
    const o = this.owner[k];
    if (o === 0) return 0;
    if (o === self && tick - this.stamp[k] < ignoreTicks) return 0;
    return o;
  }
}
