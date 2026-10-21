/*
 * intro.js — the three-second sting that plays when the game opens.
 *
 * Six neon trails, one per rider colour, spiral in from beyond the edges of
 * the screen the way riders wind round an arena, meet in the middle in a
 * flash, and the logo bursts out of it. Then the logo flies to the exact box
 * it occupies on the start screen while the curtain fades, so the hand-off
 * is the logo landing in its place rather than one picture swapped for
 * another. Nothing about it is text, so it has nothing to translate.
 *
 * WHAT IT MAY NOT DO
 *   - Cost anyone a run (hub §1). It only ever plays at page load, over the
 *     start screen, and any tap or key skips straight to the hand-off.
 *   - Let the skipping press through. A key is swallowed in the capture
 *     phase on window — this script runs async from the top of <body>, long
 *     before the module graph, so its listener is registered before
 *     js/ui.js's and js/input.js's and runs first — because the press that skips must not also be the
 *     start screen's Escape (which is the way out to the arcade) or Enter.
 *     A tap lands on the curtain itself, which covers every button.
 *   - Delay the game. It is a curtain over the page, not a gate in front of
 *     it: Babylon, the models and the menu boot underneath while it plays,
 *     which is mostly time the player would otherwise spend watching a
 *     dark canvas fill in.
 *   - Play for someone who has asked for less motion. prefers-reduced-motion
 *     means the script does nothing at all.
 *
 * A classic script, self-contained, importing nothing, for the reason
 * touch-guard.js and screen.js stand apart: if anything in the module graph
 * fails, the curtain must still lift. Every frame runs inside a try, a hard
 * timeout removes the curtain whatever happens, and a failure of this file
 * leaves the game exactly as it was without it.
 *
 * Canvas 2D, devicePixelRatio capped at 2, paths precomputed once and no
 * allocation in the frame loop (hub §10).
 */
(function () {
  "use strict";

  try {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  } catch (e) {
    /* No matchMedia: play it. */
  }

  // The six rider colours, in js/config.js PALETTE order. Copied rather than
  // imported because this file imports nothing; if the palette changes, the
  // sting simply keeps the old colours until somebody updates this line.
  var COLOURS = ["#3aa0ff", "#ff5fb4", "#5cf07a", "#ffa03c", "#7838e8", "#ed3038"];
  var GROUND = "#0a1030";
  var RIM = "#46e6ff";

  // The timeline, in milliseconds. SPIRAL: the riders wind in. FLASH: they
  // meet. LOGO: it bursts out of the flash with an overshoot. LAND starts the
  // hand-off, which takes LAND_MS (or SKIP_MS when the player skipped).
  var SPIRAL = 1250;
  var FLASH = 1250;
  var LOGO_IN = 1300;
  var LOGO_MS = 520;
  var LAND = 2350;
  var LAND_MS = 650;
  var SKIP_MS = 380;

  // Each trail is a spiral sampled at STEPS points: radius shrinking from
  // well outside the screen to nothing, angle turning TURNS times, so every
  // rider comes in from its own side and the six together read as a vortex.
  var STEPS = 90;
  var TURNS = 1.15;

  var canvas = document.createElement("canvas");
  canvas.id = "intro";
  canvas.setAttribute("aria-hidden", "true");
  var ctx = canvas.getContext("2d");
  if (!ctx) return;

  var logo = new Image();
  logo.src = "art/logo.webp";

  var W = 0;
  var H = 0;
  var dpr = 1;
  // Unit spirals: x, y per step per rider, in "radius" units scaled on draw.
  var paths = [];
  for (var r = 0; r < COLOURS.length; r++) {
    var pts = new Float32Array(STEPS * 2);
    var a0 = (r / COLOURS.length) * Math.PI * 2;
    for (var i = 0; i < STEPS; i++) {
      var u = i / (STEPS - 1);
      // Ease the radius in so the riders arrive fast and wind tight at the end.
      var rad = Math.pow(1 - u, 1.35);
      var ang = a0 + u * TURNS * Math.PI * 2 + Math.sin(u * 9 + r) * 0.08;
      pts[i * 2] = Math.cos(ang) * rad;
      pts[i * 2 + 1] = Math.sin(ang) * rad;
    }
    paths.push(pts);
  }

  function size() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth;
    H = window.innerHeight;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
  }

  function clamp01(x) {
    return x < 0 ? 0 : x > 1 ? 1 : x;
  }
  function easeOutBack(x) {
    var c = 1.9;
    return 1 + (c + 1) * Math.pow(x - 1, 3) + c * Math.pow(x - 1, 2);
  }
  function easeInOut(x) {
    return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
  }

  // The logo's box at centre stage, in CSS pixels. Big, but never wider than
  // the screen or taller than most of it.
  var stage = { x: 0, y: 0, w: 0, h: 0 };
  function stageBox() {
    var aspect = 576 / 880;
    var w = Math.min(W * 0.86, 640, (H * 0.62) / aspect);
    stage.w = w;
    stage.h = w * aspect;
    stage.x = (W - w) / 2;
    stage.y = (H - stage.h) / 2;
  }

  // Where the logo lives on the start screen. The landscape layout draws the
  // image with object-fit: contain inside a taller box, so the drawn picture
  // is worked out from the box and the artwork's own proportions rather than
  // taken from the element's rectangle as it stands.
  var target = null;
  var realLogo = null;
  function findTarget() {
    realLogo = document.querySelector("#title img");
    if (!realLogo) return null;
    // The real logo steps aside so the flying one lands on an empty spot; it
    // is given back the moment the curtain goes. Not hidden any earlier,
    // because this script runs before the menu has been parsed.
    realLogo.style.visibility = "hidden";
    var b = realLogo.getBoundingClientRect();
    if (b.width < 2 || b.height < 2) return null;
    var aspect = 576 / 880;
    var w = b.width;
    var h = w * aspect;
    if (h > b.height) {
      h = b.height;
      w = h / aspect;
    }
    return { x: b.left + (b.width - w) / 2, y: b.top + (b.height - h) / 2, w: w, h: h };
  }

  var t0 = 0;
  var landAt = LAND;
  var landMs = LAND_MS;
  var done = false;
  var raf = 0;

  function finish() {
    if (done) return;
    done = true;
    cancelAnimationFrame(raf);
    window.removeEventListener("keydown", onKey, true);
    window.removeEventListener("resize", size);
    if (realLogo) realLogo.style.visibility = "";
    if (canvas.parentNode) canvas.parentNode.removeChild(canvas);
  }

  function skip() {
    var now = performance.now() - t0;
    if (now >= landAt) return;
    landAt = now;
    landMs = SKIP_MS;
  }

  function onKey(e) {
    // Skip, and let the press go no further: see the header.
    e.preventDefault();
    e.stopImmediatePropagation();
    if (!e.repeat) skip();
  }

  function drawTrails(t, fade) {
    var p = clamp01(t / SPIRAL);
    var head = Math.max(1, Math.floor(p * (STEPS - 1)));
    // The spiral starts beyond the corners, so the riders come in from off
    // screen whichever way the screen is turned.
    var R = Math.hypot(W, H) * 0.62;
    var cx = W / 2;
    var cy = H / 2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.globalCompositeOperation = "lighter";
    for (var r = 0; r < paths.length; r++) {
      var pts = paths[r];
      ctx.strokeStyle = COLOURS[r];
      // Two passes: a wide faint one for the glow, a narrow bright one for
      // the line. Cheaper than shadowBlur and it reads the same at speed.
      for (var pass = 0; pass < 2; pass++) {
        ctx.globalAlpha = (pass === 0 ? 0.22 : 0.95) * fade;
        ctx.lineWidth = pass === 0 ? 16 : 4;
        ctx.beginPath();
        ctx.moveTo(cx + pts[0] * R, cy + pts[1] * R);
        for (var i = 1; i <= head; i++) {
          ctx.lineTo(cx + pts[i * 2] * R, cy + pts[i * 2 + 1] * R);
        }
        ctx.stroke();
      }
      // The orb at the head of each trail.
      if (p < 1) {
        var hx = cx + pts[head * 2] * R;
        var hy = cy + pts[head * 2 + 1] * R;
        ctx.globalAlpha = 0.35 * fade;
        ctx.fillStyle = COLOURS[r];
        ctx.beginPath();
        ctx.arc(hx, hy, 13, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = fade;
        ctx.fillStyle = "#ffffff";
        ctx.beginPath();
        ctx.arc(hx, hy, 5, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
  }

  function drawFlash(t) {
    var f = (t - FLASH) / 700;
    if (f < 0 || f > 1) return;
    var cx = W / 2;
    var cy = H / 2;
    var maxR = Math.hypot(W, H) * 0.5;
    ctx.globalCompositeOperation = "lighter";
    // A ring of rim light running outwards...
    ctx.globalAlpha = (1 - f) * 0.9;
    ctx.strokeStyle = RIM;
    ctx.lineWidth = 6 * (1 - f) + 1;
    ctx.beginPath();
    ctx.arc(cx, cy, maxR * easeInOut(f) + 4, 0, Math.PI * 2);
    ctx.stroke();
    // ...and a bloom in the middle that is gone in a blink.
    var b = clamp01(1 - f * 2.5);
    if (b > 0) {
      ctx.globalAlpha = b * 0.8;
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.arc(cx, cy, 40 + 160 * f, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
  }

  function frame(now) {
    if (done) return;
    try {
      if (!t0) t0 = now;
      var t = now - t0;
      var land = clamp01((t - landAt) / landMs);
      if (land >= 1) {
        finish();
        return;
      }

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);

      // The curtain itself, which thins away during the hand-off and lets
      // the start screen show through.
      ctx.globalAlpha = 1 - easeInOut(land);
      ctx.fillStyle = GROUND;
      ctx.fillRect(0, 0, W, H);
      ctx.globalAlpha = 1;

      // Trails die off as the logo arrives, and are gone before it lands.
      var trailFade = 1 - clamp01((t - LOGO_IN) / 500);
      if (land > 0) trailFade *= 1 - clamp01(land * 3);
      if (trailFade > 0) drawTrails(t, trailFade);
      if (land === 0) drawFlash(t);

      // The logo: bursts out of the flash, rests, then flies home.
      var li = (t - LOGO_IN) / LOGO_MS;
      if (land > 0 && li < 1) li = 1; // a skip before the burst lands it whole
      if (li > 0 && logo.complete && logo.naturalWidth) {
        stageBox();
        var s = easeOutBack(clamp01(li));
        var x = stage.x + (stage.w * (1 - s)) / 2;
        var y = stage.y + (stage.h * (1 - s)) / 2;
        var w = stage.w * s;
        var h = stage.h * s;
        var alpha = clamp01(li * 2.5);
        if (land > 0) {
          if (target === null) target = findTarget() || false;
          var k = easeInOut(land);
          if (target) {
            x += (target.x - x) * k;
            y += (target.y - y) * k;
            w += (target.w - w) * k;
            h += (target.h - h) * k;
          } else {
            alpha *= 1 - k; // no logo on screen to land on: just fade
          }
        }
        ctx.globalAlpha = alpha;
        ctx.drawImage(logo, x, y, w, h);
        ctx.globalAlpha = 1;
      }
    } catch (e) {
      finish();
      return;
    }
    raf = requestAnimationFrame(frame);
  }

  function start() {
    size();
    window.addEventListener("resize", size);
    window.addEventListener("keydown", onKey, true);
    canvas.addEventListener("pointerdown", function (e) {
      e.preventDefault();
      skip();
    });
    document.body.appendChild(canvas);
    raf = requestAnimationFrame(frame);
    // Whatever happens to the frame loop, the curtain does not outstay this.
    setTimeout(finish, 6000);
  }

  // Loaded from the top of <body>, so the body exists even though the rest
  // of the page may not have been parsed yet.
  start();
})();
