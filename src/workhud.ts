// The shift status shown above the pet while it works: job name, a
// terminal-style spinner (frames from cli-spinners, MIT, sindresorhus),
// a progress bar, time left, money earned so far, and a ticker of job
// "stats" that grow with the shift (flyers handed out, viewers, bugs…).
import Phaser from "phaser";
import spinners from "cli-spinners";
import type { Rect } from "./model";
import { money, tx } from "./i18n";
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
const FONT = "Segoe UI, sans-serif";
const MONO = "Consolas, Cascadia Mono, monospace";
export const HUD_W = 214;
export const HUD_H = 70;
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
      scene.add.text(0, 0, "", { fontFamily: font, fontSize: `${size}px`, color }).setDepth(29).setVisible(false);
    this.title = t(FONT, 12, "#e9e9eb");
    this.time = t(MONO, 11, "#9aa0a8");
    this.spinner = t(MONO, 11, "#b4e62e");
    this.pay = t(MONO, 11, "#ffd75e");
    this.ticker = t(FONT, 11, "#b9bcc4");
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
    g.fillStyle(0x121317, 0.94).lineStyle(1, accent, 0.6);
    g.fillRoundedRect(left, top, HUD_W, HUD_H, 9).strokeRoundedRect(left, top, HUD_W, HUD_H, 9);
    // Title row: spinner, job, time left.
    const sp = jobSpinner[job.id] ?? jobSpinner.qa;
    this.spinner.setText(sp.frames[Math.floor(now / sp.interval) % sp.frames.length]).setPosition(left + 10, top + 7);
    const sw = Math.max(18, this.spinner.width + 6);
    this.title.setText(job.name).setPosition(left + 10 + sw, top + 6);
    if (this.title.width > HUD_W - sw - 60) this.title.setText(job.name.slice(0, 18) + "…");
    this.time.setText(clock(job.left)).setPosition(left + HUD_W - 10 - this.time.width, top + 7);
    // Progress bar: filled part in the pet's colour, a moving shine on it.
    const bx = left + 10,
      by = top + 28,
      bw = HUD_W - 20 - 56,
      bh = 8;
    g.fillStyle(0x2a2d35, 1).fillRoundedRect(bx, by, bw, bh, 4);
    const fw = Math.max(bh, bw * Math.min(1, job.progress));
    g.fillStyle(accent, 1).fillRoundedRect(bx, by, fw, bh, 4);
    const shine = bx + ((now / 12) % (bw + 30)) - 30;
    if (shine < bx + fw - 6) g.fillStyle(0xffffff, 0.22).fillRect(Math.max(bx, shine), by + 1, Math.min(14, bx + fw - Math.max(bx, shine)), bh - 2);
    this.pay.setText(`+${money(job.earned)}`).setPosition(bx + bw + 8, by - 3);
    // Ticker: one stat at a time, changing every 3.5 s.
    const stats = jobStats(job.id, job.progress, now);
    this.ticker.setText(stats[Math.floor(now / 3500) % stats.length]).setPosition(left + 10, top + 46);
    return { left: Math.floor(left - 2), top: Math.floor(top - 2), right: Math.ceil(left + HUD_W + 2), bottom: Math.ceil(bottom + 2) };
  }
}
