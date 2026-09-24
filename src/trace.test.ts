import { describe, it, expect } from "vitest";
import { Director } from "./director";
import { phrases } from "./dialogue";
import { defaults, emptyMemory, Monitor, Snapshot } from "./model";
import { Spike, TraceEvent, spikeSpeech, traceSpeech } from "./trace";

const now = new Date(2026, 8, 24, 14).getTime();
const proc = (name: string, patch: Partial<TraceEvent["child"]> = {}) => ({
  pid: 10,
  name,
  path: `C:\\Program Files\\X\\${name}`,
  location: "programs" as const,
  signed: true,
  role: "",
  ...patch,
});
const ev = (patch: Partial<TraceEvent> = {}): TraceEvent => ({
  id: 1,
  time: now,
  first: now,
  kind: "console",
  child: proc("cmd.exe", { location: "system", signed: null, path: "C:\\Windows\\System32\\cmd.exe" }),
  origin: proc("steam.exe"),
  chain: ["cmd.exe", "steam.exe"],
  visible: true,
  flash: false,
  flags: [],
  score: 0,
  verdict: "ok",
  trusted: false,
  repeat: 1,
  speak: "visible",
  ...patch,
});
const director = () =>
  new Director(
    { ...defaults },
    { ...emptyMemory, lastGreeting: new Date(now).toLocaleDateString("sv") },
    () => 0,
  );

describe("process trace speech", () => {
  it("names the launcher of a visible console", () => {
    const d = director();
    expect(d.trace(ev(), now)).toBe(true);
    expect(d.bubble?.text).toContain("Steam");
    expect(d.bubble?.text).toMatch(/Program Files|подписан/);
    expect(d.bubble?.text).not.toMatch(/\{\w+\}/);
  });
  it("stays silent when Rust decided not to speak", () => {
    const d = director();
    expect(d.trace(ev({ speak: "none" }), now)).toBe(false);
    expect(d.bubble).toBeUndefined();
  });
  it("alerts bypass the comment budget and list the reasons", () => {
    const d = director();
    d.event("click", now - 1000, true);
    const alert = ev({
      speak: "alert",
      verdict: "suspicious",
      visible: false,
      child: proc("powershell.exe", { location: "system", signed: null }),
      origin: proc("updater.exe", { location: "temp", signed: false, path: "C:\\Users\\a\\AppData\\Local\\Temp\\updater.exe" }),
      flags: ["encoded", "hidden", "temp-origin", "background"],
    });
    expect(d.trace(alert, now)).toBe(true);
    expect(d.bubble?.text).toMatch(/закодированная команда/);
    expect(d.bubble?.text).not.toMatch(/\{\w+\}/);
    expect(d.reaction?.event).toBe("traceAlert");
  });
  it("orphans and flashes get their own wording", () => {
    expect(traceSpeech(ev({ origin: null }))?.event).toBe("traceOrphan");
    expect(traceSpeech(ev({ flash: true }))?.event).toBe("traceFlash");
    expect(traceSpeech(ev({ speak: "background", visible: false }))?.event).toBe("traceBackground");
  });
  it("respects the switch", () => {
    const d = new Director({ ...defaults, observeProcesses: false }, { ...emptyMemory }, () => 0);
    expect(d.trace(ev(), now)).toBe(false);
  });
  it("every trace/spike phrase uses only variables that are provided", () => {
    const vars = new Set(["child", "origin", "details", "flags", "pct", "base", "top", "share"]);
    for (const k of ["traceVisible", "traceFlash", "traceOrphan", "traceBackground", "traceAlert", "cpuSpike", "cpuSpikeAnon", "gpuSpike", "gpuSpikeAnon", "twitch"])
      for (const line of phrases[k]) {
        expect(line.length).toBeLessThan(160);
        for (const m of line.matchAll(/\{(\w+)\}/g)) expect(vars.has(m[1])).toBe(true);
      }
  });
});

describe("load spikes", () => {
  const spike = (patch: Partial<Spike> = {}): Spike => ({
    kind: "cpu",
    value: 93.4,
    base: 18.2,
    top: [{ pid: 5, name: "chrome.exe", path: "", pct: 41.2 }],
    ...patch,
  });
  it("names the culprit", () => {
    const d = director();
    expect(d.spike(spike(), now)).toBe(true);
    expect(d.bubble?.text).toMatch(/Chrome|93/);
    expect(spikeSpeech(spike()).vars).toMatchObject({ pct: "93", base: "18", top: "Chrome", share: "41" });
  });
  it("falls back without a culprit and honours the GPU switch", () => {
    expect(spikeSpeech(spike({ top: [] })).event).toBe("cpuSpikeAnon");
    expect(spikeSpeech(spike({ kind: "gpu" })).event).toBe("gpuSpike");
    const d = new Director({ ...defaults, observeGpu: false }, { ...emptyMemory }, () => 0);
    expect(d.spike(spike({ kind: "gpu" }), now)).toBe(false);
  });
});

describe("cursor jitter while asleep", () => {
  const m: Monitor = {
    id: "m",
    primary: true,
    scale: 1,
    bounds: { left: 0, top: 0, right: 1920, bottom: 1080 },
    work: { left: 0, top: 0, right: 1920, bottom: 1040 },
  };
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
  it("twitches but keeps sleeping; real input wakes", () => {
    const d = director();
    const asleep = 20 * 60000;
    d.observe(snap({ idle: asleep, jitter: 3 }));
    expect(d.base).toBe("sleep");
    d.observe(snap({ now: now + 1000, idle: asleep + 1000, jitter: 4 }));
    expect(d.base).toBe("sleep");
    expect(d.reaction?.event).toBe("twitch");
    d.observe(snap({ now: now + 2000, idle: 200, jitter: 4 }));
    expect(d.base).not.toBe("sleep");
  });
});
