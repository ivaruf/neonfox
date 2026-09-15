/*
 * scene.js — the room the game is played in: engine, camera, arena, glow.
 *
 * Everything here is scenery. It never reads the sim and the sim never hears
 * about it; main.js calls update(dt) once a frame before scene.render(), plus
 * setMode() when the game moves between the paddock and a match, and kick()
 * when something explodes. That is the whole surface (see ARCHITECTURE.md).
 *
 * The camera is deliberately not an ArcRotateCamera. Nothing here is steered
 * by the player, so a plain TargetCamera driven from three numbers — alpha
 * around the Y axis, beta down from vertical, dist from the origin — is both
 * smaller and easier to reason about: two modes are two sets of targets, and
 * the transition between them is one exponential lerp rather than a state
 * machine fighting an input manager.
 *
 * The arena is drawn once and never rebuilt: a floor disc carrying a painted
 * DynamicTexture, a torus rim that glows, and a low translucent wall that
 * tells you where the kill line is without hiding the riders behind it.
 */

import { ARENA_RADIUS } from "../config.js";

/* Camera geometry. Play sits nearly overhead so trails read as a map; the
 * paddock leans out and comes closer, which makes the attract match look
 * like a thing happening in a place rather than a diagram. */
const PLAY_BETA = 0.45; // radians from vertical
const ORBIT_BETA = 1.0;
const ORBIT_CLOSE = 0.7; // menu sits 30% nearer than the fitted distance
const ORBIT_SPEED = 0.12; // radians per second of slow drift
const SMOOTH = 3; // exponential lerp rate for mode transitions
const SHAKE_DECAY = 6; // per second; a kick is gone in well under a second
const FIT_MARGIN = 1.18; // arena radii of framing, so the rim never touches the edge

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
  // Built once and reused every frame: setTarget takes a Vector3 and the
  // origin never moves, so allocating one per frame would be pure garbage.
  const origin = new BABYLON.Vector3(0, 0, 0);

  const glow = new BABYLON.GlowLayer("glow", scene, {
    mainTextureFixedSize: 512,
    blurKernelSize: 48,
  });
  glow.intensity = 0.7;

  buildLights(scene);
  buildFloor(scene);
  buildRim(scene);
  glow.addExcludedMesh(buildWall(scene));

  /* Camera state. alpha/beta/dist are the live values; the targets live in
   * update() because two of the three depend on the current viewport. */
  let mode = "play";
  let alpha = 0;
  let beta = PLAY_BETA;
  let dist = fitDistance();
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

  /* How far back the camera must sit for the whole circle to be on screen.
   * fov is the *vertical* angle (Babylon's default FOVMODE_VERTICAL_FIXED),
   * so the horizontal half-angle shrinks with the aspect ratio. Fitting to
   * min(1, aspect) lets width decide in portrait and height in landscape,
   * which is the only way one number works on a phone and a desktop. */
  function fitDistance() {
    let aspect = engine.getRenderWidth() / engine.getRenderHeight();
    // A hidden or zero-height canvas (an arcade iframe before layout) gives
    // Infinity or NaN here, which would poison the camera permanently.
    if (!isFinite(aspect) || aspect <= 0) aspect = 1;
    return (
      (ARENA_RADIUS * FIT_MARGIN) /
      (Math.tan(camera.fov / 2) * Math.min(1, aspect))
    );
  }

  function update(dt) {
    const fit = fitDistance();
    // Exponential lerp: frame-rate independent, and it never overshoots.
    const k = 1 - Math.exp(-dt * SMOOTH);

    if (mode === "orbit") {
      // alpha is driven, not chased — there is no target to settle on.
      alpha += ORBIT_SPEED * dt;
      beta += (ORBIT_BETA - beta) * k;
      dist += (fit * ORBIT_CLOSE - dist) * k;
    } else {
      alpha += (0 - alpha) * k;
      beta += (PLAY_BETA - beta) * k;
      dist += (fit - dist) * k;
    }

    // Spherical -> cartesian. alpha 0 puts the camera on the -z side, so
    // screen-up is +z and screen-right is +x: exactly the sim's axes, which
    // is what lets render code map sim (x, y) straight to Babylon (x, 0, y).
    const sb = Math.sin(beta);
    let x = dist * sb * Math.sin(alpha);
    const y = dist * Math.cos(beta);
    let z = -dist * sb * Math.cos(alpha);

    if (shake > 0) {
      // Shake the camera, not the world: one jitter here is cheaper than
      // moving anything, and it reads the same. Only x/z, because bouncing
      // the height would change the framing.
      x += (Math.random() * 2 - 1) * shake;
      z += (Math.random() * 2 - 1) * shake;
      shake *= Math.exp(-dt * SHAKE_DECAY);
      if (shake < 0.005) shake = 0; // stop chasing a decimal nobody can see
    }

    // camera.position is itself the one preallocated vector; writing through
    // it keeps the draw loop free of `new` (house rule).
    camera.position.copyFromFloats(x, y, z);
    camera.setTarget(origin);
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
 * Floor. One disc with a procedurally painted texture: rings and spokes give
 * the eye something to judge speed and distance against, which a flat fill
 * cannot. They are faint on purpose — the trails are the picture.
 *
 * CreateDisc maps the texture across the disc's bounding square, so painting
 * centred on the canvas puts the rings concentric with the arena.
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

  // A soft lift in the middle so the disc reads as curved under the lights.
  const lift = ctx.createRadialGradient(C, C, 0, C, C, C);
  lift.addColorStop(0, "rgba(46, 72, 150, 0.35)");
  lift.addColorStop(1, "rgba(10, 17, 40, 0)");
  ctx.fillStyle = lift;
  ctx.fillRect(0, 0, S, S);

  // The disc is slightly larger than the arena so the wall has something to
  // stand on; scale the markings down by the same amount so the outermost
  // ring lands on the actual kill line rather than outside it.
  const edge = (C * ARENA_RADIUS) / (ARENA_RADIUS + 0.6);

  ctx.lineWidth = 2;
  ctx.strokeStyle = "rgba(120, 160, 255, 0.10)";
  for (let i = 1; i <= 5; i++) {
    ctx.beginPath();
    ctx.arc(C, C, (edge * i) / 5, 0, Math.PI * 2);
    ctx.stroke();
  }

  ctx.strokeStyle = "rgba(120, 160, 255, 0.06)";
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(C, C);
    ctx.lineTo(C + Math.cos(a) * edge, C + Math.sin(a) * edge);
    ctx.stroke();
  }
  tex.update();

  // Clamped: the uvs land exactly on 0 and 1 at the rim, and wrapping there
  // smears the opposite edge of the canvas into a halo.
  tex.wrapU = BABYLON.Texture.CLAMP_ADDRESSMODE;
  tex.wrapV = BABYLON.Texture.CLAMP_ADDRESSMODE;

  const mat = new BABYLON.StandardMaterial("floorMat", scene);
  mat.diffuseTexture = tex;
  // A tight specular highlight is what sells the floor as a hard surface the
  // riders skim over; the emissive is just enough that it is never pure black.
  mat.specularColor = new BABYLON.Color3(0.25, 0.3, 0.4);
  mat.specularPower = 32;
  mat.emissiveColor = new BABYLON.Color3(0.02, 0.03, 0.08);

  const floor = BABYLON.MeshBuilder.CreateDisc(
    "floor",
    {
      radius: ARENA_RADIUS + 0.6,
      tessellation: 128,
      // Double-sided so the winding of the disc never matters: flat on the
      // ground it is only ever seen from above, but this costs nothing and
      // removes a whole class of "why is the floor invisible" bug.
      sideOrientation: BABYLON.Mesh.DOUBLESIDE,
    },
    scene
  );
  // The disc is built in the XY plane; a quarter turn about X lays it down so
  // its local +y becomes world +z, matching the sim's up-the-screen axis.
  floor.rotation.x = Math.PI / 2;
  floor.position.y = 0;
  floor.material = mat;
  floor.isPickable = false; // nothing in this game picks; save the scene the work
  return floor;
}

/* The rim: a fat glowing ring on the kill line. Unlit so it reads as neon
 * from every angle instead of dimming on the far side. */
function buildRim(scene) {
  const mat = new BABYLON.StandardMaterial("rimMat", scene);
  mat.emissiveColor = new BABYLON.Color3(0.2, 0.85, 1.0).scale(0.8);
  mat.diffuseColor = new BABYLON.Color3(0, 0, 0);
  mat.specularColor = new BABYLON.Color3(0, 0, 0);
  mat.disableLighting = true;

  const rim = BABYLON.MeshBuilder.CreateTorus(
    "rim",
    {
      diameter: (ARENA_RADIUS + 0.5) * 2,
      thickness: 0.5,
      tessellation: 160,
    },
    scene
  );
  rim.position.y = 0.2;
  rim.material = mat;
  rim.isPickable = false;
  return rim;
}

/*
 * The wall: a short open cylinder standing on the rim. It is barely there
 * (alpha 0.12) because its whole job is to say "the arena ends here" without
 * ever coming between the camera and a rider on the far side. It is excluded
 * from the glow layer by the caller — a transparent surface run through glow
 * blooms into a solid white band.
 */
function buildWall(scene) {
  const mat = new BABYLON.StandardMaterial("wallMat", scene);
  mat.emissiveColor = new BABYLON.Color3(0.2, 0.85, 1.0);
  mat.diffuseColor = new BABYLON.Color3(0, 0, 0);
  mat.specularColor = new BABYLON.Color3(0, 0, 0);
  mat.disableLighting = true;
  mat.alpha = 0.12;
  mat.backFaceCulling = false; // we stand inside it and look out through it

  const wall = BABYLON.MeshBuilder.CreateCylinder(
    "wall",
    {
      diameter: (ARENA_RADIUS + 0.5) * 2,
      height: 1.4,
      tessellation: 160,
      cap: BABYLON.Mesh.NO_CAP, // a lid would hide the whole game
      sideOrientation: BABYLON.Mesh.DOUBLESIDE,
    },
    scene
  );
  wall.position.y = 0.7; // half the height, so it stands on the floor
  wall.material = mat;
  wall.isPickable = false;
  return wall;
}
