// Short CC0 effects (Kenney, see public/sfx/Kenney-License.txt) played from
// the pet window. Everything is loaded once and cloned per play, so a burst of
// clicks does not cut itself off. Both switches — on/off and volume — live in
// the settings, and `apply` is called whenever they change.
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
export class Sound {
  private cache = new Map<Sfx, HTMLAudioElement>();
  private playing: HTMLAudioElement[] = [];
  private last = new Map<Sfx, number>();
  enabled = true;
  volume = 0.55;
  constructor(private base = "/sfx/") {}
  apply(enabled: boolean, volume: number) {
    this.enabled = enabled;
    this.volume = Math.max(0, Math.min(1, volume / 100));
    if (!enabled) this.stopAll();
  }
  /** Fire and forget; a sound repeating within `gap` ms is dropped. */
  play(name: Sfx, gap = 120) {
    if (!this.enabled || this.volume <= 0) return;
    const now = Date.now();
    if (now - (this.last.get(name) ?? -Infinity) < gap) return;
    this.last.set(name, now);
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
    for (const s of this.playing) {
      s.pause();
      s.currentTime = 0;
    }
    this.playing = [];
  }
}
