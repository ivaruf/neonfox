/*
 * rider.js — one player's rider: the codex fox if it has arrived, the
 * procedural cat if it has not, a capsule if even that fails.
 *
 * Three tiers, and the best one available is chosen per rider at the moment
 * createRider() is called, not once per session:
 *
 *   1. the codex fox named by RIDER_MODEL in config.js — currently the running
 *      one, which runs on top of a ball instead of crouching on a floating orb.
 *      It is instantiated from an asset container that preloadRiders() fetched
 *      once, its materials cloned per rider so six foxes are six colours, and
 *      its one clip looped from a random phase at a rate derived from how fast
 *      a rider actually travels, so the paws plant on ground that is moving at
 *      their own speed rather than sliding under them.
 *   2. blue-cat.js — the procedural concept cat, tinted and merged into one
 *      mesh. This was the rider until the fox arrived and is now the safety net.
 *   3. a primitive orb and capsule, for when Babylon itself is not what we
 *      pinned.
 *
 * The ball is rolled here rather than in the clip, because only this file knows
 * how far the rider went: setPose accumulates the distance between successive
 * calls and turns OrbRoot by distance / ORB_RADIUS, which is rolling without
 * slipping and nothing more. A smooth glowing sphere spinning is
 * indistinguishable from one standing still, so the orb material also gets
 * painted panel seams — without them the roll is arithmetic nobody can see.
 *
 * Per rider rather than per session is deliberate: the fox is an 8.8 MB file,
 * so the attract match behind the title screen is usually ridden by cats for
 * its first seconds and quietly switches to foxes as riders are rebuilt after
 * the asset lands. Nothing blocks on the download, and a player who never gets
 * it gets a game rather than a spinner. (The codex also has a lower-detail
 * orange fox, earmarked for a low quality tier; it is not wired up yet.)
 *
 * Everything expensive happens once, at construction: load, clone, tint, merge.
 * What the frame loop calls is setPose(), which only writes numbers into an
 * existing TransformNode — no vectors, quaternions or Color3s per frame.
 *
 * The rider is a model with opinions and the sim has none, so this file is
 * where the two conventions meet (both are spelled out in ARCHITECTURE.md):
 * sim (x, y) becomes Babylon (x, 0, y), and a rider faces -Z in its own space,
 * which is why heading needs the atan2 below rather than a plain negate. The
 * fox is the exception and is turned to match; see buildFox().
 */

import {
  ORB_RADIUS,
  RIDER_MODEL,
  RIDER_SCALE,
  SPEED,
  STRIDE_REFERENCE_SPEED,
} from '../config.js';
import { createBlueCat } from './blue-cat.js';

/* How far the rider banks at full steer, and how briskly it gets there. The
 * lean is pure showmanship — the sim's hitbox is a circle and never tilts. */
const LEAN_MAX = 0.28; // radians at turn = +-1
const LEAN_RATE = 9; // e-folds per second toward the target lean
const BOB_HEIGHT = 0.04; // arena units of hover wobble, tiers 2 and 3 only
const BOB_RATE = 5; // radians per second of bob

/* The clip was authored to read right at STRIDE_REFERENCE_SPEED, so playing it
 * at this ratio keeps the gait tied to the speed riders actually travel. One
 * number for the whole game: every rider moves at SPEED. */
const STRIDE_RATE = SPEED / STRIDE_REFERENCE_SPEED;

/* A spawn puts the rider somewhere else entirely between one frame and the
 * next. Anything further than this in one call is a teleport, not travel, and
 * rolling it would spin the ball up like a slot machine on every respawn. */
const TELEPORT_DISTANCE = 2; // arena units in one setPose

/* Distance for one full turn of the ball. Roll wraps here so the accumulator
 * stays small: matrices are float32, and an angle that grows all match would
 * eventually quantise into a visible stutter. */
const ROLL_WRAP = 2 * Math.PI * ORB_RADIUS;

/*
 * One container for the whole game: instantiateModelsToScene() clones out of it
 * per rider, so a couple of hundred thousand vertices are parsed once no matter
 * how many riders or rounds follow. `loading` doubles as the guard against a
 * second fetch — every caller after the first gets the same promise, settled or
 * not. `seams` is the shared orb texture, painted on first use (see orbSeams).
 */
let container = null;
let loading = null;
let seams = null;
let riderCount = 0; // only to keep cloned node and material names unique

/*
 * Fetch the fox once. Resolves when riders can be built from it; rejects, after
 * saying so once, when they cannot. It never throws synchronously — a caller
 * must be able to write preloadRiders(scene).catch(...) and get on with the
 * menu, because every rejection here is survivable: the cat covers it.
 */
export function preloadRiders(scene) {
  if (loading) return loading;
  const B = BABYLON;

  // The loader is a second script tag in index.html and a separate file to
  // block or fail. Without it Babylon has no idea what a .glb is, and there is
  // nothing to retry, so fail loudly and let the caller fall through to cats.
  if (!B || !B.GLTFFileLoader) {
    console.warn(
      'rider: the glTF loader (babylonjs.loaders) is missing, riders use the procedural cat'
    );
    loading = Promise.reject(new Error('rider: babylonjs.loaders did not load'));
    return loading;
  }

  // Babylon 8 moved this to a bare function; the SceneLoader method is the
  // older spelling of the same call and still there in 8.56.2. Prefer the new
  // one, take the old one if a future build drops it the other way round.
  const cut = RIDER_MODEL.lastIndexOf('/') + 1; // the old call wants folder and file apart
  const load =
    typeof B.LoadAssetContainerAsync === 'function'
      ? () => B.LoadAssetContainerAsync(RIDER_MODEL, scene)
      : () =>
          B.SceneLoader.LoadAssetContainerAsync(
            RIDER_MODEL.slice(0, cut),
            RIDER_MODEL.slice(cut),
            scene
          );

  // Promise.resolve().then(load) rather than load(): it turns a synchronous
  // throw inside the loader into a rejection, which is what the contract
  // promises callers.
  loading = Promise.resolve()
    .then(load)
    .then((loaded) => {
      // The glTF loader starts the first animation group as it loads. Template
      // groups animate nodes that are never rendered, so stop them: the clones
      // each rider gets are started by buildFox() instead.
      if (loaded.animationGroups) {
        for (const group of loaded.animationGroups) group.stop();
      }
      container = loaded;
    })
    .catch((err) => {
      console.warn(`rider: ${RIDER_MODEL} failed to load, riders use the procedural cat`, err);
      throw err;
    });

  return loading;
}

export function createRider(scene, hex) {
  const B = BABYLON;
  const colour = B.Color3.FromHexString(hex);

  /*
   * Two nodes, and the split is load-bearing. `root` is pose only: it lives in
   * arena units and takes the sim's position, heading and lean. `model` carries
   * RIDER_SCALE alone — and for the cat it is set *after* the merge, because
   * MergeMeshes bakes each source mesh's world matrix into the vertices it
   * keeps. Scale the node first and the merged geometry comes out pre-scaled,
   * then gets scaled a second time by its new parent: a rider at 0.64 instead
   * of 0.8, with no error anywhere to explain it.
   */
  const root = new B.TransformNode('rider', scene);
  const model = new B.TransformNode('rider-model', scene);
  model.parent = root;

  let bobHeight = BOB_HEIGHT; // the fox clip bobs the body itself; see below
  let clip = null; // this rider's own clone of the run cycle
  let skeletons = null; // legs and tail; root.dispose() reaches neither
  let orbRoot = null; // the ball, rolled by hand in setPose
  let rollBase = 0; // whatever tilt the ball was authored with
  let orbMats = null; // the orb material clones, holding the shared seam texture
  let tier = 0;

  // Tier 1: the fox, if preloadRiders() has landed. All three models share the
  // orb at y 0.78 with diameter 1.44, so RIDER_SCALE is the same everywhere.
  if (container) {
    try {
      const fox = buildFox(scene, model, colour);
      clip = fox.clip;
      skeletons = fox.skeletons;
      orbRoot = fox.orbRoot;
      rollBase = fox.rollBase;
      orbMats = fox.orbMats;
      bobHeight = 0; // the clip bounces the body itself; two bobs fight
      model.scaling.set(RIDER_SCALE, RIDER_SCALE, RIDER_SCALE);
      tier = 1;
    } catch (err) {
      console.warn('rider: the fox instance failed, using the procedural cat', err);
      clearChildren(model);
    }
  }

  // Tier 2: the cat that was here first.
  if (!tier) {
    try {
      const cat = createBlueCat(scene);
      cat.root.parent = model;
      tintCat(cat.materials, colour);
      mergeUnder(model);
      // 1.44 model units of orb become ~1.15 arena units across, and the orb's
      // centre at model Y 0.78 lands just above the floor — a rider that hovers.
      model.scaling.set(RIDER_SCALE, RIDER_SCALE, RIDER_SCALE);
      tier = 2;
    } catch (err) {
      // A missing MeshBuilder call or a Babylon that isn't what we pinned. The
      // game is playable with a crude rider and unplayable with none, so say
      // what happened once and carry on. The placeholder is authored in arena
      // units already, so `model` keeps scale 1 here.
      console.warn('rider: concept model failed, using placeholder', err);
      clearChildren(model);
      buildPlaceholder(scene, model, colour);
      tier = 3;
    }
  }

  /* Lean state lives here rather than on the node so the easing can read its
   * own previous value without a getter round-trip, and so time can be clamped. */
  let lean = 0;
  let lastTime = 0;

  /* Roll state. `tracking` is false until setPose has a previous position worth
   * measuring against: at spawn, and again after any spell hidden, the first
   * call only records where the rider is. */
  let rolled = 0;
  let lastX = 0;
  let lastY = 0;
  let tracking = false;

  return {
    root,

    setPose(x, y, heading, turn, time) {
      root.position.x = x;
      root.position.z = y; // sim y is up the screen, which is Babylon +z
      root.position.y = bobHeight * Math.sin(time * BOB_RATE); // 0 for the fox

      // A rider faces -Z, so heading 0 (sim +x) must end up pointing at +x:
      // atan2(-cos h, -sin h) is that rotation, not the -h you'd write for a
      // +Z-facing model. All three tiers share this line — the fox is turned to
      // agree with it inside buildFox(), not here.
      root.rotation.y = Math.atan2(-Math.cos(heading), -Math.sin(heading));

      /*
       * Ease the bank instead of snapping it: steering is instant in the sim
       * and a rider that flicks between three angles reads as a bug. Framed in
       * elapsed time rather than frames so 120 Hz doesn't lean twice as fast as
       * 60; dt is clamped because the first call, and any tab that was
       * backgrounded, hands us a gap measured in seconds.
       *
       * Positive turn is a left turn (sim convention) and the model's own right
       * is +x, so leaning left is a positive rotation about z. One sign to flip
       * if it ever reads wrong, and it is this one.
       */
      const dt = Math.min(0.1, Math.max(0, time - lastTime));
      lastTime = time;
      lean += (turn * LEAN_MAX - lean) * (1 - Math.exp(-LEAN_RATE * dt));
      root.rotation.z = lean;

      /*
       * Roll the ball by the distance the rider covered since the last call —
       * rolling without slipping is exactly distance over radius, and measuring
       * it here rather than from SPEED means it stays true through a countdown,
       * a pause or a frame that ran long. All scalars: no Vector3 per frame.
       *
       * Sign: the fox hangs under the half-turned facing node, so inside it the
       * direction of travel is local +Z, and a positive rotation about local +X
       * carries the top of the ball toward +Z. Forward roll is therefore
       * positive, and this line is the single place to flip if it reads as
       * rolling backwards in play.
       */
      if (orbRoot) {
        const d = Math.hypot(x - lastX, y - lastY);
        lastX = x;
        lastY = y;
        if (tracking && d < TELEPORT_DISTANCE) {
          rolled += d;
          if (rolled > ROLL_WRAP) rolled -= ROLL_WRAP; // one turn is as good as none
          orbRoot.rotation.x = rollBase + rolled / ORB_RADIUS;
        }
        tracking = true; // a teleport reseeds from here rather than rolling
      }
    },

    setAlive(alive) {
      // Eliminated riders vanish; the round's own trail stays as evidence. A
      // hidden fox still costs its skinning every frame, so stop the clip too.
      root.setEnabled(alive);
      // Whatever happened while this rider was hidden — a respawn across the
      // arena, a whole round — is not travel, so the roll picks up from
      // wherever the next setPose puts it instead of catching up in one frame.
      tracking = false;
      if (clip) {
        // play(), not start(): Babylon's start() returns early on a group that
        // has already started, so it would never come back from a pause().
        if (alive) clip.play(true);
        else clip.pause();
      }
    },

    dispose() {
      // The clip and the skeletons are scene-level objects that root.dispose()
      // does not reach, and a clip left running would drive freed nodes.
      if (clip) clip.dispose();
      if (skeletons) {
        for (const skeleton of skeletons) skeleton.dispose();
      }
      // Let go of the seam texture first. root.dispose(..., true) disposes each
      // material's textures, and this one is the whole game's, not this rider's
      // — dropping the reference is what keeps the second rider's ball painted
      // after the first one is torn down.
      if (orbMats) {
        for (const mat of orbMats) mat.albedoTexture = null;
      }
      // Recurse into children and take the materials with it: every rider mints
      // or clones its own materials, so nothing is shared between riders and
      // nothing else can be left holding a reference.
      root.dispose(false, true);
    },
  };
}

/*
 * Tier 1. Clone the fox out of the preloaded container and paint it.
 */
function buildFox(scene, model, colour) {
  const B = BABYLON;
  // Clones need names of their own: instantiateModelsToScene renames as it
  // goes, and six riders sharing one set of names makes the scene inspector
  // useless exactly when someone is trying to work out which fox is wrong.
  const uid = ++riderCount;

  /*
   * doNotInstantiate asks for real clones rather than GPU instances. Instances
   * would share their materials and their skeleton, and the two things this
   * game needs per rider are precisely a colour of its own and a tail whipping
   * on its own phase. Six copies of 220k vertices is the price of that.
   */
  const inst = container.instantiateModelsToScene((name) => `${name}_${uid}`, true, {
    doNotInstantiate: true,
  });

  const fox = inst.rootNodes[0];
  if (!fox) throw new Error(`${RIDER_MODEL} instantiated with no root node`);

  /*
   * The fox's face points at +Z (glTF's convention, which Babylon's loader
   * keeps) while the cat, the placeholder and every line of setPose are written
   * for -Z. One half-turn reconciles them, and THIS is the single place to flip
   * if the fox turns out to ride backwards — not the atan2 in setPose, which
   * all three tiers share.
   */
  const facing = new B.TransformNode(`rider-facing-${uid}`, scene);
  facing.rotation.y = Math.PI;
  facing.parent = model;
  fox.parent = facing;

  /*
   * One pass over the meshes does both jobs. Nothing in this game picks, so
   * every mesh opts out of the ray tests; and a material reached from several
   * of the ~180 meshes must be tinted once, hence the Set — the clone's
   * materials are this rider's alone, but they are shared within it.
   */
  const painted = new Set();
  const orbMats = [];
  for (const mesh of fox.getChildMeshes()) {
    mesh.isPickable = false;
    const mat = mesh.material;
    if (!mat || painted.has(mat)) continue;
    painted.add(mat);
    tintFox(mat, colour);
    if ((mat.name || '').startsWith('Azure orb')) {
      // The seams are a white sheet with dark ink, and PBR multiplies albedo
      // colour by albedo texture, so every rider keeps their own colour and
      // gains the same dark panel lines. Emissive is untouched: it still glows.
      mat.albedoTexture = orbSeams(scene);
      orbMats.push(mat);
    }
  }

  /*
   * The ball, rolled by hand in setPose. startsWith because
   * instantiateModelsToScene renames every clone, and the whole OrbRoot turns
   * rather than the sphere alone: the energy rings belong to the ball, and a
   * sphere spinning inside a stationary cage reads as two objects.
   */
  const orbRoot = fox.getDescendants(false, (node) => node.name.startsWith('OrbRoot'))[0] || null;
  if (!orbRoot) console.warn('rider: no OrbRoot in the model, the ball will not roll');

  /*
   * And the thing that would otherwise waste an afternoon: the glTF loader
   * gives every node a rotationQuaternion, and a node that has one ignores its
   * Euler `rotation` completely — rotation.x would read back exactly what we
   * wrote and change nothing on screen. Convert once to Euler and drop the
   * quaternion so the roll below has somewhere to land. Safe here because no
   * channel in the clip targets OrbRoot; if one ever did, the animation would
   * put a quaternion back and the ball would quietly stop rolling.
   */
  let rollBase = 0;
  if (orbRoot) {
    if (orbRoot.rotationQuaternion) {
      orbRoot.rotation = orbRoot.rotationQuaternion.toEulerAngles();
      orbRoot.rotationQuaternion = null;
    }
    rollBase = orbRoot.rotation.x; // zero as authored, but do not assume it
  }

  /*
   * By index, not by name. The two fox models name their clip differently
   * (Cruise_Wind, Run_On_Orb) and each has exactly one, and this hub has been
   * caught before by a glTF exporter renaming a clip out from under it.
   */
  const clip = inst.animationGroups[0] || null;
  if (clip) {
    // start() takes the ratio as its second argument and would reset it to 1
    // otherwise. play() in setAlive reuses whatever is set here.
    clip.start(true, STRIDE_RATE);
    // Every rider loops the same short cycle, and six foxes running in lockstep
    // reads as a rendering bug rather than a pack. The offset is cosmetic
    // jitter, so plain Math.random is the right call here (nothing about it
    // needs to replay identically).
    clip.goToFrame(clip.from + Math.random() * (clip.to - clip.from));
  }

  return { clip, skeletons: inst.skeletons, orbRoot, rollBase, orbMats };
}

/*
 * The ball's panel seams, painted once for the whole game.
 *
 * A glowing sphere of one flat colour spins invisibly: there is nothing on it
 * to follow, so the roll computed in setPose would be arithmetic with no
 * picture attached. This is a white sheet with a dark grid of longitudes and
 * latitudes, plus a few markers so a spin about any axis is legible rather than
 * only the ones that cross a line. White because it multiplies with the
 * player's albedo colour — the ink darkens, the colour survives.
 *
 * It is identical for every rider, so it is built once and shared; the material
 * clones differ, the texture does not. dispose() detaches it before disposing a
 * rider's materials, which is what stops the first teardown taking it away from
 * everyone else.
 */
function orbSeams(scene) {
  if (seams) return seams;
  const B = BABYLON;
  const size = 512;

  // Mipmaps: the ball is maybe forty pixels across on a phone and it tumbles,
  // and 6 px lines minified without them crawl.
  const tex = new B.DynamicTexture('rider-orb-seams', { width: size, height: size }, scene, true);
  const ctx = tex.getContext();

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, size, size);

  ctx.strokeStyle = 'rgba(0, 0, 0, 0.45)';
  ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
  ctx.lineWidth = 6;
  ctx.lineCap = 'round';

  // Eight longitudes and five latitudes across the UV rectangle. On a sphere's
  // default mapping that is meridians and parallels, so the ball reads like a
  // beach ball rather than a texture swatch.
  for (let i = 0; i < 8; i++) {
    const x = ((i + 0.5) * size) / 8;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, size);
    ctx.stroke();
  }
  for (let i = 1; i <= 5; i++) {
    const y = (i * size) / 6;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(size, y);
    ctx.stroke();
  }

  // Dots in a few panels and one chevron: asymmetric marks, so a roll about the
  // axis that keeps the grid lines where they are is still obviously a roll.
  for (let i = 0; i < 4; i++) {
    ctx.beginPath();
    ctx.arc(((i * 2 + 1) * size) / 8, (i % 2 ? 2.5 : 3.5) * (size / 6), 14, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.beginPath();
  ctx.moveTo(size * 0.2, size * 0.28);
  ctx.lineTo(size * 0.3, size * 0.4);
  ctx.lineTo(size * 0.4, size * 0.28);
  ctx.stroke();

  tex.update();
  seams = tex;
  return seams;
}

/*
 * Repaint the fox in the player's colour. Only the parts that read as "this
 * rider's colour" move: the fur, its accents, the orb and its rings. Muzzle,
 * cream, eyes, suit, harness, brass and stitching are left as authored — those
 * are what make it a fox rather than a coloured blob, and six identically
 * tinted riders would be six silhouettes.
 *
 * These are PBRMaterials from the glTF loader, so the properties are
 * albedoColor and emissiveColor, not diffuse. Names are matched with
 * startsWith because instantiateModelsToScene appends a suffix to every clone,
 * and they are the cat build's names carried over: the words are wrong for a
 * fox but they are stable, which is what matching needs.
 */
function tintFox(mat, colour) {
  const B = BABYLON;
  const white = B.Color3.White();
  const name = mat.name || '';

  if (name.startsWith('Slate blue short fur')) {
    mat.albedoColor = colour.clone();
  } else if (name.startsWith('Russet fur shadows')) {
    mat.albedoColor = colour.scale(0.45); // the same colour in shadow, not a second colour
  } else if (name.startsWith('Golden fur tips')) {
    mat.albedoColor = B.Color3.Lerp(colour, white, 0.35);
  } else if (name.startsWith('Cyan accents')) {
    mat.albedoColor = B.Color3.Lerp(colour, white, 0.3);
    mat.emissiveColor = colour.scale(0.8); // trim is what the GlowLayer is for
  } else if (name.startsWith('Azure orb')) {
    mat.albedoColor = colour.scale(0.6);
    mat.emissiveColor = colour.scale(0.6); // the orb glows in the colour its trail will be
  } else if (name.startsWith('Energy rings')) {
    mat.albedoColor = B.Color3.Lerp(colour, white, 0.4);
    // Left alone on purpose: the rings carry a KHR_materials_emissive_strength
    // from the asset, which the loader turned into an emissiveIntensity. Only
    // the hue is ours; the brightness is the artist's.
    mat.emissiveColor = B.Color3.Lerp(colour, white, 0.4);
  }
}

/*
 * Tier 2's tint. Repaint the concept cat's palette in the player's colour: fur,
 * trim, rings, orb. The muzzle, inner ear and pupils stay as authored, for the
 * same reason the fox keeps its cream.
 */
function tintCat(materials, colour) {
  const B = BABYLON;
  const white = B.Color3.White();

  const fur = materials['cobalt-fur'];
  if (fur) {
    fur.diffuseColor = colour.scale(0.9); // slightly off full so the trim can out-glow it
    fur.emissiveColor = colour.scale(0.08); // enough that a rider in shadow still reads as its colour
  }

  // Trim and rings are the parts the GlowLayer is really for: bright, close to
  // white so the hue survives the bloom, and strongly emissive.
  const trim = materials['cyan-trim'];
  if (trim) {
    trim.diffuseColor = B.Color3.Lerp(colour, white, 0.35);
    trim.emissiveColor = colour.scale(0.7);
  }
  const rings = materials['orb-rings'];
  if (rings) {
    rings.diffuseColor = B.Color3.Lerp(colour, white, 0.35);
    rings.emissiveColor = colour.scale(1);
  }

  // The orb is the thing the trail pours out of, so it glows in the same colour
  // the trail will be.
  const core = materials['orb-core'];
  if (core) {
    core.diffuseColor = colour.scale(0.7);
    core.emissiveColor = colour.scale(0.6);
  }

  // The suit stays a dark silhouette — it is what stops the rider dissolving
  // into its own glow — but a hint of the colour keeps it from looking borrowed.
  const suit = materials['midnight-suit'];
  if (suit) {
    suit.diffuseColor = B.Color3.Lerp(B.Color3.FromHexString('#14243c'), colour, 0.18);
  }
}

/*
 * Fold the whole cat into one mesh. Forty-odd little spheres and tubes per
 * rider times six riders is a draw call count worth avoiding, and none of the
 * parts ever move independently — the cat has no rig at all.
 *
 * multiMultiMaterials keeps each material as its own submesh, which is the only
 * reason a merge is possible at all here: the model is eight materials and a
 * single-material merge would flatten it to one. The fox is never merged: it is
 * skinned, and merging would throw its skeleton away.
 */
function mergeUnder(model) {
  const B = BABYLON;
  try {
    // (meshes, disposeSource, allow32BitsIndices, meshSubclass, subdivideWithSubMeshes, multiMultiMaterials)
    const merged = B.Mesh.MergeMeshes(model.getChildMeshes(), true, true, undefined, false, true);
    if (!merged) {
      console.warn('rider: MergeMeshes returned nothing, keeping the loose meshes');
      return;
    }
    merged.parent = model;
    merged.isPickable = false; // nothing in this game picks; skip the ray tests
  } catch (err) {
    // A failed merge costs draw calls and nothing else: the unmerged children
    // are still parented, still tinted, and still look exactly right.
    console.warn('rider: merge failed, keeping the loose meshes', err);
  }
}

/*
 * The rider of last resort: an orb, a body and two ears, in arena units. It is
 * deliberately crude — it exists so a broken model degrades the look instead of
 * blanking the arena, and so the player can still see where they are.
 */
function buildPlaceholder(scene, under, colour) {
  const B = BABYLON;

  const glowing = new B.StandardMaterial('rider-placeholder-orb', scene);
  glowing.diffuseColor = colour.scale(0.7);
  glowing.emissiveColor = colour.scale(0.6);

  const body = new B.StandardMaterial('rider-placeholder-body', scene);
  body.diffuseColor = colour.scale(0.85);
  body.emissiveColor = colour.scale(0.2);

  // Same 1.15 across and same hover height the scaled models have, so the
  // camera, the trail and the collision radius all still agree with the picture.
  const orb = B.MeshBuilder.CreateSphere('rider-orb', { diameter: 1.15, segments: 16 }, scene);
  orb.position.y = 0.6;
  orb.material = glowing;
  orb.parent = under;
  orb.isPickable = false;

  const rider = B.MeshBuilder.CreateCapsule('rider-body', { height: 0.9, radius: 0.25 }, scene);
  rider.position.y = 1.5;
  rider.material = body;
  rider.parent = under;
  rider.isPickable = false;

  // Two dots of ear: the cheapest possible hint that this is meant to be a cat.
  for (const side of [-1, 1]) {
    const ear = B.MeshBuilder.CreateSphere('rider-ear', { diameter: 0.2, segments: 8 }, scene);
    ear.position.set(side * 0.16, 1.88, 0);
    ear.material = body;
    ear.parent = under;
    ear.isPickable = false;
  }
}

/* Clear out whatever a tier left behind when it threw halfway: half a fox
 * inside a cat is worse than either one alone. */
function clearChildren(node) {
  for (const child of node.getChildren()) child.dispose(false, true);
}
