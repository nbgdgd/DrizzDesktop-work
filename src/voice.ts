// Synthesised sounds: an Animal Crossing-like babble under every line (each
// character its own pitch and timbre, tempo from the length of the text)
// and small action sounds - steps, jump, landing, snoring, crunching, a
// swat, a sigh, dizziness. WebAudio only, nothing recorded, no files.
import { bus } from "./audio";
export type Act = "step" | "jump" | "land" | "snore" | "eat" | "swat" | "sigh" | "dizzy" | "pop" | "punch";
export class Voice {
  private ctx?: AudioContext;
  /** Where every sound goes: the shared bus (gain + limiter), see audio.ts. */
  private out?: AudioNode;
  private noise?: AudioBuffer;
  private busyUntil = 0;
  private last = new Map<Act, number>();
  enabled = true;
  babble = true;
  volume = 0.55;
  apply(enabled: boolean, babble: boolean, volume: number) {
    this.enabled = enabled;
    this.babble = babble;
    this.volume = Math.max(0, Math.min(1, volume / 100));
  }
  private audio(): AudioContext | undefined {
    if (!this.enabled || this.volume <= 0) return;
    try {
      if (!this.ctx) {
        const b = bus();
        if (!b) return;
        this.ctx = b.ctx;
        this.out = b.input;
        const n = this.ctx.sampleRate;
        this.noise = this.ctx.createBuffer(1, n, n);
        const d = this.noise.getChannelData(0);
        for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
      }
      if (this.ctx.state === "suspended") void this.ctx.resume();
      return this.ctx;
    } catch {
      return undefined;
    }
  }
  /**
   * WebView2 parks an idle AudioContext; sounds scheduled on a suspended
   * clock come out late or in a heap. Resume first, then play (dropped if
   * waking the device took too long to still match the moment).
   */
  private deferred(again: () => void) {
    const ctx = this.audio();
    if (!ctx || ctx.state === "running") return false;
    const t = Date.now();
    void ctx
      .resume()
      .then(() => {
        if (Date.now() - t < 500 && ctx.state === "running") again();
      })
      .catch(() => {});
    return true;
  }
  /** Babble for a line: one blip per syllable-ish, pitch follows the vowels. */
  say(text: string, pitch: number, wave: OscillatorType, mood = "normal") {
    if (!this.babble) return;
    if (this.deferred(() => this.say(text, pitch, wave, mood))) return;
    const ctx = this.audio();
    if (!ctx) return;
    const now = ctx.currentTime;
    const start = Math.max(now, this.busyUntil);
    if (start - now > 1) return;
    const letters = text.toLowerCase().replace(/[^a-zа-яё]/g, "");
    const n = Math.max(2, Math.min(22, Math.round(letters.length / 3)));
    // Long lines talk faster so the babble never runs past ~1.8 s.
    const step = Math.max(0.055, Math.min(0.095, 1.8 / n));
    const vowels = "аеёиоуыэюяaeiou";
    const moodShift = mood === "angry" ? 0.85 : mood === "sad" || mood === "sleepy" ? 0.8 : mood === "friendly" ? 1.1 : 1;
    const out = ctx.createGain();
    out.gain.value = this.volume * 0.22;
    out.connect(this.out ?? ctx.destination);
    for (let i = 0; i < n; i++) {
      const ch = letters[Math.floor((i / n) * letters.length)] ?? "а";
      const v = vowels.indexOf(ch);
      const f = pitch * moodShift * (v >= 0 ? 1 + ((v % 5) - 2) * 0.07 : 0.94 + Math.random() * 0.12);
      const t = start + i * step;
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = wave;
      o.frequency.setValueAtTime(f, t);
      o.frequency.linearRampToValueAtTime(f * (i === n - 1 ? 0.85 : 1.04), t + step * 0.8);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(1, t + 0.008);
      g.gain.exponentialRampToValueAtTime(0.001, t + step * 0.85);
      o.connect(g).connect(out);
      o.start(t);
      o.stop(t + step);
    }
    this.busyUntil = start + n * step;
  }
  /** A short action sound; the same one within `gap` ms is dropped. */
  act(kind: Act, gap = 90) {
    if (this.deferred(() => this.act(kind, gap))) return;
    const ms = Date.now();
    if (ms - (this.last.get(kind) ?? -Infinity) < gap) return;
    this.last.set(kind, ms);
    const ctx = this.audio();
    if (!ctx || !this.noise) return;
    const t = ctx.currentTime;
    const out = ctx.createGain();
    out.connect(this.out ?? ctx.destination);
    const v = this.volume;
    const tone = (type: OscillatorType, f0: number, f1: number, dur: number, gain: number, at = t) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = type;
      o.frequency.setValueAtTime(f0, at);
      o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), at + dur);
      g.gain.setValueAtTime(gain * v, at);
      g.gain.exponentialRampToValueAtTime(0.0008, at + dur);
      o.connect(g).connect(out);
      o.start(at);
      o.stop(at + dur + 0.02);
    };
    const hiss = (dur: number, gain: number, freq: number, q = 1, at = t, sweep = 0) => {
      const s = ctx.createBufferSource();
      s.buffer = this.noise!;
      const f = ctx.createBiquadFilter();
      f.type = "bandpass";
      f.frequency.setValueAtTime(freq, at);
      if (sweep) f.frequency.exponentialRampToValueAtTime(sweep, at + dur);
      f.Q.value = q;
      const g = ctx.createGain();
      g.gain.setValueAtTime(gain * v, at);
      g.gain.exponentialRampToValueAtTime(0.0008, at + dur);
      s.connect(f).connect(g).connect(out);
      s.start(at, Math.random() * 0.5);
      s.stop(at + dur + 0.02);
    };
    switch (kind) {
      case "step":
        hiss(0.04, 0.05, 1800, 2);
        break;
      case "jump":
        tone("sine", 320, 720, 0.14, 0.12);
        break;
      case "land":
        tone("sine", 140, 55, 0.16, 0.22);
        hiss(0.07, 0.06, 600, 1);
        break;
      case "snore":
        hiss(1.1, 0.05, 220, 3, t, 120);
        tone("sine", 90, 70, 1.1, 0.05);
        break;
      case "eat":
        for (let i = 0; i < 3; i++) hiss(0.05, 0.12, 2400 + i * 300, 3, t + i * 0.09);
        break;
      case "swat":
        hiss(0.12, 0.14, 800, 1.2, t, 3200);
        tone("triangle", 600, 300, 0.06, 0.08, t + 0.08);
        break;
      case "punch":
        tone("sine", 160, 42, 0.18, 0.32);
        hiss(0.05, 0.22, 1400, 0.7);
        tone("square", 90, 60, 0.05, 0.05, t + 0.01);
        break;
      case "sigh":
        hiss(0.8, 0.06, 900, 0.8, t, 300);
        break;
      case "dizzy":
        for (let i = 0; i < 4; i++) tone("sine", 700 - i * 60, 500 - i * 60, 0.12, 0.05, t + i * 0.12);
        break;
      case "pop":
        tone("sine", 900, 400, 0.08, 0.1);
        break;
    }
  }
}
