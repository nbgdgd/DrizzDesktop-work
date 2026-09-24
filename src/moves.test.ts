import { describe, it, expect } from "vitest";
import { Movement } from "./movement";
import { Director } from "./director";
import { defaults, emptyMemory, Monitor, Snapshot } from "./model";

const m: Monitor = {
  id: "m",
  primary: true,
  scale: 1,
  bounds: { left: 0, top: 0, right: 1920, bottom: 1080 },
  work: { left: 0, top: 0, right: 1920, bottom: 1040 },
};
const s = { ...defaults, size: 76 };
const run = (w: Movement, surfaces: Parameters<Movement["step"]>[4], ms: number) => {
  const seen = new Set<string>();
  for (let t = 0; t < ms; t += 33) seen.add(w.step(0.033, 1000 + t, s, [m], surfaces, "idle"));
  return seen;
};

describe("leaps and runs", () => {
  it("leaps onto the top edge of a window and sits on it", () => {
    const w = new Movement();
    w.initialize([m], 76, { x: 700, y: 1040 });
    const win = { id: 7, rect: { left: 500, top: 700, right: 1300, bottom: 1000 } };
    expect(w.leap(760, win.rect.top)).toBe(true);
    const seen = run(w, [win], 3000);
    expect(seen.has("jump")).toBe(true);
    expect(w.support?.id).toBe(7);
    expect(w.y).toBe(700);
    expect(Math.abs(w.x - 760)).toBeLessThan(40);
  });
  it("refuses a jump that is too high", () => {
    const w = new Movement();
    w.initialize([m], 76, { x: 700, y: 1040 });
    expect(w.leap(700, 200)).toBe(false);
  });
  it("runs faster than it walks", () => {
    const walk = new Movement();
    walk.initialize([m], 76, { x: 200, y: 1040 });
    walk.go(1500);
    run(walk, [], 3000);
    const sprint = new Movement();
    sprint.initialize([m], 76, { x: 200, y: 1040 });
    sprint.go(1500, false, 2.6);
    run(sprint, [], 3000);
    expect(sprint.x - 200).toBeGreaterThan((walk.x - 200) * 2);
  });
});

describe("windows reactions", () => {
  const now = new Date(2026, 8, 24, 15).getTime();
  const snap = (patch: Partial<Snapshot>): Snapshot => ({
    now,
    idle: 0,
    app: "explorer.exe",
    fullscreen: false,
    foreground: 1,
    windows: [],
    monitors: [m],
    media: { available: false, playing: false, track: "", position: 0 },
    cpu: 5,
    online: true,
    battery: null,
    plugged: false,
    controller: false,
    locked: false,
    ...patch,
  });
  const director = () =>
    new Director(
      { ...defaults },
      { ...emptyMemory, lastGreeting: new Date(now).toLocaleDateString("sv") },
      () => 0,
    );
  it("wants to climb onto a newly focused big window", () => {
    const d = director();
    d.position(600, 1040);
    const win = { id: 42, rect: { left: 300, top: 500, right: 1400, bottom: 1000 } };
    d.observe(snap({ foreground: 1, windows: [win] }));
    d.observe(snap({ now: now + 1000, foreground: 42, windows: [win] }));
    expect(d.wantHop?.id).toBe(42);
    expect(d.wantHop?.top).toBe(500);
  });
  it("notices a drive being plugged in", () => {
    const d = director();
    const env = (drives: number) => ({ volume: 50, muted: false, audio: false, clipboard: 1, caps: false, dark: true, memory: 40, disk: 50, windows: 5, drives });
    d.observe(snap({ env: env(0b100) }));
    d.observe(snap({ now: now + 1000, env: env(0b10100) }));
    expect(d.reaction?.event).toBe("driveIn");
  });
});
