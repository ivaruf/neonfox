/*
 * trails.js — the neon ribbons, which are the thing the game is actually about.
 *
 * The sim hands us `strokes`: per rider, an array of flat [x, y, heading, ...]
 * runs, one run per unbroken piece of trail (a gap ends one and starts the
 * next). We turn each run into a raised ribbon on the floor — two sides and a
 * top, TRAIL_HEIGHT tall and TRAIL_HALF_WIDTH to each side of the sim path —
 * lit by nothing at all. The material is pure emissive with lighting disabled,
 * so the scene's GlowLayer is what makes it burn.
 *
 * The hard part is that a trail grows forever while a frame budget does not.
 * Three decisions carry the whole file:
 *
 *  1. Chunks. A ribbon is cut into meshes of CAP points, each backed by a
 *     preallocated Float32Array. A finished chunk is never touched again, so
 *     a two-minute round costs the same per frame as its first second.
 *  2. One shared index array. Indices describe slot k's relationship to slot
 *     k+1 and nothing about the geometry, so they are identical for every
 *     chunk of every rider and are built exactly once, at module load.
 *  3. Unused slots collapse. Every slot from the write cursor to CAP-1 holds
 *     the *same* point, so unused segments are zero-length (they render as
 *     nothing) and the end cap lands exactly on the current end of the trail.
 *     That is also how the live head works: while a rider is alive and
 *     painting we park the whole tail on (p.x, p.y), which the sim has not
 *     committed as a point yet, so the ribbon reaches the orb between samples
 *     instead of trailing a quarter-unit behind it.
 *
 * Babylon is the UMD global `BABYLON` (see index.html), not an import.
 * Nothing here is allocated per frame: a chunk is born at most once every
 * CAP points, everything else writes into arrays that already exist.
 */

import { TRAIL_HEIGHT, TRAIL_HALF_WIDTH } from "../config.js";

/* Points per chunk. 256 * 4 verts * 3 floats is a 12 KB upload, which is a
 * nothing-sized transfer, and at TRAIL_POINT_SPACING it is 64 arena units of
 * trail — about seven seconds of riding before a new mesh is needed. */
const CAP = 256;

const VERTS_PER_POINT = 4;
const FLOATS_PER_POINT = VERTS_PER_POINT * 3;

/* The ribbon floats a hair above the floor disc so the two never z-fight. */
const FLOOR_LIFT = 0.02;

/*
 * Indices, built once and shared by every chunk.
 *
 * Slot k owns vertices 4k..4k+3: left-bottom, left-top, right-top,
 * right-bottom. Between slot k (base b) and slot k+1 (base n) we stitch three
 * quads — left side, top, right side — six triangles in all. The floor side
 * is never drawn; nobody can see under a ribbon lying on the ground.
 *
 * Then a cap at each end so a ribbon does not read as hollow when you look
 * down its length. The start cap is slot 0's four vertices; the end cap is
 * the LAST slot's, which works precisely because unused slots collapse onto
 * the latest point (see the header) — slot CAP-1 is always the current end
 * of the ribbon, whether that end is a finished chunk or a live head.
 *
 * Winding is deliberately not thought about: the material turns back-face
 * culling off, so every triangle is double-sided.
 */
const INDICES = buildIndices();

function buildIndices() {
  const out = new Uint32Array((CAP - 1) * 18 + 12);
  let i = 0;
  for (let k = 0; k < CAP - 1; k++) {
    const b = k * 4;
    const n = b + 4;
    // left side
    out[i++] = b + 0; out[i++] = b + 1; out[i++] = n + 1;
    out[i++] = b + 0; out[i++] = n + 1; out[i++] = n + 0;
    // top
    out[i++] = b + 1; out[i++] = b + 2; out[i++] = n + 2;
    out[i++] = b + 1; out[i++] = n + 2; out[i++] = n + 1;
    // right side
    out[i++] = b + 2; out[i++] = b + 3; out[i++] = n + 3;
    out[i++] = b + 2; out[i++] = n + 3; out[i++] = n + 2;
  }
  // start cap on slot 0
  out[i++] = 0; out[i++] = 1; out[i++] = 2;
  out[i++] = 0; out[i++] = 2; out[i++] = 3;
  // end cap on slot CAP-1
  const e = (CAP - 1) * 4;
  out[i++] = e + 0; out[i++] = e + 1; out[i++] = e + 2;
  out[i++] = e + 0; out[i++] = e + 2; out[i++] = e + 3;
  return out;
}

/*
 * Write one slot's four vertices from a sim point.
 *
 * Sim y becomes Babylon z (the house convention, ARCHITECTURE.md). The ribbon
 * is offset along the left normal of the heading — in the sim plane the left
 * of (cos h, sin h) is (-sin h, cos h) — so the ribbon stays centred on the
 * path however the rider turns.
 */
function setPoint(positions, slot, x, y, h) {
  const nx = -Math.sin(h) * TRAIL_HALF_WIDTH;
  const ny = Math.cos(h) * TRAIL_HALF_WIDTH;
  let i = slot * FLOATS_PER_POINT;
  // left-bottom
  positions[i++] = x + nx; positions[i++] = FLOOR_LIFT; positions[i++] = y + ny;
  // left-top
  positions[i++] = x + nx; positions[i++] = TRAIL_HEIGHT; positions[i++] = y + ny;
  // right-top
  positions[i++] = x - nx; positions[i++] = TRAIL_HEIGHT; positions[i++] = y - ny;
  // right-bottom
  positions[i++] = x - nx; positions[i++] = FLOOR_LIFT; positions[i] = y - ny;
}

export class TrailRenderer {
  constructor(scene) {
    this._scene = scene;
    /* Bound riders and their render state, index-aligned. Both are replaced
     * wholesale by bind(); nothing else touches their length. */
    this._players = [];
    this._states = [];
    this._meshSeq = 0; // only to keep mesh names unique and readable in the inspector
  }

  /*
   * One call per match. `players` is world.players, `hexById` a Map of rider
   * id -> palette hex. Materials live for the whole match (a rider's colour
   * never changes), which is why reset() keeps them.
   */
  bind(players, hexById) {
    this.dispose();
    this._players = players;
    for (const p of players) {
      const hex = hexById.get(p.id) || "#ffffff";
      const material = new BABYLON.StandardMaterial(`trail-${p.id}`, this._scene);
      material.emissiveColor = BABYLON.Color3.FromHexString(hex);
      material.diffuseColor = BABYLON.Color3.Black(); // lighting is off; this only keeps the base dark
      material.disableLighting = true; // emissive alone, so the GlowLayer has clean input
      material.backFaceCulling = false; // ribbons are open shells and get seen from inside
      this._states.push({
        material,
        chunks: [], // finished meshes, never written again
        live: null, // the chunk currently taking points
        strokeIdx: 0, // cursor into p.strokes
        pointIdx: 0, // cursor into that stroke, in floats
      });
    }
  }

  /* New round: the arena is wiped, so every ribbon goes with it. Cursors
   * rewind because the sim replaces `strokes` wholesale in spawn(). */
  reset() {
    for (const s of this._states) {
      for (const c of s.chunks) c.mesh.dispose();
      s.chunks.length = 0;
      if (s.live) s.live.mesh.dispose();
      s.live = null;
      s.strokeIdx = 0;
      s.pointIdx = 0;
    }
  }

  /*
   * Once per frame, before the scene renders.
   *
   * `world` is the call convention (and what a snapshot-fed renderer would
   * read one day); the riders we draw are the ones handed to bind(), which is
   * the same array.
   */
  update(world) {
    for (let i = 0; i < this._players.length; i++) {
      const p = this._players[i];
      const s = this._states[i];

      // 1. Drain everything the sim has committed since last frame.
      while (s.strokeIdx < p.strokes.length) {
        const stroke = p.strokes[s.strokeIdx];
        while (s.pointIdx + 2 < stroke.length) {
          this._commit(s, stroke[s.pointIdx], stroke[s.pointIdx + 1], stroke[s.pointIdx + 2]);
          s.pointIdx += 3;
        }
        // The last stroke is the one still growing; stop on it and keep the
        // cursor there. Any earlier stroke is finished for good, so close its
        // chunk — that break in the mesh is the gap the rider flew through.
        if (s.strokeIdx === p.strokes.length - 1) break;
        this._finalize(s);
        s.strokeIdx++;
        s.pointIdx = 0;
      }

      // 2. Follow the head. The sim only samples every TRAIL_POINT_SPACING, so
      // without this the ribbon lags visibly behind the orb it comes out of.
      if (s.live) {
        const onLast = s.strokeIdx === p.strokes.length - 1;
        if (p.alive && p.drawing && onLast) {
          this._head(s, p.x, p.y, p.heading);
        } else {
          // Not painting: either a gap opened or the rider crashed. Both cases
          // already pushed the exact end point (world.js `_point(p, true)` and
          // `_kill`), so the finished ribbon ends where the collision did.
          // live goes null here, which is also the guard against re-uploading
          // a finished chunk every frame.
          this._finalize(s);
        }
      }
    }
  }

  dispose() {
    this.reset();
    for (const s of this._states) s.material.dispose();
    this._states = [];
    this._players = [];
  }

  /* --- chunk plumbing ---------------------------------------------------- */

  _newChunk(state) {
    const positions = new Float32Array(CAP * FLOATS_PER_POINT);
    const mesh = new BABYLON.Mesh(`trail-chunk-${this._meshSeq++}`, this._scene);
    const data = new BABYLON.VertexData();
    data.positions = positions;
    // Shared by every chunk of every rider. Babylon uploads it and keeps a
    // reference, so nothing may ever mutate it after buildIndices().
    data.indices = INDICES;
    // No normals and no uvs — the material ignores both when lighting is off.
    data.applyToMesh(mesh, true); // updatable positions; this is the whole trick
    mesh.material = state.material;
    mesh.isPickable = false;
    // Bounding info is computed once from a zeroed array and then never
    // refreshed (we upload positions directly), so culling would be lying.
    // Skip it entirely rather than pay to keep it honest for ~30 meshes.
    mesh.alwaysSelectAsActiveMesh = true;
    mesh.doNotSyncBoundingInfo = true;
    const chunk = { mesh, positions, count: 0, dirty: false, lx: 0, ly: 0, lh: 0 };
    state.live = chunk;
    return chunk;
  }

  /* Append one committed point. */
  _commit(state, x, y, h) {
    let c = state.live;
    if (c && c.count === CAP) c = this._rollover(state);
    else if (!c) c = this._newChunk(state);
    this._write(c, x, y, h);
  }

  /*
   * A full chunk can take no more points, so close it and open the next one
   * seeded with its final point. Without that duplicated seam point the two
   * meshes would meet with a CAP-slot-wide hole between them.
   */
  _rollover(state) {
    const old = state.live;
    const lx = old.lx;
    const ly = old.ly;
    const lh = old.lh;
    this._finalize(state);
    const next = this._newChunk(state);
    this._write(next, lx, ly, lh);
    return next;
  }

  _write(c, x, y, h) {
    setPoint(c.positions, c.count, x, y, h);
    c.count++;
    c.lx = x;
    c.ly = y;
    c.lh = h;
    c.dirty = true;
  }

  /*
   * Park every uncommitted slot on the live head, then upload. Up to 256 slots
   * of 12 floats is a few thousand writes a frame per rider — cheap enough
   * that it is not worth the bookkeeping to write fewer.
   */
  _head(state, x, y, h) {
    let c = state.live;
    // A chunk that filled up exactly on its last committed point still has to
    // follow the rider, so roll it over now rather than lag until the sim
    // happens to commit the next sample.
    if (c.count === CAP) c = this._rollover(state);
    this._fill(c, c.count, x, y, h);
    this._flush(c);
  }

  /* Close the live chunk: collapse its unused tail onto the last committed
   * point, upload one final time, and retire it. */
  _finalize(state) {
    const c = state.live;
    if (!c) return;
    this._fill(c, c.count, c.lx, c.ly, c.lh);
    this._flush(c);
    state.chunks.push(c);
    state.live = null;
  }

  _fill(c, from, x, y, h) {
    for (let k = from; k < CAP; k++) setPoint(c.positions, k, x, y, h);
    c.dirty = true;
  }

  _flush(c) {
    if (!c.dirty) return;
    c.mesh.updateVerticesData(BABYLON.VertexBuffer.PositionKind, c.positions);
    c.dirty = false;
  }
}
