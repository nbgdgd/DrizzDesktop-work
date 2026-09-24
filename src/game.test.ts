import { describe, expect, it } from "vitest";
import {
  cleanGame,
  eat,
  interact,
  items,
  level,
  levelUpNeed,
  likabilityMax,
  mode,
  newGame,
  tick,
} from "./game";

const env = { present: true, resting: false, music: false };

describe("VPet formulas", () => {
  it("level grows with the square root of exp", () => {
    expect(level(0)).toBe(1);
    expect(level(99)).toBe(1);
    expect(level(100)).toBe(2);
    expect(level(400)).toBe(3);
    expect(level(-5)).toBe(1);
    expect(levelUpNeed(1)).toBe(100);
    expect(levelUpNeed(3)).toBe(900);
    expect(likabilityMax(2)).toBe(110);
  });
  it("mode follows health, feeling and likability", () => {
    const g = newGame(0);
    expect(mode({ ...g, feeling: 95 })).toBe("happy");
    expect(mode({ ...g, feeling: 60 })).toBe("normal");
    expect(mode({ ...g, feeling: 20 })).toBe("poor");
    expect(mode({ ...g, health: 50 })).toBe("poor");
    expect(mode({ ...g, health: 20 })).toBe("ill");
  });
});

describe("tick", () => {
  it("one present minute at neutral mood", () => {
    const g = tick(newGame(0), 1, env);
    expect(g.exp).toBe(1);
    expect(g.feeling).toBeCloseTo(59.85);
    expect(g.food).toBeCloseTo(99.6);
    expect(g.drink).toBeCloseTo(99.4);
    expect(g.strength).toBeCloseTo(99.7);
    expect(g.money).toBeCloseTo(1001.65);
  });
  it("good mood gives extra exp, health and likability", () => {
    const g = tick({ ...newGame(0), feeling: 95, health: 90 }, 1, env);
    expect(g.exp).toBe(3);
    expect(g.health).toBe(91);
    expect(g.likability).toBe(1);
  });
  it("bad mood costs exp and likability", () => {
    const g = tick({ ...newGame(0), feeling: 10, likability: 5, exp: 10 }, 1, env);
    expect(g.exp).toBe(10);
    expect(g.likability).toBe(4);
  });
  it("absent user: no exp or money, slow decay", () => {
    const g = tick(newGame(0), 4, { ...env, present: false });
    expect(g.exp).toBe(0);
    expect(g.money).toBe(1000);
    expect(g.food).toBeCloseTo(100 - 0.4);
  });
  it("resting restores strength", () => {
    const g = tick({ ...newGame(0), strength: 50 }, 1, { ...env, resting: true });
    expect(g.strength).toBeCloseTo(52);
  });
  it("empty stomach hurts health", () => {
    const g = tick({ ...newGame(0), food: 0 }, 1, env);
    expect(g.health).toBeCloseTo(98.6);
  });
  it("music lifts the mood a little", () => {
    const g = tick(newGame(0), 1, { ...env, music: true });
    expect(g.feeling).toBeCloseTo(59.95);
  });
  it("stored nutrition trickles in by a tenth per minute", () => {
    const g = tick({ ...newGame(0), food: 50, storeFood: 20 }, 1, env);
    expect(g.storeFood).toBeCloseTo(18);
    expect(g.food).toBeCloseTo(50 - 0.4 + 2);
  });
  it("a happy hour is worth three exp a minute", () => {
    expect(tick({ ...newGame(0), feeling: 100 }, 60, env).exp).toBe(180);
  });
  it("catches up at most eight hours", () => {
    const g = tick(newGame(0), 100000, env);
    expect(g.food).toBe(0);
    expect(g.exp).toBeLessThanOrEqual(480);
  });
});

describe("interactions and food", () => {
  it("click raises feeling, poke lowers it", () => {
    expect(interact(newGame(0), "click").feeling).toBe(62);
    expect(interact(newGame(0), "poke").feeling).toBe(59);
    expect(interact(newGame(0), "win").money).toBe(1020);
  });
  it("eating pays, applies half now and stores half", () => {
    const burger = items.find((i) => i.id === "burger")!;
    const g = eat({ ...newGame(0), food: 20, strength: 10 }, burger)!;
    expect(g.money).toBeCloseTo(1000 - burger.price);
    expect(g.food).toBeCloseTo(20 + burger.food / 2);
    expect(g.storeFood).toBeCloseTo(burger.food / 2);
    expect(g.strength).toBeCloseTo(10 + burger.strength / 2);
    expect(g.exp).toBe(burger.exp);
    expect(g.feeling).toBe(100);
  });
  it("refuses when broke", () => {
    const steak = items.find((i) => i.id === "steak")!;
    expect(eat({ ...newGame(0), money: 5 }, steak)).toBeNull();
  });
  it("every item has an icon and a positive price", () => {
    for (const i of items) {
      expect(i.icon).toMatch(/^\/shop\/[a-z]+\.png$/);
      expect(i.price).toBeGreaterThan(0);
    }
    expect(items.length).toBeGreaterThanOrEqual(24);
  });
});

describe("cleanGame", () => {
  it("fills a fresh game for garbage", () => {
    const g = cleanGame({}, 5);
    expect(g.money).toBe(1000);
    expect(g.lastTick).toBe(5);
    const bad = cleanGame({ money: -3, food: 500, likability: 999, exp: "x" } as never, 5);
    expect(bad.money).toBe(0);
    expect(bad.food).toBe(100);
    expect(bad.exp).toBe(0);
    expect(bad.likability).toBe(100);
  });
});
