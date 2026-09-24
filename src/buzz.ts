// What a drink does to the pet. Pure logic: the scene feeds the pet's state
// in every frame and gets intents out (run there, jump, sway, hiccup, hit).
//
//   energy — ~45 s of zoomies: sprints from edge to edge at triple speed,
//            random jumps, sparks; then a crash (flat on the floor, grumpy).
//   coffee — the same, shorter and calmer.
//   beer   — ~60 s drunk: wobbly zig-zag walk and a swaying body, hiccups,
//            stumbles, hunts the cursor like an angry drunk, and punches the
//            screen/window in front of it (a crack drawn by the pet — the
//            real window is never touched); then a hangover.
//
// Drinking again while the effect lasts adds time, up to a cap.
export type BuzzKind = "energy" | "beer";
export interface BuzzInput {
  now: number;
  pet: { x: number; y: number; air: boolean; dragging: boolean };
  /** Walkable span on the current floor, desktop px. */
  left: number;
  right: number;
  /** Monitor scale and pet height in desktop px. */
  k: number;
  size: number;
  random: () => number;
}
export interface BuzzIntent {
  go?: { x: number; hurry: number };
  jump?: boolean;
  glyph?: [string, string];
  /** Director event to say (direct). */
  say?: string;
  /** Tripped: dust + a squash. */
  stumble?: boolean;
  /** Punch in front: -1 left, 1 right. */
  smash?: number;
  /** Force an animation for a moment. */
  action?: "swat" | "rest" | "pained" | "celebrate";
  until?: number;
}
const DURATION: Record<BuzzKind, number> = { energy: 45000, beer: 60000 };
const AFTER: Record<BuzzKind, number> = { energy: 20000, beer: 30000 };
const CAP = 120000;

export class Buzz {
  kind: BuzzKind | null = null;
  until = 0;
  /** The after-effect (crash / hangover) lasts until this time. */
  afterUntil = 0;
  private strength = 1;
  private nextMove = 0;
  private nextGlyph = 0;
  private nextHic = 0;
  private nextSmash = 0;
  private nextSay = 0;
  private side = 1;
  private announcedAfter = false;
  smashes = 0;

  start(kind: BuzzKind, now: number, strength = 1) {
    const base = DURATION[kind] * strength;
    if (this.kind === kind && now < this.until) this.until = Math.min(now + CAP, this.until + base);
    else this.until = now + base;
    this.kind = kind;
    this.strength = strength;
    this.afterUntil = 0;
    this.announcedAfter = false;
    this.nextMove = now;
    this.nextGlyph = now + 400;
    this.nextHic = now + 3000;
    this.nextSmash = now + 7000;
    this.nextSay = now + 15000;
  }
  active(now: number) {
    return !!this.kind && now < this.until;
  }
  /** In the crash / hangover after the effect. */
  after(now: number) {
    return !!this.kind && now >= this.until && now < this.afterUntil;
  }
  get drunk() {
    return this.kind === "beer";
  }
  /** Body sway in radians while drunk (added to the drawn angle). */
  sway(now: number) {
    if (this.kind !== "beer" || now >= this.until) return 0;
    return Math.sin(now / 320) * 0.2 + Math.sin(now / 910) * 0.08;
  }
  /** Walk-cycle speed multiplier. */
  animSpeed(now: number) {
    return this.kind === "energy" && now < this.until ? 2.4 : 1;
  }
  cancel() {
    this.kind = null;
    this.until = this.afterUntil = 0;
  }
  step(i: BuzzInput): BuzzIntent {
    const { now } = i;
    if (!this.kind) return {};
    if (now >= this.until) {
      if (!this.afterUntil) this.afterUntil = this.until + AFTER[this.kind] * this.strength;
      if (now >= this.afterUntil) {
        this.kind = null;
        return {};
      }
      if (!this.announcedAfter) {
        this.announcedAfter = true;
        return {
          say: this.kind === "energy" ? "energyCrash" : "hangover",
          action: this.kind === "energy" ? "rest" : "pained",
          until: this.afterUntil,
        };
      }
      return {};
    }
    if (i.pet.dragging) return {};
    return this.kind === "energy" ? this.energy(i) : this.beer(i);
  }
  private energy(i: BuzzInput): BuzzIntent {
    const { now, k, random } = i;
    const out: BuzzIntent = {};
    if (now >= this.nextGlyph) {
      this.nextGlyph = now + 700 + random() * 900;
      out.glyph = random() < 0.5 ? ["⚡", "#ffe27a"] : ["💦", "#7fd3ff"];
    }
    if (now >= this.nextMove && !i.pet.air) {
      // Edge to edge, overshooting the middle: a sprint, not a walk.
      this.side = -this.side;
      const span = i.right - i.left;
      const x = this.side > 0 ? i.right - random() * span * 0.15 : i.left + random() * span * 0.15;
      // ~8x walking speed: a sprint the eye can barely follow.
      out.go = { x, hurry: this.strength < 1 ? 5 : 8 };
      this.nextMove = now + 1100 + random() * 1300;
      if (random() < 0.35) out.jump = true;
    } else if (!i.pet.air && random() < 0.012) out.jump = true;
    if (now >= this.nextSay) {
      this.nextSay = now + 14000 + random() * 8000;
      out.say = "energyRush";
    }
    return out;
  }
  private beer(i: BuzzInput): BuzzIntent {
    const { now, k, random } = i;
    const out: BuzzIntent = {};
    if (now >= this.nextMove && !i.pet.air) {
      // Zig-zag: short, slow, random steps with the odd lurch.
      const step = (80 + random() * 220) * k * (random() < 0.5 ? -1 : 1);
      const x = Math.max(i.left, Math.min(i.right, i.pet.x + step));
      out.go = { x, hurry: random() < 0.2 ? 1.6 : 0.65 };
      this.nextMove = now + 1300 + random() * 1800;
      if (random() < 0.22) out.stumble = true;
    }
    if (now >= this.nextHic) {
      this.nextHic = now + 3500 + random() * 4500;
      out.glyph = ["ик!", "#f3d27a"];
      if (random() < 0.3) out.say = "hic";
    }
    if (now >= this.nextSmash && !i.pet.air) {
      this.nextSmash = now + 9000 + random() * 6000;
      this.smashes++;
      out.smash = random() < 0.5 ? -1 : 1;
      out.action = "swat";
      out.until = now + 500;
    }
    if (!out.say && now >= this.nextSay) {
      this.nextSay = now + 16000 + random() * 9000;
      out.say = "drunk";
    }
    return out;
  }
}
