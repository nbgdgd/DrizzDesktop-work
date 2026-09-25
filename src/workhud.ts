// The shift status shown above the pet while it works: job name, a
// terminal-style spinner (frames from cli-spinners, MIT, sindresorhus),
// a progress bar, time left, money earned so far, and a ticker of job
// "stats" that grow with the shift (flyers handed out, viewers, bugs...).
import Phaser from "phaser";
import spinners from "cli-spinners";
import type { Rect } from "./model";
import { money, tx } from "./i18n";
import { FONT, SHADOW, bar, ink, inkSoft, panel } from "./toon";
type Spin = { interval: number; frames: string[] };
const spin = (name: string): Spin => (spinners as unknown as Record<string, Spin>)[name] ?? { interval: 100, frames: ["-", "\\", "|", "/"] };
/** A spinner per job, from the same collection terminals use. */
export const jobSpinner: Record<string, Spin> = {
  flyers: spin("arrow3"),
  stream: spin("point"),
  qa: spin("dots"),
  mining: spin("bouncingBar"),
  night: spin("dots12"),
};
/** Job "stats" at progress p (0..1); `t` wiggles live numbers a little. */
export function jobStats(id: string, p: number, t: number): string[] {
  const r = Math.round;
  const w = Math.sin(t / 1700);
  switch (id) {
    case "flyers":
      return [tx("Раздано флаеров: {n}", { n: r(120 * p) }), tx("Послали нахуй: {n}", { n: r(31 * p) }), tx("Взяли и выкинули: {n}", { n: r(70 * p) })];
    case "stream":
      return [tx("Зрителей: {n}", { n: Math.max(1, r(8 + 140 * p + 6 * w)) }), tx("Донатов: {n}", { n: money(900 * p) }), tx("Банов в чате: {n}", { n: r(12 * p) })];
    case "qa":
      return [tx("Найдено багов: {n}", { n: r(23 * p) }), tx("«Это не баг, это фича»: {n}", { n: r(9 * p) }), tx("Кофе: {n} чашки", { n: 1 + r(3 * p) })];
    case "mining":
      return [tx("Хэшрейт: {n} MH/s", { n: (41 + 3 * w).toFixed(1) }), tx("Видюха: {n}°C", { n: 62 + r(19 * p) }), tx("Намайнено: {n} ETH", { n: (0.0004 * p).toFixed(5) })];
    case "night":
      return [tx("Обходов серверной: {n}", { n: r(14 * p) }), tx("Подозрительных пингов: {n}", { n: r(6 * p) }), tx("Выпито кофе: {n}", { n: r(5 * p) })];
    default:
      return [tx("Готово: {n}%", { n: r(100 * p) })];
  }
}
export const clock = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
};
const MONO = "Consolas, Cascadia Mono, monospace";
export const HUD_W = 214;
export const HUD_H = 72;
export class WorkHud {
  private g: Phaser.GameObjects.Graphics;
  private title: Phaser.GameObjects.Text;
  private time: Phaser.GameObjects.Text;
  private spinner: Phaser.GameObjects.Text;
  private pay: Phaser.GameObjects.Text;
  private ticker: Phaser.GameObjects.Text;
  constructor(scene: Phaser.Scene) {
    this.g = scene.add.graphics().setDepth(28);
    const t = (font: string, size: number, color: string) =>
      scene.add.text(0, 0, "", { fontFamily: font, fontSize: `${size}px`, fontStyle: font === FONT ? "800" : "bold", color }).setDepth(29).setVisible(false);
    this.title = t(FONT, 12, ink);
    this.time = t(MONO, 11, inkSoft);
    this.spinner = t(MONO, 11, "#2f8a3a");
    this.pay = t(MONO, 11, "#a86a00");
    this.ticker = t(FONT, 11, inkSoft);
  }
  setDpr(dpr: number) {
    for (const x of [this.title, this.time, this.spinner, this.pay, this.ticker]) {
      x.setResolution(dpr);
      x.frame.source.resolution = dpr;
    }
  }
  private show(v: boolean) {
    for (const x of [this.title, this.time, this.spinner, this.pay, this.ticker]) x.setVisible(v);
    if (!v) this.g.clear();
  }
  /**
   * Draws the panel with its bottom edge at `bottom` (canvas px), centred on
   * `cx`. `job` null hides it. Returns the covered rectangle.
   */
  render(
    job: { id: string; name: string; progress: number; left: number; earned: number } | null,
    now: number,
    cx: number,
    bottom: number,
    accent: number,
  ): Rect | null {
    if (!job || bottom < HUD_H + 4) {
      this.show(false);
      return null;
    }
    this.show(true);
    const left = Math.max(4, Math.min(356 - HUD_W, cx - HUD_W / 2)),
      top = bottom - HUD_H;
    const g = this.g;
    g.clear();
    panel(g, left, top, HUD_W, HUD_H, 12);
    // Title row: spinner, job, time left.
    const sp = jobSpinner[job.id] ?? jobSpinner.qa;
    this.spinner.setText(sp.frames[Math.floor(now / sp.interval) % sp.frames.length]).setPosition(left + 10, top + 7);
    const sw = Math.max(18, this.spinner.width + 6);
    this.title.setText(job.name).setPosition(left + 10 + sw, top + 6);
    if (this.title.width > HUD_W - sw - 60) this.title.setText(job.name.slice(0, 18) + "...");
    this.time.setText(clock(job.left)).setPosition(left + HUD_W - 10 - this.time.width, top + 7);
    // Progress bar: filled part in the pet's colour, a moving shine on it.
    const bx = left + 10,
      by = top + 28,
      bw = HUD_W - 20 - 56,
      bh = 11;
    const fw = bar(g, bx, by, bw, bh, 100 * Math.min(1, job.progress), accent);
    // Candy stripes sliding along the filled part.
    g.fillStyle(0xffffff, 0.22);
    for (let sx = bx + ((now / 40) % 12) - 12; sx < bx + fw - 6; sx += 12) {
      const a = Math.max(bx + 3, sx);
      if (a + 5 < bx + fw - 3) g.fillTriangle(a, by + bh - 2, a + 5, by + 2, a + 9 > bx + fw - 3 ? bx + fw - 3 : a + 9, by + 2);
    }
    this.pay.setText(`+${money(job.earned)}`).setPosition(bx + bw + 8, by - 3);
    // Ticker: one stat at a time, changing every 3.5 s.
    const stats = jobStats(job.id, job.progress, now);
    this.ticker.setText(stats[Math.floor(now / 3500) % stats.length]).setPosition(left + 10, top + 46);
    return { left: Math.floor(left - 3), top: Math.floor(top - 3), right: Math.ceil(left + HUD_W + SHADOW + 3), bottom: Math.ceil(bottom + SHADOW + 3) };
  }
}
