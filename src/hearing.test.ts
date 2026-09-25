import { describe, expect, it } from "vitest";
import { FREQS, Results, key, plan, verdict } from "./hearing";

const both = (l: number | null, r: number | null): Results => Object.fromEntries(FREQS.flatMap((f) => [[`l${f}`, l], [`r${f}`, r]]));
describe("hearing check", () => {
  it("plays every frequency to both ears", () => {
    const p = plan();
    expect(p).toHaveLength(FREQS.length * 2);
    expect(new Set(p.map(key)).size).toBe(p.length);
  });
  it("small differences are normal: no balance suggested", () => {
    const v = verdict(both(-60, -55));
    expect(v.worse).toBe("");
    expect(v.balance).toBe(0);
  });
  it("a weaker left ear: the right one gets quieter, never more than 40 %", () => {
    const v = verdict(both(-45, -60));
    expect(v.worse).toBe("l");
    expect(v.diff).toBe(15);
    expect(v.gaps).toEqual(FREQS);
    // settings.balance < 0 makes the right ear quieter.
    expect(v.balance).toBeLessThan(0);
    expect(v.balance).toBeGreaterThanOrEqual(-40);
    expect(verdict(both(-60, -52)).balance).toBeGreaterThan(0);
  });
  it("tones nobody heard are reported, not counted as a difference", () => {
    const r = both(-60, -60);
    r[key({ ear: "l", freq: 8000 })] = null;
    r[key({ ear: "r", freq: 8000 })] = null;
    const v = verdict(r);
    expect(v.unheard).toEqual([8000]);
    expect(v.worse).toBe("");
  });
  it("one ear not hearing a tone at all counts as a big gap", () => {
    const r = both(-60, -60);
    r[key({ ear: "r", freq: 4000 })] = null;
    expect(verdict(r).gaps).toEqual([4000]);
  });
});
