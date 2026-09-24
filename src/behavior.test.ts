import { describe, it, expect } from "vitest";
import { Director } from "./director";
import { Dialogue, phrases } from "./dialogue";
import { Movement } from "./movement";
import { Animator, clips } from "./animation";
import {
  defaults,
  emptyMemory,
  Monitor,
  Snapshot,
  cleanSettings,
} from "./model";
const now = new Date(2026, 8, 20, 14).getTime();
const mem = () => ({
  ...emptyMemory,
  recent: [],
  facts: [],
  lastGreeting: new Date(now).toLocaleDateString("sv"),
});
const monitor: Monitor = {
  id: "main",
  primary: true,
  scale: 1,
  bounds: { left: 0, top: 0, right: 1920, bottom: 1080 },
  work: { left: 0, top: 0, right: 1920, bottom: 1040 },
};
const snap = (patch: Partial<Snapshot> = {}): Snapshot => ({
  now,
  idle: 0,
  app: "explorer.exe",
  fullscreen: false,
  foreground: 1,
  windows: [],
  monitors: [monitor],
  media: { available: false, playing: false, track: "", position: 0 },
  cpu: 10,
  online: true,
  battery: null,
  plugged: false,
  controller: false,
  locked: false,
  ...patch,
});
const director = () => new Director({ ...defaults }, mem(), () => 0);
describe("reactions and privacy", () => {
  it("expires bubble without click", () => {
    const d = director();
    d.event("click", now, true);
    expect(d.bubble).toBeDefined();
    d.tick(now + 11000);
    expect(d.bubble).toBeUndefined();
  });
  it("returns to current sleep state after temporary reaction", () => {
    const d = director();
    d.base = "sleep";
    d.event("click", now, true);
    expect(d.action(now + 10000)).toBe("sleep");
  });
  it("does not queue hidden reactions", () => {
    const d = director();
    d.observe(snap({ fullscreen: true }));
    d.event("build-success", now);
    expect(d.reaction).toBeUndefined();
    d.observe(snap({ now: now + 15000 }));
    expect(d.reaction?.event).not.toBe("build-success");
  });
  it("DND silences even direct replies", () => {
    const d = director();
    d.updateSettings({ ...defaults, mode: "dnd" });
    d.click(now);
    expect(d.bubble).toBeUndefined();
    expect(d.reaction).toBeUndefined();
  });
  it("quiet reacts but has no autonomous speech", () => {
    const d = director();
    d.updateSettings({ ...defaults, mode: "quiet" });
    d.event("editor", now);
    expect(d.reaction?.event).toBe("editor");
    expect(d.bubble).toBeUndefined();
  });
  it("priority preserves direct interactions", () => {
    const d = director();
    d.event("click", now, true);
    d.event("editor", now + 100);
    expect(d.reaction?.event).toBe("click");
  });
  it("cooldown prevents repeat event", () => {
    const d = director();
    expect(d.event("game", now)).toBe(true);
    expect(d.event("game", now + 5000)).toBe(false);
  });
  it("does not mark media/controller users absent", () => {
    for (const patch of [
      { media: { available: true, playing: true, track: "a", position: 10 } },
      { controller: true },
      { app: "game.exe" },
    ]) {
      const d = director();
      d.settings.games = ["game.exe"];
      d.observe(snap({ idle: 900000, ...patch }));
      expect(d.base).not.toBe("sleep");
      expect(d.base).not.toBe("rest");
    }
  });
  it("rest then sleep then return", () => {
    const d = director();
    d.observe(snap());
    d.observe(snap({ now: now + 300000, idle: 300000 }));
    expect(d.base).toBe("rest");
    d.observe(snap({ now: now + 900000, idle: 900000 }));
    expect(d.base).toBe("sleep");
    d.observe(snap({ now: now + 910000, idle: 0 }));
    expect(d.reaction?.event).toBe("return");
  });
  it("notifies return from hidden game without replaying start", () => {
    const d = director();
    d.settings.games = ["game.exe"];
    d.observe(snap());
    d.observe(snap({ now: now + 10000, app: "code.exe" }));
    d.observe(snap({ now: now + 20000, app: "game.exe", fullscreen: true }));
    d.observe(snap({ now: now + 30000, app: "code.exe" }));
    expect(d.reaction?.event).toBe("breakEnd");
  });
  it("does not invent battery for desktop", () => {
    const d = director();
    d.observe(snap());
    d.observe(snap({ now: now + 10000, battery: null, plugged: true }));
    expect(d.reaction?.event).not.toBe("power");
  });
  it("integration opt in and deduplicates episode id", () => {
    const d = director();
    const e = { id: "a", kind: "episode-ended", title: "Test" };
    d.integration(e, now);
    expect(d.reaction).toBeUndefined();
    d.settings.integration = true;
    d.integration(e, now);
    expect(d.reaction?.event).toBe("episode-ended");
    d.tick(now + 20000);
    d.integration(e, now + 20000);
    expect(d.reaction).toBeUndefined();
    expect(phrases["episode-ended"].join()).not.toContain("сезон завершён");
  });
  it("changes pet clears reaction", () => {
    const d = director();
    d.click(now);
    d.updateSettings({ ...defaults, pet: "claude" });
    expect(d.reaction).toBeUndefined();
    expect(d.bubble).toBeUndefined();
  });
  it("comment interval and recent suppression", () => {
    const d = new Dialogue([], () => 0);
    const first = d.choose("click", defaults, now, true);
    const second = d.choose("click", defaults, now + 2000, true);
    expect(second).not.toBe(first);
    expect(d.choose("editor", defaults, now + 10000)).toBeUndefined();
  });
  it("single phrase bank remains usable", () => {
    const d = new Dialogue([], () => 0);
    const s = { ...defaults, pet: "claude" };
    expect(d.choose("idle", s, now, true)).toBeTruthy();
    expect(d.choose("idle", s, now + 600000, true)).toBeTruthy();
  });
});
describe("physical motion", () => {
  const world = () => {
    const w = new Movement();
    w.initialize([monitor], 116, { x: 400, y: 1040 });
    return w;
  };
  it("moving selects direction-specific animation", () => {
    const w = world();
    w.go(700);
    let a = "";
    for (let i = 0; i < 40; i++)
      a = w.step(0.033, i * 33, defaults, [monitor], [], "idle");
    expect(w.x).toBeGreaterThan(400);
    expect(a).toBe("walkRight");
  });
  it("sleeper does not decide to walk", () => {
    const w = world();
    w.go(700);
    for (let i = 0; i < 100; i++)
      w.step(0.033, i * 33, defaults, [monitor], [], "sleep");
    expect(w.x).toBe(400);
  });
  it("land on window then follow and fall on close", () => {
    const w = world();
    const win = {
      id: 77,
      rect: { left: 200, top: 400, right: 900, bottom: 900 },
    };
    w.y = 300;
    w.air = true;
    for (let i = 0; i < 80; i++)
      w.step(0.033, i * 33, defaults, [monitor], [win], "idle");
    expect(w.support?.id).toBe(77);
    expect(w.y).toBe(400);
    w.follow({
      ...win,
      rect: { left: 250, top: 500, right: 950, bottom: 1000 },
    });
    expect(w.x).toBe(450);
    expect(w.y).toBe(500);
    w.follow(null);
    for (let i = 0; i < 80; i++)
      w.step(0.033, i * 33, defaults, [monitor], [], "idle");
    expect(w.y).toBe(1040);
    expect(w.support).toBeNull();
  });
  it("negative monitor coordinates and unplug recovery", () => {
    const left = {
      ...monitor,
      id: "left",
      primary: false,
      bounds: { left: -1600, top: 0, right: 0, bottom: 1000 },
      work: { left: -1600, top: 0, right: 0, bottom: 960 },
      scale: 1.25,
    };
    const w = new Movement();
    w.initialize([monitor, left], 116, { x: -500, y: 960 });
    expect(w.x).toBe(-500);
    expect(w.scale).toBe(1.25);
    w.recover([monitor], 116);
    expect(w.x).toBeGreaterThan(0);
    expect(w.y).toBeLessThanOrEqual(1040);
  });
  it("drag release is bounded and falls", () => {
    const w = world();
    w.begin(400, 1000, now);
    w.drag(-50000, -50000, now + 100);
    w.release(now + 101);
    w.recover([monitor], 116);
    for (let i = 0; i < 200; i++)
      w.step(0.033, i * 33, defaults, [monitor], [], "idle");
    expect(w.x).toBeGreaterThan(0);
    expect(w.y).toBe(1040);
  });
  it("pin stops autonomous movement but drag works", () => {
    const w = world();
    w.go(800);
    w.step(0.05, now, { ...defaults, pinned: true }, [monitor], [], "idle");
    expect(w.x).toBe(400);
    w.begin(400, 1040, now);
    w.drag(600, 1040, now + 100);
    expect(w.x).toBe(600);
  });
  it("does not land behind occluding window", () => {
    const w = world();
    w.y = 300;
    w.air = true;
    const back = {
        id: 1,
        rect: { left: 200, top: 400, right: 800, bottom: 900 },
      },
      front = { id: 2, rect: { left: 200, top: 200, right: 800, bottom: 800 } };
    for (let i = 0; i < 80; i++)
      w.step(0.033, i * 33, defaults, [monitor], [front, back], "idle");
    expect(w.support).toBeNull();
    expect(w.y).toBe(1040);
  });
});
describe("assets and settings", () => {
  it("all states use valid atlas frames and positive durations", () => {
    for (const id of [
      "drizz",
      "claude",
      "eigenblob",
      "aqua-wisp",
      "nezukocoder",
    ])
      for (const c of Object.values(clips(id))) {
        expect(c.cells.length).toBe(c.durations.length);
        expect(c.cells.every((n) => n >= 0 && n < 72)).toBe(true);
        expect(c.durations.every((n) => n > 0)).toBe(true);
      }
  });
  it("one-shot does not loop while waiting for director", () => {
    const a = new Animator("drizz");
    a.frame("wave", 100);
    expect(a.frame("wave", 9999)).toBe(clips("drizz").wave.cells.at(-1));
  });
  it("size and idle thresholds are bounded", () => {
    const s = cleanSettings({ size: 2000, idleMinutes: 10, sleepMinutes: 2 });
    expect(s.size).toBe(176);
    expect(s.sleepMinutes).toBeGreaterThan(s.idleMinutes);
  });
});
describe("global input, chatter, stats and progression", () => {
  const input = (patch: Partial<NonNullable<Snapshot["input"]>> = {}) => ({
    clicks: 0,
    rightClicks: 0,
    wheel: 0,
    keys: 0,
    shots: 0,
    lastClick: null,
    ...patch,
  });
  it("typing burst reacts once and then respects its cooldown", () => {
    const d = director();
    d.observe(snap({ input: input() }));
    d.observe(snap({ now: now + 3000, input: input({ keys: 25 }) }));
    expect(d.reaction).toBeUndefined();
    d.observe(snap({ now: now + 6000, input: input({ keys: 45 }) }));
    expect(d.reaction?.event).toBe("typing");
    expect(d.bubble?.text).toBeDefined();
    d.reaction = undefined;
    d.observe(snap({ now: now + 9000, input: input({ keys: 95 }) }));
    expect(d.reaction).toBeUndefined();
  });
  it("click storm and scrolling are separate reactions", () => {
    const d = director();
    d.observe(snap({ input: input() }));
    d.observe(snap({ now: now + 2000, input: input({ clicks: 9 }) }));
    expect(d.reaction?.event).toBe("clicking");
    const e = director();
    e.observe(snap({ input: input() }));
    e.observe(snap({ now: now + 4000, input: input({ wheel: 35 }) }));
    expect(e.reaction?.event).toBe("scrolling");
  });
  it("reactions are not blocked by the ambient comment budget", () => {
    const d = director();
    d.observe(snap({ input: input() }));
    d.event("chatter", now + 1000);
    expect(d.bubble).toBeDefined();
    d.reaction = undefined;
    d.observe(snap({ now: now + 30000, input: input({ clicks: 9 }) }));
    expect((d.reaction as { event: string } | undefined)?.event).toBe("clicking");
    expect(d.bubble?.text).toBeDefined();
    expect(d.event("idle", now + 31000)).toBe(false);
  });
  it("a far click makes the pet curious and walk there", () => {
    const d = new Director({ ...defaults }, mem(), () => 0.1);
    d.position(100, 1040);
    d.observe(snap({ input: input() }));
    d.observe(
      snap({
        now: now + 1000,
        input: input({ clicks: 1, lastClick: { x: 1500, y: 500, t: 5 } }),
      }),
    );
    expect(d.reaction?.event).toBe("curious");
    expect(d.wantGo).toBe(1500);
  });
  it("chatter fires on its own timer only while the user is around", () => {
    const d = director();
    d.observe(snap());
    expect(d.chatter(now + 1000)).toBe(false);
    const at = now + defaults.commentMinutes * 60000 * 1.3 + 1000;
    d.observe(snap({ now: at, idle: 150000 }));
    expect(d.chatter(at)).toBe(false);
    const later = at + defaults.commentMinutes * 60000 * 1.3 + 1000;
    d.observe(snap({ now: later, idle: 0 }));
    expect(d.chatter(later)).toBe(true);
    expect(d.bubble?.text).toBeDefined();
  });
  it("reports the day's top program with a friendly name", () => {
    const d = director();
    d.observe(snap({ usage: { today: [{ app: "chrome.exe", seconds: 8100 }] } }));
    const at = now + 151 * 60000;
    d.observe(snap({ now: at, usage: { today: [{ app: "chrome.exe", seconds: 8100 }] } }));
    expect(d.reaction?.event).toBe("stats");
    expect(d.bubble?.text).toContain("Chrome");
    expect(d.bubble?.text).toContain("2 ч 15 мин");
  });
  it("evening summary once per day after 21:00", () => {
    const d = director();
    const evening = new Date(2026, 8, 20, 21, 5).getTime();
    d.observe(snap({ now: evening, usage: { today: [{ app: "code.exe", seconds: 3600 }] } }));
    expect(d.reaction?.event).toBe("statsDay");
    d.reaction = undefined;
    d.observe(snap({ now: evening + 60000, usage: { today: [{ app: "code.exe", seconds: 3600 }] } }));
    expect(d.reaction).toBeUndefined();
  });
  it("level up celebrates and needs nag when hungry", () => {
    const d = director();
    d.game = { ...d.game, exp: 99, lastTick: now };
    expect(d.applyTick(now + 60000, { present: true, resting: false, music: false })).toBe(true);
    expect(d.reaction?.event).toBe("levelUp");
    expect(d.bubble?.text).toContain("2");
    const h = director();
    h.game = { ...h.game, food: 10, lastTick: now };
    h.applyTick(now + 60000, { present: true, resting: false, music: false });
    expect(h.reaction?.event).toBe("hungry");
  });
  it("clicks lift the mood at most three times a minute", () => {
    const d = director();
    for (let i = 0; i < 5; i++) d.click(now + i * 100);
    expect(d.game.feeling).toBe(61);
  });
  it("mode changes the wandering pace and low strength forces rest", () => {
    const d = director();
    expect(d.wanderFactor()).toBe(1);
    d.game = { ...d.game, feeling: 95 };
    expect(d.wanderFactor()).toBe(0.7);
    d.game = { ...d.game, health: 10 };
    expect(d.wanderFactor()).toBe(2);
    d.game = { ...d.game, health: 100, strength: 5 };
    d.observe(snap());
    expect(d.base).toBe("rest");
  });
});
