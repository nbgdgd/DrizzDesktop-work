import { Action, clamp, Monitor, Rect, Settings, Surface } from "./model";
export function monitorAt(
  monitors: Monitor[],
  x: number,
  y: number,
  preferred = "auto",
): Monitor | undefined {
  return (
    monitors.find((m) => m.id === preferred) ||
    monitors.find(
      (m) =>
        x >= m.bounds.left &&
        x < m.bounds.right &&
        y >= m.bounds.top &&
        y <= m.bounds.bottom,
    ) ||
    monitors.find((m) => m.primary) ||
    monitors[0]
  );
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
    const half = size * this.scale * 0.5;
    this.x = clamp(this.x, m.work.left + half + 8, m.work.right - half - 8);
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
  begin(x: number, y: number, now: number) {
    this.dragging = true;
    this.dragOffset = { x: this.x - x, y: this.y - y };
    this.dragStart = { x, y, t: now };
    this.lastCursor = { x, y, t: now };
    this.target = null;
    this.vx = this.vy = 0;
    this.support = null;
    this.air = true;
  }
  drag(x: number, y: number, now: number) {
    if (!this.dragging) return;
    const dt = Math.max(0.016, (now - this.lastCursor.t) / 1000);
    // Limits scale with the monitor so a fling feels the same at 100-300 %.
    const k = this.scale;
    this.vx = clamp((x - this.lastCursor.x) / dt, -1800 * k, 1800 * k);
    this.vy = clamp((y - this.lastCursor.y) / dt, -1600 * k, 1400 * k);
    this.x = x + this.dragOffset.x;
    this.y = y + this.dragOffset.y;
    this.lastCursor = { x, y, t: now };
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
    if (now - this.lastCursor.t > 100 || click) {
      this.vx = this.vy = 0;
      this.thrown = 0;
    } else {
      // Keep most of the fling so a throw flies and bounces.
      this.vx *= 0.8;
      this.vy *= 0.7;
      this.thrown = Math.hypot(this.vx, this.vy);
    }
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
    this.relocating = relocate;
    this.hurry = hurry;
  }
  /**
   * Ballistic jump that lands on (tx, ty): used to hop onto a window's top
   * edge or away from the cursor. Returns false when the target is too high
   * for one jump (then the caller walks closer first) or the pet is busy.
   */
  leap(tx: number, ty: number, maxRise = 520): boolean {
    if (this.air || this.dragging || !this.initialized) return false;
    const g = 650 * this.scale;
    const rise = this.y - ty;
    if (rise > maxRise * this.scale) return false;
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
    this.hurry = 1;
    return true;
  }
  private leapVx: number | null = null;
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
    if (this.dragging) return "drag";
    const m = monitorAt(monitors, this.x, this.y, s.monitor);
    if (!m) return base;
    this.scale = m.scale;
    const half = s.size * this.scale * 0.38;
    dt = clamp(dt, 0, 0.05);
    const allow =
      !s.pinned &&
      (this.relocating ||
        (s.walk &&
          s.mode === "normal" &&
          !["sleep", "rest", "sit"].includes(base)));
    if (!s.perch) this.support = null;
    if (s.pinned) {
      this.target = null;
      this.vx = this.vy = 0;
      this.recover(monitors, s.size, s.monitor);
      return base;
    }
    let left = m.work.left + half + 8,
      right = m.work.right - half - 8,
      floor = m.work.bottom;
    if (this.support) {
      left = Math.max(left, this.support.rect.left + half);
      right = Math.min(right, this.support.rect.right - half);
      floor = this.support.rect.top;
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
      }
      this.y = floor;
      this.vy = 0;
      this.air = false;
      this.blockedSupport = 0;
    }
    if (this.x < left || this.x > right) {
      this.x = clamp(this.x, left, right);
      if (this.air && Math.abs(this.vx) > 60 * this.scale) {
        // Hit the screen edge in flight: bounce back.
        this.impacts.push({ kind: "wall", speed: Math.abs(this.vx) });
        this.vx = -this.vx * 0.5;
        this.leapVx = null;
      } else this.vx = 0;
      this.target = null;
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
