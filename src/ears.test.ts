// Ear care (ears.ts) and the language / swearing switch in dialogue.
import { describe, expect, it } from "vitest";
import { EarSample, allowedHours, dbVolume, earLevel, earTick, emptyEars, gains, levels, volumeDb, weekly } from "./ears";
import { cleanSettings, defaults, Settings } from "./model";
import { Director } from "./director";
import { emptyMemory } from "./model";
import { newGame } from "./game";
import { Dialogue, linesFor, phrases } from "./dialogue";
import { en } from "./lines.en";
import { EN_SWEAR, cleanEn } from "./swear";
const T0 = new Date(2026, 8, 24, 14, 0, 0).getTime();
const cfg = (patch: Partial<Settings> = {}): Settings => ({ ...defaults, ...patch });
const hp = (volume: number, extra: Partial<EarSample> = {}): EarSample => ({ headphones: true, playing: true, muted: false, volume, ...extra });
/** Runs `minutes` of 2-second samples; collects event names. */
function listen(minutes: number, sample: EarSample, s: Settings, start = T0, log = emptyEars()) {
  const names: string[] = [];
  let gainsOut: [number, number] = [1, 1];
  let t = start;
  for (let i = 0; i < minutes * 30; i++) {
    t += 2000;
    const r = earTick(log, sample, s, t, 2000);
    log = r.log;
    gainsOut = r.gains;
    names.push(...r.events.map((e) => e.name));
  }
  return { log, names, t, gains: gainsOut };
}
describe("ear care: the numbers", () => {
  it("WHO / H.870: 80 dB for 40 h is 100 %, +3 dB halves the time", () => {
    expect(allowedHours(80, 80)).toBeCloseTo(40, 5);
    expect(allowedHours(83, 80)).toBeCloseTo(20, 0);
    expect(allowedHours(90, 80)).toBeCloseTo(4, 5);
    expect(allowedHours(75, 75)).toBeCloseTo(40, 5);
  });
  it("estimates the level from the Windows volume, per ear", () => {
    expect(volumeDb(100)).toBe(0);
    expect(volumeDb(50)).toBeCloseTo(-10, 0);
    expect(dbVolume(volumeDb(40))).toBeCloseTo(0.4, 2);
    // Earbuds at full volume: ~88 dB of average music.
    expect(earLevel(0, 100)).toBe(88);
    // Real channel levels win over the master volume.
    const [l, r] = levels(hp(80, { db: -3, left: -3, right: -13 }), 100);
    expect(l).toBe(85);
    expect(r).toBe(75);
  });
  it("balance and the resting ear become gains, the louder ear at 1", () => {
    expect(gains(cfg({ balance: 0 }), "")).toEqual([1, 1]);
    expect(gains(cfg({ balance: 40 }), "")).toEqual([0.6, 1]);
    expect(gains(cfg({ balance: -100 }), "")).toEqual([1, 0]);
    expect(gains(cfg({ earsRestDim: 50 }), "l")).toEqual([0.5, 1]);
    expect(gains(cfg({ earsRestDim: 50 }), "r")).toEqual([1, 0.5]);
  });
});
describe("ear care: what the pet notices", () => {
  it("only counts headphones (unless told otherwise) and only while sound plays", () => {
    const speakers = listen(30, hp(90, { headphones: false }), cfg());
    expect(weekly(speakers.log, speakers.t).min).toBe(0);
    const always = listen(30, hp(90, { headphones: false }), cfg({ earsDevice: "always" }));
    expect(weekly(always.log, always.t).min).toBeGreaterThan(29);
    const silent = listen(30, hp(90, { playing: false }), cfg());
    expect(weekly(silent.log, silent.t).min).toBe(0);
    const off = listen(30, hp(90), cfg({ ears: false }));
    expect(weekly(off.log, off.t).min).toBe(0);
  });
  it("says hello once a day, then warns about loud listening with a 'turn down' button", () => {
    const r = listen(10, hp(85), cfg());
    expect(r.names.filter((n) => n === "earsHello")).toHaveLength(1);
    // 85 % ≈ −2.3 dB → ~85.7 dBA: loud for three minutes.
    expect(r.names).toContain("earsLoud");
    const quiet = listen(10, hp(40), cfg());
    expect(quiet.names).not.toContain("earsLoud");
    expect(quiet.names).not.toContain("earsVeryLoud");
    const spike = earTick(emptyEars(), hp(100, { db: 0, left: 0, right: 0 }), cfg({ earsMax: 110 }), T0, 2000);
    expect(spike.events.find((e) => e.name === "earsVeryLoud")?.lower).toBe(true);
  });
  it("asks for a break after an hour on end, louder after 90 minutes, and praises the break", () => {
    const r = listen(95, hp(40), cfg({ earsBreak: 60 }));
    expect(r.names.filter((n) => n === "earsBreak")).toHaveLength(1);
    expect(r.names.filter((n) => n === "earsBreakLong")).toHaveLength(1);
    // Six quiet minutes: the session ends with a "rested".
    const after = listen(6, hp(40, { playing: false }), cfg(), r.t, r.log);
    expect(after.names).toContain("earsRested");
    expect(after.log.session).toBe(0);
  });
  it("counts the weekly dose and marks 50 / 80 / 100 % once each", () => {
    // 90 dBA: 4 h is the whole week. Four and a half hours of it.
    const s = cfg({ earsMax: 102, earsBreak: 180 });
    const r = listen(270, hp(100, { db: 0, left: 0, right: 0 }), s);
    const w = weekly(r.log, r.t);
    expect(w.l).toBeGreaterThan(1);
    expect(r.names.filter((n) => n === "earsDose50")).toHaveLength(1);
    expect(r.names.filter((n) => n === "earsDose80")).toHaveLength(1);
    expect(r.names.filter((n) => n === "earsDose100")).toHaveLength(1);
    expect(r.names).not.toContain("earsLowered");
    const auto = listen(270, hp(100, { db: 0, left: 0, right: 0 }), { ...s, earsAutoLower: true });
    expect(auto.names).toContain("earsLowered");
  });
  it("forgets days older than a week", () => {
    const r = listen(60, hp(70), cfg());
    const later = r.t + 8 * 86400000;
    expect(weekly(r.log, later).min).toBe(0);
  });
  it("rests the ears in turns while listening and gives the balance back when stopped", () => {
    const s = cfg({ earsRest: true, earsRestMinutes: 10, earsRestDim: 50 });
    const r = listen(25, hp(50), s);
    expect(r.names.filter((n) => n === "earsRestSwap")).toHaveLength(3);
    expect(r.gains).toEqual([0.5, 1]);
    const stopped = listen(6, hp(50, { playing: false }), s, r.t, r.log);
    expect(stopped.gains).toEqual([1, 1]);
    const noRest = earTick(r.log, hp(50), { ...s, earsRest: false }, r.t + 2000, 2000);
    expect(noRest.gains).toEqual([1, 1]);
  });
  it("notices one ear taking much more (a skewed balance)", () => {
    const r = listen(200, hp(100, { db: 0, left: 0, right: -15 }), cfg({ earsMax: 100, earsBreak: 180 }));
    expect(r.names).toContain("earsUneven");
  });
  it("reminds at night once", () => {
    const night = new Date(2026, 8, 24, 23, 30).getTime();
    const r = listen(45, hp(60), cfg({ lateHour: 23 }), night);
    expect(r.names.filter((n) => n === "earsNight")).toHaveLength(1);
  });
});
describe("ear care through the director", () => {
  it("speaks a loud warning with buttons and hands the gains to the scene", () => {
    const s = cfg({ balance: 30 });
    const d = new Director(s, { ...emptyMemory }, () => 0.3, newGame(T0));
    const env = { volume: 95, muted: false, audio: true, clipboard: 0, caps: false, dark: false, memory: 10, disk: 50, windows: 3, headphones: true, db: -0.5, left: -0.5, right: -0.5 };
    let t = T0;
    let said = "";
    for (let i = 0; i < 150; i++) {
      t += 2000;
      d.observe({ now: t, idle: 0, app: "spotify.exe", fullscreen: false, foreground: 1, windows: [], monitors: [], media: { playing: true, available: true, track: "", position: 0 }, cpu: 5, online: true, battery: null, plugged: true, controller: false, locked: false, env });
      d.heartbeat(t, { present: true, resting: false, music: true });
      if (d.reaction?.event === "earsVeryLoud" || d.reaction?.event === "earsLoud") {
        said = d.bubble?.text ?? "";
        expect(d.bubble?.actions?.map((a) => a.id)).toContain("ears:lower");
        break;
      }
    }
    expect(said).not.toBe("");
    expect(d.earGains).toEqual([0.7, 1]);
  });
});
describe("language and swearing", () => {
  it("every Russian bank has an English one with the same variables", () => {
    const vars = (t: string) => [...t.matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
    for (const [k, ru] of Object.entries(phrases)) {
      expect(en[k], k).toBeDefined();
      const allowed = new Set(ru.flatMap(vars));
      for (const line of en[k]) for (const v of vars(line)) expect(allowed.has(v), `${k}: ${line}`).toBe(true);
    }
  });
  it("English is clean by default: no swear word survives cleanEn", () => {
    for (const [k, bank] of Object.entries(en))
      for (const line of bank) expect(EN_SWEAR.test(cleanEn(line)), `${k}: ${cleanEn(line)}`).toBe(false);
    expect(cleanEn("Good fucking morning. Or whatever time it is for you.")).toBe("Good morning. Or whatever time it is for you.");
    expect(cleanEn("I'm here, bitch. Settling in.")).toBe("I'm here. Settling in.");
  });
  it("picks the bank by language and softens English unless swearing is on", () => {
    const pick = (s: Settings) => new Dialogue([], () => 0).choose("hello", s, T0, true);
    expect(pick(cfg())).toBe(phrases.hello[0]);
    const clean = pick(cfg({ lang: "en" }))!;
    expect(clean).toBe("Alright, let's go. I'm already here.");
    expect(pick(cfg({ lang: "en", swear: true }))).toBe(en.hello[0]);
    expect(linesFor("hello", cfg({ lang: "en" })).every((t) => !EN_SWEAR.test(t))).toBe(true);
    // Russian lines are never softened, whatever the switch says.
    expect(linesFor("poke", cfg({ lang: "ru", swear: false }))).toEqual(phrases.poke);
  });
  it("capitalises a line that starts with a variable", () => {
    const text = new Dialogue([], () => 0).choose("earsRestSwap", cfg({ lang: "en" }), T0, true, { side: "left" });
    expect(text?.[0]).toBe(text?.[0].toUpperCase());
  });
  it("understands English commands", async () => {
    const { parse } = await import("./commands");
    expect(parse("sit down")?.cmd).toBe("sit");
    expect(parse("come here!")?.cmd).toBe("come");
    expect(parse("go away")?.cmd).toBe("go");
    expect(parse("let's play")?.cmd).toBe("play");
    expect(parse("сядь")?.cmd).toBe("sit");
  });
});
describe("spike guard settings", () => {
  it("is off by default and keeps the ceiling and plug-in volume in range", () => {
    const d = cleanSettings({});
    expect(d.earsGuard).toBe(false);
    expect(d.earsCeiling).toBe(60);
    expect(d.earsSafe).toBe(20);
    const s = cleanSettings({ earsGuard: true, earsCeiling: 200, earsSafe: -5 });
    expect(s.earsGuard).toBe(true);
    expect(s.earsCeiling).toBe(95);
    expect(s.earsSafe).toBe(0);
  });
  it("has guard lines in both languages with the same variables", () => {
    for (const k of ["earsGuardClamp", "earsGuardPlug", "earsGuardWake"]) {
      expect(phrases[k]?.length).toBeGreaterThan(0);
      expect(en[k]?.length).toBeGreaterThan(0);
    }
  });
});
describe("mixer balance and the dose", () => {
  it("a quieter ear in the mixer counts less; a muted ear counts nothing", () => {
    const e = { headphones: true, playing: true, muted: false, volume: 80, db: -3, left: -3, right: -3 };
    const [l0, r0] = levels(e, 100);
    const [l, r] = levels({ ...e, gains: [0.5, 1] }, 100);
    expect(r).toBe(r0);
    expect(l).toBeCloseTo(l0 - 6.02, 1);
    expect(levels({ ...e, gains: [0, 1] }, 100)[0]).toBe(0);
  });
});
describe("measured sound (audio tap)", () => {
  const e = { headphones: true, playing: true, muted: false, volume: 80, db: -3, left: -3, right: -3 };
  it("the content level replaces the typical-music guess, per ear", () => {
    // Typical master (-12 against a full-scale sine) = the old estimate.
    expect(levels({ ...e, tap: [-12, -12] }, 100)[0]).toBeCloseTo(levels(e, 100)[0], 5);
    // A quiet podcast at -30 counts 18 dB less than the guess, a brick-walled track at -6 counts 6 more.
    expect(levels({ ...e, tap: [-30, -6] }, 100)).toEqual([67, 91]);
  });
  it("mixer gains are already inside the measured content, not applied twice", () => {
    expect(levels({ ...e, gains: [0.5, 1], tap: [-18, -12] }, 100)).toEqual([79, 85]);
  });
  it("silence and a muted device count nothing", () => {
    expect(levels({ ...e, tap: [-120, -120] }, 100)).toEqual([0, 0]);
    expect(levels({ ...e, volume: 0, db: -100, left: -100, right: -100, tap: [-10, -10] }, 100)).toEqual([0, 0]);
  });
  it("a quiet week of measured podcasts stays far under the dose", () => {
    const s = { ...defaults, ears: true } as Settings;
    const quiet = listen(120, hp(80, { db: -3, left: -3, right: -3, tap: [-30, -30] }), s);
    const guess = listen(120, hp(80, { db: -3, left: -3, right: -3 }), s);
    expect(quiet.log.days[0].l).toBeLessThan(guess.log.days[0].l / 30);
  });
});
describe("ears lines actually get said", () => {
  it("every ears event has a rule and lines in both languages", async () => {
    const { rules } = await import("./director");
    const names = ["earsOn", "earsHello", "earsLoud", "earsVeryLoud", "earsBreak", "earsBreakLong", "earsRested", "earsNight", "earsDose50", "earsDose80", "earsDose100", "earsLowered", "earsUneven", "earsRestSwap", "earsThanks"];
    for (const n of names) {
      expect(rules[n], n).toBeDefined();
      expect(linesFor(n, cfg()).length, n).toBeGreaterThan(0);
      expect(linesFor(n, cfg({ lang: "en" })).length, n).toBeGreaterThan(0);
    }
  });
  it("a line that comes while the pet is busy waits and is said later", async () => {
    const { rules } = await import("./director");
    const d = new Director(cfg(), { ...emptyMemory }, () => 0.3, newGame(T0));
    const env = { volume: 40, muted: false, audio: true, clipboard: 0, caps: false, dark: false, memory: 10, disk: 50, windows: 3, headphones: true, db: -13, left: -13, right: -13 };
    let t = T0;
    const said: string[] = [];
    for (let i = 0; i < 400; i++) {
      t += 2000;
      // Something stronger keeps the pet busy for the first three minutes.
      if (t - T0 < 180000) d.reaction = { event: "traceAlert", rule: rules.traceAlert, until: t + 5000 };
      d.observe({ now: t, idle: 0, app: "spotify.exe", fullscreen: false, foreground: 1, windows: [], monitors: [], media: { playing: true, available: true, track: "", position: 0 }, cpu: 5, online: true, battery: null, plugged: true, controller: false, locked: false, env });
      d.tick(t);
      d.heartbeat(t, { present: true, resting: false, music: true });
      if (d.reaction?.event?.startsWith("ears")) said.push(d.reaction.event);
    }
    expect(said).toContain("earsHello");
  });
});
