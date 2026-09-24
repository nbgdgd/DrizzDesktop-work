// Right click on the pet: a small card next to it with level, money,
// relationship and the needs as bars, plus three buttons (feed, play,
// open the full panel). Closes on its own after a while or on any click.
import Phaser from "phaser";
import type { Rect } from "./model";
import { money, tx } from "./i18n";
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
const FONT = "Segoe UI, sans-serif";
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
          color: "#b4e62e",
          backgroundColor: "#26282d",
          padding: { x: 7, y: 4 },
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
    t.setText(s).setFontSize(size).setColor(color).setFontStyle(bold ? "bold" : "normal").setPosition(x, y).setVisible(true);
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
    const h = 64 + rows * 17 + (d.job ? 16 : 0) + (d.ears ? 16 : 0) + 34;
    const left = Math.max(4, Math.min(356 - CARD_W, cx - CARD_W / 2));
    const top = headY - h - 10 >= 4 ? headY - h - 10 : Math.min(336 - h, feetY + 8);
    const g = this.g;
    g.clear();
    g.fillStyle(0x121317, 1).lineStyle(1, accent, 0.7);
    g.fillRoundedRect(left, top, CARD_W, h, 10).strokeRoundedRect(left, top, CARD_W, h, 10);
    let i = 0;
    this.text(i++, d.name, left + 12, top + 9, 14, "#e9e9eb", true);
    const cash = this.text(i++, money(d.money), 0, top + 11, 12, "#ffd75e");
    cash.setX(left + CARD_W - 12 - cash.width);
    this.text(i++, tx("{n} уровень", { n: d.level }) + ` · ${d.stage} · ${d.mood}`, left + 12, top + 29, 11, "#9aa0a8");
    // Level progress.
    const bx = left + 12,
      bw = CARD_W - 24;
    g.fillStyle(0x2a2d35, 1).fillRoundedRect(bx, top + 46, bw, 4, 2);
    g.fillStyle(accent, 1).fillRoundedRect(bx, top + 46, Math.max(4, (bw * d.levelPct) / 100), 4, 2);
    let y = top + 58;
    for (const [name, v] of d.bars) {
      this.text(i++, name, bx, y - 2, 11, "#c7ccd6");
      const x0 = bx + 78,
        w = bw - 78 - 30;
      const pct = Math.max(0, Math.min(100, v));
      const color = pct < 25 ? 0xe5484d : pct < 45 ? 0xf5a524 : 0x46a758;
      g.fillStyle(0x2a2d35, 1).fillRoundedRect(x0, y + 3, w, 6, 3);
      g.fillStyle(color, 1).fillRoundedRect(x0, y + 3, Math.max(6, (w * pct) / 100), 6, 3);
      this.text(i++, String(Math.round(pct)), x0 + w + 6, y - 2, 11, "#9aa0a8");
      y += 17;
    }
    if (d.job) {
      this.text(i++, d.job, bx, y - 1, 11, "#b4e62e");
      y += 16;
    }
    if (d.ears) {
      this.text(i++, d.ears, bx, y - 1, 11, "#7fd3ff");
      y += 16;
    }
    for (let j = i; j < this.texts.length; j++) this.texts[j].setVisible(false);
    let x = bx;
    const labels = this.labels();
    for (const [j, b] of this.buttons.entries()) {
      if (b.text !== labels[j]) b.setText(labels[j]);
      b.setVisible(true).setPosition(x, y + 4);
      x += b.width + 6;
    }
    return { left: Math.floor(left - 2), top: Math.floor(top - 2), right: Math.ceil(left + CARD_W + 2), bottom: Math.ceil(top + h + 2) };
  }
}
