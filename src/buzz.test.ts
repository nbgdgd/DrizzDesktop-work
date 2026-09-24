import { describe, it, expect } from "vitest";
import { Buzz, BuzzInput } from "./buzz";
import { phrases } from "./dialogue";
import { rules } from "./director";
import { itemById } from "./game";

const input = (now: number, patch: Partial<BuzzInput> = {}): BuzzInput => ({
  now,
  pet: { x: 1000, y: 1040, air: false, dragging: false },
  left: 100,
  right: 1800,
  k: 1,
  size: 95,
  random: Math.random,
  ...patch,
});
const run = (b: Buzz, from: number, ms: number, step = 100) => {
  const out = [];
  for (let t = from; t < from + ms; t += step) out.push(b.step(input(t)));
  return out;
};

describe("energy drink", () => {
  it("sprints edge to edge, jumps, then crashes and wears off", () => {
    const b = new Buzz();
    b.start("energy", 0);
    const during = run(b, 0, 45000);
    const runs = during.filter((i) => i.go);
    expect(runs.length).toBeGreaterThan(15);
    expect(runs.every((i) => i.go!.hurry >= 5)).toBe(true);
    // Alternates sides of the floor.
    const sides = runs.map((i) => (i.go!.x > 950 ? 1 : -1));
    expect(sides.filter((s, i) => i && s !== sides[i - 1]).length).toBeGreaterThan(runs.length * 0.8);
    expect(during.some((i) => i.jump)).toBe(true);
    expect(b.animSpeed(20000)).toBeGreaterThan(1.5);
    const crash = b.step(input(45100));
    expect(crash.say).toBe("energyCrash");
    expect(crash.action).toBe("rest");
    expect(b.after(50000)).toBe(true);
    run(b, 45200, 25000);
    expect(b.kind).toBeNull();
  });
  it("a second can adds time, capped at two minutes", () => {
    const b = new Buzz();
    b.start("energy", 0);
    b.start("energy", 10000);
    expect(b.until).toBe(90000);
    b.start("energy", 20000);
    b.start("energy", 21000);
    expect(b.until).toBeLessThanOrEqual(21000 + 120000);
  });
  it("coffee is a half-strength energy", () => {
    const b = new Buzz();
    b.start("energy", 0, 0.5);
    expect(b.until).toBe(22500);
  });
});

describe("beer", () => {
  it("staggers slowly, sways, hiccups, stumbles and punches every ~10 s", () => {
    const b = new Buzz();
    b.start("beer", 0);
    const during = run(b, 0, 60000);
    const walks = during.filter((i) => i.go);
    expect(walks.length).toBeGreaterThan(10);
    expect(walks.filter((i) => i.go!.hurry < 1).length).toBeGreaterThan(walks.length / 2);
    expect(during.some((i) => i.glyph?.[0] === "ик!")).toBe(true);
    expect(during.some((i) => i.stumble)).toBe(true);
    const smashes = during.filter((i) => i.smash);
    expect(smashes.length).toBeGreaterThanOrEqual(3);
    expect(smashes.every((i) => i.action === "swat")).toBe(true);
    expect(b.smashes).toBe(smashes.length);
    expect(Math.abs(b.sway(12345))).toBeGreaterThan(0);
    expect(b.sway(70000)).toBe(0);
    expect(b.step(input(60050)).say).toBe("hangover");
  });
  it("does nothing while held in the hand", () => {
    const b = new Buzz();
    b.start("beer", 0);
    expect(b.step(input(10000, { pet: { x: 1000, y: 800, air: true, dragging: true } }))).toEqual({});
  });
});

describe("drinks are wired", () => {
  it("beer is in the shop", () => {
    expect(itemById("beer")?.kind).toBe("drink");
  });
  it("every drink event has a rule and lines without unknown variables", () => {
    for (const e of ["energyStart", "energyRush", "energyCrash", "beerStart", "drunk", "hic", "hangover", "beerSmash", "beerScreen", "beerShove", "beerKnockout", "beerClose"]) {
      expect(rules[e], e).toBeDefined();
      expect(phrases[e]?.length, e).toBeGreaterThan(0);
      for (const l of phrases[e]) expect(l.replace(/\{item\}/g, "")).not.toMatch(/\{\w+\}/);
    }
  });
});
