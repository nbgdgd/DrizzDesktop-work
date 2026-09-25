// The equalizer at the pet's feet while music or a video plays (music.ts
// feeds it). Two small stacks of four bars, one on each side of the body,
// bass next to the pet, like a pair of speakers. They stand on whatever the
// pet stands on and never reach past its edge or the window: a side without
// room is left out instead of hanging in the air.
import Phaser from "phaser";
import type { Rect } from "./model";
import { INK } from "./toon";
import { eqSides } from "./music";
const COLORS = [0x5fd068, 0x2ec4b6, 0x3fa7ff, 0x8f7cff];
export interface EqInput {
  bars: number[];
  /** 0..1 fade. */
  shown: number;
  /** The body, canvas px. */
  body: { left: number; right: number };
  /** Feet line, canvas px. */
  floor: number;
  /** What it stands on, canvas px (a window's top edge or the screen). */
  span: [number, number];
  /** Pet size, canvas px. */
  size: number;
  /** Canvas width. */
  width: number;
  /** A small kick on the beat, 0..1. */
  kick: number;
}
export class Equalizer {
  private g: Phaser.GameObjects.Graphics;
  constructor(scene: Phaser.Scene) {
    // Behind the pet: the body may overlap the inner bars a little.
    this.g = scene.add.graphics().setDepth(-1);
  }
  clear() {
    this.g.clear();
  }
  draw(o: EqInput): Rect | null {
    this.g.clear();
    if (o.shown < 0.02) return null;
    const pairs = [0, 1, 2, 3].map((k) => Math.max(o.bars[2 * k] ?? 0, o.bars[2 * k + 1] ?? 0));
    const maxH = o.size * 0.4;
    const gap = Math.max(1, o.size * 0.018);
    let box: Rect | null = null;
    eqSides(o).forEach((side, i) => {
      if (!side) return;
      const [a, b] = side;
      const w = (b - a - gap * 3) / 4;
      if (w < 1.5) return;
      for (let k = 0; k < 4; k++) {
        // Bass next to the body on both sides.
        const x = i === 0 ? b - (k + 1) * w - k * gap : a + k * (w + gap);
        const v = Math.min(1, pairs[k] * (1 + 0.15 * o.kick));
        const h = Math.max(2, v * maxH) * o.shown;
        const r = Math.min(2, w / 2, h / 2);
        this.g.fillStyle(COLORS[k], 0.92 * o.shown).fillRoundedRect(x, o.floor - h, w, h, r);
        this.g.lineStyle(1, INK, 0.85 * o.shown).strokeRoundedRect(x, o.floor - h, w, h, r);
      }
      const r: Rect = { left: Math.floor(a - 1), top: Math.floor(o.floor - maxH - 2), right: Math.ceil(b + 1), bottom: Math.ceil(o.floor + 1) };
      box = box ? { left: Math.min(box.left, r.left), top: r.top, right: Math.max(box.right, r.right), bottom: r.bottom } : r;
    });
    return box;
  }
}
