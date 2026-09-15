/*
 * scene.js — the room the game is played in: engine, camera, arena, glow.
 *
 * Everything here is scenery. It never reads the sim and the sim never hears
 * about it; main.js calls update(dt) once a frame before scene.render(), plus
 * setMode() when the game moves between the paddock and a match, and kick()
 * when something explodes. That is the whole surface (see ARCHITECTURE.md).
 *
 * The arena is a SQUARE, 60 by 60, spanning -ARENA_HALF..ARENA_HALF on both x
 * and z. That is a framing decision as much as a gameplay one: a circle wastes
 * the corners of every screen it is drawn on, and on a phone held upright it
 * wastes most of the picture. A square can be pushed out to the edges.
 *
 * The camera is deliberately not an ArcRotateCamera. Nothing here is steered
 * by the player, so a plain TargetCamera driven from four numbers — alpha
 * around the Y axis, beta down from vertical, dist from the target and tz for
 * where that target sits along z — is both smaller and easier to reason about:
 * two modes are two sets of targets, and the transition between them is one
 * exponential lerp rather than a state machine fighting an input manager.
 *
 * How far back it sits is solved rather than guessed. The old circle fit was
 * one formula with an 18% margin baked in, which is the only honest thing you
 * can do for a shape whose silhouette never changes — but it left the arena
 * floating in the middle of the screen. fitPlay() instead projects the four
 * corners by hand and bisects for the closest distance that still holds all
 * four inside 97% of the frame, then slides the target along z to centre what
 * the tilt has pushed off. It gains 5-8% in portrait and 23% in landscape,
 * where the old min(1, aspect) clamp simply stopped using the extra width.
 *
 * The arena itself is drawn once and never rebuilt: a ground plane carrying a
 * painted DynamicTexture, four glowing beams along the kill line, and four low
 * translucent slabs that say where the wall is without hiding the riders
 * behind it.
 */

import { ARENA_HALF } from "../config.js";

/* Camera geometry. Play sits nearly overhead so trails read as a map; the
 * paddock leans out and comes closer, which makes the attract match look
 * like a thing happening in a place rather than a diagram. */
const PLAY_BETA = 0.45; // radians from vertical
const ORBIT_BETA = 1.0;
const ORBIT_CLOSE = 0.7; // menu sits 30% nearer than the fitted distance
const ORBIT_SPEED = 0.12; // radians per second of slow drift
const SMOOTH = 3; // exponential lerp rate for mode transitions
const SHAKE_DECAY = 6; // per second; a kick is gone in well under a second

/* Fit tuning. FIT_LIMIT is the fraction of the half-viewport a corner may
 * reach: 0.97 is a 3% margin, enough that the rim beams never touch the edge
 * of the glass on a rounded phone screen. FIT_PASSES is how many times the
 * "centre it, then re-fit" correction runs — the centring is a linearisation,
 * so it converges in two. */
const FIT_LIMIT = 0.97;
const FIT_PASSES = 2;
const FIT_NEAR = 5; // bisection bracket: nothing usable is closer than this
const FIT_FAR = 2000;
const FIT_STEPS = 30; // halvings; the bracket ends up narrower than a micron

/* Arena furniture, all derived from the half-size so one constant moves
 * everything. The ground is 0.6 wider than the arena on each side so the wall
 * has something to stand on; the beams straddle the kill line at +0.5. */
const GROUND_SIZE = ARENA_HALF * 2 + 1.2;
const EDGE_OFFSET = ARENA_HALF + 0.5; // centre-line of each of the four edges
const EDGE_LENGTH = ARENA_HALF * 2 + 1.0; // long enough to close at the corners

export function createScene(canvas) {
  const engine = new BABYLON.Engine(canvas, true, {
    antialias: true,
    // We do our own device-pixel-ratio maths below, capped at 2 (house rule):
    // letting the engine adapt as well would square the two and cook a phone.
    adaptToDeviceRatio: false,
  });
  applyScaling();

  const scene = new BABYLON.Scene(engine);
  // Opaque: the canvas is the bottom layer of the page and nothing behind it
  // should ever show through, least of all a white flash between frames.
  scene.clearColor = new BABYLON.Color4(0.02, 0.025, 0.07, 1);

  buildBackground(scene);

  const camera = new BABYLON.TargetCamera(
    "cam",
    new BABYLON.Vector3(0, 60, -30),
    scene
  );
  camera.fov = 0.62;
  camera.minZ = 1;
  camera.maxZ = 800;
  // Built once and reused every frame: setTarget takes a Vector3, and the
  // point we look at only ever slides along z, so allocating one per frame
  // would be pure garbage.
  const focus = new BABYLON.Vector3(0, 0, 0);

  const glow = new BABYLON.GlowLayer("glow", scene, {
    mainTextureFixedSize: 512,
    blurKernelSize: 48,
  });
  glow.intensity = 0.7;

  buildLights(scene);
  buildFloor(scene);
  buildRim(scene);
  // A transparent surface run through the glow layer blooms into a solid white
  // band, so every slab of the wall is excluded here rather than in the builder.
  for (const slab of buildWall(scene)) glow.addExcludedMesh(slab);

  /* Scratch for the fit. Both of these exist so the solver can hand back more
   * than one number per call without allocating inside update() (house rule).
   * scanSxAbs/scanSyMin/scanSyMax are the corner scan's output; fit is
   * fitPlay's, rewritten in place every frame. */
  let scanSxAbs = 0;
  let scanSyMin = 0;
  let scanSyMax = 0;
  const fit = { dist: 0, tz: 0 };

  /* Camera state. alpha/beta/dist/tz are the live values; their targets live
   * in update() because half of them depend on the current viewport. */
  let mode = "play";
  let alpha = 0;
  let beta = PLAY_BETA;
  fitPlay(PLAY_BETA, viewAspect());
  let dist = fit.dist;
  let tz = fit.tz;
  let shake = 0;

  window.addEventListener("resize", onResize);

  function onResize() {
    // Recompute the scaling as well as resizing: dragging a window to a
    // second monitor changes devicePixelRatio without changing anything else.
    applyScaling();
    engine.resize();
  }

  function applyScaling() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    engine.setHardwareScalingLevel(1 / dpr);
  }

  function viewAspect() {
    const aspect = engine.getRenderWidth() / engine.getRenderHeight();
    // A hidden or zero-height canvas (an arcade iframe before layout) gives
    // Infinity or NaN here, which would poison the camera permanently.
    return isFinite(aspect) && aspect > 0 ? aspect : 1;
  }

  /*
   * Project the four arena corners and report how far out they land.
   *
   * At alpha 0 the camera sits on the -z side of the target, so the basis is
   * fixed and writable by hand: with the target at (0, 0, tz) the camera is at
   * P = (0, d·cosB, tz - d·sinB), it looks along f = (0, -cosB, sinB), its up
   * is u = (0, sinB, cosB) and its right is (1, 0, 0) — screen-up is +z, which
   * is exactly why the whole renderer can map sim (x, y) to Babylon (x, 0, y).
   *
   * For a corner Q on the floor: v = Q - P, depth = v·f, and the normalised
   * screen coordinates are sx = v.x / (depth·tanH) and sy = v·u / (depth·tanV),
   * both ±1 at the edge of the frame. Writes its three results into the scan
   * scratch above rather than returning an object — this runs a few hundred
   * times a frame.
   */
  function scanCorners(d, tzc, b, tanH, tanV) {
    const sb = Math.sin(b);
    const cb = Math.cos(b);
    const py = d * cb;
    const pz = tzc - d * sb;

    scanSxAbs = 0;
    scanSyMin = Infinity;
    scanSyMax = -Infinity;

    for (let i = 0; i < 4; i++) {
      const qx = i & 1 ? ARENA_HALF : -ARENA_HALF;
      const qz = i & 2 ? ARENA_HALF : -ARENA_HALF;
      const vy = -py; // every corner is on the floor, y = 0
      const vz = qz - pz;
      // v·f, which works out to d + (qz - tz)·sinB: the tilt makes the far
      // corners genuinely further away, and that is what the projection needs.
      const depth = -vy * cb + vz * sb;
      if (!(depth > 0.001)) {
        // Camera is level with or behind the corner. Not a fit, and the
        // divisions below would produce nonsense to bisect on.
        scanSxAbs = Infinity;
        scanSyMin = -Infinity;
        scanSyMax = Infinity;
        return;
      }
      const sx = qx / (depth * tanH);
      const sy = (vy * sb + vz * cb) / (depth * tanV);
      const ax = sx < 0 ? -sx : sx;
      if (ax > scanSxAbs) scanSxAbs = ax;
      if (sy < scanSyMin) scanSyMin = sy;
      if (sy > scanSyMax) scanSyMax = sy;
    }
  }

  /* Smallest distance at which all four corners are inside the frame, for a
   * given target offset. Everything shrinks monotonically as the camera backs
   * off, so plain bisection on the bracket is exact enough in 30 halvings and
   * cannot get stuck the way a Newton step on a piecewise max could. */
  function fitDistance(tzc, b, tanH, tanV) {
    let near = FIT_NEAR;
    let far = FIT_FAR;
    for (let i = 0; i < FIT_STEPS; i++) {
      const mid = (near + far) * 0.5;
      scanCorners(mid, tzc, b, tanH, tanV);
      const inside =
        scanSxAbs <= FIT_LIMIT &&
        scanSyMax <= FIT_LIMIT &&
        scanSyMin >= -FIT_LIMIT;
      if (inside) far = mid;
      else near = mid;
    }
    return far; // the fitting end of the bracket, never the failing one
  }

  /*
   * The exact fit: the closest the camera can sit and still show the whole
   * square, plus where to point it. Writes { dist, tz } into `fit`.
   *
   * Fitting alone is not enough. A tilted camera sees the near edge larger
   * than the far one, so the picture ends up low in the frame and the fit is
   * then paid for twice — once for the overshoot at the bottom and once for
   * the dead band at the top. So: fit, measure how far the midpoint of the
   * corners sits off centre, slide the target along z to cancel it, and fit
   * again. Moving the target +z moves the picture *down* the screen (screen-up
   * is +z), hence the sign; d·tanV/cosB converts screen units back to world z.
   */
  function fitPlay(b, aspect) {
    const tanV = Math.tan(camera.fov / 2);
    const tanH = tanV * aspect;

    let tzc = 0;
    let d = fitDistance(tzc, b, tanH, tanV);
    for (let pass = 0; pass < FIT_PASSES; pass++) {
      scanCorners(d, tzc, b, tanH, tanV);
      tzc += (((scanSyMax + scanSyMin) / 2) * d * tanV) / Math.cos(b);
      d = fitDistance(tzc, b, tanH, tanV);
    }

    fit.dist = d;
    fit.tz = tzc;
    return fit;
  }

  function update(dt) {
    // Solved fresh every frame rather than cached: it is a few hundred float
    // operations against a cache key that would have to include the viewport,
    // the fov and a beta that changes on every frame of a mode transition.
    // Always fitted at PLAY_BETA — the orbit view is a fraction of the play
    // framing, so the distance target stays still while the tilt eases over.
    fitPlay(PLAY_BETA, viewAspect());

    // Exponential lerp: frame-rate independent, and it never overshoots.
    const k = 1 - Math.exp(-dt * SMOOTH);
    let distTarget;
    let tzTarget;

    if (mode === "orbit") {
      // alpha is driven, not chased — there is no target to settle on.
      alpha += ORBIT_SPEED * dt;
      beta += (ORBIT_BETA - beta) * k;
      // Closer than the fit and aimed at the middle: the paddock is allowed to
      // crop the arena, because a menu panel is sitting over it anyway.
      distTarget = fit.dist * ORBIT_CLOSE;
      tzTarget = 0;
    } else {
      alpha += (0 - alpha) * k;
      beta += (PLAY_BETA - beta) * k;
      distTarget = fit.dist;
      tzTarget = fit.tz;
    }

    dist += (distTarget - dist) * k;
    tz += (tzTarget - tz) * k;

    // Spherical -> cartesian about the target. alpha 0 puts the camera on the
    // -z side, so screen-up is +z and screen-right is +x: exactly the sim's
    // axes, which is what lets render code map sim (x, y) to Babylon (x, 0, y).
    const sb = Math.sin(beta);
    let x = dist * sb * Math.sin(alpha);
    const y = dist * Math.cos(beta);
    let z = tz - dist * sb * Math.cos(alpha);

    if (shake > 0) {
      // Shake the camera, not the world: one jitter here is cheaper than
      // moving anything, and it reads the same. Only x/z, because bouncing
      // the height would change the framing.
      x += (Math.random() * 2 - 1) * shake;
      z += (Math.random() * 2 - 1) * shake;
      shake *= Math.exp(-dt * SHAKE_DECAY);
      if (shake < 0.005) shake = 0; // stop chasing a decimal nobody can see
    }

    // camera.position and focus are the two preallocated vectors; writing
    // through them keeps the draw loop free of `new` (house rule).
    camera.position.copyFromFloats(x, y, z);
    focus.copyFromFloats(0, 0, tz);
    camera.setTarget(focus);
  }

  function setMode(next) {
    if (next === mode) return;
    if (next === "play") {
      // The paddock has been winding alpha up for however long the menu was
      // open. Wrapped into (-PI, PI] the lerp takes the short way home
      // instead of spinning back through every turn it made.
      alpha = wrapAngle(alpha);
    }
    mode = next;
  }

  /* A kick never shortens an ongoing one: two riders crashing together
   * should feel like the bigger of the two, not like a reset. */
  function kick(amount) {
    shake = Math.max(shake, amount);
  }

  return { engine, scene, update, setMode, kick };
}

/* Into (-PI, PI]. */
function wrapAngle(a) {
  const two = Math.PI * 2;
  const t = (((a + Math.PI) % two) + two) % two - Math.PI;
  return t === -Math.PI ? Math.PI : t;
}

/*
 * Background. A full-screen Layer behind everything, carrying a painted
 * radial gradient: the clear colour alone is flat, and a gradient gives the
 * arena something to sit in. 512 square is plenty — it is stretched over the
 * viewport and has no detail to lose.
 */
function buildBackground(scene) {
  const tex = new BABYLON.DynamicTexture(
    "bgTex",
    { width: 512, height: 512 },
    scene,
    false
  );
  const ctx = tex.getContext();
  const g = ctx.createRadialGradient(256, 256, 0, 256, 256, 300);
  g.addColorStop(0, "#1a1650");
  g.addColorStop(0.55, "#0d0b2a");
  g.addColorStop(1, "#04040e");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 512, 512);
  tex.update();

  const layer = new BABYLON.Layer("bg", null, scene, true);
  layer.texture = tex;
  return layer;
}

function buildLights(scene) {
  // Sky light: the arena is lit from above and picks up a cold blue bounce
  // from below, so riders never go fully black on their underside.
  const hemi = new BABYLON.HemisphericLight(
    "hemi",
    new BABYLON.Vector3(0, 1, 0),
    scene
  );
  hemi.intensity = 0.9;
  hemi.groundColor = new BABYLON.Color3(0.05, 0.08, 0.2);

  // One directional light from above and in front of the play camera, just
  // enough to give the riders a lit side and a shadowed side.
  const dir = new BABYLON.DirectionalLight(
    "key",
    new BABYLON.Vector3(0.25, -1, 0.45),
    scene
  );
  dir.intensity = 0.5;
}

/*
 * Floor. One ground plane with a procedurally painted texture: a square grid
 * gives the eye something to judge speed and distance against, which a flat
 * fill cannot, and it agrees with the shape of the arena in a way the old
 * rings and spokes no longer would. Everything is faint on purpose — the
 * trails are the picture.
 *
 * CreateGround maps the texture once across the whole plane, and the plane is
 * 1.2 wider than the arena so the wall has something to stand on. So the
 * markings are painted inside `edge`, the arena's half-size in texture pixels,
 * which puts the grid on the playable square and the border square exactly on
 * the kill line instead of out at the mesh edge. The motif is symmetric in
 * both axes, so which way round the uvs run does not matter.
 */
function buildFloor(scene) {
  const S = 1024;
  const C = S / 2;
  const tex = new BABYLON.DynamicTexture(
    "floorTex",
    { width: S, height: S },
    scene,
    true
  );
  const ctx = tex.getContext();

  ctx.fillStyle = "#0a1128";
  ctx.fillRect(0, 0, S, S);

  // A soft lift in the middle so the floor reads as lit from above rather
  // than as a flat swatch of navy.
  const lift = ctx.createRadialGradient(C, C, 0, C, C, C);
  lift.addColorStop(0, "rgba(46, 72, 150, 0.35)");
  lift.addColorStop(1, "rgba(10, 17, 40, 0)");
  ctx.fillStyle = lift;
  ctx.fillRect(0, 0, S, S);

  const edge = (C * (ARENA_HALF * 2)) / GROUND_SIZE;

  // 12 by 12 cells across the playable 60 by 60, so a cell is 5 arena units:
  // about a second and a half of riding, which is the scale that matters.
  const step = (edge * 2) / 12;
  ctx.lineWidth = 2;
  ctx.strokeStyle = "rgba(120, 160, 255, 0.08)";
  for (let i = 0; i <= 12; i++) {
    const p = C - edge + step * i;
    ctx.beginPath();
    ctx.moveTo(p, C - edge);
    ctx.lineTo(p, C + edge);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(C - edge, p);
    ctx.lineTo(C + edge, p);
    ctx.stroke();
  }

  // The two centre axes, a touch stronger: they are the symmetry the riders
  // spawn around, and they keep the grid from reading as wallpaper.
  ctx.strokeStyle = "rgba(120, 160, 255, 0.18)";
  ctx.beginPath();
  ctx.moveTo(C, C - edge);
  ctx.lineTo(C, C + edge);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(C - edge, C);
  ctx.lineTo(C + edge, C);
  ctx.stroke();

  // The kill line, painted on the floor as well as lit by the beams above it,
  // so it still reads when the rim is off the bottom of a tilted frame.
  ctx.strokeStyle = "rgba(140, 190, 255, 0.22)";
  ctx.lineWidth = 3;
  ctx.strokeRect(C - edge, C - edge, edge * 2, edge * 2);

  tex.update();

  // Clamped: the uvs land exactly on 0 and 1 at the mesh edge, and wrapping
  // there smears the opposite edge of the canvas into a halo.
  tex.wrapU = BABYLON.Texture.CLAMP_ADDRESSMODE;
  tex.wrapV = BABYLON.Texture.CLAMP_ADDRESSMODE;

  const mat = new BABYLON.StandardMaterial("floorMat", scene);
  mat.diffuseTexture = tex;
  // A tight specular highlight is what sells the floor as a hard surface the
  // riders skim over; the emissive is just enough that it is never pure black.
  mat.specularColor = new BABYLON.Color3(0.25, 0.3, 0.4);
  mat.specularPower = 32;
  mat.emissiveColor = new BABYLON.Color3(0.02, 0.03, 0.08);

  // CreateGround already lies flat in the XZ plane facing up, so unlike the
  // disc it replaced there is no quarter turn to remember. One quad is all
  // this needs: the detail is in the texture, not in the mesh.
  const floor = BABYLON.MeshBuilder.CreateGround(
    "floor",
    { width: GROUND_SIZE, height: GROUND_SIZE, subdivisions: 1 },
    scene
  );
  floor.position.y = 0;
  floor.material = mat;
  floor.isPickable = false; // nothing in this game picks; save the scene the work
  return floor;
}

/* The rim: four fat glowing beams along the kill line, one per edge, long
 * enough to meet at the corners so the square closes. Unlit so they read as
 * neon from every angle instead of dimming on the far side. */
function buildRim(scene) {
  const mat = new BABYLON.StandardMaterial("rimMat", scene);
  mat.emissiveColor = new BABYLON.Color3(0.2, 0.85, 1.0).scale(0.8);
  mat.diffuseColor = new BABYLON.Color3(0, 0, 0);
  mat.specularColor = new BABYLON.Color3(0, 0, 0);
  mat.disableLighting = true;

  const beams = [];
  for (let i = 0; i < 4; i++) {
    // One material and one box shape for all four: the two side beams are the
    // same beam given a quarter turn, which is cheaper to read than four
    // hand-written boxes and impossible to get subtly inconsistent.
    const beam = BABYLON.MeshBuilder.CreateBox(
      "rim" + i,
      { width: EDGE_LENGTH, height: 0.5, depth: 0.5 },
      scene
    );
    placeOnEdge(beam, i, 0.25);
    beam.material = mat;
    beam.isPickable = false;
    beams.push(beam);
  }
  return beams;
}

/*
 * The wall: four short slabs standing on the rim. It is barely there (alpha
 * 0.12) because its whole job is to say "the arena ends here" without ever
 * coming between the camera and a rider on the far side. The slabs are
 * excluded from the glow layer by the caller — a transparent surface run
 * through glow blooms into a solid white band.
 */
function buildWall(scene) {
  const mat = new BABYLON.StandardMaterial("wallMat", scene);
  mat.emissiveColor = new BABYLON.Color3(0.2, 0.85, 1.0);
  mat.diffuseColor = new BABYLON.Color3(0, 0, 0);
  mat.specularColor = new BABYLON.Color3(0, 0, 0);
  mat.disableLighting = true;
  mat.alpha = 0.12;
  mat.backFaceCulling = false; // we stand inside it and look out through it

  const slabs = [];
  for (let i = 0; i < 4; i++) {
    const slab = BABYLON.MeshBuilder.CreateBox(
      "wall" + i,
      { width: EDGE_LENGTH, height: 1.4, depth: 0.12 },
      scene
    );
    placeOnEdge(slab, i, 0.7); // half the height, so it stands on the floor
    slab.material = mat;
    slab.isPickable = false;
    slabs.push(slab);
  }
  return slabs;
}

/* Put a box on edge i of the square: 0 and 1 lie across the -z and +z edges,
 * 2 and 3 are the same box turned a quarter turn onto the -x and +x edges. */
function placeOnEdge(mesh, i, y) {
  if (i < 2) {
    mesh.position.set(0, y, i === 0 ? -EDGE_OFFSET : EDGE_OFFSET);
  } else {
    mesh.rotation.y = Math.PI / 2;
    mesh.position.set(i === 2 ? -EDGE_OFFSET : EDGE_OFFSET, y, 0);
  }
}
