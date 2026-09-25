// A day of life in a few seconds: the director gets a snapshot every 2 s
// and a heartbeat every 2 s for 24 simulated hours, with the user coming
// and going, switching apps, typing, listening on headphones, throwing and
// feeding the pet, consoles starting in the background and so on. Nothing
// here asserts a particular line; it guards what breaks a published build
// after hours of use: state that outgrows what Rust agrees to save (64 KB
// game, 20 KB memory), NaN in the stats, a pet that never stops talking or
// never talks, lines that leak {variables}, exceptions.
import { describe, expect, it } from "vitest";
import { Director } from "./director";
import { defaults, emptyMemory, Settings, Snapshot } from "./model";
import { cleanGame, newGame } from "./game";
import { cleanLife } from "./chronicle";
import { setLang } from "./i18n";
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
/** Paths of numbers that are NaN or ±Infinity (JSON would turn them into null). */
function nonFinite(v: unknown, path = ""): string[] {
  if (typeof v === "number") return Number.isFinite(v) ? [] : [path];
  if (v && typeof v === "object") return Object.entries(v).flatMap(([k, x]) => nonFinite(x, `${path}.${k}`));
  return [];
}
const apps = ["code.exe", "chrome.exe", "telegram.exe", "spotify.exe", "explorer.exe", "game.exe", "notepad.exe", "vlc.exe"];
function day(settings: Partial<Settings>, seed: number, hours = 24) {
  const random = rng(seed);
  const s: Settings = { ...defaults, ...settings, games: ["game.exe"] };
  const T0 = new Date(2026, 8, 25, 7, 0, 0).getTime();
  const d = new Director(s, { ...emptyMemory, address: "Вася", facts: ["люблю пиццу"] }, random, newGame(T0));
  const said: { t: number; text: string }[] = [];
  let lastText = "";
  let app = "code.exe";
  let away = false;
  let playing = false;
  let headphones = true;
  let keys = 0,
    clicks = 0,
    wheel = 0;
  let volume = 40;
  const end = T0 + hours * 3600000;
  for (let t = T0; t < end; t += 2000) {
    // The user: long stretches of work, breaks, going away for an hour.
    if (random() < 0.002) away = !away;
    if (!away && random() < 0.01) app = apps[Math.floor(random() * apps.length)];
    if (random() < 0.003) playing = !playing;
    if (random() < 0.0005) headphones = !headphones;
    if (random() < 0.002) volume = Math.round(20 + random() * 80);
    if (!away) {
      keys += random() < 0.5 ? Math.floor(random() * 12) : 0;
      clicks += random() < 0.2 ? 1 : 0;
      wheel += random() < 0.1 ? 3 : 0;
    }
    const n: Snapshot = {
      now: t,
      idle: away ? 600000 : random() * 5000,
      app: away ? "" : app,
      fullscreen: app === "game.exe" && random() < 0.5,
      foreground: 1,
      windows: [],
      monitors: [],
      media: { playing, available: true, track: "", position: 0 },
      cpu: 5 + random() * 30,
      online: random() > 0.001,
      battery: null,
      plugged: true,
      controller: false,
      locked: away && random() < 0.5,
      input: { clicks, rightClicks: 0, wheel, keys, shots: 0, lastClick: null },
      env: {
        volume,
        muted: false,
        audio: playing,
        clipboard: Math.floor(t / 600000),
        caps: false,
        dark: true,
        memory: 40,
        disk: 30,
        windows: 6,
        headphones,
        db: -((100 - volume) / 3),
        left: -((100 - volume) / 3),
        right: -((100 - volume) / 3),
      },
    };
    d.observe(n);
    d.tick(t);
    d.heartbeat(t, { present: !away, resting: false, music: playing });
    // Things the user does to the pet now and then.
    const r = random();
    if (!away && r < 0.0008) d.threw(t);
    else if (!away && r < 0.0016) d.petted(t);
    else if (!away && r < 0.002) d.click(t);
    else if (!away && r < 0.0022) d.fed(t);
    if (random() < 0.0003)
      d.trace(
        {
          id: Math.floor(t),
          time: t,
          first: t,
          kind: "console",
          child: { pid: 1, name: "powershell.exe", path: "", location: "system", signed: true, role: "" },
          origin: { pid: 2, name: "updater.exe", path: "", location: "programs", signed: true, role: "" },
          chain: ["powershell.exe", "updater.exe"],
          visible: false,
          flash: false,
          flags: ["background"],
          score: 1,
          verdict: "ok",
          trusted: false,
          repeat: 1,
          speak: "background",
        },
        t,
      );
    const text = d.bubble?.text ?? "";
    if (text && text !== lastText) said.push({ t, text });
    lastText = text;
  }
  return { d, said, end };
}
describe("a day of life (soak)", () => {
  for (const [name, patch, seed] of [
    ["ru, defaults", {}, 1],
    ["en, clean", { lang: "en" as const }, 2],
    ["en, swearing, ear rest", { lang: "en" as const, swear: true, earsRest: true, balance: 20 }, 3],
    ["ru, quiet mode", { mode: "quiet" as const }, 4],
  ] as const)
    it(name, () => {
      // The app switches tx() and money() with the settings; so must the test,
      // or names and sums inside English lines stay Russian.
      setLang("lang" in patch ? patch.lang : "ru");
      const { d, said, end } = day(patch, seed);
      setLang("ru");
      // Rust refuses a game over 64 000 bytes and memory over 20 000.
      const game = JSON.stringify(d.game);
      expect(game.length).toBeLessThan(40000);
      expect(JSON.stringify(d.memory).length).toBeLessThan(12000);
      // Loads back the same after a restart.
      const again = cleanGame(JSON.parse(game), end);
      expect(again.ears.days.length).toBe(d.game.ears.days.length);
      expect(cleanLife(JSON.parse(JSON.stringify(d.game.life)), end).counts).toEqual(d.game.life.counts);
      // No NaN or Infinity anywhere in the stats.
      for (const k of ["exp", "money", "strength", "food", "drink", "feeling", "health", "likability", "grudge"] as const)
        expect(Number.isFinite(d.game[k]), k).toBe(true);
      expect(nonFinite(d.game)).toEqual([]);
      // It talks, but not all the time: at most one new line a minute on average.
      if (patch.mode !== "quiet") expect(said.length).toBeGreaterThan(20);
      expect(said.length).toBeLessThan(24 * 60);
      // No unfilled {variables} and no Russian in English (and vice versa).
      for (const { text } of said) {
        expect(text, text).not.toMatch(/\{\w+\}/);
        // The user's own name and facts stay as typed.
        if (patch.lang === "en") expect(text.replace(/Вася|люблю пиццу/g, ""), text).not.toMatch(/[А-Яа-яЁё]/);
      }
      // English without swearing unless asked.
      if (patch.lang === "en" && !("swear" in patch))
        for (const { text } of said) expect(text, text).not.toMatch(/\b(fuck|shit|bitch)/i);
    });
});
