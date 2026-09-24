import { describe, it, expect } from "vitest";
import { Movement } from "./movement";
import { Director, bondPct } from "./director";
import { cleanGame, likabilityMax, level, newGame } from "./game";
import { defaults, emptyMemory, Monitor } from "./model";

const m: Monitor = {
  id: "m",
  primary: true,
  scale: 1,
  bounds: { left: 0, top: 0, right: 1920, bottom: 1080 },
  work: { left: 0, top: 0, right: 1920, bottom: 1040 },
};
const s = { ...defaults, size: 76 };
const now = new Date(2026, 8, 24, 15).getTime();
const director = () =>
  new Director(
    { ...defaults },
    { ...emptyMemory, lastGreeting: new Date(now).toLocaleDateString("sv") },
    () => 0.99,
  );

describe("throw physics", () => {
  it("a hard throw into the wall bounces back and the landing bounces", () => {
    const w = new Movement();
    w.initialize([m], 76, { x: 1500, y: 1040 });
    w.begin(1500, 1000, 0);
    w.drag(1700, 600, 40);
    w.drag(1850, 300, 80);
    w.release(90);
    expect(w.thrown).toBeGreaterThan(700);
    const kinds: string[] = [];
    for (let t = 0; t < 6000; t += 33) {
      w.step(0.033, 100 + t, s, [m], [], "idle");
      kinds.push(...w.impacts.splice(0).map((i) => i.kind));
    }
    expect(kinds).toContain("wall");
    expect(kinds.filter((k) => k === "floor").length).toBeGreaterThanOrEqual(2);
    expect(w.air).toBe(false);
    expect(w.y).toBe(1040);
    expect(w.x).toBeLessThan(1920);
  });
  it("gently put down: no throw", () => {
    const w = new Movement();
    w.initialize([m], 76, { x: 500, y: 1040 });
    w.begin(500, 1000, 0);
    w.drag(510, 990, 40);
    w.release(400);
    expect(w.thrown).toBe(0);
  });
});

describe("mood and relationship", () => {
  it("throws build a grudge that turns the tone angry; petting and food repair it", () => {
    // Drizz: a full-strength grudge (Aqua, the default, barely holds one).
    const d = new Director({ ...defaults, pet: "drizz" }, { ...emptyMemory, lastGreeting: new Date(now).toLocaleDateString("sv") }, () => 0.99);
    for (let i = 0; i < 5; i++) d.threw(now + i * 5000);
    expect(d.game.grudge).toBeGreaterThanOrEqual(50);
    expect(d.game.throwsToday).toBe(5);
    expect(d.mood(now + 30000)).toBe("angry");
    d.bubble = undefined;
    d.reaction = undefined;
    d.click(now + 40000);
    for (let i = 0; i < 3; i++) d.petted(now + 60000 + i * 10000);
    d.fed(now + 100000);
    expect(d.game.grudge).toBeLessThan(30);
  });
  it("the grudge fades with time", () => {
    const d = director();
    d.game = { ...d.game, grudge: 40, lastTick: now };
    d.applyTick(now + 20 * 60000, { present: true, resting: false, music: false });
    expect(d.game.grudge).toBe(20);
  });
  it("petting raises likability and announces bond milestones", () => {
    const d = director();
    const cap = likabilityMax(level(d.game.exp));
    d.game = { ...d.game, likability: Math.ceil(cap * 0.25) - 1 };
    d.petted(now);
    expect(bondPct(d.game)).toBeGreaterThanOrEqual(25);
    expect(d.reaction?.event).toBe("bondUp");
  });
  it("friendly after a good bond, scared after an alert", () => {
    const d = director();
    d.game = { ...d.game, likability: likabilityMax(level(d.game.exp)) };
    expect(d.mood(now)).toBe("friendly");
    d.trace(
      {
        id: 1, time: now, first: now, kind: "console",
        child: { pid: 1, name: "powershell.exe", path: "", location: "system", signed: null, role: "" },
        origin: { pid: 2, name: "x.exe", path: "", location: "temp", signed: false, role: "" },
        chain: [], visible: false, flash: false, flags: ["encoded"], score: 5,
        verdict: "suspicious", trusted: false, repeat: 1, speak: "alert",
      },
      now,
    );
    expect(d.mood(now + 1000)).toBe("scared");
    expect(d.mood(now + 120000)).toBe("friendly");
  });
  it("likability survives a save/load round trip (was reset to 0)", () => {
    const g = { ...newGame(now), likability: 42, grudge: 7, throwsToday: 3, throwsDay: "2026-09-24" };
    const back = cleanGame(JSON.parse(JSON.stringify(g)), now);
    expect(back.likability).toBe(42);
    expect(back.grudge).toBe(7);
    expect(back.throwsToday).toBe(3);
  });
});
describe("petting cannot be farmed", () => {
  it("pays at most once per 3 s", () => {
    const d = director();
    for (let i = 0; i < 90; i++) d.petted(now + i * 33);
    expect(d.game.likability).toBe(1);
    d.petted(now + 3100);
    expect(d.game.likability).toBe(2);
  });
});
