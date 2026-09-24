// Where the sprite goes and which pixels of the overlay window stay
// clickable. Pure geometry so it can be tested without Phaser.
//
// Frame coordinates: 0..192 × 0..208 inside one atlas cell. The pivot is a
// point in frame coordinates the body turns and squashes around: the feet
// normally, the grab point while the pet hangs from the hand.
import type { Rect } from "./model";
export const FRAME_W = 192;
export const FRAME_H = 208;
export interface Placement {
  /** Pivot position on the canvas, logical px. */
  x: number;
  y: number;
  /** Pivot inside the frame, px. */
  px: number;
  py: number;
  /** Frame px -> logical px, per axis (size / 192 × squash). */
  sx: number;
  sy: number;
  /** Clockwise, radians. */
  angle: number;
  /** Horizontal crop in frame px (peeking from behind an edge). */
  cropLeft?: number;
  cropRight?: number;
}
/** Frame point -> canvas point. */
export function toCanvas(p: Placement, fx: number, fy: number) {
  const dx = (fx - p.px) * p.sx,
    dy = (fy - p.py) * p.sy;
  const c = Math.cos(p.angle),
    s = Math.sin(p.angle);
  return { x: p.x + dx * c - dy * s, y: p.y + dx * s + dy * c };
}
/**
 * Window-region rectangles for the frame's opaque strips: each strip is
 * turned with the body and replaced by its bounding box, which keeps the
 * silhouette tight enough for click-through at any tilt.
 */
export function regionRects(p: Placement, mask: Rect[]): Rect[] {
  const lo = p.cropLeft ?? 0,
    hi = p.cropRight ?? FRAME_W;
  const out: Rect[] = [];
  for (const r of mask) {
    const left = Math.max(r.left, lo),
      right = Math.min(r.right, hi);
    if (right <= left) continue;
    if (!p.angle) {
      const a = toCanvas(p, left, r.top),
        b = toCanvas(p, right, r.bottom);
      out.push({
        left: Math.floor(Math.min(a.x, b.x)),
        top: Math.floor(Math.min(a.y, b.y)),
        right: Math.ceil(Math.max(a.x, b.x)),
        bottom: Math.ceil(Math.max(a.y, b.y)),
      });
      continue;
    }
    const pts = [
      toCanvas(p, left, r.top),
      toCanvas(p, right, r.top),
      toCanvas(p, left, r.bottom),
      toCanvas(p, right, r.bottom),
    ];
    out.push({
      left: Math.floor(Math.min(...pts.map((q) => q.x))),
      top: Math.floor(Math.min(...pts.map((q) => q.y))),
      right: Math.ceil(Math.max(...pts.map((q) => q.x))),
      bottom: Math.ceil(Math.max(...pts.map((q) => q.y))),
    });
  }
  return out;
}
/** Top of the head in frame px: the first opaque strip and its middle. */
export function headTop(mask: Rect[]): { x: number; y: number } | null {
  if (!mask.length) return null;
  const top = Math.min(...mask.map((r) => r.top));
  const row = mask.filter((r) => r.top <= top + 6);
  const left = Math.min(...row.map((r) => r.left)),
    right = Math.max(...row.map((r) => r.right));
  return { x: (left + right) / 2, y: top };
}
/**
 * The skull, frame px: the first row at least half as wide as the body (so
 * an antenna or a hair tuft on top does not count) and the sides a little
 * lower, where headphone cups sit.
 */
export function headBox(mask: Rect[]): { left: number; right: number; top: number; mid: number } | null {
  if (!mask.length) return null;
  const rows = new Map<number, [number, number]>();
  for (const r of mask)
    for (let y = r.top; y < r.bottom; y++) {
      const e = rows.get(y);
      rows.set(y, e ? [Math.min(e[0], r.left), Math.max(e[1], r.right)] : [r.left, r.right]);
    }
  const ys = [...rows.keys()].sort((a, b) => a - b);
  const width = (y: number) => rows.get(y)![1] - rows.get(y)![0];
  const maxW = Math.max(...ys.map(width));
  const top = ys.find((y) => width(y) >= maxW * 0.5) ?? ys[0];
  const mid = ys.find((y) => y >= top + width(top) * 0.42) ?? top;
  const [left, right] = rows.get(mid)!;
  return { left, right, top, mid };
}
/** Merges strips that touch vertically with the same span (fewer rects for Win32). */
export function compact(rects: Rect[], limit = 299): Rect[] {
  const out: Rect[] = [];
  for (const r of rects) {
    const last = out[out.length - 1];
    if (
      last &&
      Math.abs(last.left - r.left) <= 1 &&
      Math.abs(last.right - r.right) <= 1 &&
      r.top <= last.bottom + 1
    ) {
      last.left = Math.min(last.left, r.left);
      last.right = Math.max(last.right, r.right);
      last.bottom = Math.max(last.bottom, r.bottom);
    } else out.push({ ...r });
  }
  return out.slice(0, limit);
}
