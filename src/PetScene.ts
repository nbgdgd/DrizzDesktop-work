// Derived from WindowPet's transparent Phaser scene + Tauri bridge.
// One physics owner and one lifecycle; no per-reaction timers or per-frame listeners.
//
// Units: the scene works in logical canvas pixels (360×340). The Rust side
// receives physical desktop pixels; `dpr` (WebView devicePixelRatio) converts
// between the two. Movement/physics use the monitor scale reported by Rust,
// which equals `dpr` once the window sits on that monitor.
import Phaser from "phaser";
import { command, on, native } from "./bridge";
import { Sfx, Sound } from "./sound";
import { Animator } from "./animation";
import { Director } from "./director";
import { Movement, monitorAt } from "./movement";
import { overlayLayout } from "./layout";
import { Diag } from "./diag";
import type { AutorunChange, Spike, TraceEvent } from "./trace";
import {
  buyUpgrade,
  cleanGame,
  eat,
  itemById,
  jobById,
  level,
  startJob,
  upgradeById,
  working,
} from "./game";
import { BASE_HEIGHT, BASE_WIDTH, canvasSize, canvasZoom } from "./dpi";
import {
  cleanSettings,
  cleanMemory,
  Monitor,
  Rect,
  Snapshot,
  Store,
  Memory,
  pets,
} from "./model";
// The first-run card sits in canvas space, above where the pet stands.
const CARD = { left: 74, top: 24, width: 212, height: 96 };
interface Motion {
  x: number;
  y: number;
  down: boolean;
  support: { id: number; rect: Rect } | null;
}
const FRAME_WIDTH = 192;
const FRAME_HEIGHT = 208;
const CELLS = 72;
export class PetScene extends Phaser.Scene {
  private actor!: Phaser.GameObjects.Sprite;
  private label!: Phaser.GameObjects.Text;
  private buttons: Phaser.GameObjects.Text[] = [];
  private bubbleSince = 0;
  private bubbleSeen = "";
  private bubbleRect: { left: number; top: number; right: number; bottom: number } | null = null;
  private balloon!: Phaser.GameObjects.Graphics;
  private animator!: Animator;
  private brain!: Director;
  private world = new Movement();
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
  private idleAction: "look" | "sit" | "rest" | "idle" | "jump" | "celebrate" =
    "idle";
  private lastGameSave = 0;
  private sfx = new Sound();
  // First-run card: drawn once, held for a few seconds, never again.
  private card?: Phaser.GameObjects.Container;
  private cardUntil = 0;
  private lastReaction = "";
  private lastBubble = "";
  private lastGameTick = 0;
  private ready = false;
  private lastMemory = "";
  private lastSave = 0;
  private dragSeenDown = false;
  private dragAnnounced = false;
  private pressAt = { x: 0, y: 0 };
  private lastDrag = 0;
  private draggingSince = 0;
  private dnd = false;
  private lastNow = 0;
  private cursorNearSince = 0;
  private layout = overlayLayout(0, 0, 116, 1);
  private dpr = 1;
  private diag = new Diag();
  private assetError = "";
  private loadFailures = new Map<string, string>();
  private lastAction = "";
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
        frameWidth: FRAME_WIDTH,
        frameHeight: FRAME_HEIGHT,
      });
  }
  create() {
    this.actor = this.add
      .sprite(180, 330, "drizz")
      .setOrigin(0, 0)
      .setInteractive({ pixelPerfect: true, alphaTolerance: 64 });
    this.fx = this.add.graphics();
    this.balloon = this.add.graphics();
    this.label = this.add.text(0, 0, "", {
      fontFamily: "Segoe UI, sans-serif",
      fontSize: "14px",
      color: "#e9e9eb",
      wordWrap: { width: 258 },
      lineSpacing: 4,
      padding: { x: 0, y: 0 },
    });
    for (let i = 0; i < 3; i++) {
      const b = this.add
        .text(0, 0, "", {
          fontFamily: "Segoe UI, sans-serif",
          fontSize: "13px",
          color: "#b4e62e",
          backgroundColor: "#26282d",
          padding: { x: 8, y: 4 },
        })
        .setVisible(false)
        .setInteractive({ useHandCursor: true });
      b.on("pointerdown", () => {
        const a = this.brain?.bubble?.actions?.[i];
        // A new balloon may have replaced the one the user aimed at.
        if (a && Date.now() - this.bubbleSince > 450) void this.act(a.id);
      });
      this.buttons.push(b);
    }
    this.label.setInteractive();
    this.label.on("pointerdown", () => {
      if (this.brain) this.brain.bubble = undefined;
    });
    this.actor.on("pointerdown", (p: Phaser.Input.Pointer) => {
      if (!this.ready) return;
      if (p.rightButtonDown()) {
        void command("open_panel", { tab: "status" });
        return;
      }
      const now = Date.now();
      this.brain.bubble = undefined;
      this.brain.wake(now);
      this.diag.log(
        "drag",
        `pointerdown button ${p.button} cursor ${this.cursor.x},${this.cursor.y} pet ${Math.round(this.world.x)},${Math.round(this.world.y)} down ${this.cursor.down}`,
      );
      this.world.begin(this.cursor.x, this.cursor.y, now);
      this.dragSeenDown = false;
      this.dragAnnounced = false;
      this.pressAt = { x: this.cursor.x, y: this.cursor.y };
      this.draggingSince = now;
      this.brain.reaction = undefined;
    });
    this.input.on("pointerup", () => this.release("pointerup"));
    // Any press inside the window region, hit or miss, for diagnostics only.
    this.input.on("pointerdown", (p: Phaser.Input.Pointer) => {
      this.diag.log(
        "pointer",
        `down at canvas ${Math.round(p.worldX)},${Math.round(p.worldY)} actor ${Math.round(this.actor.x)},${Math.round(this.actor.y)} ${Math.round(this.actor.displayWidth)}x${Math.round(this.actor.displayHeight)} cursor ${this.cursor.x},${this.cursor.y}`,
      );
    });
    this.game.canvas.addEventListener("contextmenu", this.preventContext);
    this.events.once("shutdown", () => this.dispose());
    this.applyDpr(window.devicePixelRatio || 1, true);
    // Diagnostics only: the probes in tools/ reach the director through this.
    (window as unknown as Record<string, unknown>).__PET_SCENE__ = this;
    void this.bootPet();
  }
  private preventContext = (e: Event) => e.preventDefault();
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
    this.label.setResolution(dpr);
    this.label.frame.source.resolution = dpr;
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
      this.sfx.apply(this.store.settings.sounds, this.store.settings.soundVolume);
      if (!this.store.memory.cardShown) this.showCard();
      await this.subscribe<Store>("store", (s) => {
        const changed = s.settings.pet !== this.store.settings.pet;
        this.store = {
          ...s,
          settings: cleanSettings(s.settings),
          memory: cleanMemory(s.memory),
          game: this.brain.game,
        };
        void this.diag.refresh();
        this.brain.updateSettings(this.store.settings);
        this.sfx.apply(
          this.store.settings.sounds,
          this.store.settings.soundVolume,
        );
        this.brain.memory = this.store.memory;
        this.brain.dialogue.recent = this.store.memory.recent;
        if (changed) this.changePet();
        this.applySmoothing();
        this.world.recover(
          this.monitors,
          this.store.settings.size,
          this.store.settings.monitor,
        );
        this.lastPose = "";
      });
      await this.subscribe<Motion>("motion", (m) => {
        this.touchCheck(m);
        this.dodgeCheck(m);
        this.cursor = m;
        if (this.world.dragging) {
          this.world.drag(m.x, m.y, Date.now());
          if (
            m.down &&
            !this.dragAnnounced &&
            Math.hypot(m.x - this.pressAt.x, m.y - this.pressAt.y) > 8
          ) {
            this.dragAnnounced = true;
            this.brain.event(
              Date.now() - this.lastDrag < 12000 ? "dragged" : "drag",
              Date.now(),
              true,
            );
            this.brain.dragged(Date.now());
            this.lastDrag = Date.now();
          }
          if (m.down) this.dragSeenDown = true;
          else if (this.dragSeenDown || Date.now() - this.draggingSince > 250)
            this.release(this.dragSeenDown ? "button released" : "no button");
        } else if (this.world.support) {
          const old = this.world.support.rect;
          const lost = this.world.follow(m.support);
          if (lost) this.brain.event("fall", Date.now());
          else if (
            m.support &&
            Math.hypot(
              old.left - m.support.rect.left,
              old.top - m.support.rect.top,
            ) > 4
          )
            this.brain.event("windowMove", Date.now());
        }
      });
      await this.subscribe<Snapshot>("snapshot", (n) => {
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
        this.world.recover(
          n.monitors,
          this.store.settings.size,
          this.store.settings.monitor,
        );
        this.brain.observe(n);
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
        if (!this.brain.hidden && !this.game.loop.running)
          this.game.loop.wake();
        if (this.brain.hidden) {
          void this.renderPose(false);
          this.game.loop.sleep();
        }
      });
      await this.subscribe("summon", () => {
        this.brain.manualHidden = false;
        this.brain.hidden = false;
        const m = monitorAt(
          this.monitors,
          this.cursor.x,
          this.cursor.y,
          this.store.settings.monitor,
        );
        if (m) {
          this.world.x = this.cursor.x;
          this.world.y = m.work.bottom;
          this.world.support = null;
          this.world.vx = this.world.vy = 0;
          this.world.recover(
            this.monitors,
            this.store.settings.size,
            this.store.settings.monitor,
          );
        }
        this.brain.summoned(Date.now());
        this.brain.event("summon", Date.now(), true);
        this.game.loop.wake();
      });
      await this.subscribe("recenter", () => this.recenter());
      await this.subscribe<TraceEvent>("trace", (e) => {
        this.diag.log(
          "trace",
          `${e.child.name} <- ${e.chain.join(" <- ")} ${e.verdict} speak ${e.speak}`,
        );
        if (this.brain.trace(e, Date.now())) this.game.loop.wake();
      });
      await this.subscribe<AutorunChange>("autorun", (c) => {
        this.diag.log("autorun", `${c.kind} ${c.entry.id}`);
        if (this.brain.autorun(c, Date.now())) this.game.loop.wake();
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
      });
      await this.subscribe<{ id: string; kind: string; title: string }>(
        "integration-event",
        (e) => this.brain.integration(e, Date.now()),
      );
      await this.subscribe<string>("buy", (id) => this.buy(id));
      await this.subscribe<string>("upgrade", (id) => this.upgrade(id));
      await this.subscribe<string>("job", (id) => this.work(id));
      this.ready = true;
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
        this.world.initialize(this.monitors, 116, null);
        this.brain.event("hello", Date.now());
      }
    } catch (e) {
      this.label
        .setText("Не удалось запустить питомца. Откройте приложение заново.")
        .setPosition(20, 50);
      console.error(String(e));
    }
  }
  // Shop purchase requested from the settings panel. The pet owns the
  // progression state, so the panel only sends the item id.
  private buy(id: string) {
    const item = itemById(id);
    if (!item) return;
    const now = Date.now();
    const next = eat(this.brain.game, item);
    if (!next) {
      this.sfx.play("error");
      this.brain.event("broke", now, true);
      return;
    }
    this.brain.game = next;
    this.sfx.play(item.kind === "drink" ? "drink" : "eat");
    this.brain.fed(now);
    this.brain.event("fed", now, true, undefined, { item: item.name });
    this.saveGame(true);
    this.game.loop.wake();
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
    const text = this.add.text(w / 2, h / 2, "ТЫ ПИДОРАС", {
      fontFamily: "Segoe UI, sans-serif",
      fontSize: "26px",
      color: "#b4e62e",
      align: "center",
    });
    text.setOrigin(0.5, 0.5);
    const sub = this.add.text(w / 2, h - 16, "добро пожаловать, сука", {
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
  // Buttons inside the speech balloon.
  // ---- body language: squash & stretch, particles, touch gestures
  private kx = 1;
  private ky = 1;
  private squash: { t: number; kind: "floor" | "wall" | "ceiling"; amt: number } | null = null;
  private fx!: Phaser.GameObjects.Graphics;
  private glyphs: Phaser.GameObjects.Text[] = [];
  private parts: {
    kind: "dust" | "glyph";
    x: number;
    y: number;
    vx: number;
    vy: number;
    born: number;
    life: number;
    r: number;
    glyph?: Phaser.GameObjects.Text;
  }[] = [];
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
  private toScene(x: number, y: number) {
    return { x: (x - this.layout.left) / this.dpr, y: (y - this.layout.top) / this.dpr };
  }
  private spawnDust(n: number, big: boolean) {
    const k = this.world.scale;
    for (let i = 0; i < n; i++)
      this.parts.push({
        kind: "dust",
        x: this.world.x + (Math.random() - 0.5) * 30 * k,
        y: this.world.y - 3 * k,
        vx: (Math.random() - 0.5) * (big ? 260 : 140) * k,
        vy: -(20 + Math.random() * (big ? 90 : 45)) * k,
        born: Date.now(),
        life: 420 + Math.random() * 220,
        r: (big ? 4 : 3) + Math.random() * 2.5,
      });
  }
  private spawnGlyph(ch: string, color: string, dx = 0, life = 1300) {
    if (this.parts.length > 30) return;
    let g = this.glyphs.find((t) => !t.visible);
    if (!g) {
      if (this.glyphs.length >= 14) return;
      g = this.add.text(0, 0, "", {
        fontFamily: "Segoe UI Symbol, Segoe UI Emoji, Segoe UI, sans-serif",
        fontSize: "21px",
        fontStyle: "bold",
        color: "#ffffff",
        stroke: "#101114",
        strokeThickness: 2,
      });
      g.setOrigin(0.5, 1);
      this.glyphs.push(g);
    }
    g.setText(ch).setColor(color).setVisible(true).setAlpha(1);
    g.setResolution(this.dpr);
    g.frame.source.resolution = this.dpr;
    const k = this.world.scale;
    const size = this.store.settings.size * k;
    // Glyphs ride with the pet: x/y are offsets from its feet.
    this.parts.push({
      kind: "glyph",
      x: dx * size + (Math.random() - 0.5) * 16 * k,
      y: -size * 0.9,
      vx: (Math.random() - 0.5) * 30 * k,
      vy: -45 * k,
      born: Date.now(),
      life,
      r: 0,
      glyph: g,
    });
  }
  // One place for squash & stretch, impact reactions and ambient particles.
  private bodyLanguage(now: number, action: string) {
    const k = this.world.scale;
    for (const im of this.world.impacts.splice(0)) {
      const hard = im.speed > 600 * k;
      this.squash = { t: now, kind: im.kind, amt: Math.min(0.32, im.speed / (2400 * k)) };
      if (im.kind === "floor") {
        if (im.speed > 180 * k) this.spawnDust(hard ? 8 : 4, hard);
        if (hard && now - this.throwAt < 5000) {
          this.spawnGlyph("✦", "#ffe27a", -0.2, 900);
          this.spawnGlyph("✦", "#ffe27a", 0.2, 900);
          this.brain.impact("floor", now);
        }
      } else if (im.speed > 300 * k) {
        this.spawnGlyph("✦", "#ffe27a", 0, 900);
        this.brain.impact(im.kind, now);
      }
    }
    // Squash after an impact, stretch while flying fast.
    let sx = 1,
      sy = 1;
    if (this.world.air && !this.world.dragging) {
      const st = Math.min(0.14, Math.abs(this.world.vy) / (3000 * k));
      sy = 1 + st;
      sx = 1 - st * 0.6;
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
    // Ambient particles.
    if (action === "sleep" && now - this.lastZ > 2600) {
      this.lastZ = now;
      this.spawnGlyph("z", "#c9d1ff", 0.25, 1800);
    }
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
        bondUp: ["♥", "#ff5d8f"],
        levelUp: ["★", "#ffe27a"],
        tickle: ["♪", "#ffe27a"],
        fed: ["♥", "#ff5d8f"],
      };
      const f = fx[ev];
      if (f) this.spawnGlyph(f[0], f[1]);
    }
    this.lastFxReaction = ev;
    if (this.snapshot?.media.playing && action === "sit" && Math.random() < 0.012)
      this.spawnGlyph("♪", "#b4e62e", 0.3, 1600);
  }
  private drawParticles(now: number) {
    this.fx.clear();
    const dt = 1 / 30;
    this.parts = this.parts.filter((p) => {
      const age = now - p.born;
      if (age >= p.life) {
        p.glyph?.setVisible(false);
        return false;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.kind === "dust") {
        p.vx *= 0.9;
        p.vy += 40 * this.world.scale * dt;
      }
      const c =
        p.kind === "glyph"
          ? this.toScene(this.world.x + p.x, this.world.y + p.y)
          : this.toScene(p.x, p.y);
      const fade = 1 - age / p.life;
      if (p.kind === "dust") {
        this.fx.fillStyle(0xe8e1d4, 0.8 * fade);
        this.fx.fillCircle(c.x, c.y, p.r * (0.7 + 0.5 * (1 - fade)));
      } else if (p.glyph) {
        p.glyph.setPosition(c.x, c.y).setAlpha(Math.min(1, fade * 2.5));
      }
      return true;
    });
  }
  // Hand on the pet: a slow stroke is petting, fast wiggling is tickling.
  private touchCheck(m: Motion) {
    if (!this.ready || this.world.dragging) {
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
      this.game.loop.wake();
    } else if (span > 700 && path > 60 * k && speed < 900 * k) {
      if (t - this.lastHeart > 380) {
        this.lastHeart = t;
        this.spawnGlyph("♥", "#ff5d8f", (Math.random() - 0.5) * 0.4, 1100);
      }
      this.brain.petted(t);
      this.game.loop.wake();
    }
  }
  // Cursor flung at the pet: hop out of the way.
  private dodgeCheck(m: Motion) {
    const t = Date.now();
    const prev = this.lastMotion;
    this.lastMotion = { x: m.x, y: m.y, t };
    if (!prev || this.world.dragging || !this.ready || m.down) return;
    const dt = (t - prev.t) / 1000;
    if (dt <= 0 || dt > 0.2) return;
    const k = this.world.scale;
    const speed = Math.hypot(m.x - prev.x, m.y - prev.y) / dt;
    const cy = this.world.y - this.store.settings.size * k * 0.45;
    const d = Math.hypot(m.x - this.world.x, m.y - cy);
    const before = Math.hypot(prev.x - this.world.x, prev.y - cy);
    if (this.strokes.length > 2) return;
    if (speed > 2600 * k && d < 150 * k && d < before) {
      const s = this.store.settings;
      if (s.pinned || s.mode !== "normal" || this.world.air) return;
      if (!this.brain.event("dodge", t)) return;
      const away = m.x < this.world.x ? 1 : -1;
      this.world.leap(this.world.x + away * 170 * k, this.world.y, 0);
    }
  }
  // Pending hops/runs requested by the director, and the end of zoomies.
  private behave(now: number) {
    const s = this.store.settings;
    if (this.world.dragging || s.pinned) return;
    if (this.brain.wantRun !== null) {
      this.world.go(this.brain.wantRun, false, 2.4);
      this.brain.wantRun = null;
    }
    if (this.zoomJump && now > this.zoomJump) {
      this.zoomJump = 0;
      this.world.jump();
    }
    const hop = this.brain.wantHop;
    if (!hop) return;
    const win = this.snapshot?.windows.find((w) => w.id === hop.id);
    if (!win || now > hop.until || this.world.support?.id === hop.id) {
      this.brain.wantHop = null;
      return;
    }
    if (this.world.air) return;
    const k = this.world.scale;
    const x = Math.min(Math.max(hop.x, win.rect.left + 60 * k), win.rect.right - 60 * k);
    if (Math.abs(this.world.x - x) > 220 * k) {
      // Run under the window first.
      this.world.go(x, false, 2.4);
      return;
    }
    if (this.world.leap(x, win.rect.top)) this.brain.wantHop = null;
    else {
      // Too high for one jump: give up quietly.
      this.brain.wantHop = null;
    }
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
    const click = this.world.release(Date.now());
    this.diag.log(
      "release",
      `${reason} after ${Date.now() - this.draggingSince}ms as ${click ? "click" : "drop"} at ${Math.round(this.world.x)},${Math.round(this.world.y)} cursor ${this.cursor.x},${this.cursor.y}`,
    );
    if (click) {
      // A plain click is the quickest way to ask "how are you": level, money
      // and whatever hurts right now, straight into the balloon.
      this.sfx.play("click");
      this.brain.click(Date.now());
      this.brain.status(Date.now());
    } else {
      this.sfx.play("drop");
      if (this.world.thrown > 600 * this.world.scale) {
        this.throwAt = Date.now();
        this.brain.threw(Date.now());
      }
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
      image.width < FRAME_WIDTH * 8 ||
      image.height < FRAME_HEIGHT * 9 ||
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
      const ox = (cell % 8) * FRAME_WIDTH,
        oy = Math.floor(cell / 8) * FRAME_HEIGHT;
      let floor = FRAME_HEIGHT - 1;
      outer: for (let y = FRAME_HEIGHT - 1; y >= 0; y--) {
        for (let x = 0; x < FRAME_WIDTH; x++) {
          if (data[((oy + y) * c.width + ox + x) * 4 + 3] >= 128) {
            floor = y;
            break outer;
          }
        }
      }
      this.floors.push(floor);
      const rects: Rect[] = [];
      for (let y = 0; y < FRAME_HEIGHT; y += 2) {
        let start = -1;
        for (let x = 0; x <= FRAME_WIDTH; x += 2) {
          const filled =
            x < FRAME_WIDTH &&
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
  // One short effect per new reaction, plus a quiet blip when a new line
  // appears in the balloon.
  private reactSound() {
    const event = this.brain.reaction?.event ?? "";
    if (event && event !== this.lastReaction) {
      const map: Record<string, Sfx> = {
        levelUp: "levelup",
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
      };
      const s = map[event];
      if (s) this.sfx.play(s);
    }
    this.lastReaction = event;
    const text = this.brain.bubble?.text ?? "";
    if (text && text !== this.lastBubble) this.sfx.play("talk", 400);
    this.lastBubble = text;
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
      this.diag.log("resume", `gap ${Math.round((now - this.lastNow) / 1000)}s`);
    }
    this.lastNow = now;
    this.brain.tick(now);
    this.brain.position(this.world.x, this.world.y);
    this.reactSound();
    if (this.card && now > this.cardUntil) {
      this.hideCard();
      this.lastPose = "";
    }
    if (this.brain.workPayout(now)) {
      this.sfx.play("coin");
      this.saveGame(true);
    }
    const s = this.store.settings;
    if (this.brain.chatter(now)) this.game.loop.wake();
    if (now - this.lastGameTick >= 60000) {
      this.lastGameTick = now;
      const idle = this.snapshot?.idle ?? 0;
      const changed = this.brain.applyTick(now, {
        present: idle < 300000 && !this.brain.hidden,
        resting: ["sleep", "rest"].includes(this.lastAction),
        music: !!this.snapshot?.media.playing,
      });
      if (changed) this.saveGame(this.brain.reaction?.event === "levelUp");
    }
    if (this.brain.wantGo !== null && !this.world.dragging) {
      this.world.go(this.brain.wantGo);
      this.brain.wantGo = null;
    }
    const near =
      s.observeCursor &&
      Math.hypot(
        this.cursor.x - this.world.x,
        this.cursor.y - (this.world.y - s.size * this.world.scale * 0.45),
      ) <
        s.size * this.world.scale;
    if (near && !this.world.dragging) {
      if (!this.cursorNearSince) this.cursorNearSince = now;
      if (now - this.cursorNearSince > 900) this.brain.event("cursor", now);
      this.world.target = null;
    } else this.cursorNearSince = 0;
    let base = this.brain.action(now);
    if (s.mode === "dnd" && !this.dnd) {
      const m = monitorAt(this.monitors, this.world.x, this.world.y, s.monitor);
      const spot = this.store.memory.favorite;
      this.world.support = null;
      if (m) {
        this.world.go(
          spot?.monitor === m.id ? spot.x : m.work.right - 100,
          true,
        );
        this.world.recover(this.monitors, s.size, s.monitor);
      }
      this.world.vx = this.world.vy = 0;
    }
    this.dnd = s.mode === "dnd";
    if (!this.brain.reaction && base === "idle" && !this.world.dragging) {
      if (now > this.nextActivity) {
        const calm =
          s.activity === "calm" || ["claude", "aqua-wisp"].includes(s.pet);
        const active = s.activity === "active" || s.pet === "nezukocoder";
        // VPet-like pace: a few seconds between actions, quicker with level
        // and a good mood, slower when sick or in a poor condition.
        const wait =
          (calm ? 25000 : active ? 4000 : 9000) *
          (1.4 - this.brain.energy * 0.5) *
          this.brain.wanderFactor() *
          Math.max(0.6, 1 / (1 + 0.03 * level(this.brain.game.exp)));
        this.nextActivity = now + wait + Math.random() * wait;
        this.activityUntil = now + 3000 + Math.random() * 3500;
        const m = monitorAt(
          this.monitors,
          this.world.x,
          this.world.y,
          s.monitor,
        );
        const r = Math.random();
        const happy = this.brain.game.feeling >= 75;
        this.idleAction =
          r < 0.4
            ? "look"
            : r < 0.6
              ? "sit"
              : r < 0.75
                ? "rest"
                : r < 0.85
                  ? "jump"
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
          let target =
            this.world.x + (Math.random() - 0.5) * 450 * this.world.scale;
          if (
            s.observeCursor &&
            Math.hypot(
              this.cursor.x - this.world.x,
              this.cursor.y - this.world.y,
            ) < 260 &&
            r > 0.85
          )
            target = this.cursor.x;
          // Now and then: zoomies — sprint far, then a jump.
          if (r > 0.93 && this.brain.event("zoomies", now)) {
            const far = this.world.x < (m.work.left + m.work.right) / 2;
            this.world.go(far ? m.work.right : m.work.left, false, 2.6);
            this.zoomJump = now + 1600;
          } else this.world.go(target);
        }
      }
      if (now < this.activityUntil) base = this.idleAction;
    }
    this.behave(now);
    const action = this.world.step(
      delta / 1000,
      now,
      s,
      this.monitors,
      this.snapshot?.windows ?? [],
      base,
    );
    // Running plays the walk cycle faster: the animation clock runs ahead.
    this.animClock += delta * (this.world.running ? 2.2 : 1);
    this.bodyLanguage(now, action);
    const frame = this.animator.frame(action, this.animBase + this.animClock);
    // RequestAnimationFrame.delay is Phaser's documented timeout cadence.
    // A sleeping, stationary sprite needs only two refreshes per second.
    this.game.loop.raf.delay =
      action === "sleep" ? (this.parts.length ? 1000 / 15 : 500) : 1000 / 30;
    const size = this.snapshot?.fullscreen ? s.size * 0.75 : s.size;
    this.layout = overlayLayout(
      this.world.x,
      this.world.y,
      size,
      this.dpr,
      monitorAt(this.monitors, this.world.x, this.world.y, s.monitor),
    );
    const k = size / FRAME_WIDTH;
    const floor = ["jump", "celebrate"].includes(action)
      ? (this.floors[0] ?? FRAME_HEIGHT - 1)
      : (this.floors[frame] ?? FRAME_HEIGHT - 1);
    if (!this.assetError) {
      this.actor
        .setFrame(frame)
        .setScale(k * this.kx, k * this.ky)
        .setPosition(
          this.layout.anchorX - (size * this.kx) / 2,
          this.layout.anchorY - (floor + 1) * k * this.ky,
        );
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
    const text = this.assetError || this.brain.bubble?.text || "";
    const actions = this.assetError ? [] : (this.brain.bubble?.actions ?? []);
    if (text !== this.bubbleSeen) {
      this.bubbleSeen = text;
      this.bubbleSince = now;
    }
    this.label.setText(text);
    this.balloon.clear();
    this.bubbleRect = null;
    this.buttons.forEach((b, i) => {
      const a = actions[i];
      b.setVisible(!!a && !!text);
      if (a && b.text !== a.label) {
        b.setText(a.label);
        b.setResolution(this.dpr);
        b.frame.source.resolution = this.dpr;
      }
    });
    if (text) {
      const row = actions.length ? 32 : 0;
      const height = this.label.height + 26 + row;
      const bottom = this.layout.below
        ? this.layout.anchorY + 18 + height
        : Math.max(height + 8, this.actor.y - 12);
      this.label.setPosition(48, bottom - height + 13);
      let bx = 48;
      for (const b of this.buttons) {
        if (!b.visible) continue;
        b.setPosition(bx, bottom - row - 6);
        bx += b.width + 8;
      }
      this.bubbleRect = { left: 35, top: Math.floor(bottom - height - 8), right: 325, bottom: Math.ceil(bottom + 8) };
      this.balloon.fillStyle(0x191a1d, 0.97).lineStyle(1, 0x545c39, 0.9);
      this.balloon
        .fillRoundedRect(35, bottom - height, 290, height, 11)
        .strokeRoundedRect(35, bottom - height, 290, height, 11);
      const tail = Math.max(48, Math.min(308, this.layout.anchorX));
      if (this.layout.below)
        this.balloon.fillTriangle(
          tail - 5,
          bottom - height,
          tail + 5,
          bottom - height,
          tail,
          bottom - height - 7,
        );
      else
        this.balloon.fillTriangle(
          tail - 5,
          bottom,
          tail + 5,
          bottom,
          tail,
          bottom + 7,
        );
    }
    this.label.setVisible(!!text);
    this.drawParticles(now);
    void this.renderPose(!this.brain.hidden, frame, k, floor, !!text);
    this.saveMemory(false);
  }
  private async renderPose(
    visible: boolean,
    frame = 0,
    k = this.store.settings.size / FRAME_WIDTH,
    floor = this.floors[0] ?? FRAME_HEIGHT - 1,
    withText = false,
  ) {
    if (!this.world.initialized || this.busy) return;
    const rects = this.assetError
      ? []
      : (this.masks[frame] ?? []).map((r) => {
          const kx = k * this.kx,
            ky = k * this.ky;
          return {
            left: Math.floor(this.layout.anchorX - 96 * kx + r.left * kx),
            top: Math.floor(this.layout.anchorY - (floor + 1) * ky + r.top * ky),
            right: Math.ceil(this.layout.anchorX - 96 * kx + r.right * kx),
            bottom: Math.ceil(this.layout.anchorY - (floor + 1) * ky + r.bottom * ky),
          };
        });
    for (const p of this.parts) {
      const c =
        p.kind === "glyph"
          ? this.toScene(this.world.x + p.x, this.world.y + p.y)
          : this.toScene(p.x, p.y);
      const r = p.kind === "dust" ? p.r + 2 : 14;
      rects.push({
        left: Math.floor(c.x - r),
        top: Math.floor(c.y - r - (p.kind === "glyph" ? 6 : 0)),
        right: Math.ceil(c.x + r),
        bottom: Math.ceil(c.y + r),
      });
    }
    const card = this.cardRect();
    if (card) rects.push(card);
    if (withText && this.bubbleRect) rects.push({ ...this.bubbleRect });
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
  }
}
