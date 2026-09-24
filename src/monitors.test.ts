import { describe, it, expect } from "vitest";
import { Movement, reachable, neighbor, monitorAt } from "./movement";
import { defaults, Monitor } from "./model";

const mon = (id: string, l: number, t: number, r: number, b: number, taskbar = 40, scale = 1): Monitor => ({
  id,
  primary: id === "a",
  scale,
  bounds: { left: l, top: t, right: r, bottom: b },
  work: { left: l, top: t, right: r, bottom: b - taskbar },
});
const s = { ...defaults, size: 76 };
function walk(w: Movement, monitors: Monitor[], ms: number) {
  const seen = new Set<string>();
  for (let t = 0; t < ms; t += 33) seen.add(w.step(0.033, 1000 + t, s, monitors, [], "idle"));
  return seen;
}

describe("two monitors", () => {
  const a = mon("a", 0, 0, 1920, 1080);
  it("walks across a seam between monitors of the same height", () => {
    const b = mon("b", 1920, 0, 3840, 1080);
    const w = new Movement();
    w.initialize([a, b], 76, { x: 1700, y: 1040 });
    w.go(2600);
    walk(w, [a, b], 30000);
    expect(w.x).toBeGreaterThan(2500);
    expect(w.impacts.filter((i) => i.kind === "wall")).toHaveLength(0);
  });
  it("walks off onto a lower floor and lands on it", () => {
    const b = mon("b", 1920, 0, 4480, 1440);
    const w = new Movement();
    w.initialize([a, b], 76, { x: 1800, y: 1040 });
    w.go(2400);
    walk(w, [a, b], 30000);
    expect(w.x).toBeGreaterThan(2300);
    expect(w.y).toBe(1400);
  });
  it("jumps up onto a higher floor instead of walking into the edge", () => {
    const b = mon("b", 1920, 0, 3286, 768);
    const w = new Movement();
    w.initialize([a, b], 76, { x: 1600, y: 1040 });
    w.go(2500);
    const seen = walk(w, [a, b], 30000);
    expect(seen.has("jump")).toBe(true);
    expect(w.y).toBe(728);
    expect(w.x).toBeGreaterThan(2400);
  });
  it("monitor on the left with negative coordinates", () => {
    const b = mon("b", -2560, 0, 0, 1440);
    const w = new Movement();
    w.initialize([a, b], 76, { x: 150, y: 1040 });
    w.go(-900);
    walk(w, [a, b], 30000);
    expect(w.x).toBeLessThan(-800);
    expect(w.y).toBe(1400);
  });
  it("a throw across the seam does not bounce off it", () => {
    const b = mon("b", 1920, 0, 3840, 1080);
    const w = new Movement();
    w.initialize([a, b], 76, { x: 1700, y: 1040 });
    w.begin(1700, 1000, 0);
    w.drag(1750, 900, 16);
    w.drag(1800, 850, 32);
    w.release(40);
    walk(w, [a, b], 4000);
    expect(w.x).toBeGreaterThan(1920);
    expect(w.impacts.filter((i) => i.kind === "wall")).toHaveLength(0);
  });
  it("different scaling on the second monitor", () => {
    const b = mon("b", 1920, 0, 4800, 1620, 60, 1.5);
    const w = new Movement();
    w.initialize([a, b], 76, { x: 1800, y: 1040 });
    w.go(3000);
    walk(w, [a, b], 40000);
    expect(w.scale).toBe(1.5);
    expect(w.y).toBe(1560);
  });
  it("vertical taskbar on the seam is a wall", () => {
    const aa: Monitor = { ...a, work: { ...a.work, right: 1860 } };
    const b = mon("b", 1920, 0, 3840, 1080);
    expect(neighbor([aa, b], aa, 1)).toBeUndefined();
  });
  it("stacked monitors are not reachable on foot", () => {
    const top = mon("t", 0, -1080, 1920, 0, 0);
    expect(reachable([a, top], a, top)).toBe(false);
    const side = mon("b", 1920, 0, 3840, 1080);
    expect(reachable([a, side], a, side)).toBe(true);
  });
  it("between monitors the nearest one is used, not the primary", () => {
    const b = mon("b", 1920, 0, 3840, 1080);
    expect(monitorAt([a, b], 3000, 1300)?.id).toBe("b");
  });
});

describe("held in the hand", () => {
  const a = mon("a", 0, 0, 1920, 1080);
  it("swings behind the hand and settles", () => {
    const w = new Movement();
    w.initialize([a], 76, { x: 800, y: 1040 });
    w.begin(800, 980, 0);
    let t = 0;
    for (let i = 0; i < 12; i++) {
      t += 33;
      w.drag(800 + i * 40, 980, t);
      w.step(0.033, t, s, [a], [], "idle");
    }
    expect(Math.abs(w.swing)).toBeGreaterThan(0.05);
    for (let i = 0; i < 90; i++) {
      t += 33;
      w.drag(800 + 11 * 40, 980, t);
      w.step(0.033, t, s, [a], [], "idle");
    }
    expect(Math.abs(w.swing)).toBeLessThan(0.05);
  });
  it("shaking makes it dizzy", () => {
    const w = new Movement();
    w.initialize([a], 76, { x: 800, y: 1040 });
    w.begin(800, 980, 0);
    let t = 0;
    for (let i = 0; i < 24; i++) {
      t += 33;
      w.drag(800 + (i % 2 ? 60 : -60), 980, t);
    }
    expect(w.shaking).toBe(true);
    expect(w.takeDizzy()).toBeGreaterThan(1);
  });
  it("a clinging pet stays put until pulled hard", () => {
    const w = new Movement();
    w.initialize([a], 76, { x: 800, y: 1040 });
    w.begin(800, 1000, 0, 1500);
    w.drag(850, 990, 100);
    expect(w.clinging).toBe(true);
    expect(Math.abs(w.x - 800)).toBeLessThan(10);
    expect(w.stretch).toBeGreaterThan(0);
    w.drag(1100, 900, 200);
    expect(w.clinging).toBe(false);
    expect(w.popped).toBe(true);
  });
});
