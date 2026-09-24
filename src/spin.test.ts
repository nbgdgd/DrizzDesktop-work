import { describe, it, expect } from "vitest";
import { Placement, headTop, regionRects } from "./pose";

// A body silhouette: head at y=40, feet at y=199, 60 px wide.
const mask = Array.from({ length: 80 }, (_, i) => ({ left: 66, top: 40 + i * 2, right: 126, bottom: 42 + i * 2 }));
const floor = 199;
const anchorY = 330; // overlay canvas is 340 logical px tall, feet at 330
const place = (size: number, angle: number, center: boolean): Placement => {
  const z = size / 192;
  const py = center ? Math.round(((headTop(mask)?.y ?? 0) + floor + 1) / 2) : floor + 1;
  return { x: 180, y: anchorY + (py - (floor + 1)) * z, px: 96, py, sx: z, sy: z, angle };
};
const bottom = (p: Placement) => Math.max(...regionRects(p, mask).map((r) => r.bottom));
const top = (p: Placement) => Math.min(...regionRects(p, mask).map((r) => r.top));

describe("tumbling after a throw stays inside the overlay window", () => {
  it("around the feet the upside-down body leaves the canvas (the old bug)", () => {
    expect(bottom(place(76, Math.PI, false))).toBeGreaterThan(340);
  });
  it.each([56, 76, 96, 116])("around the middle it fits at every angle (size %s)", (size) => {
    for (let a = 0; a < Math.PI * 2; a += 0.2) {
      const p = place(size, a, true);
      expect(bottom(p)).toBeLessThanOrEqual(340);
      expect(top(p)).toBeGreaterThanOrEqual(0);
    }
  });
});
