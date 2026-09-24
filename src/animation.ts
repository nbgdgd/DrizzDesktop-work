import { Action } from "./model";
export interface Clip {
  cells: number[];
  durations: number[];
  loop: boolean;
}
const clip = (
  row: number,
  cols: number[],
  durations: number[] | number,
  loop = true,
): Clip => ({
  cells: cols.map((c) => row * 8 + c),
  durations:
    typeof durations === "number" ? cols.map(() => durations) : durations,
  loop,
});
export function clips(id: string): Record<Action, Clip> {
  const blob = id === "eigenblob",
    blink = id === "drizz" ? 4 : id === "nezukocoder" ? 2 : 3;
  return {
    idle: clip(0, [0, 1, blink, 0, 5, 0], [3200, 220, 140, 2800, 220, 1000]),
    walkRight: clip(1, [0, 1, 2, 3, 4, 5, 6, 7], 105),
    walkLeft: clip(2, [0, 1, 2, 3, 4, 5, 6, 7], 105),
    wave: blob
      ? clip(3, [1, 3, 1, 3, 1], [200, 320, 200, 320, 240], false)
      : clip(3, [0, 1, 2, 1, 2, 0], [180, 260, 260, 260, 260, 220], false),
    jump: clip(4, blob ? [0, 1, 2, 1, 0] : [0, 1, 2, 3, 4], 180, false),
    // Arms up and a hop from the scene: no longer the same frames as `jump`.
    celebrate: blob
      ? clip(3, [1, 3, 1, 3, 1, 3], 150, false)
      : clip(3, [1, 2, 1, 2, 1, 2], [140, 140, 140, 140, 140, 220], false),
    rest: clip(
      5,
      [2, 3, 4, 5, 5, 4, 3, 2],
      [800, 900, 1200, 1400, 1400, 1200, 900, 800],
    ),
    sleep: blob
      ? clip(5, [3, 4, 5, 4], 2200)
      : clip(5, [id === "nezukocoder" ? 5 : 4], 4000),
    sit: blob
      ? clip(6, [2, 4, 2], [3000, 180, 3000])
      : clip(6, [0, id === "drizz" ? 3 : 1, 0], [3000, 180, 3000]),
    look: blob
      ? clip(8, [5, 2, 2, 5, 1, 5], [400, 900, 900, 500, 900, 400], false)
      : clip(
          6,
          [0, 3, 3, 0, 2, 4, 0],
          [400, 900, 900, 500, 900, 900, 400],
          false,
        ),
    // Hanging from the hand: a slow kick of the legs.
    drag: clip(4, [1, 2], [420, 380]),
    land: clip(4, [3, 4, 0], [100, 100, 160], false),
    // Rows 5 (upset/collapse), 7 (busy) and 8 (squint) of the Codex pet
    // atlas were unused before; they carry the moods below.
    flail: clip(3, [1, 2], 100),
    shaken: clip(5, [2], 1000),
    pained: clip(5, [2, 2, 0], [500, 400, 300], false),
    dizzy: clip(5, [2, 1], [320, 280]),
    grumpy: clip(5, [0], 1000),
    sigh: clip(5, [0, 1, 1, 0], [300, 700, 700, 400], false),
    sulk: clip(5, [6, 7], [1400, 1600]),
    judge: clip(8, [0, 1, 2, 1], [500, 900, 900, 600]),
    busy: clip(7, [0, 1, 2, 3, 4, 5], 120),
    swat: clip(3, [1, 2, 1], [70, 110, 140], false),
    eat: clip(7, [0, 1, 2, 3], [160, 140, 160, 220]),
    dance: {
      cells: [4 * 8 + 1, 3 * 8 + 1, 4 * 8 + 2, 3 * 8 + 2],
      durations: [230, 230, 230, 230],
      loop: true,
    },
    hang: clip(3, [1, 2], [450, 450]),
    stretch: clip(4, [1, 2, 3, 2, 1], [200, 400, 800, 400, 200], false),
  };
}
export class Animator {
  action: Action = "idle";
  start = 0;
  private table: Record<Action, Clip>;
  constructor(public id: string) {
    this.table = clips(id);
  }
  frame(action: Action, now: number) {
    if (action !== this.action) {
      this.action = action;
      this.start = now;
    }
    const c = this.table[action];
    const total = c.durations.reduce((a, b) => a + b, 0);
    let t = c.loop
      ? (now - this.start) % total
      : Math.min(now - this.start, total - 1);
    for (let i = 0; i < c.cells.length; i++) {
      if (t < c.durations[i]) return c.cells[i];
      t -= c.durations[i];
    }
    return c.cells[c.cells.length - 1];
  }
}
