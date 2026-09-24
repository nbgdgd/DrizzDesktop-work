import { clamp, Monitor } from "./model";
// Keep the entire bubble inside its monitor, even with negative desktop coordinates.
export function overlayLayout(
  x: number,
  y: number,
  size: number,
  scale: number,
  monitor?: Monitor,
) {
  const left = monitor
    ? clamp(
        x - 180 * scale,
        monitor.work.left,
        monitor.work.right - 360 * scale,
      )
    : x - 180 * scale;
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
