// The pet and the music: beat clock, bars, and where the equalizer may stand.
import { describe, expect, it } from "vitest";
import { Groove, TapMusic, eqSides } from "./music";

const msg = (now: number, beatAt: number, period = 500, extra: Partial<TapMusic> = {}): TapMusic => ({
  bands: [0.9, 0.7, 0.5, 0.4, 0.3, 0.2, 0.1, 0.05],
  level: -14,
  bpm: 60000 / period,
  period,
  beat: (((now - beatAt) % period) + period) % period,
  confidence: 0.6,
  ...extra,
});
describe("Groove", () => {
  it("keeps a steady beat clock through jittery estimates", () => {
    const g = new Groove();
    // True beats at 0, 500, 1000...; each message is up to ±30 ms off.
    for (let t = 0; t < 10000; t += 80) g.feed(msg(t, ((t * 7919) % 61) - 30), t);
    const at = 10040;
    const p = g.phase(at)!;
    expect(p).not.toBeNull();
    // 10040 is 40 ms after a beat: phase 0.08, give or take 20 ms.
    expect(Math.abs(p * 500 - 40)).toBeLessThan(20);
  });
  it("takes a new tempo at once, not by drifting", () => {
    const g = new Groove();
    for (let t = 0; t < 3000; t += 80) g.feed(msg(t, 0, 500), t);
    for (let t = 3000; t < 3400; t += 80) g.feed(msg(t, 3000, 400), t);
    expect(g.period).toBeCloseTo(400, 0);
  });
  it("no beat when unsure, when quiet or when the tap went silent", () => {
    const g = new Groove();
    g.feed(msg(0, 0, 500, { confidence: 0.1 }), 0);
    expect(g.phase(10)).toBeNull();
    g.feed(msg(100, 0, 500, { level: -70 }), 100);
    expect(g.phase(110)).toBeNull();
    g.feed(msg(200, 0), 200);
    expect(g.phase(210)).not.toBeNull();
    expect(g.phase(2000)).toBeNull();
  });
  it("bars jump up, fall slowly and fade out when the sound stops", () => {
    const g = new Groove();
    g.feed(msg(0, 0), 0);
    for (let t = 0; t <= 300; t += 33) g.step(t, 33);
    expect(g.bars[0]).toBeGreaterThan(0.85);
    expect(g.shown).toBeGreaterThan(0.6);
    g.feed(msg(330, 0, 500, { bands: new Array(8).fill(0) }), 330);
    g.step(363, 33);
    expect(g.bars[0]).toBeGreaterThan(0.6);
    for (let t = 400; t <= 4000; t += 33) g.step(t, 33);
    expect(g.bars[0]).toBeLessThan(0.02);
    expect(g.shown).toBe(0);
  });
});
describe("equalizer placement", () => {
  const base = { body: { left: 150, right: 210 }, size: 100, width: 360 };
  it("one stack on each side of the body on a wide floor", () => {
    const [l, r] = eqSides({ ...base, span: [-1000, 5000] });
    expect(l![1]).toBeLessThan(150);
    expect(r![0]).toBeGreaterThan(210);
    expect(l![1] - l![0]).toBeCloseTo(34, 0);
  });
  it("never past the edge of the window it stands on", () => {
    // The window ends 10 px right of the body: no room, that side is left out.
    const [l, r] = eqSides({ ...base, span: [0, 220] });
    expect(l).not.toBeNull();
    expect(r).toBeNull();
    // A bit more room: the stack gets narrower but stays on the window.
    const [, r2] = eqSides({ ...base, span: [0, 235] });
    expect(r2).not.toBeNull();
    expect(r2![1]).toBeLessThanOrEqual(235);
  });
  it("stays inside the canvas", () => {
    const [l] = eqSides({ ...base, body: { left: 20, right: 80 }, span: [-500, 500] });
    expect(l).toBeNull();
  });
});
