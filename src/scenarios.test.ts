// Scenario runs: whole behaviours simulated frame by frame without Phaser
// or Windows — the pet's brain, physics, cursor play and antics together.
import { describe, it, expect } from "vitest";
import { Movement } from "./movement";
import { CursorPlay, PlayIntent } from "./cursorplay";
import { Director, bondPct } from "./director";
import { Dialogue, phrases } from "./dialogue";
import { temper, tempers } from "./character";
import { Antics, Host } from "./antics";
import type { FloorItem } from "./props";
import { MiniGames } from "./minigames";
import { parse, obeys } from "./commands";
import { cleanLife, count, lately, newLife, stage } from "./chronicle";
import { cleanGame, likabilityMax, level, newGame } from "./game";
import { defaults, emptyMemory, Monitor, Snapshot } from "./model";

const m: Monitor = {
  id: "m",
  primary: true,
  scale: 1,
  bounds: { left: 0, top: 0, right: 1920, bottom: 1080 },
  work: { left: 0, top: 0, right: 1920, bottom: 1040 },
};
const s = { ...defaults, size: 76 };
const T0 = new Date(2026, 8, 23, 15).getTime(); // a Wednesday afternoon
function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/** Runs cursor play + physics; the "user" leaves the cursor where the pet pushes it. */
function chase(pet: string, o: { cx: number; cy?: number; grudge: number; ms: number; random?: () => number; stage?: number; wronged?: number }) {
  const w = new Movement();
  w.initialize([m], 76, { x: 800, y: 1040 });
  const play = new CursorPlay();
  const t = temper(pet);
  const random = o.random ?? rng(7);
  let cursor = { x: o.cx, y: o.cy ?? 1000, down: false };
  let grudge = o.grudge;
  const log: string[] = [];
  const actions = new Set<string>();
  let forced: { action: string; until: number } | null = null;
  for (let ms = 0; ms < o.ms; ms += 33) {
    const now = T0 + ms;
    const i: PlayIntent = play.update({
      now,
      cursor,
      pet: { x: w.x, y: w.y, air: w.air, dragging: false, onWindow: false },
      size: 76,
      k: 1,
      grudge,
      wronged: o.wronged ?? 60000,
      stage: o.stage ?? 1,
      temper: t,
      enabled: true,
      asleep: false,
      agility: 0,
      random,
    });
    if (i.stop) w.target = w.goal = null;
    if (i.go) w.go(i.go.x, false, i.go.hurry);
    if (i.leap) w.leap(i.leap.x, i.leap.y);
    if (i.action) forced = { action: i.action, until: i.until ?? now + 400 };
    if (i.say) log.push(i.say);
    if (i.count) log.push("#" + i.count);
    if (i.nudge) {
      log.push("nudge");
      cursor = { ...cursor, x: cursor.x + i.nudge.dx, y: Math.min(1030, cursor.y + i.nudge.dy) };
    }
    if (i.calm) grudge = Math.max(0, grudge - i.calm);
    const base = forced && now < forced.until ? forced.action : "idle";
    actions.add(base);
    w.step(0.033, now, s, [m], [], base as never);
  }
  return { log, w, cursor, grudge, play, actions };
}
describe("cursor revenge, character by character", () => {
  it("Drizz hunts the cursor down, hits it and then watches it", () => {
    const r = chase("drizz", { cx: 1300, grudge: 60, ms: 20000 });
    expect(r.log[0]).toBe("cursorHunt");
    expect(r.log).toContain("cursorSwat");
    expect(r.log).toContain("nudge");
    expect(r.log).toContain("cursorWatch");
    expect(r.grudge).toBeLessThan(60);
    expect(r.actions.has("swat")).toBe(true);
  });
  it("Claude reads a moral first and only then swats", () => {
    const r = chase("claude", { cx: 900, grudge: 60, ms: 20000 });
    expect(r.log[0]).toBe("cursorLecture");
    const lecture = r.log.indexOf("cursorLecture"),
      swat = r.log.indexOf("cursorSwat");
    expect(swat).toBeGreaterThan(lecture);
    expect(r.actions.has("judge")).toBe(true);
    expect(r.log.filter((x) => x === "cursorSwat").length).toBeLessThanOrEqual(tempers.claude.swats);
  });
  it("Nezuko chases the cursor and keeps hitting it as it flies away", () => {
    const r = chase("nezukocoder", { cx: 1400, grudge: 90, ms: 25000 });
    expect(r.log.filter((x) => x === "#swat" || x === "#pounce").length).toBeGreaterThanOrEqual(2);
    // The pushed cursor moved well away from where it started.
    expect(Math.abs(r.cursor.x - 1400)).toBeGreaterThan(60);
  });
  it("Eigenblob misses, slips and tries again", () => {
    let n = 0;
    // Every swat misses: the random source always returns low numbers.
    const r = chase("eigenblob", { cx: 1000, grudge: 60, ms: 15000, random: () => ((n++ % 5) + 1) / 100 });
    expect(r.log).toContain("cursorMiss");
    expect(r.actions.has("pained")).toBe(true);
    expect(r.log.filter((x) => x === "cursorMiss").length).toBeGreaterThanOrEqual(2);
  });
  it("Aqua pokes once, limply, and walks away sighing", () => {
    const r = chase("aqua-wisp", { cx: 1000, grudge: 70, ms: 20000, random: () => 0.9 });
    expect(r.log.filter((x) => x === "cursorSwat").length).toBe(1);
    expect(r.log).toContain("cursorLazy");
    expect(r.actions.has("sigh")).toBe(true);
  });
  it("without a grudge it leaves the cursor alone", () => {
    const r = chase("drizz", { cx: 1300, grudge: 0, ms: 10000 });
    expect(r.log).not.toContain("cursorHunt");
    expect(r.log).not.toContain("nudge");
  });
  it("a grudge from long ago does not start a hunt", () => {
    const r = chase("drizz", { cx: 1300, grudge: 80, ms: 5000, wronged: 3 * 3600000 });
    expect(r.log).not.toContain("cursorHunt");
  });
});
describe("cursor lingering and flying past", () => {
  it("touches a cursor resting next to it, then pushes it", () => {
    const r = chase("drizz", { cx: 830, cy: 1010, grudge: 0, ms: 9000, random: () => 0.5 });
    const touch = r.log.indexOf("cursorTouch"),
      push = r.log.indexOf("cursorPush");
    expect(touch).toBeGreaterThanOrEqual(0);
    expect(push).toBeGreaterThan(touch);
    expect(r.log.filter((x) => x === "nudge").length).toBe(2);
  });
  it("Nezuko tries to catch a cursor flung past her head", () => {
    const play = new CursorPlay();
    const t = temper("nezukocoder");
    const base = { pet: { x: 800, y: 1040, air: false, dragging: false, onWindow: false }, size: 76, k: 1, grudge: 0, wronged: Infinity, stage: 0, temper: t, enabled: true, asleep: false, agility: 0, random: () => 0.1 };
    play.update({ ...base, now: T0, cursor: { x: 600, y: 1000, down: false } });
    const i = play.update({ ...base, now: T0 + 33, cursor: { x: 790, y: 1000, down: false } });
    expect(i.caught).toBe(true);
    expect(["cursorCatch", "cursorMiss"]).toContain(i.say);
  });
  it("catch-the-cursor game counts catches", () => {
    const games = new MiniGames();
    games.start("catch", T0, () => 0.5);
    const r = chase("drizz", { cx: 1100, grudge: 0, ms: 1 });
    r.play.game(T0, 20000);
    let caught = 0;
    const w = r.w;
    let cursor = { x: 1100, y: 1000, down: false };
    for (let ms = 0; ms < 20000; ms += 33) {
      const i = r.play.update({ now: T0 + ms, cursor, pet: { x: w.x, y: w.y, air: w.air, dragging: false, onWindow: false }, size: 76, k: 1, grudge: 0, wronged: Infinity, stage: 2, temper: temper("drizz"), enabled: true, asleep: false, agility: 0, random: () => 0.5 });
      if (i.go) w.go(i.go.x, false, i.go.hurry);
      if (i.caught) {
        caught++;
        games.caught();
        // The user yanks the cursor away after each catch.
        cursor = { ...cursor, x: cursor.x > 960 ? 300 : 1600 };
      }
      w.step(0.033, T0 + ms, s, [m], [], "idle");
    }
    expect(caught).toBeGreaterThanOrEqual(1);
    const out = games.tick(T0 + 20001);
    expect(out?.event).toMatch(/gameWin|gameLose/);
  });
});
const snap = (now: number, patch: Partial<Snapshot> = {}): Snapshot => ({
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
const day = new Date(T0).toLocaleDateString("sv");
// Read through functions: after `d.reaction = undefined` TypeScript narrows
// the field to `never` for the rest of the test.
const ev = (d: Director): string | undefined => d.reaction?.event;
const said = (d: Director): string | undefined => d.bubble?.text;
const brain = (pet = "drizz", random = () => 0.5) =>
  new Director({ ...defaults, pet }, { ...emptyMemory, lastGreeting: day, daily: { morning: day, lunch: day, weekend: day, holiday: day } }, random, newGame(T0));
describe("memory of what you did", () => {
  it("three throws: sulks in a corner until fed", () => {
    const d = brain();
    for (let i = 0; i < 3; i++) d.threw(T0 + i * 20000);
    expect(d.sulkUntil).toBeGreaterThan(T0 + 60000);
    d.base = "idle";
    d.reaction = undefined;
    expect(d.action(T0 + 70000)).toBe("sulk");
    d.fed(T0 + 80000);
    expect(d.action(T0 + 90000)).toBe("idle");
  });
  it("after two throws it grumbles when picked up and clings to its spot", () => {
    const d = brain();
    d.threw(T0);
    d.threw(T0 + 30000);
    d.reaction = undefined;
    const resist = d.grabbed(T0 + 60000, false);
    expect(ev(d)).toBe("regrab");
    expect(resist).toBeGreaterThan(0);
  });
  it("woken three times within an hour: the fourth time it starts with a face", () => {
    const d = brain();
    for (let i = 0; i < 3; i++) {
      d.base = "sleep";
      d.reaction = undefined;
      d.wake(T0 + i * 600000);
    }
    expect(ev(d)).toBe("grumpyWake");
    expect(lately(d.life, "wake", T0 + 1800000, 3600000)).toBe(3);
  });
  it("pulled off the same window twice: clings next time", () => {
    const d = brain();
    d.dragged(T0, true);
    d.dragged(T0 + 60000, true);
    expect(d.grabbed(T0 + 120000, true)).toBeGreaterThan(0);
  });
  it("throws in one program make it dislike that program", () => {
    const d = brain();
    d.observe(snap(T0, { app: "excel.exe" }));
    for (let i = 0; i < 9; i++) d.threw(T0 + 1000 + i * 1000);
    d.observe(snap(T0 + 20000, { app: "code.exe" }));
    d.reaction = undefined;
    d.bubble = undefined;
    d.dialogue.last = -Infinity;
    d.observe(snap(T0 + 40000, { app: "excel.exe" }));
    expect(ev(d)).toBe("judgeApp");
    expect(said(d)).toContain("Excel");
  });
  it("a window that keeps vanishing under it becomes a target out of spite", () => {
    const d = brain();
    for (let i = 0; i < 3; i++) d.fell(T0 + i * 120000, "notepad.exe");
    expect(d.spiteful("notepad.exe")).toBe(true);
    expect(ev(d)).toBe("closedAgain");
  });
  it("counts are kept across a save and load", () => {
    const d = brain();
    for (let i = 0; i < 4; i++) d.threw(T0 + i * 1000);
    const back = cleanGame(JSON.parse(JSON.stringify(d.game)), T0 + 5000);
    expect(count(back.life, "throw")).toBe(4);
    expect(lately(back.life, "throw", T0 + 5000, 60000)).toBe(4);
  });
  it("junk in the saved life is cleaned, not trusted", () => {
    const l = cleanLife({ counts: { throw: "NaN", fed: 3 }, apps: { "x.exe": 999 }, role: { id: "guard", until: 0 }, recent: { throw: ["a", 5] } }, T0);
    expect(l.counts.throw).toBeUndefined();
    expect(l.counts.fed).toBe(3);
    expect(l.apps["x.exe"]).toBe(100);
    expect(l.role).toBeNull();
    expect(l.recent.throw).toEqual([5]);
  });
});
describe("achievements", () => {
  it("an achievement unlocked during another reaction waits its turn and does not restyle that line", () => {
    const d = brain();
    d.game = { ...d.game, lastTick: T0 };
    d.dizzy(T0, 3);
    const line = said(d);
    d.heartbeat(T0 + 100, { present: true, resting: false, music: false });
    expect(d.bubble?.kind).toBeUndefined();
    expect(said(d)).toBe(line);
    d.heartbeat(T0 + 6000, { present: true, resting: false, music: false });
    expect(ev(d)).toBe("achievement");
    expect(d.bubble?.kind).toBe("sign");
    expect(d.life.achievements.dizzy).toBeGreaterThan(0);
  });
});
describe("time", () => {
  it("a night with the app closed: the pet slept, got hungry, earned nothing", () => {
    const d = brain();
    d.game = { ...d.game, strength: 40, lastTick: T0 };
    const money = d.game.money;
    d.applyTick(T0 + 8 * 3600000, { present: true, resting: false, music: false });
    expect(d.game.strength).toBeGreaterThan(90);
    expect(d.game.food).toBeGreaterThan(40);
    expect(d.game.health).toBeGreaterThan(90);
    expect(d.game.money - money).toBeLessThan(5);
  });
  it("a shift that ended while the app was closed is paid on the next start", () => {
    const d = brain();
    d.game = { ...d.game, job: { id: "flyers", startedAt: T0, endsAt: T0 + 5 * 60000 }, lastTick: T0 };
    const saved = cleanGame(JSON.parse(JSON.stringify(d.game)), T0 + 3600000);
    expect(saved.job?.id).toBe("flyers");
    const e = new Director({ ...defaults }, { ...emptyMemory }, () => 0.5, saved);
    expect(e.workPayout(T0 + 3600000)).toBe(true);
    expect(e.game.money).toBeGreaterThan(saved.money);
  });
  it("sleeps at night even while you work, and grumbles at the clock", () => {
    const night = new Date(2026, 8, 24, 2, 0).getTime();
    const d = new Director({ ...defaults }, { ...emptyMemory, lastGreeting: new Date(night).toLocaleDateString("sv") }, () => 0.5, newGame(night));
    d.observe(snap(night, { idle: 1000, input: { clicks: 0, rightClicks: 0, wheel: 0, keys: 0, shots: 0, lastClick: null } }));
    expect(d.base).toBe("sleep");
    d.observe(snap(night + 2000, { idle: 1000, input: { clicks: 0, rightClicks: 0, wheel: 0, keys: 30, shots: 0, lastClick: null } }));
    d.reaction = undefined;
    d.observe(snap(night + 4000, { idle: 500, input: { clicks: 0, rightClicks: 0, wheel: 0, keys: 60, shots: 0, lastClick: null } }));
    expect(["nightCheck", "nightOwl", "night"]).toContain(ev(d));
  });
  it("the night line is said once per night, also across a restart", () => {
    const late = new Date(2026, 8, 23, 23, 30).getTime();
    const mem = { ...emptyMemory, lastGreeting: new Date(late).toLocaleDateString("sv"), daily: {} as Record<string, string> };
    const d = new Director({ ...defaults, nightSleep: false }, mem, () => 0.5, newGame(late));
    d.observe(snap(late));
    expect(ev(d)).toBe("night");
    // Restart after midnight: same night, no second line.
    const e = new Director({ ...defaults, nightSleep: false }, { ...mem, daily: { ...d.memory.daily } }, () => 0.5, newGame(late));
    e.observe(snap(late + 3600000));
    expect(ev(e)).not.toBe("night");
  });
  it("a streak of days is counted and celebrated", () => {
    const d = brain();
    d.life.lastDay = new Date(T0 - 86400000).toLocaleDateString("sv");
    d.life.streak = 4;
    d.observe(snap(T0));
    d.observe(snap(T0 + 1000));
    expect(d.life.streak).toBe(5);
  });
  it("birthday: congratulates by name", () => {
    const bd = new Date(T0);
    const key = `${String(bd.getMonth() + 1).padStart(2, "0")}-${String(bd.getDate()).padStart(2, "0")}`;
    const d = new Director({ ...defaults }, { ...emptyMemory, address: "Вася", birthday: key, lastGreeting: day }, () => 0.1, newGame(T0));
    d.observe(snap(T0));
    d.observe(snap(T0 + 1000));
    expect(ev(d)).toBe("birthday");
  });
});
describe("relationship", () => {
  it("strangers on day one, friends after weeks of care", () => {
    const g = newGame(T0);
    expect(stage(bondPct(g), g.life, T0)).toBe(0);
    const later = T0 + 20 * 86400000;
    const loved = { ...g, likability: likabilityMax(level(g.exp)) };
    expect(stage(bondPct(loved), loved.life, later)).toBe(4);
    // A day of abuse drags it down a step.
    for (let i = 0; i < 12; i++) loved.life.recent.throw = [...(loved.life.recent.throw ?? []), later - i * 1000];
    expect(stage(bondPct(loved), loved.life, later)).toBe(3);
  });
  it("close friends get personal lines with the name and a fact", () => {
    const d = new Dialogue([], () => 0.1);
    const text = d.choose("chatter", defaults, T0, true, { name: "Вася", fact: "люблю пиццу" }, "normal", "close");
    expect(text).toBeTruthy();
    expect(phrases["chatter~close"]).toContain(
      phrases["chatter~close"].find((t) => text!.includes("Вася") || text!.includes("пиццу") || t === text) ?? text,
    );
  });
  it("lines with {name} are skipped when there is no name", () => {
    const d = new Dialogue([], () => 0);
    for (let i = 0; i < 20; i++) {
      const t = d.choose("chatter", defaults, T0 + i * 1000, true, {}, "normal", "best");
      expect(t).not.toContain("{name}");
      expect(t).not.toContain("{fact}");
    }
  });
  it("commands: friends obey, strangers mostly refuse, 'go away' always works", () => {
    const t = temper("drizz");
    let friend = 0,
      stranger = 0;
    const r = rng(3);
    for (let i = 0; i < 200; i++) {
      if (obeys("sit", { stage: 4, grudge: 0, hungry: false, temper: t, random: r })) friend++;
      if (obeys("sit", { stage: 0, grudge: 40, hungry: true, temper: t, random: r })) stranger++;
    }
    expect(friend).toBeGreaterThan(150);
    expect(stranger).toBeLessThan(40);
    expect(obeys("go", { stage: 0, grudge: 100, hungry: true, temper: t, random: () => 0.99 })).toBe(true);
    expect(parse("Отвали!")?.cmd).toBe("go");
    expect(parse("иди сюда")?.cmd).toBe("come");
    expect(parse("что это")).toBeNull();
  });
});
describe("climbing and falling", () => {
  it("climbs the side of a window, hangs from the top and pulls itself up", () => {
    const w = new Movement();
    w.initialize([m], 76, { x: 480, y: 1040 });
    w.random = () => 0.9;
    const win = { id: 5, rect: { left: 500, top: 300, right: 1400, bottom: 1040 } };
    expect(w.startClimb(win, -1, 76)).toBe(true);
    const seen = new Set<string>();
    for (let t = 0; t < 20000 && !w.support; t += 33) seen.add(w.step(0.033, T0 + t, s, [m], [win], "idle"));
    expect(seen.has("hang")).toBe(true);
    expect(w.support?.id).toBe(5);
    expect(w.y).toBe(300);
  });
  it("loses its grip and slides back down", () => {
    const w = new Movement();
    w.initialize([m], 76, { x: 480, y: 1040 });
    // Grips well for a while, then loses it halfway up.
    let calls = 0;
    w.random = () => (++calls < 60 ? 0.9 : 0.0001);
    const win = { id: 5, rect: { left: 500, top: 300, right: 1400, bottom: 1040 } };
    w.startClimb(win, -1, 76);
    const seen = new Set<string>();
    for (let t = 0; t < 20000; t += 33) seen.add(w.step(0.033, T0 + t, s, [m], [win], "idle"));
    expect(seen.has("flail")).toBe(true);
    expect(w.support).toBeNull();
    expect(w.y).toBe(1040);
  });
  it("a hard throw sends it tumbling and it lands dizzy", () => {
    const w = new Movement();
    w.initialize([m], 76, { x: 400, y: 1040 });
    w.begin(400, 1000, T0);
    w.drag(700, 700, T0 + 40);
    w.drag(1000, 400, T0 + 80);
    w.release(T0 + 90);
    let spun = false;
    for (let t = 0; t < 6000; t += 33) {
      w.step(0.033, T0 + 100 + t, s, [m], [], "idle");
      if (Math.abs(w.swing) > 1) spun = true;
    }
    expect(spun).toBe(true);
    expect(w.swing).toBe(0);
    expect(w.takeDizzy()).toBeGreaterThan(0.5);
  });
});
describe("antics", () => {
  const fakeProps = () => {
    let id = 1;
    const p = {
      items: [] as FloorItem[],
      drop(kind: FloorItem["kind"], x: number, y: number, now: number, label?: string) {
        const it = { id: id++, kind, x, y, vx: 0, label, born: now };
        p.items.push(it);
        return it;
      },
      remove(i: number) {
        p.items = p.items.filter((x) => x.id !== i);
      },
    };
    return p;
  };
  const host = (a: { now: number }, w: Movement, d: Director, props: ReturnType<typeof fakeProps>): Host => ({
    get now() {
      return a.now;
    },
    world: w,
    brain: d,
    props: props as never,
    settings: { ...defaults },
    monitors: [m],
    override: () => {},
    say: (e, direct) => d.event(e, a.now, direct),
    glyph: () => {},
    random: () => 0.5,
  });
  it("'отвали': walks off to the edge, leaves a note, a quick click gets 'I did write it', then comes back", () => {
    const w = new Movement();
    w.initialize([m], 76, { x: 1500, y: 1040 });
    const d = brain();
    const props = fakeProps();
    const clock = { now: T0 };
    const an = new Antics();
    const h = () => host(clock, w, d, props);
    an.leave(h(), "go", 60000, "Ушёл. Сам сказал.");
    for (let t = 0; t < 15000 && an.away?.phase === "leaving"; t += 33) {
      clock.now = T0 + t;
      an.update(h());
      w.step(0.033, clock.now, s, [m], [], "idle");
    }
    expect(an.away?.phase).toBe("gone");
    expect(an.absent).toBe(true);
    const note = props.items.find((i) => i.kind === "note")!;
    expect(note.label).toBe("Ушёл. Сам сказал.");
    clock.now += 1000;
    an.clickItem(h(), note);
    const second = props.items.find((i) => i.kind === "note")!;
    expect(phrases.noteAgain).toContain(second.label);
    clock.now += 10000;
    an.clickItem(h(), second);
    expect(an.away).toBeNull();
    expect(props.items.filter((i) => i.kind === "note")).toHaveLength(0);
  });
  it("after a throw: a silent stare, then the sign", () => {
    const w = new Movement();
    w.initialize([m], 76, { x: 900, y: 1040 });
    const d = brain();
    d.threw(T0);
    d.threw(T0 + 1000);
    const clock = { now: T0 + 2000 };
    const an = new Antics();
    const h = () => host(clock, w, d, fakeProps());
    an.thrownLanded(h());
    d.reaction = undefined;
    const seen: string[] = [];
    for (let t = 0; t < 5000; t += 100) {
      clock.now = T0 + 2000 + t;
      an.update(h());
      const e = ev(d);
      if (e && !seen.includes(e)) seen.push(e);
    }
    expect(seen).toEqual(["stare", "remember"]);
    expect(d.bubble?.kind).toBe("sign");
  });
  it("a gift is taken into the collection", () => {
    const w = new Movement();
    w.initialize([m], 76, { x: 900, y: 1040 });
    const d = brain();
    d.game = { ...d.game, likability: 999, life: { ...newLife(T0 - 10 * 86400000) } };
    const props = fakeProps();
    const clock = { now: T0 };
    const an = new Antics();
    (an as unknown as { bringGift: (h: Host) => void }).bringGift(host(clock, w, d, props));
    const gift = props.items[0];
    expect(d.bubble?.actions?.map((a) => a.id)).toEqual(["gift:take", "gift:no"]);
    const money = d.game.money;
    an.takeGift(host(clock, w, d, props));
    const got = gift.kind === "coin" ? d.game.money > money : Object.keys({ ...d.life.collection, ...d.life.pantry }).length > 0;
    expect(got).toBe(true);
    expect(count(d.life, "gift")).toBe(1);
  });
});
describe("mini-games", () => {
  it("rock-paper-scissors pays a win and cheers the pet up on a loss", () => {
    const g = new MiniGames();
    g.start("rps", T0, () => 0);
    const win = g.answer("paper", () => 0); // pet: rock
    expect(win?.event).toBe("gameWin");
    g.start("rps", T0, () => 0);
    const lose = g.answer("scissors", () => 0);
    expect(lose?.event).toBe("gameLose");
    expect(lose!.feeling).toBeGreaterThan(win!.feeling);
  });
  it("clicker scores clicks in ten seconds", () => {
    const g = new MiniGames();
    g.start("clicker", T0, () => 0);
    for (let i = 0; i < 30; i++) g.click(T0 + i * 300);
    expect(g.click(T0 + 11000)).toBe(false);
    const out = g.tick(T0 + 10001);
    expect(out?.event).toBe("gameWin");
    expect(out?.prize).toBe(15);
  });
});
