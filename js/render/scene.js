/*
 * scene.js — the room the game is played in: engine, camera, arena, glow.
 *
 * Everything here is scenery. It never reads the sim and the sim never hears
 * about it; main.js calls update(dt) once a frame before scene.render(),
 * setMode() when the game moves between the paddock, a match and spectating,
 * setFollow() with the pose to chase, kick() when something explodes, and
 * setArena() when the size changes. That is the whole surface (see
 * ARCHITECTURE.md).
 *
 * There are three modes. 'play' is the fitted overview, 'orbit' is the slow
 * menu drift, and 'follow' is a chase camera for spectating: once every human
 * rider is out but the round is still running, there is nothing left to steer,
 * so main.js hands the steering controls to the camera instead and they cycle
 * through the survivors — being out should mean watching the ending, not
 * waiting for it. A chase view is what makes that worth watching, because a
 * trail read from behind a rider is a wall you are about to hit rather than a
 * line on a map.
 *
 * A spectator can also move the camera: spin() accumulates a yaw and a pitch
 * offset and zoom() a distance scale, which the chase applies around the rider
 * it is following and the overview applies to the whole arena. They are
 * offsets on top of each view rather than a camera of their own, so
 * resetOrbit() is all it takes to put either view back exactly where it was —
 * and while nobody is spectating they sit at their defaults and neither view
 * knows they exist.
 *
 * The arena is a SQUARE spanning -half..half on both x and z, and the half-
 * size is now chosen in the menu rather than fixed: 18 to 48 units, applied
 * before every match — attract included, so the menu previews the size live.
 * The square itself is a framing decision as much as a gameplay one: a circle
 * wastes the corners of every screen it is drawn on, and on a phone held
 * upright it wastes most of the picture. A square can be pushed out to the
 * edges, at every size it comes in.
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
 * Because it re-solves every frame from the live half-size, a change of arena
 * needs no message: the framing glides to the new size on the usual smoothing.
 *
 * The furniture — one floor, four rim beams, four wall slabs — is built by
 * buildArena(h) and torn down and rebuilt only when the size changes: at most
 * once per match start, never per frame. The three materials are made once and
 * shared across rebuilds, so a rebuild disposes meshes and repaints the floor
 * texture in place; nothing else churns.
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

/* The chase, in arena units behind and above the rider it is following. Nine
 * back and 5.5 up is a shallow enough angle to see the trail the rider is
 * about to meet, and the aim point is 5 units *ahead* of them so the rider
 * sits low in the frame with the danger above it rather than dead centre. */
const FOLLOW_BACK = 9;
const FOLLOW_HEIGHT = 5.5;
const FOLLOW_AHEAD = 5;
const FOLLOW_AIM_HEIGHT = 0.8; // just above the trails, not down at the floor

/* The same chase offset said in polar: a radius and an elevation about the
 * rider. Derived rather than typed so the two forms cannot drift apart —
 * atan2(5.5, 9) is 0.55 rad and the radius is 10.55 — and it is the polar form
 * a spectator's yaw and pitch are added to. */
const FOLLOW_ELEV = Math.atan2(FOLLOW_HEIGHT, FOLLOW_BACK);
const FOLLOW_RADIUS = Math.hypot(FOLLOW_BACK, FOLLOW_HEIGHT);

/* Limits on what a spectator can do to the camera. Pitch is an offset on the
 * base elevation of whichever view is running: down 0.35 rad still leaves the
 * chase above the trails and out of the floor, up 0.75 stops short of straight
 * overhead, where a look-at with a +y up vector has no idea which way is up.
 * The overview is clamped absolutely instead — it starts nearly overhead, so
 * the same offsets would push it through the ceiling. */
const PITCH_MIN = -0.35;
const PITCH_MAX = 0.75;
const PLAY_BETA_MIN = 0.12;
const PLAY_BETA_MAX = 1.25;
const ZOOM_MIN = 0.35; // a third of the way in
const ZOOM_MAX = 3; // three times out, enough to see the whole vast arena

/* Two lenses. The overview wants a long one so the square does not bow at the
 * corners; the chase wants a wide one so the speed reads as speed. */
const PLAY_FOV = 0.62;
const FOLLOW_FOV = 0.95;

/* How fast the camera itself moves toward where it wants to be — a separate,
 * faster smoothing than SMOOTH, which shapes the rig the overview is built
 * from. FOLLOW_SMOOTH is a real chase lag: the camera swings wide when the
 * rider turns, which is most of what makes the chase feel like a camera and
 * not a rigid boom. VIEW_SMOOTH is high enough that the overview is where the
 * fit put it as far as the eye is concerned, and low enough that handing the
 * picture back from the chase is a sweep rather than a cut. */
const FOLLOW_SMOOTH = 5;
const VIEW_SMOOTH = 12;

/* How fast the chase's idea of the rider's heading catches up with the real
 * one. Slower than the camera itself on purpose: this is the filter that
 * keeps an AI's steering twitch out of the picture entirely, rather than
 * smoothing a camera that is faithfully chasing a twitch. */
const HEAD_SMOOTH = 4;

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

/* Arena furniture, all derived from the half-size — which is a runtime value
 * now, so these are three small functions rather than three constants. The
 * ground is 0.6 wider than the arena on each side so the wall has something to
 * stand on; the beams straddle the kill line at +0.5. */
function groundSize(h) {
  return h * 2 + 1.2;
}
function edgeOffset(h) {
  return h + 0.5; // centre-line of each of the four edges
}
function edgeLength(h) {
  return h * 2 + 1.0; // long enough to close at the corners
}

/* The floor texture is square and repainted per arena size; 1024 is plenty
 * for markings this faint. */
const FLOOR_TEX = 1024;

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
  camera.fov = PLAY_FOV;
  camera.minZ = 1;
  camera.maxZ = 800;

  /* The camera's whole state, and the reason the modes can be swapped mid-
   * round without a cut: wherever the picture comes from, it arrives as a
   * position and a point to look at, and those two vectors chase their
   * desired values every frame. A mode change only changes what is desired.
   * All four are built once and written through with copyFromFloats — the
   * draw loop allocates nothing (house rule). */
  const camPos = new BABYLON.Vector3(0, 0, 0);
  const camAim = new BABYLON.Vector3(0, 0, 0);
  const desiredPos = new BABYLON.Vector3(0, 0, 0);
  const desiredAim = new BABYLON.Vector3(0, 0, 0);

  const glow = new BABYLON.GlowLayer("glow", scene, {
    mainTextureFixedSize: 512,
    blurKernelSize: 48,
  });
  glow.intensity = 0.7;

  buildLights(scene);

  /* The live half-size of the arena. It starts at the config default and is
   * replaced by setArena() when the menu picks another; everything that draws
   * or frames the arena reads this one variable, which is what lets a rebuild
   * be a local affair and the camera look after itself. */
  let half = ARENA_HALF;

  /* Materials outlive the meshes. Nothing about them depends on the size — the
   * floor's texture is repainted in place rather than replaced — so they are
   * made once here and shared by every arena that gets built, and a rebuild
   * disposes meshes only. */
  const floorTex = buildFloorTexture(scene);
  const floorMat = buildFloorMaterial(scene, floorTex);
  const rimMat = buildRimMaterial(scene);
  const wallMat = buildWallMaterial(scene);

  /* The furniture itself, replaced wholesale on every size change. */
  let floor = null;
  let beams = [];
  let slabs = [];
  buildArena(half);

  /* Scratch for the fit. Both of these exist so the solver can hand back more
   * than one number per call without allocating inside update() (house rule).
   * scanSxAbs/scanSyMin/scanSyMax are the corner scan's output; fit is
   * fitPlay's, rewritten in place every frame. */
  let scanSxAbs = 0;
  let scanSyMin = 0;
  let scanSyMax = 0;
  const fit = { dist: 0, tz: 0 };

  /* The overview rig. alpha/beta/dist/tz are the live values; their targets
   * live in update() because half of them depend on the current viewport.
   * These describe the 'play' and 'orbit' framings only — 'follow' bypasses
   * them entirely and answers with the rider's pose instead. */
  let mode = "play";
  let alpha = 0;
  let beta = PLAY_BETA;
  fitPlay(PLAY_BETA, viewAspect());
  let dist = fit.dist;
  let tz = fit.tz;
  let shake = 0;

  /* The pose being chased, in sim coordinates, last set by setFollow(). Only
   * read while the mode is 'follow'; main.js keeps it current every frame.
   *
   * followHead is that heading eased, and the camera uses it instead of the
   * real one. A rider's heading is not a camera's: an AI threading a gap
   * flips its steer every few ticks, which the rider wears as a wobble and
   * the camera would wear as a tremor — worst of all spun round to the front,
   * where every twitch swings the whole picture. Easing it costs a fraction of
   * a second of lag on a genuine turn and buys a camera that looks held.
   * headSnap makes the next setFollow() adopt a heading outright instead of
   * sweeping to it, so arriving at a rider facing the other way is a cut and
   * not a half-second orbit around them. */
  let followX = 0;
  let followY = 0;
  let followHeading = 0;
  let followHead = 0;
  let headSnap = true;

  /* The spectator's own offsets, applied by both the chase and the overview.
   * They are allowed to snap: nothing reads them but the desired position and
   * aim, and those are smoothed, so a jump here comes out as a glide. yaw is
   * deliberately never wrapped — a held spin should keep turning the same way
   * past half a turn, not reverse — and resetOrbit() unwinds it instead. */
  let yaw = 0;
  let pitch = 0;
  let zoomScale = 1;

  // Start where the fit says rather than gliding in from the origin on the
  // first frame: there is nothing to transition from when the game opens.
  sphericalInto(camPos);
  camAim.copyFromFloats(0, 0, tz);

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
   * Build the floor, the four rim beams and the four wall slabs at half-size
   * h. Runs once at startup and again from setArena(); never from the draw
   * loop, so the allocation here is not the house rule's business.
   */
  function buildArena(h) {
    // The grid keeps its twelve cells at every size, but the kill-line border
    // sits at h/(h+0.6) of the mesh, so the paint still has to follow h.
    paintFloor(floorTex, h);

    // CreateGround already lies flat in the XZ plane facing up, so unlike the
    // disc it replaced there is no quarter turn to remember. One quad is all
    // this needs: the detail is in the texture, not in the mesh.
    floor = BABYLON.MeshBuilder.CreateGround(
      "floor",
      { width: groundSize(h), height: groundSize(h), subdivisions: 1 },
      scene
    );
    floor.position.y = 0;
    floor.material = floorMat;
    floor.isPickable = false; // nothing in this game picks; save the scene the work

    beams = buildRim(scene, rimMat, h);
    slabs = buildWall(scene, wallMat, h);
    // A transparent surface run through the glow layer blooms into a solid
    // white band, so every slab is excluded — and the exclusions have to be
    // made again after every rebuild, because these are meshes the layer has
    // never seen before.
    for (const slab of slabs) glow.addExcludedMesh(slab);
  }

  /* The matching teardown: meshes go, materials and the floor texture stay.
   * Each slab leaves the glow layer's exclusion list before it is disposed —
   * a disposed mesh left in that list is a dangling reference the layer walks
   * on every frame. */
  function clearArena() {
    for (const slab of slabs) {
      glow.removeExcludedMesh(slab);
      slab.dispose();
    }
    slabs = [];
    for (const beam of beams) beam.dispose();
    beams = [];
    if (floor) {
      floor.dispose();
      floor = null;
    }
  }

  /*
   * Resize the arena. main.js calls this before every match, attract included,
   * so the menu previews the size live — at most once per match start, which
   * is why rebuilding meshes here is honest. The camera is deliberately not
   * touched: fitPlay() reads `half` afresh every frame, so the view glides out
   * to the new framing on the usual smoothing instead of cutting to it.
   */
  function setArena(h) {
    if (h === half) return;
    half = h;
    clearArena();
    buildArena(h);
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
   * times a frame. The corners come from the live `half`, so the frame after
   * setArena() is already fitting the new square.
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
      const qx = i & 1 ? half : -half;
      const qz = i & 2 ? half : -half;
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
    // PLAY_FOV, not camera.fov: the chase widens the live lens, and fitting
    // the overview against it would quietly pull the fitted distance in while
    // nobody is looking at the overview — then push it back out over a second
    // once the picture returned. The overview is always fitted for its own lens.
    const tanV = Math.tan(PLAY_FOV / 2);
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
    // the fov, the arena size and a beta that changes on every frame of a mode
    // transition. Always fitted at PLAY_BETA — the orbit view is a fraction of
    // the play framing, so the distance target stays still while the tilt eases.
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
      // The overview, plus whatever the spectator has done to it. Rotating
      // alpha turns the square within the frame, so the fitted corners can
      // leave it — the fit is solved for alpha 0 and is not re-solved per
      // angle. That is the spectator's choice to make, and the cost of the
      // alternative (fitting a rotated square every frame) buys nothing for
      // the one view that matters, which is the one at yaw 0.
      alpha += (yaw - alpha) * k;
      beta +=
        (clamp(PLAY_BETA + pitch, PLAY_BETA_MIN, PLAY_BETA_MAX) - beta) * k;
      distTarget = fit.dist * zoomScale;
      tzTarget = fit.tz;
    }

    dist += (distTarget - dist) * k;
    tz += (tzTarget - tz) * k;

    /* Where the camera wants to be this frame, and what it wants to look at.
     * The overview answers from the rig above, the chase from the pose it was
     * given; both write the same two vectors, so everything below is one
     * piece of code that never asks which mode it is in. */
    if (mode === "follow") {
      // Ease the camera's idea of which way the rider faces toward the real
      // one, the short way round: wrapped into (-PI, PI] the difference goes
      // across the seam at ±PI instead of the long way back through zero.
      const dHead = wrapAngle(followHeading - followHead);
      followHead = wrapAngle(
        followHead + dHead * (1 - Math.exp(-dt * HEAD_SMOOTH))
      );

      // Sim heading is the maths angle and sim (x, y) maps to Babylon
      // (x, 0, y), so the rider's forward along the floor is (cos h, 0, sin h).
      const fx = Math.cos(followHead);
      const fz = Math.sin(followHead);

      // The chase as a polar offset about the rider: half a turn round from
      // the way it is facing puts the camera behind it, and the spectator's
      // yaw walks round from there. At yaw 0 and pitch 0 this is exactly the
      // back-9 up-5.5 boom FOLLOW_ELEV and FOLLOW_RADIUS were derived from.
      const az = followHead + Math.PI + yaw;
      const elev = FOLLOW_ELEV + pitch;
      const r = FOLLOW_RADIUS * zoomScale;
      const flat = r * Math.cos(elev);
      desiredPos.copyFromFloats(
        followX + flat * Math.cos(az),
        r * Math.sin(elev),
        followY + flat * Math.sin(az)
      );

      // Look ahead of the rider only while the camera is actually behind it.
      // Spun round to the side or the front, cos(yaw) goes to zero or negative
      // and the aim collapses onto the rider itself — leading a rider you are
      // looking at head-on would push it out of the frame backwards.
      const lead = FOLLOW_AHEAD * Math.max(0, Math.cos(yaw));
      desiredAim.copyFromFloats(
        followX + fx * lead,
        FOLLOW_AIM_HEIGHT,
        followY + fz * lead
      );
    } else {
      sphericalInto(desiredPos);
      desiredAim.copyFromFloats(0, 0, tz);
    }

    // The one place the camera actually moves, and the reason 'follow' needs
    // no handover of its own: the vectors are wherever the last mode left
    // them, so they glide to the new desire from there. The chase lags on
    // purpose (it swings wide through a turn); the overview does not.
    const ck =
      1 - Math.exp(-dt * (mode === "follow" ? FOLLOW_SMOOTH : VIEW_SMOOTH));
    lerpInto(camPos, desiredPos, ck);
    lerpInto(camAim, desiredAim, ck);
    // fov is a plain number on the camera, so the lens changes the same way
    // everything else does: eased, never cut.
    const fovTarget = mode === "follow" ? FOLLOW_FOV : PLAY_FOV;
    camera.fov += (fovTarget - camera.fov) * ck;

    let x = camPos.x;
    const y = camPos.y;
    let z = camPos.z;

    if (shake > 0) {
      // Shake the camera, not the world: one jitter here is cheaper than
      // moving anything, and it reads the same. Only x/z, because bouncing
      // the height would change the framing. Added after the smoothing and
      // never written back into camPos — a shake the lerp could chase would
      // linger for a second instead of a fifth of one.
      x += (Math.random() * 2 - 1) * shake;
      z += (Math.random() * 2 - 1) * shake;
      shake *= Math.exp(-dt * SHAKE_DECAY);
      if (shake < 0.005) shake = 0; // stop chasing a decimal nobody can see
    }

    // camera.position and camAim are preallocated; writing through them keeps
    // the draw loop free of `new` (house rule).
    camera.position.copyFromFloats(x, y, z);
    camera.setTarget(camAim);
  }

  /* Spherical -> cartesian about the target, written into `out`. alpha 0 puts
   * the camera on the -z side, so screen-up is +z and screen-right is +x:
   * exactly the sim's axes, which is what lets render code map sim (x, y) to
   * Babylon (x, 0, y). */
  function sphericalInto(out) {
    const sb = Math.sin(beta);
    out.copyFromFloats(
      dist * sb * Math.sin(alpha),
      dist * Math.cos(beta),
      tz - dist * sb * Math.cos(alpha)
    );
  }

  /* The pose to chase, in sim coordinates; sim y is Babylon z. main.js calls
   * this every frame while spectating and it is ignored in any other mode, so
   * a stale pose left behind by a dead rider can never drag the overview. */
  function setFollow(x, y, heading) {
    followX = x;
    followY = y;
    followHeading = heading;
    if (headSnap) {
      // First pose since the stop changed: take the heading as it is rather
      // than sweeping to it from whoever we were watching before.
      followHead = heading;
      headSnap = false;
    }
  }

  /* Add to the spectator's orbit. Both arguments are deltas in radians, which
   * is what a drag and a held control both produce naturally; accumulating
   * here rather than taking absolute angles means main.js never has to hold a
   * copy of the camera's state to add to. */
  function spin(dYaw, dPitch) {
    yaw += dYaw;
    pitch = clamp(pitch + dPitch, PITCH_MIN, PITCH_MAX);
  }

  /* Multiplicative, not additive: a drag of the same length should change the
   * view by the same proportion whether it starts close in or far out. */
  function zoom(factor) {
    zoomScale = clamp(zoomScale * factor, ZOOM_MIN, ZOOM_MAX);
  }

  /* Back to the view as designed — called on every change of stop and at the
   * start of a round. alpha comes home the short way: after a long held spin
   * yaw is several turns from zero, and the overview would otherwise unwind
   * every one of them on its way back. */
  function resetOrbit() {
    yaw = 0;
    pitch = 0;
    zoomScale = 1;
    alpha = wrapAngle(alpha);
    // main.js calls this on every change of stop, which is the one moment the
    // eased heading is about to be a lie about a different rider.
    headSnap = true;
  }

  function setMode(next) {
    if (next === mode) return;
    if (mode === "orbit") {
      // The paddock has been winding alpha up for however long the menu was
      // open. Wrapped into (-PI, PI] the lerp takes the short way home
      // instead of spinning back through every turn it made.
      alpha = wrapAngle(alpha);
    }
    // Nothing else to hand over: whatever the camera was doing, its position
    // and aim are live vectors that will simply glide to whatever this mode
    // asks for next — including back out to the fit when the round restarts.
    mode = next;
  }

  /* A kick never shortens an ongoing one: two riders crashing together
   * should feel like the bigger of the two, not like a reset. */
  function kick(amount) {
    shake = Math.max(shake, amount);
  }

  return {
    engine,
    scene,
    update,
    setMode,
    setFollow,
    spin,
    zoom,
    resetOrbit,
    kick,
    setArena,
  };
}

/* Into [lo, hi]. */
function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

/* Exponential lerp of one vector toward another, in place: the whole camera
 * moves through this, so it takes no Vector3 arguments it would have to
 * allocate and returns nothing. */
function lerpInto(v, to, k) {
  v.x += (to.x - v.x) * k;
  v.y += (to.y - v.y) * k;
  v.z += (to.z - v.z) * k;
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

/* The floor's canvas. Made once and handed to paintFloor() again on every
 * size change: a DynamicTexture is a GPU texture with a 2D context in front of
 * it, and repainting that context costs a canvas upload, where recreating the
 * texture would also mean rebuilding the material that points at it. */
function buildFloorTexture(scene) {
  const tex = new BABYLON.DynamicTexture(
    "floorTex",
    { width: FLOOR_TEX, height: FLOOR_TEX },
    scene,
    true
  );
  // Clamped: the uvs land exactly on 0 and 1 at the mesh edge, and wrapping
  // there smears the opposite edge of the canvas into a halo.
  tex.wrapU = BABYLON.Texture.CLAMP_ADDRESSMODE;
  tex.wrapV = BABYLON.Texture.CLAMP_ADDRESSMODE;
  return tex;
}

function buildFloorMaterial(scene, tex) {
  const mat = new BABYLON.StandardMaterial("floorMat", scene);
  mat.diffuseTexture = tex;
  // A tight specular highlight is what sells the floor as a hard surface the
  // riders skim over; the emissive is just enough that it is never pure black.
  mat.specularColor = new BABYLON.Color3(0.25, 0.3, 0.4);
  mat.specularPower = 32;
  mat.emissiveColor = new BABYLON.Color3(0.02, 0.03, 0.08);
  return mat;
}

/*
 * Paint the floor for half-size h: a square grid gives the eye something to
 * judge speed and distance against, which a flat fill cannot, and it agrees
 * with the shape of the arena in a way the old rings and spokes no longer
 * would. Everything is faint on purpose — the trails are the picture.
 *
 * CreateGround maps the texture once across the whole plane, and the plane is
 * 1.2 wider than the arena so the wall has something to stand on. So the
 * markings are painted inside `edge`, the arena's half-size in texture pixels,
 * which puts the grid on the playable square and the border square exactly on
 * the kill line instead of out at the mesh edge. That ratio is h/(h+0.6), so
 * it shifts a little with every arena size and the paint has to be redone for
 * each one — the first fillRect covers whatever the last size left behind.
 * The motif is symmetric in both axes, so which way round the uvs run does
 * not matter.
 */
function paintFloor(tex, h) {
  const S = FLOOR_TEX;
  const C = S / 2;
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

  const edge = (C * (h * 2)) / groundSize(h);

  // 12 by 12 cells across the playable square whatever its size, so a cell is
  // h/6 units: five at the classic size, about a second and a half of riding.
  // Holding the count rather than the cell size is deliberate — the camera
  // fits the square to the screen either way, so a fixed count keeps the floor
  // looking the same in a tiny arena as in a vast one.
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
}

/* Unlit so the rim reads as neon from every angle instead of dimming on the
 * far side. One material serves every rebuild. */
function buildRimMaterial(scene) {
  const mat = new BABYLON.StandardMaterial("rimMat", scene);
  mat.emissiveColor = new BABYLON.Color3(0.2, 0.85, 1.0).scale(0.8);
  mat.diffuseColor = new BABYLON.Color3(0, 0, 0);
  mat.specularColor = new BABYLON.Color3(0, 0, 0);
  mat.disableLighting = true;
  return mat;
}

/* The rim: four fat glowing beams along the kill line of an arena of half-size
 * h, one per edge, long enough to meet at the corners so the square closes. */
function buildRim(scene, mat, h) {
  const beams = [];
  for (let i = 0; i < 4; i++) {
    // One box shape for all four: the two side beams are the same beam given a
    // quarter turn, which is cheaper to read than four hand-written boxes and
    // impossible to get subtly inconsistent.
    const beam = BABYLON.MeshBuilder.CreateBox(
      "rim" + i,
      { width: edgeLength(h), height: 0.5, depth: 0.5 },
      scene
    );
    placeOnEdge(beam, i, 0.25, h);
    beam.material = mat;
    beam.isPickable = false;
    beams.push(beam);
  }
  return beams;
}

/*
 * The wall's material. It is barely there (alpha 0.12) because its whole job
 * is to say "the arena ends here" without ever coming between the camera and a
 * rider on the far side. The slabs themselves are excluded from the glow layer
 * by buildArena() — a transparent surface run through glow blooms into a solid
 * white band — and have to be excluded again after every rebuild.
 */
function buildWallMaterial(scene) {
  const mat = new BABYLON.StandardMaterial("wallMat", scene);
  mat.emissiveColor = new BABYLON.Color3(0.2, 0.85, 1.0);
  mat.diffuseColor = new BABYLON.Color3(0, 0, 0);
  mat.specularColor = new BABYLON.Color3(0, 0, 0);
  mat.disableLighting = true;
  mat.alpha = 0.12;
  mat.backFaceCulling = false; // we stand inside it and look out through it
  return mat;
}

/* Four short slabs standing on the rim of an arena of half-size h. */
function buildWall(scene, mat, h) {
  const slabs = [];
  for (let i = 0; i < 4; i++) {
    const slab = BABYLON.MeshBuilder.CreateBox(
      "wall" + i,
      { width: edgeLength(h), height: 1.4, depth: 0.12 },
      scene
    );
    placeOnEdge(slab, i, 0.7, h); // half the height, so it stands on the floor
    slab.material = mat;
    slab.isPickable = false;
    slabs.push(slab);
  }
  return slabs;
}

/* Put a box on edge i of the square of half-size h: 0 and 1 lie across the -z
 * and +z edges, 2 and 3 are the same box turned a quarter turn onto the -x and
 * +x edges. */
function placeOnEdge(mesh, i, y, h) {
  const off = edgeOffset(h);
  if (i < 2) {
    mesh.position.set(0, y, i === 0 ? -off : off);
  } else {
    mesh.rotation.y = Math.PI / 2;
    mesh.position.set(i === 2 ? -off : off, y, 0);
  }
}
