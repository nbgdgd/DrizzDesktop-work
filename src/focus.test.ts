import { describe, expect, it } from "vitest";
import { focusProgress, focusTick, noFocus, noReminders, remindTick, startFocus } from "./focus";

const S = { focusMinutes: 25, breakMinutes: 5, longBreakMinutes: 15 };
const R = { remindWater: 60, remindPosture: 45, remindEyes: 20 };
describe("focus timer", () => {
  it("25 minutes of focus, a break, back to work; the fourth break is long", () => {
    let f = startFocus(S, 0);
    const said: string[] = [];
    for (let t = 0; t <= 4 * 30 * 60000 + 20 * 60000; t += 2000) {
      const r = focusTick(f, S, t);
      f = r.focus;
      said.push(...r.events.map((e) => e.name + (e.vars?.min ?? "")));
    }
    expect(said).toEqual(["focusBreak5", "focusBack25", "focusBreak5", "focusBack25", "focusBreak5", "focusBack25", "focusLongBreak15", "focusBack25"]);
  });
  it("off does nothing; progress runs 0 to 1", () => {
    expect(focusTick(noFocus, S, 1e9).events).toEqual([]);
    const f = startFocus(S, 1000);
    expect(focusProgress(f, 1000)).toBe(0);
    expect(focusProgress(f, 1000 + 12.5 * 60000)).toBeCloseTo(0.5);
  });
});
describe("reminders", () => {
  const run = (minutes: number, idle = 0, hold = false, r = noReminders) => {
    const due: string[] = [];
    for (let t = 0; t < minutes * 60000; t += 2000) {
      const x = remindTick(r, R, 2000, idle, hold);
      r = x.reminders;
      due.push(...x.due);
    }
    return { due, r };
  };
  it("count only time at the PC and come one at a time", () => {
    const { due } = run(61);
    expect(due.filter((d) => d === "remindEyes")).toHaveLength(3);
    expect(due.filter((d) => d === "remindPosture")).toHaveLength(1);
    expect(due.filter((d) => d === "remindWater")).toHaveLength(1);
    expect(run(120, 200000).due).toEqual([]);
  });
  it("held during focus, said right after", () => {
    const held = run(30, 0, true);
    expect(held.due).toEqual([]);
    expect(remindTick(held.r, R, 2000, 0, false).due).toEqual(["remindEyes"]);
  });
  it("five minutes away rests the eyes and the back, not the thirst", () => {
    const r = remindTick({ water: 50 * 60000, posture: 40 * 60000, eyes: 19 * 60000 }, R, 2000, 400000, false).reminders;
    expect(r).toEqual({ water: 50 * 60000, posture: 0, eyes: 0 });
  });
  it("0 minutes switches a reminder off", () => {
    expect(run(120, 0, false, noReminders).due.length).toBeGreaterThan(0);
    const x = remindTick(noReminders, { remindWater: 0, remindPosture: 0, remindEyes: 0 }, 2000, 0, false);
    expect(x.due).toEqual([]);
  });
});
describe("focus through the director", () => {
  it("quiet during focus, calls the break with buttons, reminders wait for it", async () => {
    const { Director } = await import("./director");
    const { defaults, emptyMemory } = await import("./model");
    const { newGame } = await import("./game");
    const T0 = new Date(2026, 8, 24, 11).getTime();
    const d = new Director({ ...defaults, remindEyes: 20 }, { ...emptyMemory }, () => 0.3, newGame(T0));
    d.startFocus(T0);
    expect((d.reaction as { event?: string } | undefined)?.event).toBe("focusStart");
    expect(d.hushed(T0 + 60000)).toBe(true);
    // An ordinary line during focus waits.
    d.bubble = undefined;
    d.reaction = undefined;
    expect(d.event("typing", T0 + 60000)).toBe(false);
    const said: string[] = [];
    let t = T0;
    for (; t < T0 + 26 * 60000; t += 2000) {
      d.heartbeat(t, { present: true, resting: false, music: false, idle: 1000 });
      const r = d.reaction as { event?: string } | undefined;
      if (r?.event && !said.includes(r.event)) said.push(r.event);
    }
    expect(said).toContain("focusBreak");
    expect(said).not.toContain("remindEyes");
    expect((d.bubble as { actions?: { id: string }[] } | undefined)?.actions?.map((a) => a.id)).toEqual(["focus:skip", "focus:stop"]);
    expect(d.hushed(t)).toBe(false);
    // The eyes reminder held during focus comes in the break.
    for (let i = 0; i < 60 && !said.includes("remindEyes"); i++, t += 2000) {
      d.bubble = undefined;
      d.reaction = undefined;
      d.heartbeat(t, { present: true, resting: false, music: false, idle: 1000 });
      const r = d.reaction as { event?: string } | undefined;
      if (r?.event) said.push(r.event);
    }
    expect(said).toContain("remindEyes");
    d.stopFocus(t);
    expect(d.focus.phase).toBe("");
  });
});
