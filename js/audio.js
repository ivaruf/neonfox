/*
 * audio.js — WebAudio blips and the looping theme, lazily created on first
 * gesture.
 *
 * House rule: sound cues are code, not files — every click/crash/win blip
 * here is a synthesized oscillator or filtered noise burst, built fresh
 * each time rather than decoded from an asset, so there is nothing to
 * fetch and nothing a blocklist can catch. The one exception is the theme
 * song, which cannot be synthesized: it is the single shipped audio file,
 * audio/theme.m4a, fetched and decoded once and looped underneath.
 *
 * This class is the whole mixer: two GainNodes hang off ctx.destination,
 * musicGain and sfxGain, one per volume slider in the menu, so a cue and
 * the theme can be balanced independently and either taken all the way to
 * silent without touching the other. Every synthesized cue connects to
 * sfxGain instead of the destination directly; the theme source connects
 * to musicGain.
 *
 * The AudioContext itself is created lazily by unlock(), which main.js
 * calls on the first pointerdown/keydown, because autoplay policies refuse
 * to start audio before a user gesture. Every public cue method silently
 * no-ops until that has happened, so callers never need to guard the calls
 * themselves; a cue at volume 0 still "plays", just inaudibly, because
 * skipping it would desync it from anything timed against it.
 */

const MUSIC_KEY = "neonfox.vol.music.v1";
const SFX_KEY = "neonfox.vol.sfx.v1";
// Pre-volume-sliders key: a single on/off toggle. Read once as a migration
// fallback (see the constructor) and never written back to.
const OLD_SOUND_KEY = "neonfox.sound.v1";

const DEFAULT_MUSIC_VOLUME = 0.6;
const DEFAULT_SFX_VOLUME = 0.8;

// A sample this quiet or quieter counts as silence when hunting for the
// theme's real start/end, rather than digital-zero noise floor.
const SILENCE_FLOOR = 1e-4;

function clamp01(v) {
  return Math.min(1, Math.max(0, v));
}

export class Sfx {
  constructor() {
    this._ctx = null;
    this._musicGain = null;
    this._sfxGain = null;
    this._themeStarted = false;
    this._themeSource = null;

    this._musicVolume = DEFAULT_MUSIC_VOLUME;
    this._sfxVolume = DEFAULT_SFX_VOLUME;

    try {
      const storedMusic = localStorage.getItem(MUSIC_KEY);
      const storedSfx = localStorage.getItem(SFX_KEY);
      if (storedMusic === null && storedSfx === null) {
        // Neither new key exists yet: this is either a fresh player, or
        // one carrying the old single mute switch forward. A player who
        // had explicitly muted the game must not have the theme come in
        // loud the next time they open it, so a "sound was off" old value
        // starts both sliders at 0 instead of the defaults above. The old
        // key is only ever read, never rewritten, so this fallback keeps
        // applying every session until the player actually touches a
        // slider and one of the new keys gets written below.
        if (localStorage.getItem(OLD_SOUND_KEY) === "0") {
          this._musicVolume = 0;
          this._sfxVolume = 0;
        }
      } else {
        if (storedMusic !== null) this._musicVolume = clamp01(Number(storedMusic));
        if (storedSfx !== null) this._sfxVolume = clamp01(Number(storedSfx));
      }
    } catch {
      // Private mode / quota errors: keep the defaults above.
    }
  }

  get musicVolume() {
    return this._musicVolume;
  }

  setMusicVolume(v) {
    this._musicVolume = clamp01(v);
    try {
      localStorage.setItem(MUSIC_KEY, String(this._musicVolume));
    } catch {
      // Storage can be unavailable; the in-memory value still applies live.
    }
    if (this._musicGain) this.#applyGain(this._musicGain, this._musicVolume);
  }

  get sfxVolume() {
    return this._sfxVolume;
  }

  setSfxVolume(v) {
    this._sfxVolume = clamp01(v);
    try {
      localStorage.setItem(SFX_KEY, String(this._sfxVolume));
    } catch {
      // Storage can be unavailable; the in-memory value still applies live.
    }
    if (this._sfxGain) this.#applyGain(this._sfxGain, this._sfxVolume);
  }

  /** Glide a gain node to a new value instead of snapping it, so a fast
   *  slider drag ramps smoothly rather than clicking on every "input". */
  #applyGain(node, value) {
    node.gain.setTargetAtTime(value, this._ctx.currentTime, 0.01);
  }

  /** Create (or resume) the AudioContext and start the theme.
   *  Call this from a user gesture. */
  unlock() {
    try {
      if (!this._ctx) {
        const AudioCtor = window.AudioContext || window.webkitAudioContext;
        this._ctx = new AudioCtor();

        this._musicGain = this._ctx.createGain();
        this._musicGain.gain.value = this._musicVolume;
        this._musicGain.connect(this._ctx.destination);

        this._sfxGain = this._ctx.createGain();
        this._sfxGain.gain.value = this._sfxVolume;
        this._sfxGain.connect(this._ctx.destination);
      }
      if (this._ctx.state === "suspended") this._ctx.resume();
    } catch {
      // No WebAudio support, or the browser refused: every play method
      // below already checks for a live context and stays silent, and the
      // theme never starts (guarded below on this._ctx existing).
      return;
    }

    // Guarded so a second unlock() (e.g. a second keydown before the user
    // ever clicks) does not fetch and start the theme twice.
    if (!this._themeStarted) {
      this._themeStarted = true;
      this.#startTheme();
    }
  }

  /**
   * Fetch, decode and loop the one shipped audio file. Fully wrapped in
   * try/catch (an async function's own internal catch, not a caller's)
   * so a failed fetch or decode can never surface as an unhandled
   * rejection on the page's crash handler — it just warns and leaves the
   * game silent but playable.
   */
  async #startTheme() {
    try {
      const response = await fetch("audio/theme.m4a");
      const data = await response.arrayBuffer();
      const buffer = await this._ctx.decodeAudioData(data);

      // AAC decoders pad the encoded stream with "priming" samples used to
      // fill the filterbank before real audio starts, and (depending on
      // the decoder) can leave true digital silence after the last real
      // sample too. theme.m4a was rendered twice, keeping only the second
      // pass, specifically so the *musical* tail is the piece's own reverb
      // trailing into the loop point rather than silence (hub CLAUDE.md
      // §9) — but the decoder's own padding sits outside that on both
      // sides, and looping the raw buffer plays it as an audible gap every
      // 90 seconds. So scan inward from both ends for the first sample
      // whose magnitude clears a small noise floor and loop only between
      // those two points. This scan is not a fixed trim: on this file
      // today Chrome's decoder measures ~0ms of head padding and ~19ms of
      // tail padding, but those numbers are a property of the decoder, not
      // of the file (Safari's AAC decoder primes differently), so the
      // bounds are found at runtime rather than hard-coded.
      const channel = buffer.getChannelData(0);
      let start = 0;
      while (start < channel.length && Math.abs(channel[start]) <= SILENCE_FLOOR) {
        start++;
      }
      let end = channel.length - 1;
      while (end > start && Math.abs(channel[end]) <= SILENCE_FLOOR) {
        end--;
      }

      const source = this._ctx.createBufferSource();
      source.buffer = buffer;
      source.loop = true;
      source.loopStart = start / buffer.sampleRate;
      // loopEnd 0 would mean "buffer end" (the Web Audio default); an
      // explicit end trims the trailing digital silence the scan above
      // found, one sample past the last audible one so it isn't clipped.
      source.loopEnd = (end + 1) / buffer.sampleRate;
      source.connect(this._musicGain);
      source.start(0);
      this._themeSource = source;
    } catch (err) {
      console.warn("NeonFox: could not load audio/theme.m4a", err);
    }
  }

  /** Whether a cue is allowed to play right now — only "is there a live
   *  context", never a volume check, so a cue at 0 is inaudible, not skipped. */
  #gate() {
    return !!this._ctx;
  }

  /**
   * One oscillator through a gain envelope: a 5 ms linear attack (starting
   * from a near-zero floor, since exponentialRampToValueAtTime cannot ramp
   * from exactly 0) up to `gain`, then an exponential decay down to 0.0001
   * by the time the tone ends. `to`, when given, glides the pitch over the
   * same span — used for the rising "go" chirp and the falling "crash".
   * Every tone routes through sfxGain, never the destination directly, so
   * the effects slider governs it.
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

    osc.connect(env).connect(this._sfxGain);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  /** A short burst of band-passed white noise, same envelope shape as tone().
   *  `delay` (seconds ahead of now) exists for taunt()'s noise-blip breath,
   *  which has to land under a caller-chosen offset the same way its tones
   *  do; every other caller leaves it at 0. */
  #noise(dur, gain, delay = 0) {
    const ctx = this._ctx;
    const t0 = ctx.currentTime + delay;

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

    src.connect(filter).connect(env).connect(this._sfxGain);
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

  /**
   * The yip a fox gives on its backflip: a rival crashing into its trail
   * gets one, a round win gets two (one per flip). Meant to read as a small
   * animal's cheeky triumph, not an instrument, so it stays short — a
   * breath of noise, then two fast upward pitch-slides, the second higher
   * and shorter — and quiet enough (gain 0.10) to sit under crash() or the
   * roundWin() arpeggio without burying either.
   *
   * `voice` is the rider's palette index (0-5): six riders, six voices, so
   * every fox has its own pitch and a listener can tell who is gloating
   * without looking at the screen. Scaling every frequency by the same
   * per-voice ratio (a whole tone per rider) keeps the two-note shape
   * intact while shifting who it belongs to.
   */
  taunt(voice = 0, delay = 0) {
    if (!this.#gate()) return;
    const ratio = Math.pow(2, (voice * 2) / 12);
    // The "breath" before the yip: a hair of noise, quieter than the tones
    // so it reads as texture, not a second cue.
    this.#noise(0.02, 0.07, delay);
    this.#tone({
      freq: 620 * ratio,
      to: 950 * ratio,
      dur: 0.09,
      type: "triangle",
      gain: 0.1,
      delay,
    });
    this.#tone({
      freq: 900 * ratio,
      to: 1300 * ratio,
      dur: 0.11,
      type: "square",
      gain: 0.1,
      delay: delay + 0.09,
    });
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
