import { it, expect } from "vitest";
import { overlayLayout } from "./layout";
import { cleanMemory, cleanSettings, defaults, Monitor } from "./model";
import { Movement } from "./movement";
it("keeps bubble horizontally on monitor at every scale and edge", () => {
  for (const scale of [1, 1.25, 1.5, 2]) {
    const m: Monitor = {
      id: "left",
      primary: true,
      scale,
      bounds: { left: -1920, top: -400, right: 0, bottom: 1040 },
      work: { left: -1920, top: -400, right: 0, bottom: 1000 },
    };
    for (const x of [m.work.left + 100 * scale, m.work.right - 100 * scale])
      for (const y of [m.work.top + 180 * scale, m.work.bottom]) {
        const l = overlayLayout(x, y, 116, scale, m);
        expect(l.left + 35 * scale).toBeGreaterThanOrEqual(m.work.left);
        expect(l.left + 325 * scale).toBeLessThanOrEqual(m.work.right);
        expect(l.top + l.anchorY * scale).toBe(y);
        if (y < m.work.top + 241 * scale) expect(l.below).toBe(true);
      }
  }
});
it("repairs malformed memory and settings without discarding valid facts", () => {
  const m = cleanMemory({
    facts: ["ok", 12] as any,
    recent: null as any,
    position: { x: NaN, y: 0 },
    favorite: { x: 0, y: 1, monitor: 1 } as any,
    address: 5 as any,
  });
  expect(m.facts).toEqual(["ok"]);
  expect(m.recent).toEqual([]);
  expect(m.position).toBeNull();
  expect(m.favorite).toBeNull();
  expect(m.address).toBe("");
  const s = cleanSettings({
    games: null as any,
    mode: "broken" as any,
    observeApps: null as any,
    lateHour: 0,
  });
  expect(s.games).toEqual([]);
  expect(s.mode).toBe("normal");
  expect(s.observeApps).toBe(true);
  expect(s.lateHour).toBe(0);
});
it("DND moves to its spot with walking animation, then sleeps", () => {
  const m: Monitor = {
    id: "main",
    primary: true,
    scale: 1,
    bounds: { left: 0, top: 0, right: 1920, bottom: 1080 },
    work: { left: 0, top: 0, right: 1920, bottom: 1040 },
  };
  const w = new Movement();
  w.initialize([m], 116, { x: 400, y: 1040 });
  w.go(550, true);
  let moving = false;
  for (let i = 0; i < 600; i++) {
    const a = w.step(
      0.033,
      i * 33,
      { ...defaults, mode: "dnd" },
      [m],
      [],
      "sleep",
    );
    moving ||= a === "walkRight";
  }
  expect(moving).toBe(true);
  expect(Math.abs(w.x - 550)).toBeLessThan(5);
  expect(
    w.step(0.033, 30000, { ...defaults, mode: "dnd" }, [m], [], "sleep"),
  ).toBe("sleep");
});
