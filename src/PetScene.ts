// Derived from WindowPet's transparent Phaser scene + Tauri bridge.
// One physics owner and one lifecycle; no per-reaction timers or per-frame listeners.
//
// Units: the scene works in logical canvas pixels (360×340). The Rust side
// receives physical desktop pixels; `dpr` (WebView devicePixelRatio) converts
// between the two. Movement/physics use the monitor scale reported by Rust,
// which equals `dpr` once the window sits on that monitor.
import Phaser from "phaser";
import { command, emitAll, on, native } from "./bridge";
import { Sfx, Sound } from "./sound";
import { Voice } from "./voice";
import { Animator } from "./animation";
import { Director } from "./director";
import { Movement, monitorAt, reachable } from "./movement";
import { overlayLayout } from "./layout";
import { Diag } from "./diag";
import type { AutorunChange, Spike, TraceEvent } from "./trace";
import {
  buyUpgrade,
  cleanGame,
  eat,
  itemById,
  items,
  jobById,
  level,
  skill,
  startJob,
  upgradeById,
  working,
} from "./game";
import { BASE_HEIGHT, BASE_WIDTH, canvasSize, canvasZoom } from "./dpi";
import {
  Action,
  cleanSettings,
  cleanMemory,
  Monitor,
  Rect,
  Snapshot,
  Store,
  Memory,
  pets,
} from "./model";
import { Effects } from "./effects";
import { Balloon } from "./balloon";
import { Props } from "./props";
import { CursorPlay, PlayIntent } from "./cursorplay";
import { Antics, Host } from "./antics";
import { MiniGames, GameKind } from "./minigames";
import { parse, obeys } from "./commands";
import { FRAME_H, FRAME_W, Placement, compact, headTop, regionRects, toCanvas } from "./pose";
import { note } from "./chronicle";
import { dayPart, holiday } from "./calendar";
// The first-run card sits in canvas space, above where the pet stands.
const CARD = { left: 74, top: 24, width: 212, height: 96 };
interface Motion {
  x: number;
  y: number;
  down: boolean;
  support: { id: number; rect: Rect } | null;
}
const CELLS = 72;
export class PetScene extends Phaser.Scene {
  private actor!: Phaser.GameObjects.Sprite;
  private balloon!: Balloon;
  private fx!: Effects;
  private props!: Props;
  private animator!: Animator;
  private brain!: Director;
  private world = new Movement();
  private play = new CursorPlay();
  private antics = new Antics();
  private games = new MiniGames();
  private store!: Store;
  private monitors: Monitor[] = [];
  private snapshot?: Snapshot;
  private cursor: Motion = { x: 0, y: 0, down: false, support: null };
  private disposers: (() => void)[] = [];
  private disposed = false;
  private busy = false;
  private lastPose = "";
  private floors: number[] = [];
  private masks: Rect[][] = [];
  private nextActivity = 0;
  private activityUntil = 0;
  private idleAction: Action = "idle";
  private lastGameSave = 0;
  private sfx = new Sound();
  private voice = new Voice();
  // First-run card: drawn once, held for a few seconds, never again.
  private card?: Phaser.GameObjects.Container;
  private cardUntil = 0;
  private lastReaction = "";
  private lastBubble = "";
  private ready = false;
  private lastMemory = "";
  private lastSave = 0;
  private dragSeenDown = false;
  private dragAnnounced = false;
  private pressAt = { x: 0, y: 0 };
  private lastDrag = 0;
  private draggingSince = 0;
  /** Window it was sitting on and the walk it was on when picked up. */
  private pickedFrom: { id: number; rect: Rect } | null = null;
  private pickedGoal: number | null = null;
  private dnd = false;
  private lastNow = 0;
  private cursorNearSince = 0;
  private layout = overlayLayout(0, 0, 116, 1);
  private dpr = 1;
  private diag = new Diag();
  private assetError = "";
  private loadFailures = new Map<string, string>();
  private lastAction = "";
  private heart = 0;
  /** An animation forced for a while (cursor games, commands, antics). */
  private forced: { action: Action; until: number } | null = null;
  /** Food dragged out of the panel toward the pet. */
  private carrying: { id: string; since: number; down: boolean } | null = null;
  private carriedImage?: Phaser.GameObjects.Image;
  private climbPlan: { id: number; side: -1 | 1; x: number; until: number } | null = null;
  private lastSupport = 0;
  private supportApp = "";
  private lastMonitor = "";
  private placement: Placement | null = null;
  private weather: { kind: "rain" | "snow" | "heat" | "clear"; at: number } | null = null;
  private nextWeather = 0;
  private nextNeedGlyph = 0;
  private nextStep = 0;
  private nextSnore = 0;
  private wasAir = false;
  private landedFromThrow = false;
  private lastForcedAction = "";
  constructor() {
    super("Pets");
  }
  preload() {
    this.load.on(
      Phaser.Loader.Events.FILE_LOAD_ERROR,
      (file: Phaser.Loader.File) => {
        this.loadFailures.set(file.key, file.src);
        console.error(`Sprite load failed: ${file.key} <- ${file.src}`);
      },
    );
    for (const p of pets)
      this.load.spritesheet(p.id, `/pets/${p.id}/spritesheet.webp`, {
        frameWidth: FRAME_W,
        frameHeight: FRAME_H,
      });
    // Shop icons: food carried from the panel, snacks brought as gifts.
    for (const i of items) this.load.image("shop-" + i.id, i.icon);
  }
  create() {
    this.actor = this.add
      .sprite(180, 330, "drizz")
      .setOrigin(0.5, 1)
      .setInteractive({ pixelPerfect: true, alphaTolerance: 64 });
    this.props = new Props(this);
    this.fx = new Effects(this);
    this.balloon = new Balloon(
      this,
      (i) => {
        const a = this.brain?.bubble?.actions?.[i];
        // A new balloon may have replaced the one the user aimed at.
        if (a && Date.now() - this.balloon.since > 450) void this.act(a.id);
      },
      () => {
        if (this.brain && !this.brain.bubble?.actions?.length) this.brain.bubble = undefined;
      },
    );
    this.actor.on("pointerdown", (p: Phaser.Input.Pointer) => {
      if (!this.ready || this.antics.absent) return;
      if (p.rightButtonDown()) {
        void command("open_panel", { tab: "status" });
        return;
      }
      const now = Date.now();
      if (this.games.click(now)) {
        this.sfx.play("click");
        this.fx.glyph("+1", "#b4e62e", this.sizePx(), this.world.scale, this.dpr, (Math.random() - 0.5) * 0.6, 700);
        this.game.loop.wake();
        return;
      }
      this.brain.bubble = undefined;
      this.brain.wake(now);
      this.diag.log(
        "drag",
        `pointerdown button ${p.button} cursor ${this.cursor.x},${this.cursor.y} pet ${Math.round(this.world.x)},${Math.round(this.world.y)} down ${this.cursor.down}`,
      );
      this.pickedFrom = this.world.support ? { id: this.world.support.id, rect: this.world.support.rect } : null;
      this.pickedGoal = this.world.goal;
      // Clings to its spot if it has been dragged or thrown a lot lately.
      const resist = this.brain.grabbed(now, !!this.pickedFrom);
      this.world.begin(this.cursor.x, this.cursor.y, now, resist);
      this.play.cancel();
      this.forced = null;
      this.dragSeenDown = false;
      this.dragAnnounced = false;
      this.pressAt = { x: this.cursor.x, y: this.cursor.y };
      this.draggingSince = now;
      if (this.brain.reaction?.event !== "regrab") this.brain.reaction = undefined;
    });
    this.input.on("pointerup", () => this.release("pointerup"));
    // Any press inside the window region: floor items (notes, gifts) and diagnostics.
    this.input.on("pointerdown", (p: Phaser.Input.Pointer) => {
      const d = this.fromScene(p.worldX, p.worldY);
      const it = this.props.hit(d.x, d.y, this.world.scale);
      if (it && this.brain && this.antics.clickItem(this.host(), it)) this.game.loop.wake();
      this.diag.log(
        "pointer",
        `down at canvas ${Math.round(p.worldX)},${Math.round(p.worldY)} actor ${Math.round(this.actor.x)},${Math.round(this.actor.y)} cursor ${this.cursor.x},${this.cursor.y}`,
      );
    });
    // Preview in a browser: the page cursor stands in for the desktop cursor.
    if (!native)
      this.game.canvas.addEventListener("pointermove", this.previewMove);
    this.game.canvas.addEventListener("contextmenu", this.preventContext);
    this.events.once("shutdown", () => this.dispose());
    this.applyDpr(window.devicePixelRatio || 1, true);
    // Diagnostics only: the probes in tools/ reach the director through this.
    (window as unknown as Record<string, unknown>).__PET_SCENE__ = this;
    void this.bootPet();
  }
  private preventContext = (e: Event) => e.preventDefault();
  private previewMove = (e: PointerEvent) => {
    const r = this.game.canvas.getBoundingClientRect();
    const x = this.layout.left + (e.clientX - r.left) * this.dpr,
      y = this.layout.top + (e.clientY - r.top) * this.dpr;
    this.onMotion({ x: Math.round(x), y: Math.round(y), down: e.buttons > 0, support: this.world.support });
  };
  private async subscribe<T>(event: string, fn: (data: T) => void) {
    const off = await on<T>(event, fn);
    if (this.disposed) off();
    else this.disposers.push(off);
  }
  // Keeps the backing store at physical resolution while the scene keeps
  // working in 360×340 logical units: canvas = base×dpr, camera zoom = dpr.
  private applyDpr(dpr: number, force = false) {
    if (!force && Math.abs(dpr - this.dpr) < 0.001) return;
    this.dpr = dpr;
    const { width, height } = canvasSize(dpr);
    const scale = this.game.scale;
    scale.zoom = canvasZoom(dpr);
    if (scale.width !== width || scale.height !== height)
      scale.resize(width, height);
    else scale.refresh();
    this.cameras.main
      .setViewport(0, 0, width, height)
      .setZoom(dpr)
      .centerOn(BASE_WIDTH / 2, BASE_HEIGHT / 2);
    // Text.setResolution() re-renders the glyph canvas at dpr× but Phaser only
    // copies the value to the texture source in the constructor; without this
    // the renderer would draw the text dpr× too large.
    this.balloon.setDpr(dpr);
    this.props.setDpr(dpr);
    this.applySmoothing();
    this.lastPose = "";
    this.diag.log(
      "dpi",
      `devicePixelRatio ${dpr} canvas ${width}x${height} css ${BASE_WIDTH}x${BASE_HEIGHT}`,
    );
  }
  // Resampling quality for the downscaled atlas. Setting canvas.width (any
  // resize) resets the 2D context, so this runs after every resize too.
  private applySmoothing() {
    const smooth = this.store?.settings.smooth ?? true;
    const ctx = this.game.context as CanvasRenderingContext2D | null;
    if (ctx && "imageSmoothingQuality" in ctx)
      ctx.imageSmoothingQuality = smooth ? "high" : "low";
    for (const p of pets)
      if (this.textures.exists(p.id))
        this.textures
          .get(p.id)
          .setFilter(
            smooth
              ? Phaser.Textures.FilterMode.LINEAR
              : Phaser.Textures.FilterMode.NEAREST,
          );
  }
  private sizePx() {
    return this.store.settings.size * this.world.scale;
  }
  /** Everything the long behaviours need, in one object. */
  private host(): Host {
    return {
      now: Date.now(),
      world: this.world,
      brain: this.brain,
      props: this.props,
      settings: this.store.settings,
      monitors: this.monitors,
      snapshot: this.snapshot,
      override: (action, ms) => this.force(action, ms),
      say: (event, direct = false, vars) => this.brain.event(event, Date.now(), direct, undefined, vars),
      glyph: (ch, color) => this.fx.glyph(ch, color, this.sizePx(), this.world.scale, this.dpr),
      random: Math.random,
    };
  }
  private force(action: Action, ms: number) {
    this.forced = { action, until: Date.now() + ms };
  }
  private async bootPet() {
    try {
      this.store = await command<Store>("load_store");
      if (this.disposed) return;
      this.store.settings = cleanSettings(this.store.settings);
      this.store.memory = cleanMemory(this.store.memory);
      await this.diag.refresh();
      this.brain = new Director(
        this.store.settings,
        this.store.memory,
        Math.random,
        cleanGame(this.store.game, Date.now()),
      );
      this.changePet();
      this.applySound();
      if (!this.store.memory.cardShown) this.showCard();
      await this.subscribe<Store>("store", (s) => this.onStore(s));
      await this.subscribe<Motion>("motion", (m) => this.onMotion(m));
      await this.subscribe<Snapshot>("snapshot", (n) => this.onSnapshot(n));
      await this.subscribe("summon", () => this.summon());
      await this.subscribe("recenter", () => this.recenter());
      await this.subscribe<TraceEvent>("trace", (e) => {
        this.diag.log(
          "trace",
          `${e.child.name} <- ${e.chain.join(" <- ")} ${e.verdict} speak ${e.speak}`,
        );
        if (this.brain.trace(e, Date.now())) {
          if (e.speak === "alert") this.antics.scare(this.host());
          this.game.loop.wake();
        }
      });
      await this.subscribe<AutorunChange>("autorun", (c) => {
        this.diag.log("autorun", `${c.kind} ${c.entry.id}`);
        if (this.brain.autorun(c, Date.now())) {
          if (this.brain.reaction?.event === "autorunRisky") this.antics.scare(this.host());
          this.game.loop.wake();
        }
      });
      await this.subscribe<Spike>("load-spike", (s) => {
        this.diag.log(
          "spike",
          `${s.kind} ${Math.round(s.value)}% base ${Math.round(s.base)}% top ${s.top.map((t) => t.name).join(",")}`,
        );
        this.brain.spike(s, Date.now());
      });
      await this.subscribe<boolean>("hidden", (v) => {
        this.brain.manualHidden = v;
        this.brain.hidden = v;
        this.brain.bubble = undefined;
        if (v) this.game.loop.sleep();
        else this.game.loop.wake();
      });
      await this.subscribe<{ id: string; kind: string; title: string }>(
        "integration-event",
        (e) => this.brain.integration(e, Date.now()),
      );
      await this.subscribe<string>("buy", (id) => this.buy(id));
      await this.subscribe<string>("upgrade", (id) => this.upgrade(id));
      await this.subscribe<string>("job", (id) => this.work(id));
      // Exit from the tray: save before the process goes.
      await this.subscribe("flush", () => {
        this.saveGame(true);
        this.saveMemory(true);
      });
      // Panel -> pet, straight through the event bus.
      await this.subscribe<{ text?: string; game?: GameKind; wear?: string; role?: string }>("pet-command", (c) => this.onCommand(c));
      await this.subscribe<{ id: string }>("carry", (c) => {
        if (itemById(c.id)) {
          this.carrying = { id: c.id, since: Date.now(), down: false };
          this.game.loop.wake();
        }
      });
      this.ready = true;
      // The minute tick, payouts and achievements run on a timer of their own:
      // they must go on while the pet is hidden in a fullscreen game.
      const timer = window.setInterval(() => this.heartbeat(), 2000);
      this.disposers.push(() => window.clearInterval(timer));
      if (!native) {
        this.monitors = [
          {
            id: "preview",
            primary: true,
            scale: 1,
            bounds: { left: 0, top: 0, right: 900, bottom: 720 },
            work: { left: 0, top: 0, right: 900, bottom: 720 },
          },
        ];
        this.world.initialize(this.monitors, this.store.settings.size, null);
        this.brain.event("hello", Date.now());
      }
    } catch (e) {
      this.balloon.label
        .setText("Не удалось запустить питомца. Откройте приложение заново.")
        .setPosition(20, 50)
        .setVisible(true);
      console.error(String(e));
    }
  }
  private applySound() {
    const s = this.store.settings;
    this.sfx.apply(s.sounds, s.soundVolume);
    this.voice.apply(s.sounds, s.voice, s.soundVolume);
  }
  private onStore(s: Store) {
    const changed = s.settings.pet !== this.store.settings.pet;
    const memory = cleanMemory(s.memory);
    // The pet owns position, recent lines and daily flags; the panel owns
    // name, facts, birthday and the favourite spot. A reset in the panel bumps
    // `epoch`, and then the panel's copy wins entirely.
    const reset = memory.epoch !== this.brain.memory.epoch;
    const merged: Memory = reset
      ? memory
      : {
          ...this.brain.memory,
          address: memory.address,
          facts: memory.facts,
          birthday: memory.birthday,
          favorite: memory.favorite,
          epoch: memory.epoch,
        };
    this.store = {
      ...s,
      settings: cleanSettings(s.settings),
      memory: merged,
      game: this.brain.game,
    };
    void this.diag.refresh();
    this.brain.updateSettings(this.store.settings);
    this.applySound();
    this.brain.memory = merged;
    if (reset) this.brain.dialogue.recent = merged.recent;
    if (changed) {
      this.changePet();
      this.play.cancel();
    }
    this.applySmoothing();
    this.world.recover(this.monitors, this.store.settings.size, this.store.settings.monitor);
    this.lastPose = "";
  }
  private onMotion(m: Motion) {
    if (!this.ready) return;
    this.touchCheck(m);
    this.dodgeCheck(m);
    this.carryCheck(m);
    this.cursor = m;
    const now = Date.now();
    if (this.world.dragging) {
      this.world.drag(m.x, m.y, now);
      if (
        m.down &&
        !this.dragAnnounced &&
        Math.hypot(m.x - this.pressAt.x, m.y - this.pressAt.y) > 8
      ) {
        this.dragAnnounced = true;
        this.brain.event(now - this.lastDrag < 12000 ? "dragged" : "drag", now, true);
        this.brain.dragged(now, !!this.pickedFrom);
        this.lastDrag = now;
      }
      if (m.down) this.dragSeenDown = true;
      else if (this.dragSeenDown || now - this.draggingSince > 250)
        this.release(this.dragSeenDown ? "button released" : "no button");
    } else if (this.world.support) {
      const old = this.world.support.rect;
      const lost = this.world.follow(m.support);
      if (lost) {
        this.brain.fell(now, this.supportApp);
        this.antics.fell(this.host(), old);
      } else if (m.support) {
        const d = Math.hypot(old.left - m.support.rect.left, old.top - m.support.rect.top);
        if (d > 4) {
          this.brain.event("windowMove", now);
          this.antics.rideJerk(this.host(), d);
        }
      }
    }
    this.game.loop.wake();
  }
  private onSnapshot(n: Snapshot) {
    this.snapshot = n;
    if (
      n.monitors.length !== this.monitors.length ||
      n.monitors.some((m, i) => m.id !== this.monitors[i]?.id)
    )
      this.diag.log(
        "monitors",
        n.monitors
          .map(
            (m) =>
              `${m.id} ${m.bounds.left},${m.bounds.top}-${m.bounds.right},${m.bounds.bottom} scale ${m.scale}${m.primary ? " primary" : ""}`,
          )
          .join("; "),
      );
    this.monitors = n.monitors;
    if (n.input)
      this.diag.log(
        "input",
        `keys ${n.input.keys} clicks ${n.input.clicks} right ${n.input.rightClicks} wheel ${n.input.wheel} usage ${(n.usage?.today ?? []).map((u) => `${u.app}:${u.seconds}`).join(",") || "-"}`,
        30000,
      );
    this.world.initialize(
      n.monitors,
      this.store.settings.size,
      this.store.memory.position,
      this.store.settings.monitor,
    );
    this.world.recover(n.monitors, this.store.settings.size, this.store.settings.monitor);
    this.brain.observe(n);
    if (this.brain.memoryDirty) {
      this.brain.memoryDirty = false;
      this.saveMemory(true);
    }
    this.diag.log(
      "hidden",
      this.brain.hidden
        ? this.brain.manualHidden
          ? "manual"
          : n.locked
            ? "session locked"
            : `fullscreen ${n.app || "?"}`
        : "visible",
    );
    if (!this.brain.hidden && !this.game.loop.running) this.game.loop.wake();
    if (this.brain.hidden) {
      this.play.cancel();
      void this.renderPose(false);
      this.game.loop.sleep();
    }
  }
  /** Every 2 s, drawn or not: minute tick, payouts, achievements, games, weather. */
  private heartbeat() {
    if (!this.ready || this.disposed) return;
    const now = Date.now();
    const idle = this.snapshot?.idle ?? 0;
    const r = this.brain.heartbeat(now, {
      present: idle < 300000 && !this.brain.hidden,
      resting: ["sleep", "rest"].includes(this.lastAction),
      music: !!this.snapshot?.media.playing,
    });
    if (r.paid) this.sfx.play("coin");
    if (r.unlocked.length) this.sfx.play("levelup");
    if (r.changed) this.saveGame(r.paid || r.unlocked.length > 0 || this.brain.reaction?.event === "levelUp");
    const out = this.games.tick(now);
    if (out) this.finishGame(out);
    // Roles end on time.
    const role = this.brain.life.role;
    if (role && now >= role.until) {
      this.brain.life.role = null;
      this.brain.event("roleGuardEnd", now, true);
      this.saveGame(true);
    }
    if (this.brain.memoryDirty) {
      this.brain.memoryDirty = false;
      this.saveMemory(true);
    }
    void this.checkWeather(now);
    if (this.brain.bubble || this.brain.reaction) this.game.loop.wake();
  }
  // ------------------------------------------------------------ actions
  // Shop purchase requested from the settings panel. The pet owns the
  // progression state, so the panel only sends the item id.
  private buy(id: string, free = false) {
    const item = itemById(id);
    if (!item) return;
    const now = Date.now();
    const next = eat(free ? { ...this.brain.game, money: this.brain.game.money + item.price } : this.brain.game, item);
    if (!next) {
      this.sfx.play("error");
      this.brain.event("broke", now, true);
      return;
    }
    this.brain.game = next;
    this.sfx.play(item.kind === "drink" ? "drink" : "eat");
    this.voice.act("eat", 400);
    this.brain.fed(now);
    this.antics.returned(this.host());
    this.brain.reset("fed");
    this.brain.event("fed", now, true, undefined, { item: item.name });
    this.antics.carry = "shop-" + id;
    this.antics.later(now + 2600, () => {
      if (this.antics.carry === "shop-" + id) this.antics.carry = "";
    });
    this.force("eat", 2600);
    this.saveGame(true);
    this.game.loop.wake();
  }
  /** "Feed" button on a hunger line: pantry first, then the best thing the money buys. */
  private quickFeed(kind: "food" | "drink" | "drug") {
    const pantry = this.brain.life.pantry;
    const stored = Object.keys(pantry).find((id) => pantry[id] > 0 && itemById(id) && (kind === "drink" ? itemById(id)!.drink > 20 : kind === "drug" ? itemById(id)!.kind === "drug" : itemById(id)!.food > 20));
    if (stored) {
      pantry[stored]--;
      if (!pantry[stored]) delete pantry[stored];
      this.buy(stored, true);
      return;
    }
    const money = this.brain.game.money;
    const pick = items
      .filter((i) => i.price <= money && (kind === "drink" ? i.drink >= 40 : kind === "drug" ? i.kind === "drug" : i.food >= 40))
      .sort((a, b) => (kind === "drink" ? b.drink / b.price - a.drink / a.price : kind === "drug" ? b.health / b.price - a.health / a.price : b.food / b.price - a.food / a.price))[0];
    if (pick) this.buy(pick.id);
    else {
      this.sfx.play("error");
      this.brain.event("broke", Date.now(), true);
    }
  }
  // Upgrade bought in the panel. Same shape as `buy`: the panel sends an id,
  // the pet decides whether it can afford it.
  private upgrade(id: string) {
    const u = upgradeById(id);
    if (!u) return;
    const now = Date.now();
    const next = buyUpgrade(this.brain.game, id);
    if (!next) {
      this.sfx.play("error");
      this.brain.event("broke", now, true);
      return;
    }
    this.brain.game = next;
    this.sfx.play("upgrade");
    this.brain.event("upgrade", now, true, undefined, { skill: u.name });
    this.saveGame(true);
    this.game.loop.wake();
  }
  // Shift requested in the panel: refused out loud when the pet is in no
  // state to work.
  private work(id: string) {
    const job = jobById(id);
    if (!job) return;
    const now = Date.now();
    const next = startJob(this.brain.game, id, now);
    if (!next) {
      this.sfx.play("error");
      this.brain.event("workFail", now, true);
      return;
    }
    this.brain.game = next;
    this.sfx.play("work");
    this.brain.event("work", now, true, undefined, { job: job.name });
    this.saveGame(true);
    this.game.loop.wake();
  }
  private summon() {
    this.brain.manualHidden = false;
    this.brain.hidden = false;
    const now = Date.now();
    this.antics.away = null;
    const m = monitorAt(this.monitors, this.cursor.x, this.cursor.y, this.store.settings.monitor);
    if (m) {
      this.world.travelTo(m, this.cursor.x, this.store.settings.size);
      this.world.recover(this.monitors, this.store.settings.size, this.store.settings.monitor);
      this.fx.dust(this.world.x, this.world.y, this.world.scale, 6, false);
    }
    // Offended or woken too often: pretends to be asleep for a moment.
    if (this.brain.summoned(now)) {
      this.brain.reset("fakeSleep");
      this.brain.event("fakeSleep", now, true);
      this.antics.later(now + 3300, () => {
        this.brain.reset("fakeSleepEnd");
        this.brain.event("fakeSleepEnd", Date.now(), true);
      });
    } else this.brain.event("summon", now, true);
    this.game.loop.wake();
  }
  /** A command typed in the chat or a button in the panel. */
  private onCommand(c: { text?: string; game?: GameKind; wear?: string; role?: string }) {
    if (!this.ready) return;
    const now = Date.now();
    const b = this.brain;
    const reply = () => void emitAll("pet-reply", { text: b.bubble?.text ?? "" });
    note(b.life, "command", now);
    if (c.game) {
      this.startGame(c.game);
      reply();
      return;
    }
    if (c.wear !== undefined) {
      b.life.wear = c.wear;
      this.saveGame(true);
      this.brain.event("upgrade", now, true, undefined, { skill: "гардероб" });
      return;
    }
    if (c.role === "guard") {
      this.startGuard();
      reply();
      return;
    }
    if (c.role === "clean") {
      void this.offerClean(true);
      return;
    }
    const cmd = parse(c.text ?? "");
    if (!cmd) {
      b.reset("cmdUnknown");
      b.event("cmdUnknown", now, true);
      reply();
      return;
    }
    const g = b.game;
    const ok = obeys(cmd.cmd, {
      stage: b.stageNow(now),
      grudge: g.grudge,
      hungry: g.food < 25 || g.drink < 25,
      temper: b.temper,
      random: Math.random,
    });
    const say = (e: string) => {
      b.reset(e);
      b.event(e, now, true);
    };
    if (!ok) {
      say("cmdRefuse");
      reply();
      return;
    }
    b.wake(now);
    const s = this.store.settings;
    switch (cmd.cmd) {
      case "sit":
        this.force("sit", 20000);
        say("cmdSit");
        break;
      case "come":
        if (!s.pinned) this.world.go(this.cursor.x, false, 1.8);
        say("cmdCome");
        break;
      case "sleep":
        this.force("sleep", 45000);
        say("cmdSleep");
        break;
      case "go":
        say("cmdGo");
        this.antics.leave(this.host(), "go", 60000 + Math.random() * 30000, "Ушёл. Сам сказал.");
        break;
      case "jump":
        this.world.jump();
        say("cmdJump");
        break;
      case "dance":
        this.force("dance", 8000);
        say("cmdDance");
        break;
      case "wake":
        say("awayBack");
        break;
      case "play":
        say("gameStart");
        if (b.bubble)
          b.bubble = {
            ...b.bubble,
            actions: [
              { id: "start:rps", label: "Камень-ножницы" },
              { id: "start:hand", label: "Угадай руку" },
              { id: "start:clicker", label: "Кликер" },
            ],
            until: now + 20000,
          };
        break;
      case "rps":
      case "hand":
      case "clicker":
      case "catch":
        this.startGame(cmd.cmd);
        break;
      case "guard":
        this.startGuard();
        break;
      case "clean":
        void this.offerClean(true);
        break;
    }
    reply();
    this.game.loop.wake();
  }
  private startGame(kind: GameKind) {
    const now = Date.now();
    const r = this.games.start(kind, now, Math.random);
    note(this.brain.life, "game", now);
    this.brain.reset("gameStart");
    this.brain.event("gameStart", now, true, r.text);
    if (this.brain.bubble) {
      this.brain.bubble.actions = r.actions;
      this.brain.bubble.until = now + Math.min(r.ms, 30000);
    }
    if (kind === "catch") this.play.game(now, r.ms);
    this.game.loop.wake();
  }
  private finishGame(o: { event: string; text: string; prize: number; feeling: number }) {
    const now = Date.now();
    const g = this.brain.game;
    this.brain.game = { ...g, money: g.money + o.prize, feeling: Math.min(100, g.feeling + o.feeling) };
    if (o.event === "gameWin") note(this.brain.life, "win", now);
    this.brain.reset(o.event);
    this.brain.event(o.event, now, true, undefined, {});
    if (this.brain.bubble) this.brain.bubble = { ...this.brain.bubble, sub: o.text + (o.prize ? ` +${o.prize} ₽` : "") };
    this.saveGame(true);
    void emitAll("pet-reply", { text: `${this.brain.bubble?.text ?? ""} ${o.text}` });
  }
  private startGuard() {
    const now = Date.now();
    const minutes = 20 + 10 * skill(this.brain.game, "vigilance");
    this.brain.life.role = { id: "guard", until: now + minutes * 60000 };
    this.brain.reset("roleGuard");
    this.brain.event("roleGuard", now, true);
    this.saveGame(true);
  }
  /** Asks Rust how much is in %TEMP% and offers to clean it (never on its own). */
  private async offerClean(asked: boolean) {
    const now = Date.now();
    try {
      const r = await command<{ bytes: number; files: number }>("temp_scan");
      if (!r || r.bytes < 20 * 1048576) {
        if (asked) {
          this.brain.reset("cleanNothing");
          this.brain.event("cleanNothing", now, true);
        }
        return;
      }
      this.brain.reset("cleanOffer");
      if (this.brain.event("cleanOffer", now, true, undefined, { size: formatBytes(r.bytes) }) && this.brain.bubble)
        this.brain.bubble = {
          ...this.brain.bubble,
          actions: [
            { id: "clean:yes", label: "Почистить" },
            { id: "clean:no", label: "Не надо" },
          ],
          until: now + 60000,
        };
    } catch (e) {
      this.diag.log("clean", String(e));
    }
    this.game.loop.wake();
  }
  private async checkWeather(now: number) {
    const s = this.store.settings;
    if (!s.weather || !s.weatherPlace || now < this.nextWeather) return;
    this.nextWeather = now + 30 * 60000;
    try {
      const w = await command<{ code: number; temp: number } | null>("weather", { place: s.weatherPlace });
      if (!w) return;
      const code = w.code;
      const kind: "rain" | "snow" | "heat" | "clear" =
        (code >= 51 && code <= 67) || (code >= 80 && code <= 82) || code >= 95
          ? "rain"
          : (code >= 71 && code <= 77) || code === 85 || code === 86
            ? "snow"
            : w.temp >= 30
              ? "heat"
              : "clear";
      this.weather = { kind, at: now };
      if (kind !== "clear") this.brain.event(kind, now);
    } catch (e) {
      this.diag.log("weather", String(e));
    }
  }
  // A paper card the pet holds up on the very first launch. Greeting, one
  // time only: the flag goes into memory as soon as it is shown.
  private showCard() {
    const w = CARD.width;
    const h = CARD.height;
    const card = this.add.container(CARD.left, CARD.top);
    const paper = this.add.graphics();
    paper.fillStyle(0x0e0e12, 0.92);
    paper.fillRoundedRect(0, 0, w, h, 10);
    paper.lineStyle(2, 0xb4e62e, 0.9);
    paper.strokeRoundedRect(0, 0, w, h, 10);
    const text = this.add.text(w / 2, h / 2 - 4, "ПРИВЕТ, УЁБОК", {
      fontFamily: "Segoe UI, sans-serif",
      fontSize: "24px",
      fontStyle: "bold",
      color: "#b4e62e",
      align: "center",
    });
    text.setOrigin(0.5, 0.5);
    const sub = this.add.text(w / 2, h - 16, "теперь я живу у тебя на столе", {
      fontFamily: "Segoe UI, sans-serif",
      fontSize: "11px",
      color: "#9a9aa2",
      align: "center",
    });
    sub.setOrigin(0.5, 0.5);
    card.add([paper, text, sub]);
    card.setAngle(-4);
    card.setDepth(50);
    this.card = card;
    this.cardUntil = Date.now() + 9000;
    this.sfx.play("summon");
    this.store.memory.cardShown = true;
    this.brain.memory.cardShown = true;
    this.saveMemory(true);
    this.game.loop.wake();
  }
  /** Window region for the card while it is up (the region clips drawing). */
  private cardRect() {
    return this.card
      ? {
          left: CARD.left - 6,
          top: CARD.top - 6,
          right: CARD.left + CARD.width + 6,
          bottom: CARD.top + CARD.height + 6,
        }
      : null;
  }
  private hideCard() {
    this.card?.destroy(true);
    this.card = undefined;
    this.cardUntil = 0;
  }
  private saveGame(force: boolean) {
    const now = Date.now();
    if (!force && now - this.lastGameSave < 60000) return;
    this.lastGameSave = now;
    this.store.game = this.brain.game;
    void command("save_game", { game: this.brain.game }).catch((e) =>
      this.diag.log("game-error", String(e)),
    );
  }
  // Tray "return the pet to the screen": a reachable spot on the monitor under
  // the cursor (or the preferred/primary one). Settings are left untouched.
  private recenter() {
    this.brain.manualHidden = false;
    this.brain.hidden = false;
    this.brain.bubble = undefined;
    this.antics.away = null;
    const m =
      monitorAt(
        this.monitors,
        this.cursor.x,
        this.cursor.y,
        this.store.settings.monitor,
      ) ?? this.monitors[0];
    if (m) {
      this.world.placeOn(
        m,
        this.monitors,
        this.store.settings.size,
        this.store.settings.monitor,
      );
      this.diag.log(
        "recenter",
        `${m.id} -> ${Math.round(this.world.x)},${Math.round(this.world.y)}`,
      );
      this.saveMemory(true);
    }
    this.lastPose = "";
    this.game.loop.wake();
  }
  // ---- body language: squash & stretch, particles, touch gestures
  private kx = 1;
  private ky = 1;
  private squash: { t: number; kind: "floor" | "wall" | "ceiling"; amt: number } | null = null;
  private strokes: { x: number; y: number; t: number }[] = [];
  private lastHeart = 0;
  private lastZ = 0;
  private throwAt = 0;
  private lastFxReaction = "";
  private animClock = 0;
  private animBase = Date.now();
  private zoomJump = 0;
  private lastMotion: { x: number; y: number; t: number } | null = null;
  /** Physical desktop pixels -> logical canvas coordinates. */
  private toScene = (x: number, y: number) => ({
    x: (x - this.layout.left) / this.dpr,
    y: (y - this.layout.top) / this.dpr,
  });
  private fromScene(x: number, y: number) {
    return { x: this.layout.left + x * this.dpr, y: this.layout.top + y * this.dpr };
  }
  private glyph(ch: string, color: string, dx = 0, life = 1300) {
    this.fx.glyph(ch, color, this.sizePx(), this.world.scale, this.dpr, dx, life);
  }
  // One place for squash & stretch, impact reactions and ambient particles.
  private bodyLanguage(now: number, action: string) {
    const k = this.world.scale;
    for (const im of this.world.impacts.splice(0)) {
      const hard = im.speed > 600 * k;
      this.squash = { t: now, kind: im.kind, amt: Math.min(0.32, im.speed / (2400 * k)) };
      if (im.kind === "floor") {
        if (im.speed > 180 * k) {
          this.fx.dust(this.world.x, this.world.y, k, hard ? 8 : 4, hard);
          this.voice.act("land", 150);
        }
        if (now - this.throwAt < 5000 && !this.landedFromThrow) {
          this.landedFromThrow = true;
          const m = monitorAt(this.monitors, this.world.x, this.world.y, this.store.settings.monitor);
          if (m) this.brain.landed(m.id, this.world.x);
          if (hard) {
            this.glyph("✦", "#ffe27a", -0.2, 900);
            this.glyph("✦", "#ffe27a", 0.2, 900);
            this.brain.impact("floor", now);
          }
          this.antics.thrownLanded(this.host());
        }
      } else if (im.speed > 300 * k) {
        this.glyph("✦", "#ffe27a", 0, 900);
        this.brain.impact(im.kind, now);
      }
    }
    // Dizzy from shaking or from tumbling through the air.
    if (!this.world.dragging && !this.world.air && this.world.shake >= 1) {
      const d = this.world.takeDizzy();
      if (this.brain.dizzy(now, d)) {
        this.fx.starsUntil = now + Math.min(6500, 1400 * d);
        this.force("dizzy", Math.min(6500, 1400 * d));
        this.voice.act("dizzy", 1000);
      }
    }
    // Squash after an impact, stretch while flying fast or resisting a pull.
    let sx = 1,
      sy = 1;
    if (this.world.air && !this.world.dragging && !this.world.climb) {
      const st = Math.min(0.14, Math.abs(this.world.vy) / (3000 * k));
      sy = 1 + st;
      sx = 1 - st * 0.6;
    }
    if (this.world.clinging) {
      sy = 1 + 0.3 * this.world.stretch;
      sx = 1 - 0.12 * this.world.stretch;
    }
    if (action === "dance") {
      // Bobbing to a beat of ~2 per second.
      const b = Math.abs(Math.sin(now / 160));
      sy *= 1 - 0.07 * b;
      sx *= 1 + 0.05 * b;
    }
    if (this.squash) {
      const p = (now - this.squash.t) / 260;
      if (p >= 1) this.squash = null;
      else {
        // Damped wobble: squash, overshoot, settle.
        const a = this.squash.amt * Math.cos(p * Math.PI * 1.5) * (1 - p);
        if (this.squash.kind === "wall") {
          sx = 1 - a;
          sy = 1 + a * 0.6;
        } else {
          sx = 1 + a;
          sy = 1 - a;
        }
      }
    }
    // Quantised so the window region is not rebuilt for invisible changes.
    this.kx = Math.round(sx * 50) / 50;
    this.ky = Math.round(sy * 50) / 50;
    // Ambient particles and action sounds.
    if (action === "sleep" && now - this.lastZ > 2600) {
      this.lastZ = now;
      this.glyph("z", "#c9d1ff", 0.25, 1800);
      if (now > this.nextSnore) {
        this.nextSnore = now + 5200;
        this.voice.act("snore", 3000);
      }
    }
    if ((action === "walkLeft" || action === "walkRight") && now > this.nextStep) {
      this.nextStep = now + (this.world.running ? 160 : 290);
      this.voice.act("step", 80);
    }
    if (this.world.air && !this.wasAir && !this.world.dragging) this.voice.act("jump", 200);
    this.wasAir = this.world.air;
    const ev = this.brain.reaction?.event ?? "";
    if (ev && ev !== this.lastFxReaction) {
      const fx: Record<string, [string, string]> = {
        traceAlert: ["!", "#ffcf33"],
        autorunRisky: ["!", "#ffcf33"],
        autorunAdded: ["?", "#ffcf33"],
        dodge: ["!", "#ffffff"],
        cpuSpike: ["💦", "#7fd3ff"],
        gpuSpike: ["💦", "#7fd3ff"],
        thrown: ["💢", "#ff6a6a"],
        poke: ["💢", "#ff6a6a"],
        regrab: ["💢", "#ff6a6a"],
        grumpyWake: ["💢", "#ff6a6a"],
        remember: ["💢", "#ff6a6a"],
        bondUp: ["♥", "#ff5d8f"],
        levelUp: ["★", "#ffe27a"],
        achievement: ["★", "#ffe27a"],
        tickle: ["♪", "#ffe27a"],
        fed: ["♥", "#ff5d8f"],
        giveBack: ["♥", "#ff5d8f"],
        cursorSwat: ["💥", "#ffffff"],
        cursorPounce: ["💥", "#ffffff"],
        cursorCatch: ["★", "#ffe27a"],
        cursorMiss: ["💫", "#ffe27a"],
        nightCheck: ["🕒", "#ffffff"],
        seasick: ["🤢", "#9fe07a"],
        judgeApp: ["…", "#ffffff"],
        jealous: ["💢", "#ff6a6a"],
        sigh: ["~", "#c9d1ff"],
        gift: ["🎁", "#ffffff"],
        steal: ["?", "#ffffff"],
      };
      const f = fx[ev];
      if (f) this.glyph(f[0], f[1]);
      const sound: Record<string, Parameters<Voice["act"]>[0]> = {
        cursorSwat: "swat",
        cursorTouch: "swat",
        cursorPush: "swat",
        cursorCatch: "pop",
        sigh: "sigh",
        cursorLazy: "sigh",
        sulk: "sigh",
      };
      if (sound[ev]) this.voice.act(sound[ev], 150);
      if (this.brain.reaction?.rule.action === "celebrate" && !this.world.air && !this.world.support) this.world.jump();
    }
    this.lastFxReaction = ev;
    if (this.snapshot?.media.playing && (action === "sit" || action === "dance") && Math.random() < 0.012)
      this.glyph("♪", "#b4e62e", 0.3, 1600);
    // Needs show above the head now and then, even when it keeps quiet.
    if (now > this.nextNeedGlyph && action !== "sleep") {
      this.nextNeedGlyph = now + 9000;
      const g = this.brain.game;
      const need: [string, string] | null =
        g.health < 50 ? ["🤒", "#ffffff"] : g.food < 25 ? ["🍗", "#ffffff"] : g.drink < 25 ? ["💧", "#7fd3ff"] : g.strength < 20 ? ["💤", "#c9d1ff"] : g.grudge >= 50 ? ["💢", "#ff6a6a"] : null;
      if (need) this.glyph(need[0], need[1], 0.35, 1600);
    }
  }
  // Hand on the pet: a slow stroke is petting, fast wiggling is tickling.
  private touchCheck(m: Motion) {
    if (!this.ready || this.world.dragging || this.antics.absent) {
      this.strokes = [];
      return;
    }
    const t = Date.now();
    const k = this.world.scale;
    const size = this.store.settings.size * k;
    const inside =
      !m.down &&
      Math.abs(m.x - this.world.x) < size * 0.42 &&
      m.y < this.world.y &&
      m.y > this.world.y - size * 0.95;
    if (!inside) {
      this.strokes = [];
      return;
    }
    const last = this.strokes[this.strokes.length - 1];
    if (last && last.x === m.x && last.y === m.y) return;
    this.strokes.push({ x: m.x, y: m.y, t });
    while (this.strokes.length && t - this.strokes[0].t > 1500) this.strokes.shift();
    if (this.strokes.length < 4) return;
    let path = 0,
      turns = 0,
      dir = 0;
    for (let i = 1; i < this.strokes.length; i++) {
      const a = this.strokes[i - 1],
        b = this.strokes[i];
      path += Math.hypot(b.x - a.x, b.y - a.y);
      const dx = b.x - a.x;
      if (Math.abs(dx) > 2) {
        const d = Math.sign(dx);
        if (dir && d !== dir) turns++;
        dir = d;
      }
    }
    const span = Math.max(1, t - this.strokes[0].t);
    const speed = (path / span) * 1000;
    if (turns >= 6 && speed > 700 * k) {
      this.strokes = [];
      this.brain.tickled(t);
      this.play.cancel();
      this.game.loop.wake();
    } else if (span > 700 && path > 60 * k && speed < 900 * k) {
      if (t - this.lastHeart > 380) {
        this.lastHeart = t;
        this.glyph("♥", "#ff5d8f", (Math.random() - 0.5) * 0.4, 1100);
      }
      const hadStolen = this.brain.stolen > 0;
      this.brain.petted(t);
      if (hadStolen && this.brain.stolen === 0) this.antics.returned(this.host());
      this.play.cancel();
      this.game.loop.wake();
    }
  }
  // Cursor flung at the pet: hop out of the way (unless it tries to catch it).
  private dodgeCheck(m: Motion) {
    const t = Date.now();
    const prev = this.lastMotion;
    this.lastMotion = { x: m.x, y: m.y, t };
    if (!prev || this.world.dragging || !this.ready || m.down || this.antics.absent) return;
    const dt = (t - prev.t) / 1000;
    if (dt <= 0 || dt > 0.2) return;
    const k = this.world.scale;
    const speed = Math.hypot(m.x - prev.x, m.y - prev.y) / dt;
    const cy = this.world.y - this.store.settings.size * k * 0.45;
    const d = Math.hypot(m.x - this.world.x, m.y - cy);
    const before = Math.hypot(prev.x - this.world.x, prev.y - cy);
    if (this.strokes.length > 2 || this.play.busy) return;
    if (speed > 2600 * k && d < 150 * k && d < before) {
      const s = this.store.settings;
      if (s.pinned || s.mode !== "normal" || this.world.air || this.world.climb) return;
      // Friends and Nezuko try to catch it instead (cursorplay handles it).
      if (s.cursorPlay && (this.brain.temper.chase === "aggressive" || this.brain.stageNow(t) >= 2)) return;
      if (!this.brain.event("dodge", t)) return;
      const away = m.x < this.world.x ? 1 : -1;
      this.world.leap(this.world.x + away * 170 * k, this.world.y, 0);
    }
  }
  /** Food dragged from the panel: released over the pet = eaten. */
  private carryCheck(m: Motion) {
    const c = this.carrying;
    if (!c) return;
    if (m.down) c.down = true;
    const now = Date.now();
    if (now - c.since > 20000) {
      this.carrying = null;
      return;
    }
    if (c.down && !m.down) {
      const size = this.sizePx();
      const over =
        Math.abs(m.x - this.world.x) < size * 0.7 && m.y < this.world.y + 20 * this.world.scale && m.y > this.world.y - size * 1.3;
      this.carrying = null;
      if (over) this.buy(c.id);
    }
  }
  // Pending hops/runs requested by the director, climbing, the end of zoomies.
  private behave(now: number) {
    const s = this.store.settings;
    if (this.world.dragging || s.pinned || this.antics.absent) return;
    if (this.brain.wantRun !== null) {
      this.world.go(this.brain.wantRun, false, 2.4);
      this.brain.wantRun = null;
    }
    if (this.brain.wantAnnoy) {
      this.brain.wantAnnoy = false;
      if (s.cursorPlay) this.play.annoy(now);
    }
    if (this.zoomJump && now > this.zoomJump) {
      this.zoomJump = 0;
      this.world.jump();
    }
    const plan = this.climbPlan;
    if (plan) {
      const win = this.snapshot?.windows.find((w) => w.id === plan.id);
      if (!win || now > plan.until) this.climbPlan = null;
      else if (Math.abs(this.world.x - plan.x) < 14 * this.world.scale && !this.world.air) {
        this.climbPlan = null;
        this.world.startClimb(win, plan.side, s.size);
      } else if (this.world.target === null) this.world.go(plan.x, false, 1.3);
    }
    const hop = this.brain.wantHop;
    if (!hop) return;
    const win = this.snapshot?.windows.find((w) => w.id === hop.id);
    if (!win || now > hop.until || this.world.support?.id === hop.id) {
      this.brain.wantHop = null;
      return;
    }
    if (this.world.air || this.world.climb) return;
    const k = this.world.scale;
    const x = Math.min(Math.max(hop.x, win.rect.left + 60 * k), win.rect.right - 60 * k);
    if (Math.abs(this.world.x - x) > 220 * k) {
      // Run under the window first.
      this.world.go(x, false, 2.4);
      return;
    }
    this.brain.wantHop = null;
    if (this.world.leap(x, win.rect.top)) return;
    // Too high for one jump: climb up its side instead.
    const half = s.size * k * 0.38;
    const side: -1 | 1 = Math.abs(win.rect.left - this.world.x) < Math.abs(win.rect.right - this.world.x) ? -1 : 1;
    const edge = side < 0 ? win.rect.left - half * 0.55 : win.rect.right + half * 0.55;
    if (win.rect.bottom >= this.world.y - 30 * k) this.climbPlan = { id: win.id, side, x: edge, until: now + 15000 };
  }
  private async act(id: string) {
    const now = Date.now();
    // The answer to a button replaces the question at once.
    this.brain.reaction = undefined;
    const [kind, ...rest] = id.split(":");
    const arg = rest.join(":");
    this.diag.log("action", id);
    try {
      if (kind === "reveal") {
        this.brain.bubble = undefined;
        await command("trace_reveal", { path: arg });
      } else if (kind === "journal") {
        this.brain.bubble = undefined;
        await command("open_panel", { tab: "trace" });
      } else if (kind === "panel") {
        this.brain.bubble = undefined;
        await command("open_panel", { tab: arg });
      } else if (kind === "quickfeed") {
        this.brain.bubble = undefined;
        this.quickFeed(arg as "food" | "drink" | "drug");
      } else if (kind === "gift") {
        this.brain.bubble = undefined;
        if (arg === "take") this.antics.takeGift(this.host());
        else this.antics.declineGift(this.host());
        this.saveGame(true);
      } else if (kind === "start") {
        this.startGame(arg as GameKind);
      } else if (kind === "game") {
        const o = this.games.answer(arg, Math.random);
        if (o) this.finishGame(o);
      } else if (kind === "clean") {
        this.brain.bubble = undefined;
        if (arg === "yes") {
          const r = await command<{ bytes: number; files: number }>("temp_clean");
          note(this.brain.life, "clean", Date.now());
          this.brain.reset("cleanDone");
          this.brain.event("cleanDone", Date.now(), true, undefined, { size: formatBytes(r?.bytes ?? 0) });
          this.saveGame(true);
        }
      } else if (kind === "autorun-keep") {
        this.brain.bubble = undefined;
        await command("autorun_keep", { id: arg });
        this.brain.event("autorunKept", now, true);
      } else if (kind === "autorun-remove") {
        this.brain.bubble = undefined;
        const e = await command<{ name: string }>("autorun_remove", { id: arg });
        this.brain.reaction = undefined;
        this.brain.event("autorunRemoved", Date.now(), true, undefined, { name: e?.name ?? "" });
      }
    } catch (err) {
      this.brain.bubble = undefined;
      this.brain.reaction = undefined;
      this.brain.event("autorunFailed", Date.now(), true, undefined, { error: String(err) });
    }
    this.game.loop.wake();
  }
  private release(reason = "unknown") {
    if (!this.world.dragging) return;
    this.brain.reaction = undefined;
    const now = Date.now();
    const clinging = this.world.clinging;
    const click = this.world.release(now);
    this.diag.log(
      "release",
      `${reason} after ${now - this.draggingSince}ms as ${click ? "click" : clinging ? "cling" : "drop"} at ${Math.round(this.world.x)},${Math.round(this.world.y)} cursor ${this.cursor.x},${this.cursor.y}`,
    );
    if (click) {
      // A plain click: a reply, with level, money and what hurts under it.
      this.sfx.play("click");
      this.brain.click(now);
      // A click on a pet sitting on a window leaves it sitting there.
      const win = this.pickedFrom && this.snapshot?.windows.find((w) => w.id === this.pickedFrom!.id);
      if (win) {
        this.world.support = win;
        this.world.air = false;
        this.world.y = win.rect.top;
      }
    } else if (clinging) {
      // Never let go: stays where it was, glaring.
      this.force("grumpy", 1500);
    } else {
      this.sfx.play("drop");
      if (this.world.thrown > 600 * this.world.scale) {
        this.throwAt = now;
        this.landedFromThrow = false;
        this.brain.threw(now);
      }
      const d = this.world.takeDizzy();
      if (d >= 1 && this.brain.dizzy(now, d)) {
        this.fx.starsUntil = now + Math.min(6500, 1400 * d);
        this.force("dizzy", Math.min(6500, 1400 * d));
        this.voice.act("dizzy", 1000);
      }
      if (this.dragAnnounced) this.antics.dropped(this.host(), this.pickedFrom ? { id: this.pickedFrom.id, rect: this.pickedFrom.rect } : null, this.pickedGoal);
    }
    this.world.recover(
      this.monitors,
      this.store.settings.size,
      this.store.settings.monitor,
    );
    this.saveMemory(true);
  }
  private changePet() {
    const id = this.store.settings.pet;
    const url = `/pets/${id}/spritesheet.webp`;
    this.animator = new Animator(id);
    this.floors = [];
    this.masks = [];
    this.lastPose = "";
    const texture = this.textures.exists(id) ? this.textures.get(id) : null;
    const image = texture?.getSourceImage() as
      | HTMLImageElement
      | HTMLCanvasElement
      | undefined;
    const frames = texture ? texture.frameTotal - 1 : 0; // minus __BASE
    if (
      !texture ||
      !image ||
      image.width < FRAME_W * 8 ||
      image.height < FRAME_H * 9 ||
      frames < CELLS
    ) {
      const reason = this.loadFailures.has(id)
        ? `не удалось загрузить ${this.loadFailures.get(id)}`
        : texture
          ? `неверный размер атласа ${image?.width ?? 0}×${image?.height ?? 0}, кадров ${frames}`
          : `текстура «${id}» отсутствует`;
      this.assetError = `Спрайт не загружен: ${reason}`;
      this.actor.setVisible(false);
      console.error(this.assetError);
      this.diag.log("asset", `${id} ${url} FAILED: ${reason}`);
      return;
    }
    this.assetError = "";
    this.actor.setVisible(true).setTexture(id);
    this.applySmoothing();
    this.diag.log(
      "asset",
      `${id} ${url} ok ${image.width}x${image.height} frames ${frames}`,
    );
    const c = document.createElement("canvas");
    c.width = image.width;
    c.height = image.height;
    const ctx = c.getContext("2d", { willReadFrequently: true })!;
    ctx.drawImage(image, 0, 0);
    const data = ctx.getImageData(0, 0, c.width, c.height).data;
    for (let cell = 0; cell < CELLS; cell++) {
      const ox = (cell % 8) * FRAME_W,
        oy = Math.floor(cell / 8) * FRAME_H;
      let floor = FRAME_H - 1;
      outer: for (let y = FRAME_H - 1; y >= 0; y--) {
        for (let x = 0; x < FRAME_W; x++) {
          if (data[((oy + y) * c.width + ox + x) * 4 + 3] >= 128) {
            floor = y;
            break outer;
          }
        }
      }
      this.floors.push(floor);
      const rects: Rect[] = [];
      for (let y = 0; y < FRAME_H; y += 2) {
        let start = -1;
        for (let x = 0; x <= FRAME_W; x += 2) {
          const filled =
            x < FRAME_W &&
            [0, 1].some((dy) =>
              [0, 1].some(
                (dx) =>
                  data[((oy + y + dy) * c.width + ox + x + dx) * 4 + 3] >= 64,
              ),
            );
          if (filled && start < 0) start = x;
          if (!filled && start >= 0) {
            rects.push({ left: start, top: y, right: x, bottom: y + 2 });
            start = -1;
          }
        }
      }
      this.masks.push(rects);
    }
    const empty = this.masks.filter((m) => m.length === 0).length;
    if (empty)
      this.diag.log("mask", `${id}: ${empty} of ${CELLS} cells are empty`);
  }
  // One short effect per new reaction, plus the babble when a new line
  // appears in the balloon.
  private reactSound() {
    const event = this.brain.reaction?.event ?? "";
    if (event && event !== this.lastReaction) {
      const map: Record<string, Sfx> = {
        levelUp: "levelup",
        achievement: "levelup",
        workDone: "coin",
        summon: "summon",
        poke: "poke",
        fall: "drop",
        sleep: "sleep",
        return: "wake",
        hello: "wake",
        screenshot: "click",
        mute: "poke",
        unmute: "wake",
        giftTaken: "coin",
        giveBack: "coin",
      };
      const s = map[event];
      if (s) this.sfx.play(s);
    }
    this.lastReaction = event;
    const b = this.brain.bubble;
    const text = b?.text ?? "";
    if (text && text !== this.lastBubble) {
      const s = this.store.settings;
      if (s.voice && b?.kind !== "sign") this.voice.say(text, this.brain.temper.pitch, this.brain.temper.wave, this.brain.mood(Date.now()));
      else this.sfx.play("talk", 400);
    }
    this.lastBubble = text;
  }
  /** Carries out what cursor play asked for this frame. */
  private applyPlay(p: PlayIntent, now: number) {
    const s = this.store.settings;
    if (p.stop) this.world.target = this.world.goal = null;
    if (p.go && !s.pinned) this.world.go(p.go.x, false, p.go.hurry);
    if (p.leap && !s.pinned) this.world.leap(p.leap.x, p.leap.y);
    if (p.action) this.forced = { action: p.action, until: p.until ?? now + 400 };
    if (p.say) this.brain.event(p.say, now, false);
    if (p.count) note(this.brain.life, p.count, now);
    if (p.count === "gameCatch") this.games.caught();
    if (p.calm) this.brain.game = { ...this.brain.game, grudge: Math.max(0, this.brain.game.grudge - p.calm) };
    if (p.slip) {
      this.fx.dust(this.world.x, this.world.y, this.world.scale, 5, false);
      this.squash = { t: now, kind: "floor", amt: 0.25 };
      this.voice.act("land", 200);
    }
    if (p.nudge && s.cursorPush && native && !this.cursor.down)
      void command("nudge_cursor", { dx: p.nudge.dx, dy: p.nudge.dy }).catch(() => {});
  }
  update(_time: number, delta: number) {
    if (!this.ready || this.disposed || !this.world.initialized) return;
    this.applyDpr(window.devicePixelRatio || 1);
    const now = Date.now();
    if (this.lastNow && now - this.lastNow > 10000) {
      // Resumed after sleep/lock: drop stale motion instead of catching up.
      this.brain.bubble = undefined;
      this.brain.reaction = undefined;
      this.world.vx = this.world.vy = 0;
      this.world.target = null;
      this.play.cancel();
      this.diag.log("resume", `gap ${Math.round((now - this.lastNow) / 1000)}s`);
    }
    this.lastNow = now;
    this.brain.tick(now);
    this.brain.position(this.world.x, this.world.y);
    this.world.agility = skill(this.brain.game, "agility");
    this.reactSound();
    if (this.card && now > this.cardUntil) {
      this.hideCard();
      this.lastPose = "";
    }
    const s = this.store.settings;
    const k = this.world.scale;
    const size = this.sizePx();
    // Cursor games first: they may steer the walk and force an animation.
    const g = this.brain.game;
    const intent = this.play.update({
      now,
      cursor: this.cursor,
      pet: { x: this.world.x, y: this.world.y, air: this.world.air, dragging: this.world.dragging, onWindow: !!this.world.support },
      size,
      k,
      grudge: g.grudge,
      wronged: Math.min(this.brain.since("throw", now), this.brain.since("poke", now)),
      stage: this.brain.stageNow(now),
      temper: this.brain.temper,
      enabled:
        s.cursorPlay && s.mode === "normal" && s.walk && !s.pinned && !this.brain.hidden && !this.antics.absent && !this.world.climb,
      asleep: ["sleep", "rest"].includes(this.brain.base) && this.play.state !== "game",
      agility: skill(g, "agility"),
      random: Math.random,
    });
    this.applyPlay(intent, now);
    this.antics.update(this.host());
    const near =
      s.observeCursor &&
      Math.hypot(
        this.cursor.x - this.world.x,
        this.cursor.y - (this.world.y - s.size * k * 0.45),
      ) < s.size * k;
    if (near && !this.world.dragging && !this.play.busy) {
      if (!this.cursorNearSince) this.cursorNearSince = now;
      if (now - this.cursorNearSince > 900) this.brain.event("cursor", now);
    } else this.cursorNearSince = 0;
    let base = this.brain.action(now);
    const top = this.brain.reaction && this.brain.reaction.until > now && this.brain.reaction.rule.priority >= 95;
    if (this.forced && now < this.forced.until && !top) base = this.forced.action;
    else if (this.forced && now >= this.forced.until) this.forced = null;
    // A shift at work: busy typing.
    if (base === "idle" && working(g, now)) base = "busy";
    if (s.mode === "dnd" && !this.dnd) {
      const m = monitorAt(this.monitors, this.world.x, this.world.y, s.monitor);
      const spot = this.store.memory.favorite;
      this.world.support = null;
      if (m) {
        this.world.go(spot?.monitor === m.id ? spot.x : m.work.right - 100, true);
        this.world.recover(this.monitors, s.size, s.monitor);
      }
      this.world.vx = this.world.vy = 0;
    }
    this.dnd = s.mode === "dnd";
    // Far click on a monitor it cannot walk to: it just turns up there.
    if (this.brain.wantGo !== null && !this.world.dragging) {
      const goal = this.brain.wantGo;
      this.brain.wantGo = null;
      const here = monitorAt(this.monitors, this.world.x, this.world.y, s.monitor);
      const there = this.cursor.x === goal ? monitorAt(this.monitors, this.cursor.x, this.cursor.y) : undefined;
      if (here && there && here.id !== there.id && !reachable(this.monitors, here, there) && s.monitor === "auto") {
        this.fx.dust(this.world.x, this.world.y, k, 6, false);
        this.world.travelTo(there, goal, s.size);
      } else this.world.go(goal);
    }
    const quietIdle = !this.brain.reaction && base === "idle" && !this.world.dragging && !this.play.busy && !this.forced && !this.antics.carry;
    if (quietIdle) {
      if (now > this.nextActivity) {
        const calm = s.activity === "calm";
        const active = s.activity === "active";
        const pace = this.brain.temper.pace;
        // VPet-like pace: a few seconds between actions, quicker with level
        // and a good mood, slower when sick or in a poor condition.
        const wait =
          (calm ? 25000 : active ? 4000 : 9000) *
          pace *
          (1.4 - this.brain.energy * 0.5) *
          this.brain.wanderFactor() *
          Math.max(0.6, 1 / (1 + 0.03 * level(g.exp)));
        this.nextActivity = now + wait + Math.random() * wait;
        this.activityUntil = now + 3000 + Math.random() * 3500;
        const m = monitorAt(this.monitors, this.world.x, this.world.y, s.monitor);
        const r = Math.random();
        const happy = g.feeling >= 75;
        const sad = g.feeling < 30;
        this.idleAction =
          r < 0.3
            ? "look"
            : r < 0.45
              ? "sit"
              : r < 0.55
                ? sad
                  ? "sigh"
                  : "rest"
                : r < 0.63
                  ? "judge"
                  : r < 0.72
                    ? "jump"
                    : r < 0.78
                      ? "stretch"
                      : happy
                        ? "celebrate"
                        : "look";
        if (this.idleAction === "jump") {
          this.world.jump();
          this.activityUntil = now + 900;
        }
        if (
          m &&
          !near &&
          s.walk &&
          s.mode === "normal" &&
          !s.pinned &&
          r > 0.55 - this.brain.curiosity * 0.3
        ) {
          this.idleAction = "idle";
          let target = this.world.x + (Math.random() - 0.5) * 450 * k;
          if (
            s.observeCursor &&
            Math.hypot(this.cursor.x - this.world.x, this.cursor.y - this.world.y) < 260 &&
            r > 0.85
          )
            target = this.cursor.x;
          // Now and then: zoomies — sprint far, then a jump.
          if (r > 0.93 && this.brain.event("zoomies", now)) {
            const far = this.world.x < (m.work.left + m.work.right) / 2;
            this.world.go(far ? m.work.right : m.work.left, false, 2.6 * (this.brain.temper.chase === "aggressive" ? 1.15 : 1));
            this.zoomJump = now + 1600;
          } else this.world.go(target);
        }
      }
      if (now < this.activityUntil) base = this.idleAction;
    }
    this.behave(now);
    let action: Action = this.world.step(
      delta / 1000,
      now,
      s,
      this.monitors,
      this.snapshot?.windows ?? [],
      base,
    );
    // Held in the hand: hanging, kicking, flailing, being shaken, resisting.
    if (this.world.dragging) {
      const speed = Math.hypot(this.world.vx, this.world.vy);
      action = this.world.clinging
        ? "grumpy"
        : this.world.shaking
          ? "shaken"
          : speed > 900 * k
            ? "flail"
            : "drag";
    } else if (this.world.air && this.world.swing && !this.world.climb) action = "flail";
    if (action !== this.lastForcedAction && ["swat", "sigh"].includes(action)) this.voice.act(action === "swat" ? "swat" : "sigh", 300);
    this.lastForcedAction = action;
    // New perch (landed on or climbed onto a window), monitor changes.
    const sup = this.world.support?.id ?? 0;
    if (sup !== this.lastSupport) {
      if (sup) {
        this.supportApp = this.snapshot?.foreground === sup ? (this.snapshot?.app ?? "") : "";
        if (this.lastAction === "hang" || this.lastAction === "jump") this.antics.perched(this.host());
      }
      this.lastSupport = sup;
    }
    const mon = monitorAt(this.monitors, this.world.x, this.world.y, s.monitor)?.id ?? "";
    if (mon && this.lastMonitor && mon !== this.lastMonitor) note(this.brain.life, "cross", now);
    this.lastMonitor = mon;
    this.props.kick(this.world.x, this.world.vx, this.world.y, k);
    this.props.step(delta / 1000, k);
    // Running plays the walk cycle faster: the animation clock runs ahead.
    this.animClock += delta * (this.world.running ? 2.2 : 1);
    this.bodyLanguage(now, action);
    const frame = this.animator.frame(action, this.animBase + this.animClock);
    // RequestAnimationFrame.delay is Phaser's documented timeout cadence.
    // A sleeping, stationary sprite needs only two refreshes per second.
    this.game.loop.raf.delay =
      action === "sleep" && !this.fx.busy && !this.brain.bubble ? 500 : 1000 / 30;
    const drawSize = this.snapshot?.fullscreen ? s.size * 0.75 : s.size;
    this.layout = overlayLayout(
      this.world.x,
      this.world.y,
      drawSize,
      this.dpr,
      monitorAt(this.monitors, this.world.x, this.world.y, s.monitor),
      this.monitors,
    );
    const z = drawSize / FRAME_W;
    const floor = ["jump", "celebrate", "flail", "drag", "shaken", "dance", "hang"].includes(action)
      ? (this.floors[0] ?? FRAME_H - 1)
      : (this.floors[frame] ?? FRAME_H - 1);
    // Pivot: the grab point while held, the feet otherwise.
    let px = 96,
      py = floor + 1;
    if (this.world.dragging && !this.world.clinging) {
      px = Math.max(10, Math.min(182, 96 + this.world.grab.x / (this.dpr * z)));
      py = Math.max(10, Math.min(200, floor + 1 + this.world.grab.y / (this.dpr * z)));
    }
    let angle = this.world.swing;
    if (now < this.fx.starsUntil && !this.world.dragging) angle += Math.sin(now / 170) * 0.13;
    const shiver = this.antics.shivering || (action === "pained" && g.health < 50) ? (Math.random() - 0.5) * 1.6 : 0;
    const crop = this.antics.crop();
    const p: Placement = {
      x: this.layout.anchorX + (px - 96) * z * this.kx + shiver,
      y: this.layout.anchorY + (py - (floor + 1)) * z * this.ky,
      px,
      py,
      sx: z * this.kx,
      sy: z * this.ky,
      angle,
      cropLeft: crop?.[0],
      cropRight: crop?.[1],
    };
    this.placement = p;
    const absent = this.antics.absent;
    if (!this.assetError) {
      this.actor
        .setVisible(!absent)
        .setFrame(frame)
        .setOrigin(px / FRAME_W, py / FRAME_H)
        .setScale(p.sx, p.sy)
        .setRotation(angle)
        .setPosition(p.x, p.y);
      if (crop) this.actor.setCrop(crop[0], 0, crop[1] - crop[0], FRAME_H);
      else if (this.actor.isCropped) this.actor.setCrop();
    }
    if (action !== this.lastAction) {
      if (action === "land" && !this.world.support) {
        const m = monitorAt(this.monitors, this.world.x, this.world.y, s.monitor);
        if (m)
          this.diag.log(
            "perch",
            `landed on floor at ${Math.round(this.world.x)},${Math.round(this.world.y)}; ${this.world.explainPerch(s, m, this.snapshot?.windows ?? [])}`,
          );
      }
      this.lastAction = action;
      this.diag.log(
        "state",
        `action ${action} base ${this.brain.base} reaction ${this.brain.reaction?.event ?? "-"} frame ${frame} pos ${Math.round(this.world.x)},${Math.round(this.world.y)} support ${this.world.support?.id ?? 0}`,
      );
    }
    const mask = this.masks[frame] ?? [];
    const head = headTop(mask);
    const headCanvas = head && !absent ? toCanvas(p, head.x, head.y) : null;
    // Props: accessories, headphones, umbrella, flashlight, carried things.
    const hol = holiday(now, this.store.memory.birthday, this.brain.life.since);
    const walking = action === "walkLeft" || action === "walkRight";
    const propRects = this.props.draw({
      head: headCanvas,
      angle,
      z,
      wear: hol?.wear ?? this.brain.life.wear,
      headphones: !!this.snapshot?.media.playing && !absent,
      umbrella: this.weather?.kind === "rain" && now - this.weather.at < 3600000 && !this.world.dragging,
      flashlight: dayPart(now) === "night" && walking && !absent ? (action === "walkRight" ? 1 : -1) : 0,
      carry: this.antics.carry,
      feet: { x: this.layout.anchorX, y: this.layout.anchorY },
      toCanvas: this.toScene,
      now,
      visible: !absent && !this.assetError,
    });
    // Food dragged in from the panel follows the cursor over the window.
    const carriedRect = this.drawCarried();
    const text = this.assetError || (absent ? "" : (this.brain.bubble?.text ?? ""));
    const bubble = text
      ? {
          text,
          sub: this.assetError ? undefined : this.brain.bubble?.sub,
          kind: this.assetError ? "say" as const : this.brain.bubble?.kind,
          actions: this.assetError ? [] : this.brain.bubble?.actions,
        }
      : null;
    const pet = pets.find((x) => x.id === s.pet);
    const bubbleRect = this.balloon.render(
      bubble,
      now,
      this.layout.anchorX,
      headCanvas?.y ?? this.layout.anchorY - drawSize,
      this.layout.anchorY,
      this.layout.below,
      Phaser.Display.Color.HexStringToColor(pet?.color ?? "#545c39").color,
    );
    this.fx.draw(now, k, this.world.x, this.world.y, this.toScene, headCanvas, z * 2.4);
    const rects: Rect[] = [];
    if (!this.assetError && !absent) rects.push(...compact(regionRects(p, mask), 240));
    rects.push(...this.fx.rects(this.toScene, this.world.x, this.world.y, headCanvas, now, z * 2.4));
    rects.push(...propRects);
    if (carriedRect) rects.push(carriedRect);
    const card = this.cardRect();
    if (card) rects.push(card);
    if (bubbleRect) rects.push(bubbleRect);
    void this.renderPose(!this.brain.hidden, rects);
    this.saveMemory(false);
  }
  private drawCarried(): Rect | null {
    const c = this.carrying;
    if (!c) {
      this.carriedImage?.setVisible(false);
      return null;
    }
    const pos = this.toScene(this.cursor.x, this.cursor.y);
    if (pos.x < -20 || pos.x > BASE_WIDTH + 20 || pos.y < -20 || pos.y > BASE_HEIGHT + 20) {
      this.carriedImage?.setVisible(false);
      return null;
    }
    const key = "shop-" + c.id;
    if (!this.textures.exists(key)) return null;
    if (!this.carriedImage) this.carriedImage = this.add.image(0, 0, key).setDepth(40);
    this.carriedImage.setTexture(key).setDisplaySize(30, 30).setPosition(pos.x + 14, pos.y + 14).setVisible(true);
    return { left: Math.floor(pos.x - 2), top: Math.floor(pos.y - 2), right: Math.ceil(pos.x + 32), bottom: Math.ceil(pos.y + 32) };
  }
  private async renderPose(visible: boolean, rects: Rect[] = []) {
    if (!this.world.initialized || this.busy) return;
    const scale = this.dpr;
    const pose = {
      x: Math.round(this.layout.left),
      y: Math.round(this.layout.top),
      scale,
      rects: rects.slice(0, 299),
      support: this.world.support?.id ?? 0,
      visible,
    };
    const key = JSON.stringify(pose);
    if (key === this.lastPose) return;
    this.busy = true;
    try {
      const assigned = await command<number>("pose", pose);
      this.lastPose = key;
      const { width, height } = canvasSize(scale);
      this.diag.log(
        "pose",
        `visible ${visible} window ${pose.x},${pose.y} ${width}x${height} scale ${scale} rects ${pose.rects.length} support ${pose.support}`,
        3000,
      );
      if (typeof assigned === "number" && Math.abs(assigned - scale) > 0.01)
        this.diag.log(
          "dpi-mismatch",
          `Windows assigned scale ${assigned}, WebView reports ${scale}`,
        );
    } catch (e) {
      console.error("Overlay position:", String(e));
      this.diag.log("pose-error", String(e));
    } finally {
      this.busy = false;
    }
  }
  private saveMemory(force: boolean) {
    const now = Date.now();
    if (!force && now - this.lastSave < 15000) return;
    this.lastSave = now;
    const memory: Memory = {
      ...this.brain.memory,
      recent: this.brain.dialogue.recent,
      position: { x: Math.round(this.world.x), y: Math.round(this.world.y) },
    };
    const key = JSON.stringify(memory);
    if (key === this.lastMemory) return;
    this.lastMemory = key;
    void command("save_pet_memory", { memory }).catch(() => {
      this.lastMemory = "";
    });
  }
  private dispose() {
    this.disposed = true;
    for (const off of this.disposers) off();
    this.disposers = [];
    this.game.canvas.removeEventListener("contextmenu", this.preventContext);
    this.game.canvas.removeEventListener("pointermove", this.previewMove);
  }
  /** For probes: current placement of the sprite. */
  get debugPlacement() {
    return this.placement;
  }
}
function formatBytes(n: number) {
  if (n >= 1073741824) return (n / 1073741824).toFixed(1).replace(".", ",") + " ГБ";
  if (n >= 1048576) return Math.round(n / 1048576) + " МБ";
  return Math.round(n / 1024) + " КБ";
}
