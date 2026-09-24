// Regression tests for the defects found in the 0.1.0 handover build:
// invisible sprite (CSP), blurry/misaligned overlay at Windows scaling,
// frame warnings from an absent texture, lost pet after monitor changes.
import { describe, it, expect, vi } from "vitest";
import { Animator, clips } from "./animation";
import { canvasSize, canvasZoom, BASE_WIDTH, BASE_HEIGHT } from "./dpi";
import { overlayLayout } from "./layout";
import { Movement } from "./movement";
import { Director } from "./director";
import { defaults, emptyMemory, Monitor, pets } from "./model";
import conf from "../src-tauri/tauri.conf.json";

vi.mock("./bridge", () => ({
  native: false,
  command: vi.fn(async () => undefined),
  on: vi.fn(async () => () => {}),
}));
import { Diag } from "./diag";

const directive = (name: string) =>
  String(conf.tauri.security.csp)
    .split(";")
    .map((d) => d.trim())
    .find((d) => d.startsWith(name + " ")) ?? "";

describe("production CSP keeps sprite loading possible", () => {
  it("allows same-origin XHR/fetch (Phaser loads images as blobs by default)", () => {
    expect(directive("connect-src")).toContain("'self'");
  });
  it("allows same-origin and blob images", () => {
    expect(directive("img-src")).toContain("'self'");
    expect(directive("img-src")).toContain("blob:");
  });
});

describe("DPI: canvas backing store versus logical overlay size", () => {
  it.each([1, 1.25, 1.5, 1.75, 2, 2.5, 3])(
    "keeps the CSS size at 360×340 for devicePixelRatio %s",
    (dpr) => {
      const { width, height } = canvasSize(dpr);
      expect(Number.isInteger(width) && Number.isInteger(height)).toBe(true);
      expect(width * canvasZoom(dpr)).toBeCloseTo(BASE_WIDTH, 6);
      expect(Math.abs(height * canvasZoom(dpr) - BASE_HEIGHT)).toBeLessThan(1);
      expect(width).toBe(Math.round(BASE_WIDTH * dpr));
    },
  );
  it("survives nonsense ratios", () => {
    expect(canvasSize(0)).toEqual(canvasSize(1));
    expect(canvasSize(NaN)).toEqual(canvasSize(1));
  });
  it.each([1, 1.25, 1.5, 2, 3])(
    "overlay anchor maps back to the physical pet position at scale %s",
    (dpr) => {
      const m: Monitor = {
        id: "m",
        primary: true,
        scale: dpr,
        bounds: { left: -1000, top: -200, right: 2000, bottom: 1400 },
        work: { left: -1000, top: -200, right: 2000, bottom: 1350 },
      };
      for (const x of [-990, -100, 0, 700, 1990])
        for (const y of [-190, 100, 1350]) {
          const l = overlayLayout(x, y, 116, dpr, m);
          expect(l.left + l.anchorX * dpr).toBeCloseTo(x, 6);
          expect(l.top + l.anchorY * dpr).toBeCloseTo(y, 6);
          expect(l.left).toBeGreaterThanOrEqual(m.work.left);
          expect(l.left + BASE_WIDTH * dpr).toBeLessThanOrEqual(m.work.right);
        }
    },
  );
});

describe("animation frames stay inside the 72-cell atlas", () => {
  it.each(pets.map((p) => p.id))("%s", (id) => {
    const a = new Animator(id);
    // Every clip, including the ones added later (moods, hanging, dancing).
    const actions = Object.keys(clips(id)) as (keyof ReturnType<typeof clips>)[];
    for (const action of actions)
      for (let t = 0; t < 20000; t += 37) {
        const f = a.frame(action, 1000 + t);
        expect(Number.isInteger(f)).toBe(true);
        expect(f).toBeGreaterThanOrEqual(0);
        expect(f).toBeLessThan(72);
      }
  });
});

describe("return the pet to the screen", () => {
  const primary: Monitor = {
    id: "p",
    primary: true,
    scale: 1.5,
    bounds: { left: 0, top: 0, right: 2880, bottom: 1620 },
    work: { left: 0, top: 0, right: 2880, bottom: 1560 },
  };
  const secondary: Monitor = {
    id: "s",
    primary: false,
    scale: 1,
    bounds: { left: 2880, top: 0, right: 4800, bottom: 1080 },
    work: { left: 2880, top: 0, right: 4800, bottom: 1040 },
  };
  it("places the pet on the floor of an attached monitor and drops supports", () => {
    const w = new Movement();
    w.initialize([primary, secondary], 116, { x: 4000, y: 700 });
    w.support = { id: 7, rect: { left: 3000, top: 700, right: 4200, bottom: 1000 } };
    w.vx = 40;
    w.air = true;
    w.placeOn(primary, [primary], 116);
    expect(w.support).toBeNull();
    expect(w.air).toBe(false);
    expect(w.vx).toBe(0);
    expect(w.y).toBe(primary.work.bottom);
    expect(w.x).toBeGreaterThan(primary.work.left);
    expect(w.x).toBeLessThan(primary.work.right);
    expect(w.scale).toBe(1.5);
  });
  it("recovers a saved position from a disconnected monitor", () => {
    const w = new Movement();
    w.initialize([primary], 116, { x: 4000, y: 1040 });
    expect(w.x).toBeLessThanOrEqual(primary.work.right);
    expect(w.y).toBeLessThanOrEqual(primary.work.bottom);
    expect(w.x).toBeGreaterThanOrEqual(primary.work.left);
  });
});

describe("direct interaction wakes a resting pet", () => {
  it("sleep → idle on wake, untouched in DND", () => {
    const now = Date.now();
    const d = new Director({ ...defaults }, { ...emptyMemory }, () => 0);
    d.base = "sleep";
    d.wake(now);
    expect(d.base).toBe("idle");
    const dnd = new Director({ ...defaults, mode: "dnd" }, { ...emptyMemory }, () => 0);
    dnd.base = "sleep";
    dnd.wake(now);
    expect(dnd.base).toBe("sleep");
  });
});

describe("diagnostics never repeat an unchanged value", () => {
  it("logs on change only and is silent when disabled", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const d = new Diag();
    d.log("pose", "a");
    expect(info).not.toHaveBeenCalled();
    d.enabled = true;
    d.log("pose", "a");
    d.log("pose", "a");
    d.log("pose", "a");
    expect(info).toHaveBeenCalledTimes(1);
    d.log("pose", "b");
    expect(info).toHaveBeenCalledTimes(2);
    d.log("state", "b");
    expect(info).toHaveBeenCalledTimes(3);
    info.mockRestore();
  });
});
