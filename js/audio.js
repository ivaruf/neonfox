/*
 * audio.js — WebAudio blips, lazily created on first gesture.
 *
 * House rule: sound is code, not files. Every cue here is a synthesized
 * oscillator or filtered noise burst, built fresh each time rather than
 * decoded from an asset, so there is nothing to fetch and nothing a
 * blocklist can catch. The AudioContext itself is created lazily by
 * unlock(), which main.js calls on the first pointerdown/keydown, because
 * autoplay policies refuse to start audio before a user gesture; every
 * public play method silently no-ops until that has happened (or while the
 * player has muted sound), so callers never need to guard the calls
 * themselves.
 */

const SOUND_KEY = "trailblazers.sound.v1";

export class Sfx {
  constructor() {
    this._ctx = null;
    this._enabled = true;
    try {
      const stored = localStorage.getItem(SOUND_KEY);
      if (stored !== null) this._enabled = stored !== "0";
    } catch {
      // Private mode / quota errors: keep the default (enabled).
    }
  }

  get enabled() {
    return this._enabled;
  }

  setEnabled(on) {
    this._enabled = !!on;
    try {
      localStorage.setItem(SOUND_KEY, this._enabled ? "1" : "0");
    } catch {
      // Storage can be unavailable; the in-memory flag still works this
      // session, it just won't be remembered next time.
    }
  }

  /** Create (or resume) the AudioContext. Call this from a user gesture. */
  unlock() {
    try {
      if (!this._ctx) {
        const AudioCtor = window.AudioContext || window.webkitAudioContext;
        this._ctx = new AudioCtor();
      }
      if (this._ctx.state === "suspended") this._ctx.resume();
    } catch {
      // No WebAudio support, or the browser refused: every play method
      // below already checks for a live context and stays silent.
    }
  }

  /** Whether a cue is allowed to play right now. */
  #gate() {
    return this._enabled && !!this._ctx;
  }

  /**
   * One oscillator through a gain envelope: a 5 ms linear attack (starting
   * from a near-zero floor, since exponentialRampToValueAtTime cannot ramp
   * from exactly 0) up to `gain`, then an exponential decay down to 0.0001
   * by the time the tone ends. `to`, when given, glides the pitch over the
   * same span — used for the rising "go" chirp and the falling "crash".
   */
  #tone({ freq, to, dur, type = "sine", gain = 0.15, delay = 0 }) {
    const ctx = this._ctx;
    const t0 = ctx.currentTime + delay;

    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (to !== undefined) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(to, 1), t0 + dur);
    }

    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t0);
    env.gain.linearRampToValueAtTime(gain, t0 + 0.005);
    env.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

    osc.connect(env).connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  /** A short burst of band-passed white noise, same envelope shape as tone(). */
  #noise(dur, gain) {
    const ctx = this._ctx;
    const t0 = ctx.currentTime;

    const length = Math.max(1, Math.ceil(ctx.sampleRate * dur));
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;

    const src = ctx.createBufferSource();
    src.buffer = buffer;

    const filter = ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = 1200;

    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t0);
    env.gain.linearRampToValueAtTime(gain, t0 + 0.005);
    env.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

    src.connect(filter).connect(env).connect(ctx.destination);
    src.start(t0);
    src.stop(t0 + dur + 0.02);
  }

  /** UI click: a menu button or seg pill being pressed. */
  click() {
    if (!this.#gate()) return;
    this.#tone({ freq: 1400, dur: 0.04, type: "square", gain: 0.05 });
  }

  /** Countdown tick while riders aim before a round starts. */
  ready() {
    if (!this.#gate()) return;
    this.#tone({ freq: 520, dur: 0.08, type: "triangle" });
  }

  /** The round's "Go!" flash. */
  go() {
    if (!this.#gate()) return;
    this.#tone({ freq: 780, to: 1040, dur: 0.18, type: "square", gain: 0.12 });
  }

  /** A rider (human or AI) is eliminated. */
  crash() {
    if (!this.#gate()) return;
    this.#tone({ freq: 420, to: 60, dur: 0.35, type: "sawtooth", gain: 0.18 });
    this.#noise(0.25, 0.12);
  }

  /** Round over: a short rising triangle arpeggio. */
  roundWin() {
    if (!this.#gate()) return;
    const notes = [660, 880, 1320];
    notes.forEach((freq, i) => {
      this.#tone({
        freq,
        dur: 0.12,
        type: "triangle",
        gain: 0.12,
        delay: i * 0.09,
      });
    });
  }

  /** Match over: the same idea as roundWin, longer and with a final flourish. */
  matchWin() {
    if (!this.#gate()) return;
    const notes = [523, 659, 784, 1047, 1319];
    notes.forEach((freq, i) => {
      this.#tone({
        freq,
        dur: 0.16,
        type: "triangle",
        gain: 0.14,
        delay: i * 0.12,
      });
    });
    this.#tone({
      freq: 1568,
      dur: 0.4,
      type: "triangle",
      gain: 0.14,
      delay: notes.length * 0.12,
    });
  }
}
