/*
 * marker.js — "this one is you".
 *
 * Six foxes in six colours is a lovely thing to look at and a hard thing to
 * find yourself in, especially in the first second of a round when everyone
 * is still bunched near the middle and nobody has laid any trail yet. A
 * scoreboard chip in the corner tells you your colour; it does not tell you
 * which of the six specks currently sharing a patch of floor is wearing it.
 * This file draws the two things that do.
 *
 *   1. THE ARROW. A small pyramid hanging above the rider, point down, in the
 *      rider's own colour. It bobs and turns slowly so the eye catches it
 *      against an arena full of straight lines, and it is up for as long as
 *      the rider is alive. Turning is not decoration alone: a static cone
 *      seen from the play camera's near-overhead angle is a flat hexagon, and
 *      a turning one keeps reading as a solid arrow.
 *
 *   2. THE READY RING. A ring on the floor around the rider, breathing in
 *      size and brightness, up only between roundStart and go — the couple of
 *      seconds the game gives you to steer and aim before anyone moves. That
 *      is exactly the window where knowing which rider is yours matters most
 *      and where the arrow alone has the least to work with, because nothing
 *      has moved yet. On "Go!" it does not blink out; it swells and dims over
 *      RING_FADE seconds, which reads as released rather than switched off.
 *
 * WHO GETS ONE: main.js builds a marker for every player whose `kind` is
 * "human", and that one test is right in both modes. In a local match human
 * means somebody at this keyboard. In a net match js/net/shadow.js already
 * maps `mine` — the ids the host said belong to this device — onto
 * `kind: "human"` and everybody else onto "ai", so a guest marks its own
 * riders and not the four strangers sharing the arena. Two people on one
 * keyboard get two markers, in their own two colours, which is the whole
 * point of the colour being in here at all. Attract mode has no humans and
 * therefore no markers, so the paddock is never cluttered with arrows.
 *
 * WHY IT IS NOT PARENTED TO THE RIDER. Hanging these off rider.root would be
 * free — no per-frame writes at all — and wrong twice over: that node carries
 * the rider's heading and its bank, so the ring would tilt up to 16 degrees
 * off the floor through every turn, and rider.dispose() disposes its children
 * and their materials, which would leave this file's ownership of its own
 * meshes a polite fiction. It keeps its own root and takes a position
 * instead, from the same interpolated coordinates the rider model is posed
 * from, so marker and fox can never visibly disagree.
 *
 * SIZE IS FIXED, like the riders and the trails. A Vast arena is a zoom out
 * and everything in it reads smaller, the marker included; scaling it to the
 * arena would make it the one object in the scene that refuses to.
 *
 * Nothing here allocates per frame: update() writes scalars into existing
 * nodes and channel floats into existing Color3s (house rule, §10).
 */

/* The arrow, in arena units. The fox's ears reach about 1.5, so a tip at 2.1
 * clears its head without floating off on its own. */
const ARROW_TIP = 2.1;
const ARROW_HEIGHT = 0.8;
const ARROW_WIDTH = 0.75;
const ARROW_BOB = 0.16; // half the peak-to-peak wobble
const ARROW_BOB_RATE = 2.6; // radians per second
const ARROW_SPIN = 1.1; // radians per second

/* The ring. 3.2 across is a comfortable hoop around a rider 1.15 wide — big
 * enough to be a place rather than a collar, small enough that two riders
 * spawned near each other do not overlap into one shape. It sits below
 * TRAIL_HEIGHT so a trail laid across it draws over the top, which is correct:
 * the trail is the thing that kills you. */
const RING_DIAMETER = 3.2;
const RING_THICKNESS = 0.11;
const RING_Y = 0.06;
const RING_PULSE_RATE = 5.2; // radians per second
const RING_PULSE_SCALE = 0.09; // fraction of the radius, either side
const RING_FADE = 0.35; // seconds to swell and dim away on "Go!"
const RING_FADE_SWELL = 0.5; // extra scale reached by the end of that fade

export function createMarker(scene, hex) {
  const B = BABYLON;
  const colour = B.Color3.FromHexString(hex);

  const root = new B.TransformNode("marker", scene);

  /*
   * Both pieces are unlit and emissive: they are signage, not scenery, and a
   * marker that dims on the shadowed side of the arena fails at the one job
   * it has. Being opaque is deliberate too — scene.js's wall slabs document
   * what a transparent surface does to the glow layer (it blooms into a solid
   * white band), and a ring that pulses in brightness rather than in alpha
   * gets to keep the bloom instead of being excluded from it.
   */
  const arrowMat = new B.StandardMaterial("marker-arrow", scene);
  arrowMat.emissiveColor = B.Color3.Lerp(colour, B.Color3.White(), 0.35);
  arrowMat.diffuseColor = new B.Color3(0, 0, 0);
  arrowMat.specularColor = new B.Color3(0, 0, 0);
  arrowMat.disableLighting = true;

  const ringMat = new B.StandardMaterial("marker-ring", scene);
  ringMat.emissiveColor = colour.clone(); // written per frame; see update()
  ringMat.diffuseColor = new B.Color3(0, 0, 0);
  ringMat.specularColor = new B.Color3(0, 0, 0);
  ringMat.disableLighting = true;

  /* The brightest the ring ever gets, kept aside because emissiveColor above
   * is scratch that update() overwrites channel by channel. */
  const ringPeak = B.Color3.Lerp(colour, B.Color3.White(), 0.25);

  /*
   * A cylinder with no top and four sides is a square pyramid, and pointing
   * it down is what makes it an arrow rather than a hat. Four sides rather
   * than sixteen on purpose: the facets are what catch the light differently
   * as it turns, and a smooth cone would just be a blob.
   */
  const arrow = B.MeshBuilder.CreateCylinder(
    "marker-arrow",
    {
      height: ARROW_HEIGHT,
      diameterTop: ARROW_WIDTH,
      diameterBottom: 0,
      tessellation: 4,
    },
    scene,
  );
  arrow.material = arrowMat;
  arrow.isPickable = false; // nothing in this game picks
  arrow.parent = root;
  arrow.position.y = ARROW_TIP + ARROW_HEIGHT / 2;

  /* Babylon's torus already lies in the XZ plane with its axis up, so there
   * is no quarter turn to remember here. */
  const ring = B.MeshBuilder.CreateTorus(
    "marker-ring",
    {
      diameter: RING_DIAMETER,
      thickness: RING_THICKNESS,
      tessellation: 48,
    },
    scene,
  );
  ring.material = ringMat;
  ring.isPickable = false;
  ring.parent = root;
  ring.position.y = RING_Y;
  ring.setEnabled(false); // roundStart turns it on; nothing else does

  /* Ring state. `ready` is the countdown window itself; `fadeFrom` is the
   * time "Go!" arrived, or null when the ring is either fully up or fully
   * gone. Keeping the moment rather than a countdown means update() never
   * has to be told how much time passed. */
  let ready = false;
  let fadeFrom = null;

  /* Whether this rider is still riding. The arrow and the ring both go with
   * it, because a marker pointing at nothing is worse than no marker. */
  let alive = true;

  return {
    root,

    /* Sim (x, y) -> Babylon (x, 0, y), the same mapping every other renderer
     * here uses. main.js calls this from render() with the interpolated
     * position, so the marker rides with the fox rather than a tick behind
     * it. */
    setPose(x, y) {
      root.position.x = x;
      root.position.z = y;
    },

    /* Edge-triggered like rider.setAlive, and for the same reason: the caller
     * is free to hand us the sim's flag every frame. */
    setAlive(next) {
      if (next === alive) return;
      alive = next;
      root.setEnabled(next);
      if (!next) {
        // Dying during the countdown is possible in principle (a rematch
        // landing mid-round), and a ring left mid-fade would come back with
        // the rider wearing whatever scale it had reached.
        ready = false;
        fadeFrom = null;
        ring.setEnabled(false);
      }
    },

    /*
     * The countdown window. `true` at roundStart, `false` at go — main.js
     * routes both, and both are gated on actually being in a match, so the
     * attract game behind the paddock never gets one.
     */
    setReady(next, time) {
      if (next === ready) return;
      ready = next;
      if (next) {
        fadeFrom = null;
        ring.setEnabled(true);
      } else {
        // Not switched off: released. update() takes it from here and
        // disables the mesh once the swell has finished.
        fadeFrom = time;
      }
    },

    /*
     * Once a frame, with the same `time` (seconds since load) the riders bob
     * on. Everything here is a write into a node or a float already built.
     */
    update(time) {
      if (!alive) return;

      arrow.position.y =
        ARROW_TIP +
        ARROW_HEIGHT / 2 +
        ARROW_BOB * Math.sin(time * ARROW_BOB_RATE);
      arrow.rotation.y = time * ARROW_SPIN;

      if (!ring.isEnabled()) return;

      let scale = 1;
      let bright = 1;
      if (fadeFrom === null) {
        // Breathing: size and brightness on one phase, so the ring reads as
        // one thing pulsing rather than two effects sharing a mesh.
        const pulse = Math.sin(time * RING_PULSE_RATE);
        scale = 1 + RING_PULSE_SCALE * pulse;
        bright = 0.7 + 0.3 * pulse;
      } else {
        const t = (time - fadeFrom) / RING_FADE;
        if (t >= 1) {
          ring.setEnabled(false);
          fadeFrom = null;
          return;
        }
        scale = 1 + RING_FADE_SWELL * t;
        bright = 1 - t;
      }

      ring.scaling.x = scale;
      ring.scaling.z = scale;
      // Channel by channel into the Color3 the material already holds: a
      // Color3.Lerp or a scale() here would mint a new one sixty times a
      // second, per marker.
      ringMat.emissiveColor.r = ringPeak.r * bright;
      ringMat.emissiveColor.g = ringPeak.g * bright;
      ringMat.emissiveColor.b = ringPeak.b * bright;
    },

    dispose() {
      // Recurse into the two children and take their materials with them:
      // every marker mints its own, so nothing here is shared with anything
      // else and nothing else can be left holding a reference.
      root.dispose(false, true);
    },
  };
}
