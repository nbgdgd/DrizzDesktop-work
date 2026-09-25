// What plays, as the pet feels it: the audio tap (tap.rs) sends eight band
// levels, the tempo and the time since the last beat ~12 times a second.
// Groove smooths the bars between messages, keeps a steady beat clock
// (small corrections, no jumps) and fades out when the sound stops. Pure,
// the scene draws it (equalizer at the feet) and bobs on the beat.
export interface TapMusic {
  bands: number[];
  /** dB of the louder channel against a full-scale sine. */
  level: number;
  bpm: number;
  /** Beat period and time since the last beat, ms; confidence 0..1. */
  period: number;
  beat: number;
  confidence: number;
}
export const BARS = 8;
/** Below this the bars are not worth drawing (dB against full scale). */
const QUIET = -55;
/** No message for this long: the tap stopped, fade out. */
const STALE = 700;
export class Groove {
  /** Shown bar heights, 0..1. */
  bars: number[] = new Array(BARS).fill(0);
  private target: number[] = new Array(BARS).fill(0);
  private at = -Infinity;
  private level = -120;
  /** Beat clock: time of a beat and the period, ms. */
  beatAt = 0;
  period = 0;
  confidence = 0;
  /** 0..1, how visible the equalizer is (fades in and out). */
  shown = 0;
  feed(m: TapMusic, now: number) {
    this.at = now;
    this.level = m.level;
    this.target = m.bands.slice(0, BARS).map((v) => Math.max(0, Math.min(1, Number(v) || 0)));
    this.confidence = Math.max(0, Math.min(1, m.confidence));
    if (!(m.period > 250 && m.period < 1500)) return;
    const seen = now - m.beat;
    if (!this.period || Math.abs(m.period / this.period - 1) > 0.08) {
      // New tempo: take it as it is.
      this.period = m.period;
      this.beatAt = seen;
      return;
    }
    this.period += (m.period - this.period) * 0.2;
    // Pull the clock a third of the way towards the new estimate.
    let err = (seen - this.beatAt) % this.period;
    if (err > this.period / 2) err -= this.period;
    if (err < -this.period / 2) err += this.period;
    this.beatAt += err * 0.3;
  }
  /** Sound is on and loud enough to show. */
  playing(now: number) {
    return now - this.at < STALE && this.level > QUIET;
  }
  /** Where in the beat we are, 0 at the hit .. 1; null without a steady beat. */
  phase(now: number): number | null {
    if (!this.playing(now) || this.confidence < 0.2 || this.period <= 0) return null;
    const p = ((now - this.beatAt) % this.period) / this.period;
    return p < 0 ? p + 1 : p;
  }
  /** Bars follow the target: up at once, down slowly, to zero when stale. */
  step(now: number, dt: number) {
    const live = this.playing(now);
    const fall = Math.min(1, dt / 180);
    for (let i = 0; i < BARS; i++) {
      const t = live ? this.target[i] : 0;
      this.bars[i] = t > this.bars[i] ? this.bars[i] + (t - this.bars[i]) * Math.min(1, dt / 40) : this.bars[i] + (t - this.bars[i]) * fall;
    }
    const want = live ? 1 : 0;
    this.shown += (want - this.shown) * Math.min(1, dt / (live ? 300 : 600));
    if (this.shown < 0.01 && !live) this.shown = 0;
  }
}

/** Where the bars go: [left, right] per side, or null for a side left out. */
export function eqSides(o: { body: { left: number; right: number }; span: [number, number]; size: number; width: number }): ([number, number] | null)[] {
  const gap = Math.max(2, o.size * 0.03);
  const want = o.size * 0.34;
  const min = o.size * 0.16;
  const lo = Math.max(o.span[0], 2),
    hi = Math.min(o.span[1], o.width - 2);
  const left: [number, number] = [Math.max(lo, o.body.left - gap - want), o.body.left - gap];
  const right: [number, number] = [o.body.right + gap, Math.min(hi, o.body.right + gap + want)];
  return [left, right].map((s) => (s[1] - s[0] >= min ? s : null));
}
