import { Action, clamp, Monitor, Rect, Settings, Surface } from "./model";
const within = (m: Monitor, x: number, y: number) =>
  x >= m.bounds.left && x < m.bounds.right && y >= m.bounds.top && y <= m.bounds.bottom;
export function monitorAt(
  monitors: Monitor[],
  x: number,
  y: number,
  preferred = "auto",
): Monitor | undefined {
  if (!monitors.length) return undefined;
  const chosen = monitors.find((m) => m.id === preferred);
  if (chosen) return chosen;
  const exact = monitors.find((m) => within(m, x, y));
  if (exact) return exact;
  // Between two monitors (a jump across a seam, a fling past a corner): the
  // nearest one, so the pet is never teleported to the primary screen.
  return [...monitors].sort((a, b) => gap(a, x, y) - gap(b, x, y))[0];
}
/** Distance from (x, y) to the monitor's bounds, 0 inside. */
export const gap = (m: Monitor, x: number, y: number) =>
  Math.hypot(
    Math.max(m.bounds.left - x, 0, x - m.bounds.right),
    Math.max(m.bounds.top - y, 0, y - m.bounds.bottom),
  );
/** Can the pet get from one monitor to another on foot (or by one jump)? */
export function reachable(monitors: Monitor[], from: Monitor, to: Monitor): boolean {
  const seen = new Set([from.id]);
  const queue = [from];
  while (queue.length) {
    const m = queue.shift()!;
    if (m.id === to.id) return true;
    for (const side of [-1, 1] as const) {
      const n = neighbor(monitors, m, side);
      // One jump covers about 520 logical px of rise.
      if (n && !seen.has(n.id) && m.work.bottom - n.work.bottom < 480 * m.scale) {
        seen.add(n.id);
        queue.push(n);
      }
    }
  }
  return false;
}
/**
 * The monitor glued to `m` on the given side, if the pet can pass the seam:
 * the edges touch, neither side of the seam is a vertical taskbar, and the two
 * work areas share some height.
 */
export function neighbor(
  monitors: Monitor[],
  m: Monitor,
  side: -1 | 1,
): Monitor | undefined {
  return monitors.find((n) => {
    if (n === m || n.id === m.id) return false;
    const touching =
      side > 0
        ? Math.abs(n.bounds.left - m.bounds.right) <= 2 &&
          m.work.right >= m.bounds.right - 2 &&
          n.work.left <= n.bounds.left + 2
        : Math.abs(n.bounds.right - m.bounds.left) <= 2 &&
          m.work.left <= m.bounds.left + 2 &&
          n.work.right >= n.bounds.right - 2;
    return touching && n.work.top < m.work.bottom && n.work.bottom > m.work.top;
  });
}
/**
 * Horizontal room for the pet's feet at height `y`: its monitor, plus a glued
 * neighbour whose work area contains that height (same or lower floor, or in
 * the air above a higher one). `wall` tells which seams are closed.
 */
export function span(
  monitors: Monitor[],
  m: Monitor,
  y: number,
  height: number,
  margin: number,
) {
  let left = m.work.left + margin,
    right = m.work.right - margin;
  const open = (n: Monitor | undefined) =>
    !!n && y <= n.work.bottom + 2 && y - height >= n.work.top - 2;
  const r = neighbor(monitors, m, 1),
    l = neighbor(monitors, m, -1);
  if (open(r)) right = r!.work.right - margin;
  if (open(l)) left = l!.work.left + margin;
  return { left, right, rightNext: r, leftNext: l };
}
export class Movement {
  x = 0;
  y = 0;
  vx = 0;
  vy = 0;
  scale = 1;
  support: Surface | null = null;
  dragging = false;
  target: number | null = null;
  air = false;
  initialized = false;
  dragOffset = { x: 0, y: 0 };
  private lastCursor = { x: 0, y: 0, t: 0 };
  private dragStart = { x: 0, y: 0, t: 0 };
  private landUntil = 0;
  /** Collisions since the scene last drained them (for squash, dust, lines). */
  impacts: { kind: "floor" | "wall" | "ceiling"; speed: number }[] = [];
  /** Release speed of the last throw, px/s (0 = gently put down). */
  thrown = 0;
  private blockedSupport = 0;
  private relocating = false;
  /** Where the pet really wants to go; `target` is that, clamped to the room it has. */
  goal: number | null = null;
  /** Walk goal resumed after a jump onto a higher neighbouring monitor. */
  private pending: number | null = null;
  // ---- held in the hand: a pendulum around the grab point
  /** Body tilt in radians (hanging swing while dragged, spin while flying). */
  swing = 0;
  private swingV = 0;
  private spinV = 0;
  private lastVx = 0;
  /** Grab point relative to the feet, physical px (for the pendulum sign). */
  grab = { x: 0, y: 0 };
  /** Shaking accumulated in the current drag; drained by `takeDizzy`. */
  shake = 0;
  private flips: number[] = [];
  private lastDirX = 0;
  private lastDirY = 0;
  /** Stubborn grip: the pet does not come loose until this time or a hard pull. */
  private resistUntil = 0;
  private anchor = { x: 0, y: 0 };
  /** 0..1 how far the pet is stretched by a resisted pull. */
  stretch = 0;
  /** True once a resisted grab has come loose ("pop"). */
  popped = false;
  /** Agility upgrade 0..5: higher jumps, surer climbing. */
  agility = 0;
  /**
   * Climbing up the side of a window: "up" along the edge, "hang" from the
   * top edge before pulling up, "slide" when it loses grip.
   */
  climb: { id: number; side: -1 | 1; phase: "up" | "hang" | "slide"; until: number } | null = null;
  /** A random source for slips (tests pass a fixed one). */
  random = Math.random;
  initialize(
    monitors: Monitor[],
    size: number,
    saved: { x: number; y: number } | null,
    preferred = "auto",
  ) {
    if (this.initialized) return;
    const m = monitorAt(monitors, saved?.x ?? 0, saved?.y ?? 0, preferred);
    if (!m) return;
    this.x = saved?.x ?? m.work.right - 120;
    this.y = saved?.y ?? m.work.bottom;
    this.initialized = true;
    this.recover(monitors, size, preferred);
  }
  recover(monitors: Monitor[], size: number, preferred = "auto") {
    const m = monitorAt(monitors, this.x, this.y, preferred);
    if (!m) return;
    this.scale = m.scale;
    // Mid-flight over a seam is not "lost": leave the physics alone unless
    // the pet is far outside every monitor.
    const lost = gap(m, this.x, this.y) > 300 * m.scale;
    if (this.air && !this.dragging && !lost) return;
    const half = size * this.scale * 0.5;
    const auto = preferred === "auto" || !monitors.some((mm) => mm.id === preferred);
    const room = auto
      ? span(monitors, m, this.y, size * this.scale, half + 8)
      : { left: m.work.left + half + 8, right: m.work.right - half - 8 };
    this.x = clamp(this.x, room.left, room.right);
    this.y = clamp(this.y, m.work.top + size * this.scale + 4, m.work.bottom);
    if (
      this.support &&
      !monitors.some(
        (mm) =>
          this.support!.rect.top >= mm.work.top &&
          this.support!.rect.top <= mm.work.bottom,
      )
    )
      this.support = null;
  }
  follow(surface: Surface | null) {
    if (!this.support) return false;
    if (!surface || surface.id !== this.support.id) {
      this.blockedSupport = this.support.id;
      this.support = null;
      this.air = true;
      this.vy = 25;
      return true;
    }
    const dx = surface.rect.left - this.support.rect.left,
      dy = surface.rect.top - this.support.rect.top;
    this.x += dx;
    this.y += dy;
    if (this.target !== null) this.target += dx;
    this.support = surface;
    return false;
  }
  /**
   * Picked up at cursor (x, y). `resist` ms: the pet clings to its spot and
   * only stretches toward the hand until the time runs out or the pull is hard.
   */
  begin(x: number, y: number, now: number, resist = 0) {
    this.dragging = true;
    this.climb = null;
    this.dragOffset = { x: this.x - x, y: this.y - y };
    this.grab = { x: x - this.x, y: y - this.y };
    this.dragStart = { x, y, t: now };
    this.lastCursor = { x, y, t: now };
    this.target = null;
    this.goal = null;
    this.pending = null;
    this.vx = this.vy = 0;
    this.lastVx = 0;
    this.swingV = 0;
    this.spinV = 0;
    this.shake = 0;
    this.flips = [];
    this.lastDirX = this.lastDirY = 0;
    this.anchor = { x: this.x, y: this.y };
    this.resistUntil = resist > 0 ? now + resist : 0;
    this.stretch = 0;
    this.popped = false;
    // A clinging pet keeps its footing until it lets go.
    if (!this.resistUntil) {
      this.support = null;
      this.air = true;
    }
  }
  /** True while a stubborn grab has not come loose yet. */
  get clinging() {
    return this.dragging && this.resistUntil > 0;
  }
  drag(x: number, y: number, now: number) {
    if (!this.dragging) return;
    const dt = Math.max(0.016, (now - this.lastCursor.t) / 1000);
    // Limits scale with the monitor so a fling feels the same at 100-300 %.
    const k = this.scale;
    if (this.resistUntil) {
      const dx = x - this.dragStart.x,
        dy = y - this.dragStart.y,
        pull = Math.hypot(dx, dy);
      if (now < this.resistUntil && pull < 190 * k) {
        // Rubber band: the feet stay, the body leans toward the hand.
        this.stretch = clamp(pull / (190 * k), 0, 1);
        this.x = this.anchor.x + dx * 0.1;
        this.y = this.anchor.y + Math.min(0, dy) * 0.05;
        this.lastCursor = { x, y, t: now };
        this.vx = this.vy = 0;
        return;
      }
      // Came loose: from now on it hangs from the hand like any other grab.
      this.resistUntil = 0;
      this.stretch = 0;
      this.popped = true;
      this.support = null;
      this.air = true;
      this.dragOffset = { x: this.x - x, y: this.y - y };
    }
    this.vx = clamp((x - this.lastCursor.x) / dt, -1800 * k, 1800 * k);
    this.vy = clamp((y - this.lastCursor.y) / dt, -1600 * k, 1400 * k);
    // Shaking: quick direction flips at speed, horizontal or vertical.
    const dirX = Math.abs(this.vx) > 650 * k ? Math.sign(this.vx) : 0;
    const dirY = Math.abs(this.vy) > 650 * k ? Math.sign(this.vy) : 0;
    let flipped = false;
    if (dirX && this.lastDirX && dirX !== this.lastDirX) flipped = true;
    if (dirY && this.lastDirY && dirY !== this.lastDirY) flipped = true;
    if (dirX) this.lastDirX = dirX;
    if (dirY) this.lastDirY = dirY;
    if (flipped) {
      this.flips.push(now);
      this.flips = this.flips.filter((t) => now - t < 1400);
      if (this.flips.length >= 3) this.shake = Math.min(6, this.shake + 0.45);
    }
    this.x = x + this.dragOffset.x;
    this.y = y + this.dragOffset.y;
    this.lastCursor = { x, y, t: now };
  }
  /** True when the last second of the drag looks like shaking. */
  get shaking() {
    return this.flips.length >= 3 && this.lastCursor.t - (this.flips[this.flips.length - 1] ?? 0) < 400;
  }
  /** Dizziness collected from shaking and spinning; reading it resets it. */
  takeDizzy() {
    const d = this.shake;
    this.shake = 0;
    return d;
  }
  // Pendulum while held: the body lags behind the hand and swings back.
  private hang(dt: number) {
    if (this.resistUntil) {
      this.swing *= Math.exp(-dt * 8);
      return;
    }
    const k = this.scale;
    const ax = clamp((this.vx - this.lastVx) / Math.max(dt, 0.016), -45000 * k, 45000 * k);
    this.lastVx = this.vx;
    // Held by the feet the body stands above the hand: the lag flips side.
    const below = this.grab.y < -12 * k ? 1 : -1;
    const w2 = 58,
      damp = 3.4,
      g = 5200 * k;
    this.swingV +=
      (-w2 * (Math.sin(this.swing) - below * (ax / g) * Math.cos(this.swing)) -
        damp * this.swingV) *
      dt;
    this.swing = clamp(this.swing + this.swingV * dt, -1.15, 1.15);
  }
  release(now: number) {
    if (!this.dragging) return false;
    this.dragging = false;
    const click =
      now - this.dragStart.t < 350 &&
      Math.hypot(
        this.lastCursor.x - this.dragStart.x,
        this.lastCursor.y - this.dragStart.y,
      ) < 7;
    const clinging = this.resistUntil > 0;
    this.resistUntil = 0;
    this.stretch = 0;
    if (clinging) {
      // Never came loose: back on its spot.
      this.x = this.anchor.x;
      this.y = this.anchor.y;
    }
    if (now - this.lastCursor.t > 100 || click || clinging) {
      this.vx = this.vy = 0;
      this.thrown = 0;
    } else {
      // Keep most of the fling so a throw flies and bounces.
      this.vx *= 0.8;
      this.vy *= 0.7;
      this.thrown = Math.hypot(this.vx, this.vy);
      // A hard fling sends it tumbling.
      if (this.thrown > 1100 * this.scale)
        this.spinV = Math.sign(this.vx || 1) * Math.min(13, this.thrown / (140 * this.scale));
    }
    this.swingV = 0;
    return click;
  }
  // Diagnostics: why the last fall did not end on a window. Lists every
  // surface that overlaps the pet horizontally with the failed condition.
  explainPerch(s: Settings, m: Monitor, surfaces: Surface[]): string {
    const half = s.size * this.scale * 0.38;
    const parts: string[] = [];
    surfaces.forEach((win, i) => {
      const r = win.rect;
      if (this.x <= r.left || this.x >= r.right) return;
      const why = !s.perch
        ? "perch off"
        : win.id === this.blockedSupport
          ? "blocked (just fell from it)"
          : this.x <= r.left + half || this.x >= r.right - half
            ? "too close to its edge"
            : r.top < m.work.top + s.size * this.scale
              ? "top above monitor work area + pet height"
              : r.top >= m.work.bottom
                ? "top below work area"
                : surfaces.slice(0, i).some(
                      (w) =>
                        this.x > w.rect.left &&
                        this.x < w.rect.right &&
                        r.top > w.rect.top &&
                        r.top < w.rect.bottom,
                    )
                  ? "occluded by " +
                    surfaces
                      .slice(0, i)
                      .filter(
                        (w) =>
                          this.x > w.rect.left &&
                          this.x < w.rect.right &&
                          r.top > w.rect.top &&
                          r.top < w.rect.bottom,
                      )
                      .map((w) => `#${w.id} ${w.rect.left},${w.rect.top}-${w.rect.right},${w.rect.bottom}`)
                      .join(", ")
                  : "not crossed while falling";
      parts.push(`#${win.id} ${r.left},${r.top}-${r.right},${r.bottom}: ${why}`);
    });
    return parts.length ? parts.join("; ") : "no window under x";
  }
  // Puts the pet on the floor of `m` near its right edge, dropping any window
  // support and motion. Used by "return the pet to the screen".
  placeOn(m: Monitor, monitors: Monitor[], size: number, preferred = "auto") {
    this.x = m.work.right - 120 * m.scale;
    this.y = m.work.bottom;
    this.support = null;
    this.target = null;
    this.vx = this.vy = 0;
    this.air = false;
    this.dragging = false;
    this.initialized = true;
    this.recover(monitors, size, preferred);
  }
  /** Speed multiplier for the current walk: 1 = stroll, ~2.6 = run. */
  hurry = 1;
  /** True while moving fast enough that the walk cycle should play faster. */
  running = false;
  go(x: number, relocate = false, hurry = 1) {
    this.target = x;
    this.goal = x;
    this.relocating = relocate;
    this.hurry = hurry;
  }
  /**
   * Monitors the pet cannot walk or jump to (stacked, gap between them):
   * it just turns up there, on the floor, at `x` clamped to that screen.
   */
  travelTo(m: Monitor, x: number, size: number) {
    const half = size * m.scale * 0.5 + 8;
    this.x = clamp(x, m.work.left + half, m.work.right - half);
    this.y = m.work.bottom;
    this.scale = m.scale;
    this.support = null;
    this.target = this.goal = this.pending = null;
    this.vx = this.vy = 0;
    this.air = false;
    this.swing = this.spinV = 0;
  }
  /**
   * Ballistic jump that lands on (tx, ty): used to hop onto a window's top
   * edge or away from the cursor. Returns false when the target is too high
   * for one jump (then the caller walks closer first) or the pet is busy.
   */
  leap(tx: number, ty: number, maxRise = 520): boolean {
    if (this.air || this.dragging || !this.initialized || this.climb) return false;
    const g = 650 * this.scale;
    const rise = this.y - ty;
    if (rise > maxRise * this.scale * (1 + 0.12 * this.agility)) return false;
    // Apex a little above the higher of start and target.
    const apex = Math.max(rise, 0) + 40 * this.scale;
    const vy = -Math.sqrt(2 * g * apex);
    const up = -vy / g;
    const down = Math.sqrt((2 * Math.max(apex - rise, 1)) / g);
    const t = up + down;
    this.vy = vy;
    this.vx = clamp((tx - this.x) / t, -600 * this.scale, 600 * this.scale);
    this.leapVx = this.vx;
    this.air = true;
    this.support = null;
    this.target = null;
    this.goal = null;
    this.hurry = 1;
    return true;
  }
  private leapVx: number | null = null;
  /**
   * Starts climbing the side of `win` from the floor next to it. The pet
   * must stand beside the window and the window must reach down to it.
   */
  startClimb(win: Surface, side: -1 | 1, size: number): boolean {
    if (this.air || this.dragging || this.climb) return false;
    const h = size * this.scale;
    if (win.rect.bottom < this.y - h * 0.5 || win.rect.top > this.y - h * 1.2) return false;
    this.climb = { id: win.id, side, phase: "up", until: 0 };
    this.support = null;
    this.target = this.goal = null;
    this.vx = this.vy = 0;
    return true;
  }
  private climbing(dt: number, now: number, s: Settings, floor: number, surfaces: Surface[]): Action {
    const c = this.climb!;
    const win = surfaces.find((w) => w.id === c.id);
    const k = this.scale,
      h = s.size * k,
      half = h * 0.38;
    if (!win) {
      // The window went away under the hands: fall.
      this.climb = null;
      this.air = true;
      this.vy = 20 * k;
      return "flail";
    }
    const r = win.rect;
    this.x = c.side < 0 ? r.left - half * 0.55 : r.right + half * 0.55;
    if (c.phase === "up") {
      this.y -= 75 * k * dt * (1 + 0.1 * this.agility);
      // Losing grip: less likely with agility.
      if (this.random() < dt * 0.12 * (1 - 0.15 * this.agility)) c.phase = "slide";
      if (this.y - h * 0.8 <= r.top) {
        c.phase = "hang";
        c.until = now + 900 + this.random() * 900;
        this.y = r.top + h * 0.8;
      }
      return "hang";
    }
    if (c.phase === "hang") {
      this.y = r.top + h * 0.8;
      if (now < c.until) return "hang";
      if (this.random() < 0.2 * (1 - 0.15 * this.agility)) {
        c.phase = "slide";
        return "flail";
      }
      // Pull up onto the top edge.
      this.climb = null;
      this.y = r.top;
      this.x = c.side < 0 ? r.left + half + 6 * k : r.right - half - 6 * k;
      this.support = win;
      this.air = false;
      this.landUntil = now + 260;
      this.impacts.push({ kind: "floor", speed: 120 * k });
      return "land";
    }
    // Sliding down the edge back to the floor.
    this.y += 160 * k * dt;
    if (this.y >= floor) {
      this.y = floor;
      this.climb = null;
      this.landUntil = now + 260;
      this.impacts.push({ kind: "floor", speed: 200 * k });
      return "land";
    }
    return "flail";
  }
  jump() {
    if (!this.air && !this.dragging) {
      this.vy = -250 * this.scale;
      this.air = true;
      this.support = null;
    }
  }
  step(
    dt: number,
    now: number,
    s: Settings,
    monitors: Monitor[],
    surfaces: Surface[],
    base: Action,
  ): Action {
    if (!this.initialized) return base;
    dt = clamp(dt, 0, 0.05);
    if (this.dragging) {
      this.hang(dt);
      return "drag";
    }
    const m = monitorAt(monitors, this.x, this.y, s.monitor);
    if (!m) return base;
    this.scale = m.scale;
    const half = s.size * this.scale * 0.38;
    // Tumbling after a hard throw; any other tilt settles back upright.
    if (this.air && this.spinV) this.swing += this.spinV * dt;
    else if (this.swing) {
      this.swing *= Math.exp(-dt * 7);
      if (Math.abs(this.swing) < 0.01) this.swing = 0;
    }
    const allow =
      !s.pinned &&
      (this.relocating ||
        (s.walk &&
          s.mode === "normal" &&
          !["sleep", "rest", "sit"].includes(base)));
    if (!s.perch) this.support = null;
    if (s.pinned) {
      this.target = null;
      this.climb = null;
      this.vx = this.vy = 0;
      this.recover(monitors, s.size, s.monitor);
      return base;
    }
    if (this.climb) return this.climbing(dt, now, s, m.work.bottom, surfaces);
    const auto = s.monitor === "auto" || !monitors.some((mm) => mm.id === s.monitor);
    const room = auto
      ? span(monitors, m, this.y, s.size * this.scale, half + 8)
      : { left: m.work.left + half + 8, right: m.work.right - half - 8, rightNext: undefined, leftNext: undefined };
    let left = room.left,
      right = room.right,
      floor = m.work.bottom;
    if (this.support) {
      left = Math.max(m.work.left + half + 8, this.support.rect.left + half);
      right = Math.min(m.work.right - half - 8, this.support.rect.right - half);
      floor = this.support.rect.top;
    }
    // A higher floor across a seam (monitors of different height): jump up
    // onto it instead of walking into the edge.
    if (this.goal !== null && !this.air && !this.support && allow) {
      for (const [side, n] of [
        [1, room.rightNext],
        [-1, room.leftNext],
      ] as const) {
        if (!n) continue;
        const seam = side > 0 ? m.work.right : m.work.left;
        const beyond = side > 0 ? this.goal > seam : this.goal < seam;
        const rise = this.y - n.work.bottom;
        if (!beyond || rise <= 2 || Math.abs(this.x - seam) > half + 40 * this.scale) continue;
        const goal = this.goal;
        if (this.leap(seam + side * (half + 70 * this.scale), n.work.bottom)) this.pending = goal;
        else this.target = this.goal = null;
        break;
      }
    }
    // Mid-jump onto a neighbour: the seam is open whatever the height.
    if (this.pending !== null && this.air) {
      if (room.rightNext && this.vx > 0) right = room.rightNext.work.right - half - 8;
      if (room.leftNext && this.vx < 0) left = room.leftNext.work.left + half + 8;
    }
    if (this.target !== null) this.target = clamp(this.target, left, right);
    const desired =
      allow && this.target !== null
        ? clamp(
            (this.target - this.x) * 1.8 * this.hurry,
            -60 * this.scale * this.hurry,
            60 * this.scale * this.hurry,
          )
        : 0;
    // A leap keeps its horizontal speed until it lands.
    if (this.leapVx !== null && this.air) this.vx = this.leapVx;
    else this.vx += (desired - this.vx) * Math.min(1, dt * (this.air ? 1.8 : 5));
    this.x += this.vx * dt;
    if (this.target !== null && Math.abs(this.x - this.target) < 3) {
      this.target = null;
      this.goal = null;
      this.relocating = false;
      this.hurry = 1;
    }
    const previous = this.y;
    if (
      this.air ||
      this.y < floor - 1 ||
      (!this.support && this.y < m.work.bottom)
    ) {
      this.vy += 650 * this.scale * dt;
      this.y += this.vy * dt;
      this.air = true;
    }
    if (this.vy >= 0 && s.perch && !this.support) {
      for (const win of surfaces) {
        if (win.id === this.blockedSupport) continue;
        const r = win.rect;
        if (
          this.x > r.left + half &&
          this.x < r.right - half &&
          previous <= r.top + 3 &&
          this.y >= r.top &&
          r.top >= m.work.top + s.size * this.scale &&
          r.top < m.work.bottom
        ) {
          const occluded = surfaces
            .slice(0, surfaces.indexOf(win))
            .some(
              (w) =>
                this.x > w.rect.left &&
                this.x < w.rect.right &&
                r.top > w.rect.top &&
                r.top < w.rect.bottom,
            );
          if (!occluded) {
            this.support = win;
            floor = r.top;
            break;
          }
        }
      }
    }
    if (this.y >= floor && this.vy >= 0) {
      if (this.air) {
        this.impacts.push({ kind: "floor", speed: this.vy });
        if (this.vy > 420 * this.scale && this.leapVx === null) {
          // Hard landing: bounce once or twice before settling.
          this.y = floor;
          this.vy = -this.vy * 0.32;
          this.vx *= 0.6;
          if (this.support) this.support = null;
          return "jump";
        }
        this.landUntil = now + 260;
        this.leapVx = null;
        this.vx *= 0.3;
        this.thrown = 0;
        if (this.spinV) {
          // Dizzy from the tumble; lands upright (the squash hides the snap).
          this.shake = Math.min(6, this.shake + Math.abs(this.spinV) / 5);
          this.spinV = 0;
          this.swing = 0;
        }
        if (this.pending !== null) {
          this.target = this.goal = this.pending;
          this.pending = null;
        }
      }
      this.y = floor;
      this.vy = 0;
      this.air = false;
      this.blockedSupport = 0;
    }
    if (this.x < left || this.x > right) {
      // Just past a seam while dropping onto a lower screen: slide in, the
      // edge is not a wall and the walk goes on.
      const seam =
        !this.support &&
        ((this.x < left && room.leftNext && this.x > room.leftNext.work.right - half - 8) ||
          (this.x > right && room.rightNext && this.x < room.rightNext.work.left + half + 8));
      this.x = clamp(this.x, left, right);
      if (seam) {
        // keep target and speed
      } else if (this.air && Math.abs(this.vx) > 60 * this.scale) {
        // Hit the screen edge in flight: bounce back.
        this.impacts.push({ kind: "wall", speed: Math.abs(this.vx) });
        this.vx = -this.vx * 0.5;
        this.leapVx = null;
        this.target = null;
        this.goal = null;
      } else {
        this.vx = 0;
        this.target = null;
        this.goal = null;
      }
    }
    if (this.y < m.work.top + s.size * this.scale) {
      this.y = m.work.top + s.size * this.scale;
      if (this.vy < -200 * this.scale)
        this.impacts.push({ kind: "ceiling", speed: -this.vy });
      this.vy = Math.max(0, -this.vy * 0.3);
    }
    if (this.air) return "jump";
    if (now < this.landUntil) return "land";
    if (Math.abs(this.vx) > 3) {
      this.running = Math.abs(this.vx) > 90 * this.scale;
      return this.vx > 0 ? "walkRight" : "walkLeft";
    }
    this.running = false;
    return base;
  }
}
