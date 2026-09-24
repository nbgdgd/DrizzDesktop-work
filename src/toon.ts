// Cartoon look shared by the balloon, the right click card and the work
// panel: cream paper, thick ink outline, a hard offset shadow, chunky
// "candy" bars with a gloss stripe and pill buttons with a bottom lip.
// Font: Nunito (SIL OFL 1.1, @fontsource/nunito), rounded, has Cyrillic.
import type Phaser from "phaser";
export const FONT = "Nunito, Segoe UI, sans-serif";
export const INK = 0x2b2233;
export const PAPER = 0xfffaf0;
export const TRACK = 0xeadfcb;
export const ink = "#2b2233";
export const inkSoft = "#6b6275";
/** How far the hard shadow sits from the shape (right and down). */
export const SHADOW = 3;
export const OUTLINE = 2.5;
type G = Phaser.GameObjects.Graphics;
export function darker(c: number, k = 0.72) {
  const r = (c >> 16) & 255,
    g = (c >> 8) & 255,
    b = c & 255;
  return (Math.round(r * k) << 16) | (Math.round(g * k) << 8) | Math.round(b * k);
}
/** Dark or light text, whichever reads better on `c`. */
export function textOn(c: number) {
  const r = (c >> 16) & 255,
    g = (c >> 8) & 255,
    b = c & 255;
  return 0.299 * r + 0.587 * g + 0.114 * b > 150 ? ink : "#ffffff";
}
export function hex(c: number) {
  return "#" + c.toString(16).padStart(6, "0");
}
/** Paper card with outline and hard shadow. */
export function panel(g: G, x: number, y: number, w: number, h: number, r: number, fill = PAPER, alpha = 1) {
  g.fillStyle(INK, 0.3 * alpha).fillRoundedRect(x + SHADOW, y + SHADOW + 1, w, h, r);
  g.fillStyle(fill, alpha).fillRoundedRect(x, y, w, h, r);
  g.lineStyle(OUTLINE, INK, alpha).strokeRoundedRect(x, y, w, h, r);
}
/** Pill button behind a text object (its bounds include the padding). */
export function button(g: G, t: { x: number; y: number; width: number; height: number }, fill: number) {
  const r = Math.min(10, t.height / 2);
  g.fillStyle(darker(fill, 0.62), 1).fillRoundedRect(t.x, t.y + 3, t.width, t.height, r);
  g.fillStyle(fill, 1).fillRoundedRect(t.x, t.y, t.width, t.height, r);
  g.fillStyle(0xffffff, 0.35).fillRoundedRect(t.x + 5, t.y + 3, t.width - 10, Math.max(2, t.height * 0.22), 2);
  g.lineStyle(2, INK, 1).strokeRoundedRect(t.x, t.y, t.width, t.height + 3, r);
}
/** Chunky progress bar: outlined track, candy fill, gloss on top. */
export function bar(g: G, x: number, y: number, w: number, h: number, pct: number, fill: number) {
  const r = h / 2;
  g.fillStyle(TRACK, 1).fillRoundedRect(x, y, w, h, r);
  const fw = Math.max(h, (w * Math.max(0, Math.min(100, pct))) / 100);
  if (pct > 0) {
    g.fillStyle(fill, 1).fillRoundedRect(x, y, fw, h, r);
    g.fillStyle(darker(fill, 0.8), 1).fillRect(x + r, y + h - 2, Math.max(0, fw - h), 2);
    g.fillStyle(0xffffff, 0.45).fillRoundedRect(x + 3, y + 2, Math.max(0, fw - 6), Math.max(1.5, h * 0.25), 1);
  }
  g.lineStyle(2, INK, 1).strokeRoundedRect(x, y, w, h, r);
  return fw;
}
/** Candy colours for need bars. */
export const need = (pct: number) => (pct < 25 ? 0xff5d6c : pct < 45 ? 0xffb830 : 0x5fd068);
export const GOLD = 0xffcf3a;
