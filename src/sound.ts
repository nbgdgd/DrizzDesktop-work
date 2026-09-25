// Short CC0 effects (Kenney, see public/sfx/Kenney-License.txt) played from
// the pet window. Everything is loaded once and cloned per play, so a burst of
// clicks does not cut itself off. Both switches - on/off and volume - live in
// the settings, and `apply` is called whenever they change.
import { bus } from "./audio";
export type Sfx =
  | "click"
  | "poke"
  | "talk"
  | "eat"
  | "drink"
  | "coin"
  | "levelup"
  | "upgrade"
  | "error"
  | "work"
  | "summon"
  | "drop"
  | "sleep"
  | "wake";
const FILES: Record<Sfx, string> = {
  click: "click",
  poke: "poke",
  talk: "talk",
  eat: "eat",
  drink: "drink",
  coin: "coin",
  levelup: "levelup",
  upgrade: "upgrade",
  error: "error",
  work: "work",
  summon: "summon",
  drop: "drop",
  sleep: "sleep",
  wake: "wake",
};
// Per-sound trim so a coin purse is not four times louder than a click.
const GAIN: Partial<Record<Sfx, number>> = {
  talk: 0.35,
  coin: 0.7,
  eat: 0.8,
  poke: 0.6,
  drop: 0.5,
  sleep: 0.5,
};
/**
 * The recorded effects are mastered much hotter than the synthesised voice:
 * through the bus boost they hit 1.0 (clipping) at 55 %. Trimmed to sit
 * with the voice (measured with tools/sound-probe.cjs).
 */
const SFX_TRIM = 0.4;
export class Sound {
  private cache = new Map<Sfx, HTMLAudioElement>();
  private playing: HTMLAudioElement[] = [];
  /** Decoded effects for the shared bus (audio.ts); HTML audio is the fallback. */
  private buffers = new Map<Sfx, AudioBuffer | Promise<AudioBuffer | null> | null>();
  private sources = new Set<AudioBufferSourceNode>();
  private last = new Map<Sfx, number>();
  enabled = true;
  volume = 0.55;
  constructor(private base = "/sfx/") {}
  apply(enabled: boolean, volume: number) {
    this.enabled = enabled;
    this.volume = Math.max(0, Math.min(1, volume / 100));
    if (!enabled) this.stopAll();
    // Decode every effect up front so the first click is not late.
    else if (this.volume > 0) {
      const b = bus();
      if (b) for (const n of Object.keys(FILES) as Sfx[]) void this.load(n, b.ctx);
    }
  }
  /** Fire and forget; a sound repeating within `gap` ms is dropped. */
  play(name: Sfx, gap = 120) {
    if (!this.enabled || this.volume <= 0) return;
    const now = Date.now();
    if (now - (this.last.get(name) ?? -Infinity) < gap) return;
    this.last.set(name, now);
    // Through the bus: louder (make-up gain + limiter) and one mixer entry.
    const b = bus();
    if (b) {
      const buf = this.buffers.get(name);
      const start = (buffer: AudioBuffer) => {
        const src = b.ctx.createBufferSource();
        src.buffer = buffer;
        const g = b.ctx.createGain();
        g.gain.value = this.volume * (GAIN[name] ?? 1) * SFX_TRIM;
        src.connect(g).connect(b.input);
        this.sources.add(src);
        src.onended = () => this.sources.delete(src);
        src.start();
      };
      if (buf instanceof AudioBuffer) return start(buf);
      if (buf === null) return this.html(name);
      if (!buf) {
        // The first play waits for the file, but only briefly: a late click is worse than none.
        void this.load(name, b.ctx).then((d) => {
          if (d && Date.now() - now < 400) start(d);
          else if (!d) this.html(name);
        });
      }
      return;
    }
    this.html(name);
  }
  private load(name: Sfx, ctx: AudioContext) {
    const have = this.buffers.get(name);
    if (have !== undefined) return Promise.resolve(have instanceof AudioBuffer ? have : have === null ? null : have);
    const loading = fetch(`${this.base}${FILES[name]}.ogg`)
      .then((r) => r.arrayBuffer())
      .then((a) => ctx.decodeAudioData(a))
      .then((d) => (this.buffers.set(name, d), d))
      .catch(() => (this.buffers.set(name, null), null));
    this.buffers.set(name, loading);
    return loading;
  }
  private html(name: Sfx) {
    try {
      let node = this.cache.get(name);
      if (!node) {
        node = new Audio(`${this.base}${FILES[name]}.ogg`);
        node.preload = "auto";
        this.cache.set(name, node);
      }
      const shot = node.cloneNode() as HTMLAudioElement;
      shot.volume = Math.min(1, this.volume * (GAIN[name] ?? 1));
      this.playing.push(shot);
      if (this.playing.length > 8) this.playing.shift();
      shot.addEventListener("ended", () => {
        this.playing = this.playing.filter((s) => s !== shot);
      });
      // Autoplay can still refuse before the first user gesture; that is not
      // worth an error in the log, the next sound will work.
      void shot.play().catch(() => {});
    } catch {
      /* no audio device: the pet stays silent, everything else keeps working */
    }
  }
  stopAll() {
    for (const s of this.sources)
      try {
        s.stop();
      } catch {
        /* already ended */
      }
    this.sources.clear();
    for (const s of this.playing) {
      s.pause();
      s.currentTime = 0;
    }
    this.playing = [];
  }
}
