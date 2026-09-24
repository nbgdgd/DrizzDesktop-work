import { clamp, Monitor } from "./model";
import { neighbor } from "./movement";
// Keep the entire bubble inside its monitor, even with negative desktop coordinates.
// With `monitors` the window may also hang over a seam into a glued
// neighbour, so the pet is not cut in half while it walks across.
export function overlayLayout(
  x: number,
  y: number,
  size: number,
  scale: number,
  monitor?: Monitor,
  monitors: Monitor[] = [],
) {
  let lo = monitor?.work.left ?? -Infinity,
    hi = monitor?.work.right ?? Infinity;
  if (monitor) {
    const r = neighbor(monitors, monitor, 1),
      l = neighbor(monitors, monitor, -1);
    if (r && x > monitor.work.right - 180 * scale) hi = r.work.right;
    if (l && x < monitor.work.left + 180 * scale) lo = l.work.left;
  }
  const left = monitor ? clamp(x - 180 * scale, lo, hi - 360 * scale) : x - 180 * scale;
  const below = !!monitor && y - monitor.work.top < (size + 125) * scale;
  const anchorY = below ? Math.max(190, size + 12) : 330;
  return {
    left,
    top: y - anchorY * scale,
    anchorX: (x - left) / scale,
    anchorY,
    below,
  };
}
