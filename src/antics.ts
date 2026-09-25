// Longer behaviours that make the pet feel alive between reactions: it
// sulks in a corner after throws, stares and holds up a sign, comes back to
// the window you pulled it off, repeats what you interrupted, looks for the
// window that vanished under it, leaves notes and goes away for a while,
// hides at the screen edge when something scary happens, brings gifts,
// steals coins, dances to music and picks its own place to sleep.
// The scene owns the objects; this only decides and schedules.
import type { Action, Monitor, Settings, Snapshot, Surface } from "./model";
import type { Movement } from "./movement";
import type { Director } from "./director";
import type { Props, FloorItem } from "./props";
import { monitorAt } from "./movement";
import { favoriteSpot, lately } from "./chronicle";
import { working } from "./game";
import { linesFor } from "./dialogue";
import { tx } from "./i18n";
export interface Host {
  now: number;
  world: Movement;
  brain: Director;
  props: Props;
  settings: Settings;
  monitors: Monitor[];
  snapshot?: Snapshot;
  /** Plays `action` for `ms` over whatever the director wants. */
  override(action: Action, ms: number): void;
  /** Director line (direct = bypasses the comment budget). */
  say(event: string, direct?: boolean, vars?: Record<string, string>): boolean;
  glyph(ch: string, color: string): void;
  random: () => number;
}
export type Away =
  | null
  | { phase: "leaving"; edge: number; note: string; ms: number; reason: string }
  | { phase: "gone"; until: number; note: FloorItem; reason: string; again: boolean }
  | { phase: "peek"; until: number; side: -1 | 1 };
const stickers = ["Звёздочка", "Котик", "Пиксель", "Молния", "Сердечко", "Кактус", "Череп", "Радуга"];
const snacks = ["candy", "chips", "cola", "seeds", "chocolate", "icecream"];
export class Antics {
  private jobs: { at: number; run: () => void }[] = [];
  away: Away = null;
  /** Hiding at an edge after a scare: peeking and shivering until then. */
  hideUntil = 0;
  hideSide: -1 | 1 = 1;
  private hiding = false;
  /** What it carries above its head (item texture key or "coin"). */
  carry = "";
  private carryTo: number | null = null;
  private carryThen: (() => void) | null = null;
  private gift: { item: FloorItem; until: number } | null = null;
  private stash: FloorItem | null = null;
  private nextGift = 0;
  private nextSteal = 0;
  private nextNote = 0;
  private nextDance = 0;
  private nextRoll = 0;
  private nextClimb = 0;
  private lastBase: Action = "idle";
  private sleepNote: FloorItem | null = null;
  private perchLeaveAt = 0;
  private sulkWalked = 0;
  /** Seconds of jerky window rides (motion sickness). */
  private ride = 0;
  constructor() {}
  later(at: number, run: () => void) {
    this.jobs.push({ at, run });
  }
  private edges(h: Host) {
    const m = monitorAt(h.monitors, h.world.x, h.world.y, h.settings.monitor);
    const half = h.settings.size * h.world.scale * 0.5 + 10;
    return m ? { m, left: m.work.left + half, right: m.work.right - half } : null;
  }
  private nearestEdge(h: Host): { x: number; side: -1 | 1 } | null {
    const e = this.edges(h);
    if (!e) return null;
    return h.world.x - e.left < e.right - h.world.x ? { x: e.left, side: -1 } : { x: e.right, side: 1 };
  }
  /** The user wants to play: off the screen or hiding, it comes back now. */
  recall() {
    this.away = null;
    this.hideUntil = 0;
  }
  get absent() {
    return this.away?.phase === "gone";
  }
  /**
   * Horizontal crop for peeking from behind the screen edge: the side it
   * hides on is cut off. Returns [cropLeft, cropRight] in frame px or null.
   */
  crop(): [number, number] | null {
    if (this.away?.phase === "peek") return this.away.side < 0 ? [96, 192] : [0, 96];
    if (this.hiding) return this.hideSide < 0 ? [86, 192] : [0, 106];
    return null;
  }
  get shivering() {
    return this.hiding;
  }
  // ------------------------------------------------------------ triggers
  /** A throw has landed: silent stare, then maybe the sign. */
  thrownLanded(h: Host) {
    const now = h.now;
    this.later(now + 350, () => h.brain.stare(h.now));
    const lately3 = lately(h.brain.life, "throw", now, 20 * 60000);
    if (h.brain.game.grudge >= 20 || lately3 >= 2 || h.random() < 0.4)
      this.later(now + 3700, () => h.brain.remember(h.now));
  }
  /** Dropped after a drag: stubborn return to a window, repeat an interrupted walk. */
  dropped(h: Host, fromWindow: Surface | null, goal: number | null) {
    const now = h.now;
    if (fromWindow && lately(h.brain.life, "evict", now, 10 * 60000) >= 2) {
      this.later(now + 2600, () => {
        const win = h.snapshot?.windows.find((w) => w.id === fromWindow.id);
        if (!win || h.world.dragging) return;
        if (h.say("stubborn", true))
          h.brain.wantHop = { id: win.id, x: (win.rect.left + win.rect.right) / 2, top: win.rect.top, until: h.now + 12000 };
      });
    } else if (goal !== null && h.brain.cancelled(now)) {
      this.later(now + 2000, () => {
        if (h.world.dragging) return;
        h.say("repeatSpite", true);
        h.world.go(goal, false, 1.3);
      });
    }
  }
  /** The window under it vanished: looks around where it was. */
  fell(h: Host, rect: Surface["rect"]) {
    const now = h.now;
    const mid = (rect.left + rect.right) / 2;
    this.later(now + 1500, () => {
      if (h.world.dragging) return;
      h.say("search", false);
      h.world.go(mid, false, 1);
    });
    this.later(now + 4500, () => {
      if (!h.world.dragging) h.world.go(mid + (h.random() < 0.5 ? -1 : 1) * 140 * h.world.scale);
      h.override("look", 1500);
    });
  }
  /** Just climbed or jumped onto a window. */
  perched(h: Host) {
    if (h.random() < 0.45) {
      h.override("judge", 3500);
      h.say("perchLook", false);
    }
    this.perchLeaveAt = h.now + (40 + h.random() * 80) * 1000;
  }
  /** Something scary (trace alert, risky autostart): hide at the edge and shiver. */
  scare(h: Host) {
    if (working(h.brain.game, h.now)) return;
    if (!h.settings.walk || h.settings.pinned || h.world.support) return;
    const e = this.nearestEdge(h);
    if (!e) return;
    this.hideSide = e.side;
    h.world.go(e.x + e.side * 20 * h.world.scale, true, 2.6);
    this.hideUntil = h.now + 12000;
  }
  /** "Отвали": walks off the edge and peeks back after a minute. */
  leave(h: Host, reason: "go" | "note", ms: number, note?: string) {
    if (this.away) return;
    const e = this.nearestEdge(h);
    if (!e) return;
    const text = note ?? pick(linesFor("noteLeft", h.brain.settings), h.random);
    this.away = { phase: "leaving", edge: e.x, note: text, ms, reason };
    h.world.support = null;
    h.world.go(e.x, true, reason === "go" ? 1.6 : 1);
  }
  /** Clicked a floor item: notes, gifts, the stash. */
  clickItem(h: Host, it: FloorItem): boolean {
    const now = h.now;
    if (it.kind === "note") {
      if (this.away?.phase === "gone" && this.away.note.id === it.id) {
        // Straight away? Another note: "I did write it."
        if (now - it.born < 6000 && !this.away.again) {
          h.props.remove(it.id);
          const again = h.props.drop("note", it.x, it.y, now, pick(linesFor("noteAgain", h.brain.settings), h.random));
          this.away = { ...this.away, note: again, again: true };
          h.brain.reset("noteAgain");
          return true;
        }
        this.comeBack(h);
        return true;
      }
      h.props.remove(it.id);
      if (it === this.sleepNote) {
        // "Не трогать." - clicked anyway: "I did write it."
        this.sleepNote =
          ["Не трогать.", "Do not touch."].includes(it.label ?? "") ? h.props.drop("note", it.x, it.y, now, pick(linesFor("noteAgain", h.brain.settings), h.random)) : null;
        h.brain.life.counts.noteRead = (h.brain.life.counts.noteRead ?? 0) + 1;
      }
      return true;
    }
    if (this.gift?.item.id === it.id) {
      this.takeGift(h);
      return true;
    }
    if (this.stash?.id === it.id) {
      h.say("steal", true);
      return true;
    }
    return false;
  }
  takeGift(h: Host) {
    const g = this.gift;
    if (!g) return;
    this.gift = null;
    h.props.remove(g.item.id);
    const life = h.brain.life;
    if (g.item.kind === "coin") {
      const n = Number(g.item.label) || 10;
      h.brain.game = { ...h.brain.game, money: h.brain.game.money + n };
    } else if (g.item.kind === "sticker") life.collection["sticker:" + (g.item.label ?? "?")] = (life.collection["sticker:" + (g.item.label ?? "?")] ?? 0) + 1;
    else if (g.item.kind === "snack") life.pantry[g.item.label ?? "candy"] = Math.min(99, (life.pantry[g.item.label ?? "candy"] ?? 0) + 1);
    life.counts.gift = (life.counts.gift ?? 0) + 1;
    h.brain.reset("giftTaken");
    h.say("giftTaken", true);
  }
  declineGift(h: Host) {
    const g = this.gift;
    if (!g) return;
    this.gift = null;
    h.props.remove(g.item.id);
    h.say("giftIgnored", true);
  }
  private comeBack(h: Host) {
    if (this.away?.phase === "gone") h.props.remove(this.away.note.id);
    this.away = null;
    h.brain.life.counts.noteRead = (h.brain.life.counts.noteRead ?? 0) + 1;
    h.say("awayBack", true);
  }
  /** Motion of the window it rides on (px per motion event). */
  rideJerk(h: Host, d: number) {
    const k = h.world.scale;
    this.ride = Math.max(0, this.ride * 0.97 + Math.max(0, d - 25 * k) / (220 * k));
    if (this.ride > 3.2) {
      this.ride = 0;
      h.brain.seasick(h.now);
      // Sometimes it just falls off.
      if (h.random() < 0.4 && h.world.support) {
        h.world.support = null;
        h.world.air = true;
        h.world.vy = 20 * k;
      }
    }
  }
  // ------------------------------------------------------------ per frame
  update(h: Host) {
    const now = h.now;
    const s = h.settings;
    const w = h.world;
    // Scheduled one-offs.
    const due = this.jobs.filter((j) => j.at <= now);
    this.jobs = this.jobs.filter((j) => j.at > now);
    for (const j of due) j.run();
    // At work it stays at its desk: no gifts, notes, climbing or dancing.
    const free = s.mode === "normal" && s.walk && !s.pinned && !w.dragging && !h.brain.hidden && !working(h.brain.game, now);
    // Away (a note in its place).
    if (this.away) {
      const a = this.away;
      if (a.phase === "leaving") {
        if (!free) this.away = null;
        else if (Math.abs(w.x - a.edge) < 6 && !w.air) {
          const note = h.props.drop("note", w.x - Math.sign(a.edge - w.x || 1) * 40 * w.scale, w.y, now, a.note);
          this.away = { phase: "gone", until: now + a.ms, note, reason: a.reason, again: false };
          h.brain.reset("noteLeft");
        }
      } else if (a.phase === "gone") {
        if (now >= a.until) {
          const e = this.nearestEdge(h);
          this.away = { phase: "peek", until: now + 3500, side: e?.side ?? 1 };
          if (a.reason === "go") h.say("peekBack", true);
          h.override("look", 3500);
        }
      } else if (now >= a.until) {
        this.away = null;
        if (free) w.go(w.x - a.side * 260 * w.scale);
      }
      return;
    }
    // Hiding after a scare.
    this.hiding = now < this.hideUntil && Math.abs(w.vx) < 20 && !w.air && !w.support;
    if (this.hideUntil && now >= this.hideUntil) {
      this.hideUntil = 0;
      if (free) w.go(w.x - this.hideSide * 220 * w.scale);
    }
    if (!free) return;
    // Carrying something to its corner.
    if (this.carryTo !== null && Math.abs(w.x - this.carryTo) < 8 && !w.air) {
      this.carryTo = null;
      const then = this.carryThen;
      this.carryThen = null;
      this.carry = "";
      then?.();
    }
    // Sulking: to the nearest corner, once.
    if (h.brain.sulkUntil > now && now - this.sulkWalked > 60000 && !w.support) {
      this.sulkWalked = now;
      const e = this.nearestEdge(h);
      if (e) w.go(e.x, false, 1.2);
    }
    // Pick a place to rest or sleep.
    const base = h.brain.base;
    if ((base === "rest" || base === "sleep") && this.lastBase !== base && !w.support) {
      const m = monitorAt(h.monitors, w.x, w.y, s.monitor);
      if (m) {
        const fav = favoriteSpot(h.brain.life, m.id);
        const e = this.edges(h);
        const r = h.random();
        const x = fav !== null && r < 0.5 ? fav : e && r < 0.8 ? (r < 0.65 ? e.left : e.right) : w.x;
        w.go(x, true, 1);
        this.later(now + 9000, () => h.brain.settled(m.id, h.world.x));
        // "Do not touch" note next to a sleeping pet, now and then.
        if (base === "sleep" && s.mischief && h.random() < 0.25)
          this.later(now + 9500, () => {
            if (h.brain.base === "sleep" && !this.sleepNote)
              this.sleepNote = h.props.drop("note", h.world.x + 45 * h.world.scale, h.world.y, h.now, tx("Не трогать."));
          });
      }
    }
    if (base !== "sleep" && this.sleepNote) {
      h.props.remove(this.sleepNote.id);
      this.sleepNote = null;
    }
    this.lastBase = base;
    // Asleep on a window: now and then rolls off in its sleep.
    if (base === "sleep" && w.support && now >= this.nextRoll) {
      this.nextRoll = now + 60000;
      if (h.random() < 0.03) {
        w.support = null;
        w.air = true;
        w.vy = 30 * w.scale;
        this.later(now + 1500, () => h.brain.wake(h.now));
      }
    }
    // Leave a window it perched on after a while.
    if (this.perchLeaveAt && now >= this.perchLeaveAt && w.support && base === "idle") {
      this.perchLeaveAt = 0;
      w.support = null;
      w.air = true;
      w.vy = -120 * w.scale;
    }
    // Music: dances now and then.
    if (h.snapshot?.media.playing && ["sit", "idle"].includes(base) && now >= this.nextDance && !h.brain.reaction) {
      this.nextDance = now + 40000 + h.random() * 50000;
      h.override("dance", 6000 + h.random() * 4000);
    }
    const present = (h.snapshot?.idle ?? 0) < 60000;
    // Mischief: gifts, theft, notes. Rare, and only when you are around.
    if (s.mischief && present && base === "idle" && !h.brain.reaction && !h.brain.bubble) {
      if (!this.nextGift) this.nextGift = now + (40 + h.random() * 60) * 60000;
      if (!this.nextSteal) this.nextSteal = now + (30 + h.random() * 60) * 60000;
      if (!this.nextNote) this.nextNote = now + (90 + h.random() * 120) * 60000;
      if (now >= this.nextGift) {
        this.nextGift = now + (90 + h.random() * 90) * 60000;
        if (h.brain.stageNow(now) >= 2 && !this.gift) this.bringGift(h);
      } else if (now >= this.nextSteal) {
        this.nextSteal = now + (40 + h.random() * 50) * 60000;
        const g = h.brain.game;
        if (g.grudge >= 15 && g.grudge < h.brain.temper.huntAt && g.money > 50 && !this.stash) this.steal(h);
      } else if (now >= this.nextNote) {
        this.nextNote = now + (120 + h.random() * 180) * 60000;
        this.leave(h, "note", (2 + h.random() * 2) * 60000);
      }
    }
    // A gift nobody takes goes back into its pocket.
    if (this.gift && now >= this.gift.until) {
      const g = this.gift;
      this.gift = null;
      h.props.remove(g.item.id);
      h.say("giftIgnored", true);
    }
    // Bored: climbs the window next to it.
    if (s.perch && base === "idle" && !w.support && !w.air && now >= this.nextClimb && h.snapshot) {
      this.nextClimb = now + (4 + h.random() * 8) * 60000;
      const k = w.scale,
        half = s.size * k * 0.38;
      const win = h.snapshot.windows.find(
        (x) =>
          x.rect.bottom >= w.y - 30 * k &&
          x.rect.top < w.y - s.size * k * 1.6 &&
          (Math.abs(x.rect.left - w.x) < 200 * k || Math.abs(x.rect.right - w.x) < 200 * k),
      );
      if (win && h.random() < 0.5) {
        const side: -1 | 1 = Math.abs(win.rect.left - w.x) < Math.abs(win.rect.right - w.x) ? -1 : 1;
        const x = side < 0 ? win.rect.left - half * 0.55 : win.rect.right + half * 0.55;
        w.go(x, false, 1.2);
        this.later(now + 4000, () => {
          if (Math.abs(h.world.x - x) < 20 * k) h.world.startClimb(win, side, s.size);
        });
      }
    }
  }
  private bringGift(h: Host) {
    const w = h.world;
    const r = h.random();
    const kind: FloorItem["kind"] = r < 0.5 ? "coin" : r < 0.8 ? "sticker" : "snack";
    const label =
      kind === "coin" ? String(5 + Math.floor(h.random() * 20)) : kind === "sticker" ? pick(stickers, h.random) : pick(snacks, h.random);
    const item = h.props.drop(kind, w.x + 50 * w.scale, w.y, h.now, label);
    this.gift = { item, until: h.now + 45000 };
    h.brain.reset("gift");
    if (h.say("gift", true) && h.brain.bubble)
      h.brain.bubble = {
        ...h.brain.bubble,
        actions: [
          { id: "gift:take", label: tx("Взять") },
          { id: "gift:no", label: tx("Не надо") },
        ],
        until: h.now + 30000,
      };
  }
  private steal(h: Host) {
    const g = h.brain.game;
    const amount = Math.max(3, Math.min(20, Math.round(g.money * 0.03)));
    h.brain.game = { ...g, money: g.money - amount };
    h.brain.stolen += amount;
    h.say("steal", true);
    const e = this.nearestEdge(h);
    if (!e) return;
    this.carry = "coin";
    this.carryTo = e.x;
    this.carryThen = () => {
      this.stash = h.props.drop("stash", h.world.x + e.side * -30 * h.world.scale, h.world.y, h.now);
    };
    h.world.go(e.x, false, 1.4);
  }
  /** Petting returned the coins: the stash disappears. */
  returned(h: Host) {
    if (this.stash) h.props.remove(this.stash.id);
    this.stash = null;
  }
}
function pick<T>(list: T[], random: () => number): T {
  return list[Math.floor(random() * list.length)] ?? list[0];
}
