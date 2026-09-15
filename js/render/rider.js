/*
 * rider.js — one player's rider: the concept cat tinted to their colour,
 * merged into a single mesh, and posed from sim coordinates every frame.
 *
 * Everything expensive happens once, at construction: build, tint, merge. What
 * the frame loop calls is setPose(), which only writes numbers into an existing
 * TransformNode — no vectors, no quaternions, no Color3s allocated per frame.
 *
 * The rider is a model with opinions and the sim has none, so this file is
 * where the two conventions meet (both are spelled out in ARCHITECTURE.md):
 * sim (x, y) becomes Babylon (x, 0, y), and the model faces -Z in its own
 * space, which is why heading needs the atan2 below rather than a plain negate.
 */

import { RIDER_SCALE } from '../config.js';
import { createBlueCat } from './blue-cat.js';

/* How far the rider banks at full steer, and how briskly it gets there. The
 * lean is pure showmanship — the sim's hitbox is a circle and never tilts. */
const LEAN_MAX = 0.28; // radians at turn = +-1
const LEAN_RATE = 9; // e-folds per second toward the target lean
const BOB_HEIGHT = 0.04; // arena units of hover wobble
const BOB_RATE = 5; // radians per second of bob

export function createRider(scene, hex) {
  const B = BABYLON;
  const colour = B.Color3.FromHexString(hex);

  /*
   * Two nodes, and the split is load-bearing. `root` is pose only: it lives in
   * arena units and takes the sim's position, heading and lean. `model` carries
   * RIDER_SCALE alone — and it is set *after* the merge, because MergeMeshes
   * bakes each source mesh's world matrix into the vertices it keeps. Scale the
   * node first and the merged geometry comes out pre-scaled, then gets scaled a
   * second time by its new parent: a rider at 0.64 instead of 0.8, with no
   * error anywhere to explain it.
   */
  const root = new B.TransformNode('rider', scene);
  const model = new B.TransformNode('rider-model', scene);
  model.parent = root;

  try {
    const cat = createBlueCat(scene);
    cat.root.parent = model;
    tint(cat.materials, colour);
    mergeUnder(model);
    // 1.44 model units of orb become ~1.15 arena units across, and the orb's
    // centre at model Y 0.78 lands just above the floor — a rider that hovers.
    model.scaling.set(RIDER_SCALE, RIDER_SCALE, RIDER_SCALE);
  } catch (err) {
    // A missing MeshBuilder call or a Babylon that isn't what we pinned. The
    // game is playable with a crude rider and unplayable with none, so say what
    // happened once and carry on. (If createBlueCat died part-built it may have
    // orphaned meshes at the origin; in practice it fails on its first call or
    // not at all.) The placeholder is authored in arena units already, so
    // `model` keeps scale 1 here.
    console.warn('rider: concept model failed, using placeholder', err);
    buildPlaceholder(scene, model, colour);
  }

  /* Lean state lives here rather than on the node so the easing can read its
   * own previous value without a getter round-trip, and so time can be clamped. */
  let lean = 0;
  let lastTime = 0;

  return {
    root,

    setPose(x, y, heading, turn, time) {
      root.position.x = x;
      root.position.z = y; // sim y is up the screen, which is Babylon +z
      root.position.y = BOB_HEIGHT * Math.sin(time * BOB_RATE);

      // The model faces -Z, so heading 0 (sim +x) must end up pointing at +x:
      // atan2(-cos h, -sin h) is that rotation, not the -h you'd write for a
      // +Z-facing model.
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
    },

    setAlive(alive) {
      // Eliminated riders vanish; the round's own trail stays as evidence.
      root.setEnabled(alive);
    },

    dispose() {
      // Recurse into children and take the materials with it: every rider mints
      // its own set of StandardMaterials in createBlueCat, so nothing is shared
      // and nothing else can be left holding a reference.
      root.dispose(false, true);
    },
  };
}

/*
 * Repaint the concept's palette in the player's colour. Only the parts that
 * read as "this rider's colour" move: fur, trim, rings, orb. The muzzle, inner
 * ear and pupils stay as authored — a cream muzzle is what makes it a cat, and
 * six identically tinted cats would be six silhouettes rather than six riders.
 */
function tint(materials, colour) {
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
 * parts ever move independently — there is no rig, and the hop and flip the
 * concept's later versions describe are not in this model.
 *
 * multiMultiMaterials keeps each material as its own submesh, which is the only
 * reason a merge is possible at all here: the model is eight materials and a
 * single-material merge would flatten it to one.
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

  // Same 1.15 across and same hover height the scaled concept model has, so the
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
