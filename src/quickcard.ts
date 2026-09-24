// Right click on the pet: a small card next to it with level, money,
// relationship and the needs as bars, plus three buttons (feed, play,
// open the full panel). Closes on its own after a while or on any click.
import Phaser from "phaser";
import type { Rect } from "./model";
import { money, tx } from "./i18n";
import { FONT, GOLD, SHADOW, bar, button, ink, inkSoft, need, panel, textOn } from "./toon";
export interface CardData {
  name: string;
  level: number;
  levelPct: number;
  money: number;
  stage: string;
  mood: string;
  bars: [string, number][];
  job: string;
  /** "Уши: 34% недельной нормы", or "" when ear care is off / unused. */
  ears: string;
}
export const CARD_W = 236;
export class QuickCard {
  private g: Phaser.GameObjects.Graphics;
  private texts: Phaser.GameObjects.Text[] = [];
  buttons: Phaser.GameObjects.Text[] = [];
  openUntil = 0;
  private dpr = 1;
  constructor(private scene: Phaser.Scene, private labels: () => string[], onButton: (i: number) => void) {
    this.g = scene.add.graphics().setDepth(45);
    labels().forEach((label, i) => {
      const b = scene.add
        .text(0, 0, label, {
          fontFamily: FONT,
          fontSize: "12px",
          fontStyle: "800",
          color: ink,
          padding: { x: 8, y: 3 },
        })
        .setDepth(47)
        .setVisible(false)
        .setInteractive({ useHandCursor: true });
      b.on("pointerdown", () => onButton(i));
      this.buttons.push(b);
    });
  }
  get open() {
    return Date.now() < this.openUntil;
  }
  toggle(now: number) {
    this.openUntil = this.open ? 0 : now + 12000;
  }
  close() {
    this.openUntil = 0;
  }
  setDpr(dpr: number) {
    this.dpr = dpr;
    for (const t of [...this.texts, ...this.buttons]) {
      t.setResolution(dpr);
      t.frame.source.resolution = dpr;
    }
  }
  private text(i: number, s: string, x: number, y: number, size: number, color: string, bold = false) {
    let t = this.texts[i];
    if (!t) {
      t = this.scene.add.text(0, 0, "", { fontFamily: FONT, fontSize: `${size}px`, color }).setDepth(46);
      t.setResolution(this.dpr);
      t.frame.source.resolution = this.dpr;
      this.texts[i] = t;
    }
    t.setText(s).setFontSize(size).setColor(color).setFontStyle(bold ? "800" : "700").setPosition(x, y).setVisible(true);
    return t;
  }
  /** Draws the card above the head (below the pet if there is no room). */
  render(d: CardData | null, cx: number, headY: number, feetY: number, accent: number): Rect | null {
    if (!d || !this.open) {
      this.g.clear();
      for (const t of [...this.texts, ...this.buttons]) t.setVisible(false);
      return null;
    }
    const rows = d.bars.length;
    const h = 66 + rows * 19 + (d.job ? 16 : 0) + (d.ears ? 16 : 0) + 38;
    const left = Math.max(4, Math.min(356 - CARD_W, cx - CARD_W / 2));
    const top = headY - h - 10 >= 4 ? headY - h - 10 : Math.min(336 - h, feetY + 8);
    const g = this.g;
    g.clear();
    panel(g, left, top, CARD_W, h, 14);
    let i = 0;
    this.text(i++, d.name, left + 12, top + 8, 15, ink, true);
    // Money on a little gold coin tag.
    const cash = this.text(i++, money(d.money), 0, top + 10, 12, ink, true);
    cash.setX(left + CARD_W - 16 - cash.width);
    button(g, { x: cash.x - 6, y: cash.y - 1, width: cash.width + 12, height: cash.height + 1 }, GOLD);
    this.text(i++, tx("{n} уровень", { n: d.level }) + ` · ${d.stage} · ${d.mood}`, left + 12, top + 30, 11, inkSoft);
    // Level progress.
    const bx = left + 12,
      bw = CARD_W - 24;
    bar(g, bx, top + 47, bw, 8, d.levelPct, accent);
    let y = top + 64;
    for (const [name, v] of d.bars) {
      this.text(i++, name, bx, y - 2, 11, ink);
      const x0 = bx + 78,
        w = bw - 78 - 30;
      const pct = Math.max(0, Math.min(100, v));
      bar(g, x0, y + 1, w, 10, pct, need(pct));
      this.text(i++, String(Math.round(pct)), x0 + w + 6, y - 2, 11, inkSoft);
      y += 19;
    }
    if (d.job) {
      this.text(i++, d.job, bx, y - 1, 11, "#2f8a3a");
      y += 16;
    }
    if (d.ears) {
      this.text(i++, d.ears, bx, y - 1, 11, "#2a7fb0");
      y += 16;
    }
    for (let j = i; j < this.texts.length; j++) this.texts[j].setVisible(false);
    let x = bx;
    const labels = this.labels();
    // Shrink the row until it fits inside the card (long English labels).
    for (const [j, b] of this.buttons.entries()) if (b.text !== labels[j]) b.setText(labels[j]).setFontSize(12);
    for (let size = 12; size > 9 && this.buttons.reduce((w, b) => w + b.width + 6, -6) > bw; size--) for (const b of this.buttons) b.setFontSize(size - 1);
    for (const b of this.buttons) {
      b.setVisible(true).setPosition(x, y + 5);
      button(g, b, textOn(accent) === ink ? accent : GOLD);
      x += b.width + 6;
    }
    return { left: Math.floor(left - 3), top: Math.floor(top - 3), right: Math.ceil(left + CARD_W + SHADOW + 3), bottom: Math.ceil(top + h + SHADOW + 3) };
  }
}
