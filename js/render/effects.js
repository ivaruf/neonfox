/*
 * effects.js — the one-shot sparks a rider leaves behind when it dies.
 *
 * A single entry point, burst(x, y, hex), in sim coordinates. It fires a
 * short additive particle system in the rider's own colour and then throws it
 * away: no pooling, no registry, no update() to call. Eliminations happen a
 * handful of times a round, so the simplest thing that works is the right
 * thing (§"don't over-engineer").
 *
 * The only shared state is the blob texture, painted once and handed to every
 * burst — see the dispose guard below for why keeping it alive takes a line
 * of code rather than none.
 */

export function createEffects(scene) {
  const blob = makeBlob(scene);

  /* Sim (x, y) -> Babylon (x, 0.6, y): sim y is Babylon z, and the sparks
   * start at about rider-orb height rather than in the floor. */
  function burst(x, y, hex) {
    try {
      const c = BABYLON.Color3.FromHexString(hex);

      const ps = new BABYLON.ParticleSystem("burst", 160, scene);
      ps.particleTexture = blob;
      ps.emitter = new BABYLON.Vector3(x, 0.6, y);
      // A point source: the rider was a point, so the spray should start as
      // one and get its shape from the directions below.
      ps.minEmitBox = new BABYLON.Vector3(0, 0, 0);
      ps.maxEmitBox = new BABYLON.Vector3(0, 0, 0);

      ps.color1 = new BABYLON.Color4(c.r, c.g, c.b, 1);
      // Half the sparks run hot toward white, which is what makes an additive
      // burst read as an explosion rather than as coloured confetti.
      ps.color2 = new BABYLON.Color4(
        Math.min(1, c.r * 0.5 + 0.5),
        Math.min(1, c.g * 0.5 + 0.5),
        Math.min(1, c.b * 0.5 + 0.5),
        1
      );
      ps.colorDead = new BABYLON.Color4(c.r, c.g, c.b, 0);

      ps.minSize = 0.25;
      ps.maxSize = 0.7;
      ps.minLifeTime = 0.4;
      ps.maxLifeTime = 0.9;

      // Everything at once: emitRate 0 plus a manual count is Babylon's way
      // of saying "one puff", and Babylon zeroes manualEmitCount after it
      // fires so this never repeats.
      ps.emitRate = 0;
      ps.manualEmitCount = 140;

      ps.blendMode = BABYLON.ParticleSystem.BLENDMODE_ADD;
      ps.gravity = new BABYLON.Vector3(0, -6, 0);
      // Up and out: the cone is biased upward so the sparks arc and fall back
      // through the trail rather than sliding along the floor.
      ps.direction1 = new BABYLON.Vector3(-1, 0.5, -1);
      ps.direction2 = new BABYLON.Vector3(1, 2.5, 1);
      ps.minEmitPower = 4;
      ps.maxEmitPower = 10;
      ps.updateSpeed = 0.016;

      // Stop almost immediately (there is nothing left to emit) and let
      // Babylon dispose the system once the last particle has faded.
      ps.targetStopDuration = 0.05;
      ps.disposeOnStop = true;

      // ParticleSystem.dispose() defaults to disposing its particleTexture,
      // and disposeOnStop hands the system to the scene, which calls dispose
      // with no arguments. Unguarded, the first burst would take the shared
      // blob with it and every later one would draw untextured white squares.
      const rawDispose = ps.dispose.bind(ps);
      ps.dispose = (_disposeTexture, subEmitters, endSubEmitters) =>
        rawDispose(false, subEmitters, endSubEmitters);

      ps.start();
    } catch (err) {
      // An effect is decoration. If a driver or a Babylon change breaks it,
      // the round must still play out.
      console.warn("trailblazers: burst failed", err);
    }
  }

  return { burst };
}

/*
 * The spark sprite: a white dot with a soft falloff, painted once. White so
 * every rider's colour can tint it, and soft so additive blending piles up
 * into a glow instead of a mosaic of hard discs.
 */
function makeBlob(scene) {
  const S = 64;
  const tex = new BABYLON.DynamicTexture(
    "sparkTex",
    { width: S, height: S },
    scene,
    false
  );
  const ctx = tex.getContext();
  ctx.clearRect(0, 0, S, S);
  const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0, "rgba(255, 255, 255, 1)");
  g.addColorStop(0.35, "rgba(255, 255, 255, 0.7)");
  g.addColorStop(1, "rgba(255, 255, 255, 0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  tex.update();
  tex.hasAlpha = true;
  return tex;
}
