// What the pet does with the mouse cursor: touches it when it lingers,
// pushes it away, tries to catch it when it flies past, and - when it has
// been wronged - hunts it down and hits it, each character in its own way:
//   Drizz (stalk)      follows the cursor around and hits it a couple of times;
//   Nezuko (aggressive) runs after it at full speed, keeps hitting, pounces;
//   Claude (lecture)   reads a moral first, then one careful swat;
//   Eigenblob (clumsy) tries hard, misses, slips and falls;
//   Aqua (lazy)        one limp poke and walks away sighing.
// Pure logic: the scene feeds positions in, gets intents out (walk, jump,
// play an animation, say something, push the real cursor a little).
// Units: desktop px; `size` is the pet's height in px, `k` the monitor scale.
import type { Action } from "./model";
import type { Chase, Temper } from "./character";
export interface PlayInput {
  now: number;
  cursor: { x: number; y: number; down: boolean };
  pet: { x: number; y: number; air: boolean; dragging: boolean; onWindow: boolean };
  size: number;
  k: number;
  grudge: number;
  /** ms since the last throw or poke (Infinity if never). */
  wronged: number;
  /** Relationship stage 0..4. */
  stage: number;
  temper: Temper;
  /** Cursor play allowed right now (setting, normal mode, walking, not pinned). */
  enabled: boolean;
  /** The pet is asleep or resting and should not start games. */
  asleep: boolean;
  /** Agility upgrade level 0..5. */
  agility: number;
  /** A random source (tests pass a fixed one). */
  random: () => number;
}
export interface PlayIntent {
  /** Walk/run to x. */
  go?: { x: number; hurry: number };
  /** Jump at a point. */
  leap?: { x: number; y: number };
  /** Play this animation until `until`. */
  action?: Action;
  until?: number;
  /** Director event for a line. */
  say?: string;
  /** Push the real cursor by this much (desktop px). */
  nudge?: { dx: number; dy: number };
  /** Missed and slipped: dust and a wobble. */
  slip?: boolean;
  /** A fast pass was caught (the scene should not dodge). */
  caught?: boolean;
  /** Revenge taken: lower the grudge by this much. */
  calm?: number;
  /** Counted for achievements: "swat", "pounce", "miss". */
  count?: string;
  /** Stop walking. */
  stop?: boolean;
  /** Hop in place (an angry jump at a cursor it cannot reach). */
  jump?: boolean;
}
type State =
  | "idle"
  | "lecture"
  | "hunt"
  | "swat"
  | "pounce"
  | "slip"
  | "watch"
  | "touch"
  | "push"
  | "stalk"
  | "leave"
  | "annoy"
  | "game";
export class CursorPlay {
  state: State = "idle";
  private since = 0;
  private until = 0;
  private swats = 0;
  private lastSample = { x: 0, y: 0, t: 0 };
  /** Cursor speed, px/s, lightly smoothed. */
  speed = 0;
  private stillSince = 0;
  private nextHunt = 0;
  private nextLinger = 0;
  private nextCatch = 0;
  private nextStalk = 0;
  private lastGo = { x: NaN, t: 0 };
  private hitAt = 0;
  private pounced = false;
  /** Standing right under a cursor that is out of reach since then. */
  private glareSince = 0;
  private lastLeap = 0;
  /** When this revenge started: retries after slips stop after a minute. */
  private huntStart = 0;
  /** Ignore cursor speed right after we moved it ourselves. */
  private ownMoveUntil = 0;
  get busy() {
    return this.state !== "idle";
  }
  /** Stop everything (drag, sleep, settings change). */
  cancel() {
    this.state = "idle";
    this.swats = 0;
  }
  /** Mini-game "catch the cursor": chase without a grudge, count catches. */
  game(now: number, ms: number) {
    this.enter("game", now, ms);
    this.swats = 0;
  }
  /** No reason at all: walk up to the cursor and hit it once. */
  tease(now: number) {
    if (this.state !== "idle") return false;
    this.enter("hunt", now, 9000);
    this.swats = 0;
    this.huntStart = now;
    return true;
  }
  /** Ignored too long: walk right under the cursor and stand in the way. */
  annoy(now: number) {
    if (this.state !== "idle") return;
    this.enter("annoy", now, 12000);
  }
  private enter(s: State, now: number, ms: number) {
    this.state = s;
    this.since = now;
    this.until = now + ms;
  }
  private track(i: PlayInput) {
    const { x, y } = i.cursor;
    const dt = (i.now - this.lastSample.t) / 1000;
    if (this.lastSample.t && dt > 0 && dt < 0.5) {
      const v = Math.hypot(x - this.lastSample.x, y - this.lastSample.y) / dt;
      this.speed = this.speed * 0.5 + v * 0.5;
    } else this.speed = 0;
    if (Math.hypot(x - this.lastSample.x, y - this.lastSample.y) > 3) this.stillSince = i.now;
    this.lastSample = { x, y, t: i.now };
  }
  /** Horizontal and vertical reach of one swat. */
  private reachable(i: PlayInput) {
    const dx = Math.abs(i.cursor.x - i.pet.x);
    // A swat reaches a little above the head (it stretches up for it).
    const top = i.pet.y - i.size * 1.45,
      bottom = i.pet.y + 16 * i.k;
    return dx < i.size * 0.8 && i.cursor.y > top && i.cursor.y < bottom;
  }
  /** Highest point one jump gets the paws to. */
  private jumpMax(i: PlayInput) {
    return Math.min(470 * i.k, i.size + 260 * i.k * (1 + 0.12 * i.agility));
  }
  /** Close enough above for one jump. */
  private pounceable(i: PlayInput) {
    const rise = i.pet.y - i.cursor.y;
    return (
      !i.pet.air &&
      Math.abs(i.cursor.x - i.pet.x) < 320 * i.k &&
      rise > i.size * 1.2 &&
      rise < this.jumpMax(i)
    );
  }
  private near(i: PlayInput, r: number) {
    return (
      Math.abs(i.cursor.x - i.pet.x) < r &&
      i.cursor.y > i.pet.y - i.size * 1.5 &&
      i.cursor.y < i.pet.y + 20 * i.k
    );
  }
  private missChance(i: PlayInput) {
    return Math.max(0.02, i.temper.miss * (1 - 0.15 * i.agility));
  }
  private goTo(i: PlayInput, x: number, hurry: number): PlayIntent {
    // Re-aim only when the target moved noticeably (no jitter in the walk).
    if (Math.abs(x - this.lastGo.x) < 40 * i.k && i.now - this.lastGo.t < 900) return {};
    this.lastGo = { x, t: i.now };
    return { go: { x, hurry } };
  }
  private push(i: PlayInput, strength: number) {
    const dir = Math.sign(i.cursor.x - i.pet.x) || (i.random() < 0.5 ? -1 : 1);
    const p = i.temper.push * i.k * strength * (0.8 + i.random() * 0.4);
    this.ownMoveUntil = i.now + 450;
    return { dx: Math.round(dir * p), dy: Math.round(-p * 0.35) };
  }
  private style(i: PlayInput): Chase {
    return i.temper.chase;
  }
  update(i: PlayInput): PlayIntent {
    this.track(i);
    const now = i.now;
    if (!i.enabled || i.pet.dragging) {
      if (this.state !== "idle") this.cancel();
      return {};
    }
    const chase = this.style(i);
    switch (this.state) {
      case "idle":
        return this.idle(i, chase);
      case "lecture":
        if (now >= this.until) {
          this.enter("hunt", now, 25000);
          return { say: "cursorHunt" };
        }
        return { action: "judge", until: now + 300, stop: true };
      case "hunt":
        return this.hunt(i, chase);
      case "swat":
        return this.swat(i, chase);
      case "pounce":
        return this.pounce(i, chase);
      case "slip":
        if (now >= this.until) {
          // Picks itself up and tries again while the revenge is not done
          // (the lazy one does not bother).
          if (chase !== "lazy" && this.swats < i.temper.swats && i.grudge >= i.temper.huntAt * 0.5 && now - this.huntStart < 60000) {
            this.enter("hunt", now, 15000);
            return {};
          }
          this.enter("watch", now, 20000);
          return { say: "cursorWatch" };
        }
        return { action: "pained", until: now + 200 };
      case "watch": {
        if (now >= this.until) {
          this.cancel();
          return {};
        }
        // Sits a little to the side and keeps its eyes on the cursor.
        const side = i.cursor.x > i.pet.x ? -1 : 1;
        const spot = i.cursor.x + side * 150 * i.k;
        const far = Math.abs(i.pet.x - spot) > 260 * i.k;
        return {
          ...(far ? this.goTo(i, spot, 1) : {}),
          action: far ? undefined : "judge",
          until: now + 300,
        };
      }
      case "touch":
        if (now - this.since > 2200) {
          // Still there after a touch: now a proper push.
          if (this.near(i, i.size) && this.speed < 60) {
            this.enter("push", now, 700);
            return {
              action: "swat",
              until: now + 450,
              say: "cursorPush",
              nudge: this.push(i, 1),
            };
          }
          this.cancel();
          return {};
        }
        return { action: "look", until: now + 200 };
      case "push":
        if (now >= this.until) {
          this.enter("watch", now, 8000 + i.random() * 6000);
        }
        return {};
      case "stalk": {
        if (now >= this.until || i.grudge >= i.temper.huntAt) {
          this.cancel();
          return {};
        }
        const side = i.cursor.x > i.pet.x ? -1 : 1;
        const spot = i.cursor.x + side * 190 * i.k;
        if (Math.abs(i.pet.x - spot) > 110 * i.k) return this.goTo(i, spot, 1.3);
        return { action: "judge", until: now + 300 };
      }
      case "leave":
        if (now >= this.until) {
          this.cancel();
          return { action: "sigh", until: now + 2100 };
        }
        return {};
      case "game": {
        if (now >= this.until) {
          this.cancel();
          return { stop: true };
        }
        // A catch is a real hit, same as in a hunt: the cursor gets knocked.
        if (this.reachable(i) && now - this.hitAt > 800) {
          this.hitAt = now;
          return { action: "swat", until: now + 420, caught: true, count: "gameCatch", say: "gameCatch", nudge: this.push(i, 0.8) };
        }
        // Jumps for a cursor above it much more eagerly than in a hunt.
        if (this.pounceable(i) && now - this.lastLeap > 1100 && i.random() < 0.15) {
          this.lastLeap = now;
          return { leap: { x: i.cursor.x, y: i.cursor.y + i.size * 0.35 } };
        }
        // Close but out of reach: a hop now and then, and it runs a little
        // past the cursor so it turns around instead of creeping one way.
        const dx = i.cursor.x - i.pet.x;
        if (!i.pet.air && Math.abs(dx) < i.size * 1.6 && now - this.lastLeap > 1500 && i.random() < 0.03) {
          this.lastLeap = now;
          return { jump: true };
        }
        return this.goTo(i, i.cursor.x + Math.sign(dx) * 30 * i.k, i.temper.hurry * 1.3);
      }
      case "annoy": {
        if (now >= this.until) {
          this.cancel();
          return {};
        }
        if (Math.abs(i.pet.x - i.cursor.x) > 40 * i.k) return this.goTo(i, i.cursor.x, 1.2);
        if (now - this.hitAt > 6000) {
          this.hitAt = now;
          return { action: "wave", until: now + 1500, say: "cursorAnnoy" };
        }
        return {};
      }
    }
    return {};
  }
  private idle(i: PlayInput, chase: Chase): PlayIntent {
    const now = i.now;
    if (i.asleep || i.pet.air) return {};
    // 1. Revenge.
    if (i.grudge >= i.temper.huntAt && i.wronged < 15 * 60000 && now >= this.nextHunt) {
      this.nextHunt = now + 90000;
      this.swats = 0;
      this.huntStart = now;
      if (chase === "lecture") {
        this.enter("lecture", now, 4500);
        return { say: "cursorLecture", action: "judge", until: now + 4500, stop: true };
      }
      this.enter("hunt", now, chase === "lazy" ? 12000 : 25000);
      return { say: "cursorHunt" };
    }
    // 2. A cursor flung past the head: try to catch it (playful or aggressive).
    if (
      now >= this.nextCatch &&
      now >= this.ownMoveUntil &&
      this.speed > 2300 * i.k &&
      this.near(i, 230 * i.k) &&
      (chase === "aggressive" || i.stage >= 2 || i.grudge >= 20) &&
      i.random() < (chase === "aggressive" ? 0.8 : 0.45)
    ) {
      this.nextCatch = now + 20000;
      const hit = this.reachable(i) && i.random() > this.missChance(i);
      if (hit) return { action: "swat", until: now + 450, say: "cursorCatch", caught: true, count: "swat" };
      this.enter("slip", now, 1500);
      return { action: "pained", until: now + 1500, say: "cursorMiss", slip: true, caught: true, count: "miss" };
    }
    // 3. The cursor rests right next to it: touch it, then push it.
    if (
      now >= this.nextLinger &&
      this.speed < 30 &&
      now - this.stillSince > 3500 &&
      this.near(i, i.size * 0.9) &&
      !i.pet.onWindow
    ) {
      this.nextLinger = now + 60000;
      this.enter("touch", now, 2500);
      return { action: "swat", until: now + 400, say: "cursorTouch", nudge: this.push(i, 0.2) };
    }
    // 4. Drizz follows the cursor around when a little annoyed.
    if (
      chase === "stalk" &&
      now >= this.nextStalk &&
      i.grudge >= 15 &&
      i.random() < 0.01
    ) {
      this.nextStalk = now + 5 * 60000;
      this.enter("stalk", now, 20000 + i.random() * 20000);
    }
    return {};
  }
  private hunt(i: PlayInput, chase: Chase): PlayIntent {
    const now = i.now;
    if (now >= this.until) {
      this.enter("watch", now, 15000);
      return { say: "cursorWatch", stop: true };
    }
    if (this.reachable(i)) {
      this.enter("swat", now, 480);
      this.pounced = false;
      return { action: "swat", until: now + 480, stop: true };
    }
    // Above the head but within a jump: it jumps at it - for sure once it is
    // close, now and then from further away (Nezuko more often).
    const dx = Math.abs(i.cursor.x - i.pet.x);
    const jumpy = { aggressive: 0.05, stalk: 0.02, clumsy: 0.03, lecture: 0.01, lazy: 0 }[chase];
    if (
      chase !== "lazy" &&
      this.pounceable(i) &&
      now - this.lastLeap > 1400 &&
      (dx < 170 * i.k || i.random() < jumpy)
    ) {
      this.enter("pounce", now, 2500);
      this.pounced = false;
      this.lastLeap = now;
      this.glareSince = 0;
      return {
        leap: { x: i.cursor.x, y: i.cursor.y + i.size * 0.35 },
        say: "cursorPounce",
      };
    }
    const hurry = i.temper.hurry * (chase === "aggressive" ? 1 : 0.85);
    // Out of reach even for a jump: runs under it, glares for a moment, then
    // an angry hop with a swipe and a shout - and it lets the cursor be.
    if (i.pet.y - i.cursor.y > i.size * 1.2 && !this.pounceable(i)) {
      if (dx > 60 * i.k) {
        this.glareSince = 0;
        return this.goTo(i, i.cursor.x, hurry);
      }
      if (!this.glareSince) this.glareSince = now;
      if (now - this.glareSince > 2200 && !i.pet.air) {
        this.glareSince = 0;
        this.enter("watch", now, 12000);
        return { say: "cursorTooHigh", jump: true, action: "swat", until: now + 700, stop: true };
      }
      return { action: "judge", until: now + 300 };
    }
    this.glareSince = 0;
    return this.goTo(i, i.cursor.x, hurry);
  }
  private swat(i: PlayInput, chase: Chase): PlayIntent {
    const now = i.now;
    // The paw comes down ~150 ms in: that is when it hits or misses.
    if (now - this.since >= 150 && this.hitAt < this.since) {
      this.hitAt = now;
      if (!this.reachable(i)) return {};
      if (i.random() < this.missChance(i)) {
        this.enter("slip", now, chase === "clumsy" ? 1800 : 1300);
        return { action: "pained", until: now + 1500, say: "cursorMiss", slip: true, count: "miss" };
      }
      this.swats++;
      return {
        nudge: this.push(i, chase === "lazy" ? 0.4 : 1),
        say: "cursorSwat",
        calm: chase === "lazy" ? 25 : 10,
        count: "swat",
      };
    }
    if (now < this.until) return { action: "swat", until: this.until };
    // Wind down: lazy leaves, the rest hit again or settle to watch.
    if (chase === "lazy") {
      const away = i.pet.x + (i.cursor.x > i.pet.x ? -1 : 1) * 320 * i.k;
      this.enter("leave", now, 5000);
      return { say: "cursorLazy", go: { x: away, hurry: 0.8 } };
    }
    if (this.swats < i.temper.swats && i.grudge > i.temper.huntAt * 0.4) {
      this.enter("hunt", now, chase === "aggressive" ? 20000 : 10000);
      return {};
    }
    this.enter("watch", now, 20000 + i.random() * 15000);
    return { say: "cursorWatch" };
  }
  private pounce(i: PlayInput, chase: Chase): PlayIntent {
    const now = i.now;
    const cx = i.pet.x,
      cy = i.pet.y - i.size * 0.5;
    if (
      i.pet.air &&
      !this.pounced &&
      Math.hypot(i.cursor.x - cx, i.cursor.y - cy) < i.size * 0.7
    ) {
      this.pounced = true;
      this.ownMoveUntil = now + 450;
      if (i.random() < this.missChance(i) * 0.6) return {};
      return {
        nudge: { dx: Math.round((i.random() - 0.5) * 30 * i.k), dy: Math.round(55 * i.k) },
        count: "pounce",
        calm: 15,
      };
    }
    if (!i.pet.air && now - this.since > 300) {
      if (!this.pounced && chase === "clumsy") {
        this.enter("slip", now, 1800);
        return { slip: true, say: "cursorMiss", action: "pained", until: now + 1500, count: "miss" };
      }
      // Missed in the air: it lands and goes again while the anger lasts.
      if (!this.pounced) {
        if (now - this.huntStart < 25000) {
          this.enter("hunt", now, 12000);
          return {};
        }
        this.enter("watch", now, 15000);
        return { say: "cursorWatch" };
      }
      this.swats++;
      if (this.swats < i.temper.swats && (chase === "aggressive" || i.grudge > i.temper.huntAt * 0.4)) {
        this.enter("hunt", now, 15000);
        return {};
      }
      this.enter("watch", now, 20000);
      return { say: "cursorWatch" };
    }
    if (now >= this.until) this.enter("watch", now, 15000);
    return {};
  }
}
