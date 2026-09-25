// Pet volume by ear, and the per-hour cap on lines of its own.
import { describe, expect, it } from "vitest";
import { perceived } from "./audio";
import { Director } from "./director";
import { cleanSettings, defaults, emptyMemory } from "./model";
import { newGame } from "./game";
const db = (a: number) => 20 * Math.log10(a);
describe("pet volume and limits", () => {
  it("the volume slider is by ear: the bottom is audible, 0 is silence", () => {
    expect(perceived(0)).toBe(0);
    expect(perceived(100)).toBe(1);
    expect(db(perceived(15))).toBeGreaterThan(-11);
    expect(db(perceived(50))).toBeGreaterThan(-4);
    for (let v = 5; v <= 100; v += 5) expect(perceived(v)).toBeGreaterThan(perceived(v - 5));
  });
  it("cleans the new settings", () => {
    const s = cleanSettings({ voiceVolume: 250 as never, effectsVolume: -3 as never, linesPerHour: "x" as never, teaseRate: "wild" as never });
    expect([s.voiceVolume, s.effectsVolume, s.linesPerHour, s.teaseRate]).toEqual([100, 0, 30, "normal"]);
  });
  it("says at most N lines of its own an hour, but always answers the user", () => {
    const T0 = new Date(2026, 8, 25, 12).getTime();
    const d = new Director({ ...defaults, linesPerHour: 5, commentMinutes: 1 }, { ...emptyMemory }, () => 0.5, newGame(T0));
    let own = 0;
    for (let t = T0; t < T0 + 3600000; t += 60000) {
      d.bubble = undefined;
      d.reaction = undefined;
      if (d.event("chatter", t) && d.bubble) own++;
    }
    expect(own).toBeLessThanOrEqual(5);
    expect(own).toBeGreaterThan(2);
    d.bubble = undefined;
    d.reaction = undefined;
    d.reset("click");
    expect(d.event("click", T0 + 3500000, true)).toBe(true);
    expect((d.bubble as { text?: string } | undefined)?.text).toBeTruthy();
  });
});
