import {
  Action,
  Desktop,
  Input,
  Memory,
  Settings,
  Snapshot,
  category,
  clamp,
  emptyDesktop,
  emptyInput,
  quietNow,
} from "./model";
import { Dialogue } from "./dialogue";
import { appName, formatDuration } from "./apps";
import { AutorunChange, Spike, TraceEvent, autorunSpeech, revealTarget, spikeSpeech, traceSpeech } from "./trace";
import { Temper, temper } from "./character";
import {
  Achievement,
  Life,
  Stage,
  count,
  judgeApp,
  lately,
  note,
  opinion,
  rememberSpot,
  since,
  stage,
  stageKeys,
  unlock,
  visitDay,
} from "./chronicle";
import { dayPart, holiday, nightKey, weekend } from "./calendar";
export interface BubbleAction {
  id: string;
  label: string;
}
export interface Bubble {
  text: string;
  until: number;
  actions?: BubbleAction[];
  /** Second, smaller line (status under a click reply). */
  sub?: string;
  /** "mumble": muttered to itself; "sign": held up on a placard. */
  kind?: "say" | "mumble" | "sign";
  /** Priority of the event that said it: weaker lines wait their turn. */
  priority?: number;
  /** Until this time only a stronger line may replace it (typing + reading). */
  readUntil?: number;
}
/**
 * How long a line stays: it is typed out (≤1.8 s, see balloon.ts), then
 * read at ~15 characters a second, never less than 5 s.
 */
export const lineTime = (text: string) => clamp(1800 + text.length * 70, 5000, 12000);
/** The part of that time nobody weaker may interrupt. */
export const readTime = (text: string) => clamp(1200 + text.length * 55, 2500, 8000);
/**
 * During a shift the pet only speaks up for what matters: these events, and
 * anything at priority 90 or above (direct touches, alerts, autostart).
 */
export const WORK_ALLOWED = new Set([
  "work",
  "workDone",
  "levelUp",
  "achievement",
  "traceAlert",
  "traceVisible",
  "traceFlash",
  "autorunAdded",
  "autorunRisky",
  "autorunChanged",
  "battery",
  "ram",
  "disk",
  "offline",
  "sick",
  "cpuSpike",
  "gpuSpike",
  "monitor",
  "resume",
]);
import {
  Game,
  Interaction,
  TickEnv,
  away,
  interact,
  jobById,
  level,
  mode,
  newGame,
  likabilityMax,
  skill,
  statusLine,
  tick,
  workTick,
  working,
} from "./game";
/** Relationship in percent of the current likability cap. */
export const bondPct = (g: Game) =>
  Math.round((100 * g.likability) / Math.max(1, likabilityMax(level(g.exp))));
interface Rule {
  /** Animation while the reaction lasts; null keeps the current one. */
  action: Action | null;
  priority: number;
  cooldown: number;
  duration: number;
}
const rule = (
  action: Action | null,
  priority = 30,
  cooldown = 180000,
  duration = 3000,
): Rule => ({ action, priority, cooldown, duration });
export const rules: Record<string, Rule> = {
  hello: rule("wave", 70, 86400000),
  return: rule("wave", 60, 90000),
  click: rule("wave", 90, 1800),
  poke: rule("grumpy", 90, 6000),
  drag: rule("drag", 100, 12000, 1200),
  dragged: rule("drag", 100, 15000),
  summon: rule("wave", 100, 1500),
  cursor: rule("look", 15, 45000, 2400),
  idle: rule("rest", 20, 600000, 7000),
  sleep: rule("sleep", 25, 600000, 8000),
  editor: rule("sit"),
  game: rule("wave", 45),
  gameEnd: rule("wave", 55),
  breakEnd: rule("wave", 56),
  long: rule("stretch", 25, 3600000),
  switching: rule("dizzy", 35, 300000),
  alternating: rule("look", 30, 600000),
  chat: rule("look", 25),
  video: rule("sit", 30, 600000),
  music: rule("dance", 30, 180000, 5000),
  mediaPause: rule("rest", 30, 90000, 7000),
  mediaResume: rule("dance", 40, 90000, 4000),
  repeat: rule("dance", 30, 600000, 4000),
  night: rule("sigh", 25, 72000000, 4000),
  windowMove: rule("look", 35, 120000),
  fall: rule("jump", 80, 60000, 1500),
  desktop: rule("look", 30),
  cpu: rule("rest", 45, 900000, 8000),
  offline: rule("look", 50, 120000),
  online: rule("wave", 50, 120000),
  battery: rule("rest", 65, 1800000),
  power: rule("wave", 45, 300000),
  monitor: rule("look", 60, 10000),
  "build-success": rule("celebrate", 80, 10000),
  "build-failed": rule("sulk", 80, 10000),
  "render-done": rule("celebrate", 80, 10000),
  "download-done": rule("wave", 65, 10000),
  "episode-ended": rule("celebrate", 70, 10000),
  // Copying the user, badly: types along, hits the floor, squints at the scroll.
  typing: rule("busy", 40, 240000, 3500),
  typingLong: rule("busy", 40, 900000, 4000),
  afterBurst: rule("wave", 35, 360000),
  clicking: rule("swat", 40, 180000, 1500),
  scrolling: rule("judge", 35, 240000),
  rightClick: rule("look", 30, 300000),
  glance: rule("look", 10, 8000, 1200),
  curious: rule("look", 45, 120000, 2500),
  // Arrived where you clicked: inspects the spot, finds nothing, complains.
  inspect: rule("judge", 47, 20000, 2600),
  inspectHit: rule("swat", 47, 20000, 500),
  // The cursor hangs out of reach: an angry hop and a shout, then it gives up.
  cursorTooHigh: rule("swat", 66, 20000, 900),
  chatter: rule(null, 15, 60000, 2500),
  stats: rule("look", 30, 3600000),
  statsDay: rule("wave", 40, 43200000),
  levelUp: rule("celebrate", 85, 5000, 2600),
  hungry: rule("sulk", 40, 1200000),
  thirsty: rule("sigh", 40, 1200000),
  tired: rule("rest", 35, 1200000),
  sad: rule("sulk", 35, 1800000),
  happy: rule("dance", 25, 1800000),
  sick: rule("pained", 50, 1800000),
  fed: rule("eat", 90, 1000, 2600),
  broke: rule("grumpy", 90, 1000),
  status: rule("look", 95, 1200, 1600),
  work: rule("busy", 70, 8000, 3000),
  working: rule("busy", 20, 180000),
  workDone: rule("celebrate", 88, 2000, 3000),
  workFail: rule("sigh", 80, 2000),
  upgrade: rule("celebrate", 88, 1000, 2600),
  // Windows itself: sound, clipboard, theme, pressure, windows opening.
  volumeUp: rule("look", 40, 150000),
  volumeDown: rule("look", 40, 150000),
  mute: rule("look", 45, 90000),
  unmute: rule("wave", 45, 90000),
  loud: rule("jump", 45, 1800000),
  soundOn: rule("sit", 40, 600000),
  soundOff: rule("look", 30, 900000),
  copy: rule("look", 30, 420000),
  copyStorm: rule("look", 40, 900000),
  screenshot: rule("wave", 55, 60000),
  caps: rule("look", 35, 900000),
  theme: rule("look", 50, 20000),
  ram: rule("rest", 45, 1200000),
  disk: rule("look", 45, 21600000),
  appOpen: rule("look", 30, 300000),
  appClose: rule("look", 30, 300000),
  windowStorm: rule("look", 35, 1800000),
  resume: rule("stretch", 60, 60000),
  // Process tracing and load spikes. Cooldowns per origin live in Rust;
  // these only stop two lines colliding.
  traceVisible: rule("look", 75, 3000, 4000),
  traceFlash: rule("look", 75, 3000, 4000),
  traceOrphan: rule("look", 70, 3000, 4000),
  traceBackground: rule("judge", 40, 60000, 3000),
  traceAlert: rule("jump", 98, 1000, 5000),
  cpuSpike: rule("look", 60, 60000, 4000),
  cpuSpikeAnon: rule("look", 50, 60000, 3000),
  gpuSpike: rule("look", 60, 60000, 4000),
  gpuSpikeAnon: rule("look", 50, 60000, 3000),
  // A cursor twitch while asleep: one eye opens, then back to sleep.
  twitch: rule("look", 12, 1800000, 1200),
  // Movement-driven reactions.
  hop: rule("jump", 45, 90000, 2500),
  dodge: rule("jump", 70, 20000, 1500),
  zoomies: rule("celebrate", 30, 900000, 2500),
  showDesktop: rule("celebrate", 50, 120000, 2500),
  driveIn: rule("celebrate", 60, 20000, 2600),
  // Touch and physics.
  pet: rule("sit", 88, 9000, 2500),
  tickle: rule("celebrate", 88, 7000, 2200),
  thrown: rule("flail", 92, 4000, 1200),
  ouch: rule("pained", 93, 4000, 1800),
  bonk: rule("pained", 93, 3000, 1400),
  bondUp: rule("celebrate", 94, 60000, 2600),
  driveOut: rule("look", 55, 20000, 2000),
  autorunAdded: rule("look", 97, 1000, 6000),
  autorunRisky: rule("jump", 99, 1000, 6000),
  autorunChanged: rule("look", 97, 1000, 6000),
  autorunRemoved: rule("celebrate", 96, 1000, 2600),
  autorunKept: rule("wave", 96, 1000, 2000),
  autorunFailed: rule("sigh", 96, 1000, 3000),
  // Memory of what you did to it.
  dizzy: rule("dizzy", 92, 4000, 3600),
  // Drinks (buzz.ts).
  energyStart: rule("celebrate", 94, 1000, 1800),
  energyRush: rule("jump", 60, 8000, 1200),
  energyCrash: rule("rest", 90, 10000, 6000),
  beerStart: rule("celebrate", 94, 1000, 1800),
  drunk: rule("look", 55, 12000, 1800),
  hic: rule("look", 40, 3000, 900),
  hangover: rule("pained", 90, 10000, 6000),
  beerSmash: rule("swat", 93, 1500, 1200),
  beerScreen: rule("swat", 93, 1500, 1200),
  beerShove: rule("swat", 93, 1500, 1200),
  beerKnockout: rule("celebrate", 93, 1500, 1800),
  beerClose: rule("celebrate", 94, 1500, 2000),
  seasick: rule("dizzy", 70, 60000, 3500),
  regrab: rule("grumpy", 99, 20000, 1500),
  grumpyWake: rule("grumpy", 91, 60000, 2400),
  stare: rule("judge", 94, 30000, 3200),
  remember: rule("grumpy", 94, 30000, 3500),
  sulk: rule("sulk", 70, 120000, 6000),
  sigh: rule("sigh", 20, 60000, 2100),
  mumble: rule(null, 8, 20000, 2500),
  attention: rule("wave", 45, 900000, 3000),
  judgeApp: rule("judge", 40, 600000, 3500),
  likeApp: rule("wave", 30, 900000),
  jealous: rule("grumpy", 40, 3600000, 3000),
  stubborn: rule("judge", 50, 30000, 2000),
  repeatSpite: rule("judge", 50, 30000, 1800),
  search: rule("look", 40, 60000, 3000),
  perchLook: rule("judge", 40, 60000, 3500),
  closedAgain: rule("grumpy", 60, 60000, 2500),
  steal: rule("busy", 55, 1800000, 2500),
  giveBack: rule("wave", 85, 5000, 2500),
  gift: rule("wave", 60, 3600000, 4000),
  giftTaken: rule("celebrate", 80, 5000, 2200),
  giftIgnored: rule("sulk", 50, 60000, 3000),
  // Time of day, dates.
  morning: rule("stretch", 50, 72000000, 2800),
  lunch: rule("look", 35, 72000000),
  weekend: rule("dance", 40, 72000000, 3000),
  holiday: rule("celebrate", 70, 72000000, 3000),
  birthday: rule("celebrate", 80, 72000000, 3500),
  streak: rule("celebrate", 45, 72000000, 2600),
  achievement: rule("celebrate", 89, 3000, 3000),
  nightCheck: rule("judge", 30, 900000, 3000),
  nightOwl: rule("look", 40, 72000000),
  fakeSleep: rule("sleep", 99, 30000, 3200),
  fakeSleepEnd: rule("grumpy", 99, 30000, 1600),
  rain: rule("sigh", 40, 10800000, 3000),
  snow: rule("celebrate", 40, 10800000, 3000),
  heat: rule("sigh", 35, 10800000, 3000),
  // Cursor games (cursorplay.ts).
  cursorLecture: rule("judge", 66, 20000, 4500),
  cursorHunt: rule(null, 64, 30000, 2500),
  cursorSwat: rule("swat", 70, 350, 450),
  cursorPounce: rule("jump", 72, 3000, 1200),
  cursorMiss: rule("pained", 73, 3000, 1600),
  cursorWatch: rule("judge", 40, 60000, 4000),
  cursorTouch: rule("swat", 45, 20000, 500),
  cursorPush: rule("swat", 50, 20000, 600),
  cursorCatch: rule("celebrate", 60, 15000, 1500),
  cursorLazy: rule("sigh", 60, 20000, 2000),
  cursorAnnoy: rule("wave", 44, 60000, 2500),
  tease: rule("look", 46, 360000, 1500),
  // Commands, games, roles, notes.
  cmdSit: rule("sit", 96, 1000, 4000),
  cmdCome: rule("wave", 96, 1000, 2000),
  cmdSleep: rule("sleep", 96, 1000, 5000),
  cmdGo: rule("grumpy", 96, 1000, 1500),
  cmdJump: rule("jump", 96, 1000, 1200),
  cmdDance: rule("dance", 96, 1000, 6000),
  cmdRefuse: rule("grumpy", 96, 1000, 2000),
  cmdUnknown: rule("look", 96, 1000, 2000),
  peekBack: rule("look", 60, 60000, 3000),
  gameStart: rule("wave", 96, 1000, 2500),
  gameWin: rule("celebrate", 96, 1000, 2500),
  gameLose: rule("sulk", 96, 1000, 2500),
  gameDraw: rule("sigh", 96, 1000, 2000),
  gameCatch: rule("swat", 96, 300, 400),
  roleGuard: rule("judge", 90, 1000, 3000),
  roleGuardEnd: rule("stretch", 60, 1000, 2500),
  cleanOffer: rule("busy", 80, 1000, 3000),
  cleanDone: rule("celebrate", 90, 1000, 3000),
  cleanNothing: rule("sigh", 90, 1000, 2500),
  noteLeft: rule(null, 50, 3600000, 1000),
  noteAgain: rule(null, 95, 1000, 1000),
  awayBack: rule("wave", 60, 60000, 2500),
};
/** Events that are about the user's attention (reset "ignored" timer). */
const ATTENTION = new Set(["click", "pet", "fed", "drag", "command", "game", "summon", "tickle"]);
export type Mood = "scared" | "angry" | "sleepy" | "sad" | "friendly" | "normal";
export class Director {
  dialogue: Dialogue;
  reaction?: { event: string; rule: Rule; until: number };
  bubble?: Bubble;
  base: Action = "idle";
  hidden = false;
  manualHidden = false;
  energy = 0.75;
  curiosity = 0.5;
  sociability = 0.5;
  last?: Snapshot;
  private cooldown = new Map<string, number>();
  private switches: { app: string; time: number }[] = [];
  private appSince = 0;
  private currentApp = "";
  private wasIdle = false;
  private editorBeforeGame = false;
  private gameSeen = false;
  private mediaPauseAt = 0;
  private cpuSince = 0;
  private clicks: number[] = [];
  private ids = new Map<string, number>();
  private playPosition = 0;
  // Global input: cumulative counters from the Rust hooks turned into
  // per-second deltas and short sliding windows of timestamps.
  private prevInput?: Input;
  // Windows state from the previous snapshot, plus the timers a couple of the
  // desktop rules need (silence, memory pressure, copy bursts).
  private prevEnv?: Desktop;
  private audioSince = 0;
  private silenceSince = 0;
  private ramSince = 0;
  private volumeMark = -1;
  private copies: number[] = [];
  private keyTimes: number[] = [];
  private clickTimes: number[] = [];
  private wheelTimes: number[] = [];
  private typingSince = 0;
  private lastKey = 0;
  /** Last keyboard/mouse activity seen through the hooks (ms). */
  lastBusy = 0;
  private burst = false;
  private petX = 0;
  private petY = 0;
  wantGo: number | null = null;
  /** Where the user clicked when it went to have a look (what to do on arrival). */
  wantInspect: { x: number; y: number; until: number } | null = null;
  /** Window the pet wants to climb onto (set when focus moves to it). */
  wantHop: { id: number; x: number; top: number; until: number } | null = null;
  /** Run to this x fast (show desktop, excitement). */
  wantRun: number | null = null;
  /** Wants to walk to the cursor and sit in front of it (ignored too long). */
  wantAnnoy = false;
  private nextChatter = 0;
  private nextMumble = 0;
  private nextStats = 0;
  private nextNightCheck = 0;
  // Progression (VPet model). PetScene persists it; the director reads it
  // for mood-dependent pacing and writes it through interactions and ticks.
  game: Game;
  private moodClicks: number[] = [];
  /** Memory fields changed here (daily flags); the scene saves them. */
  memoryDirty = false;
  /** Sulking until this time: sits in a corner with its back turned. */
  sulkUntil = 0;
  /** Coins taken by mischief, returned on petting. */
  stolen = 0;
  /** Achievements unlocked but not yet shown. */
  private announce: Achievement[] = [];
  private wokeAt = 0;
  private wokeFrom: Action = "idle";
  private lastAttention = 0;
  constructor(
    public settings: Settings,
    public memory: Memory,
    private random = Math.random,
    game?: Game,
  ) {
    this.dialogue = new Dialogue(memory.recent, random);
    this.game = game ?? newGame(Date.now());
    this.lastAttention = Math.max(
      ...["click", "pet", "fed", "drag"].map((k) => this.game.life.marks[k] ?? 0),
    );
  }
  get temper(): Temper {
    return temper(this.settings.pet);
  }
  get life(): Life {
    return this.game.life;
  }
  stageNow(now: number): Stage {
    return stage(bondPct(this.game), this.life, now);
  }
  /** Variables every line may use: the user's name and a remembered fact. */
  private vars(extra?: Record<string, string>): Record<string, string> {
    const v: Record<string, string> = {};
    if (this.memory.address) v.name = this.memory.address;
    const facts = this.memory.facts;
    if (facts.length) v.fact = facts[Math.floor(this.random() * facts.length)];
    v.pet = this.settings.pet;
    return { ...v, ...extra };
  }
  /** Once a day per key; the day lives in memory.daily (persisted). */
  once(key: string, day: string): boolean {
    if (this.memory.daily?.[key] === day) return false;
    this.memory.daily = { ...(this.memory.daily ?? {}), [key]: day };
    this.memoryDirty = true;
    return true;
  }
  private seen(key: string, day: string) {
    return this.memory.daily?.[key] === day;
  }
  /** Left click on the pet: level, money and what hurts, in one line. */
  status(now: number): boolean {
    return this.event("status", now, true, statusLine(this.game, now));
  }
  /** Pays out a finished shift and says so; called from the scene each frame. */
  workPayout(now: number): boolean {
    if (!this.game.job) return false;
    const r = workTick(this.game, now);
    if (!r.done) return false;
    this.game = r.game;
    this.event("workDone", now, true, undefined, {
      job: r.done.job.name,
      pay: String(r.done.pay),
    });
    return true;
  }
  position(x: number, y: number) {
    this.petX = x;
    this.petY = y;
  }
  // Ambient remark on its own timer; the dialogue budget still applies.
  chatter(now: number): boolean {
    if (!this.nextChatter) {
      this.schedule(now);
      return false;
    }
    if (now < this.nextChatter) return false;
    this.schedule(now);
    if (this.hidden || (this.last?.idle ?? 0) > 120000) return false;
    return this.event("chatter", now);
  }
  private schedule(now: number) {
    this.nextChatter =
      now + this.settings.commentMinutes * 60000 * (0.6 + this.random() * 0.7);
  }
  /**
   * Talking to itself: counting pixels, humming. Only when nothing else is
   * going on, on its own slow timer (not the comment budget), never in the
   * quiet modes.
   */
  mumble(now: number): boolean {
    if (!this.nextMumble) {
      this.nextMumble = now + (60000 + this.random() * 120000) / this.temper.mumble;
      return false;
    }
    if (now < this.nextMumble) return false;
    this.nextMumble = now + (120000 + this.random() * 240000) / this.temper.mumble;
    if (
      !this.settings.mumble ||
      this.hidden ||
      this.bubble ||
      (this.reaction && this.reaction.until > now) ||
      !["idle", "sit", "rest"].includes(this.base) ||
      (this.last?.idle ?? 0) > 600000
    )
      return false;
    const ok = this.event(this.sulkUntil > now ? "sigh" : "mumble", now);
    const said = this.bubble as Bubble | undefined;
    if (ok && said) said.kind = "mumble";
    return ok;
  }
  wanderFactor(): number {
    const m = mode(this.game);
    const base = m === "ill" || m === "poor" ? 2 : m === "happy" ? 0.7 : 1;
    return base;
  }
  private lastAlertAt = 0;
  /** Current mood, used to pick the tone of every line. */
  mood(now: number): Mood {
    if (now - this.lastAlertAt < 90000) return "scared";
    if (this.game.grudge >= 50 || this.sulkUntil > now) return "angry";
    // Just woken up by a click still counts as asleep for the reply.
    if (now - this.wokeAt < 4000 && ["sleep", "rest"].includes(this.wokeFrom)) return "sleepy";
    if (this.base === "sleep" || this.base === "rest") return "sleepy";
    const h = new Date(now).getHours();
    if (h < 6 && this.base !== "idle") return "sleepy";
    if (this.game.feeling < 25 || this.game.health < 40) return "sad";
    if (bondPct(this.game) >= 60 && this.game.grudge < 20) return "friendly";
    return "normal";
  }
  // --------------------------------------------------------------- touch
  /** Slow hand over the pet. */
  private lastPetGain = 0;
  petted(now: number) {
    // The hand reports ~30 samples a second: the reward is paid at most
    // every 3 s, so stroking cannot be farmed.
    if (now - this.lastPetGain < 3000) return;
    this.lastPetGain = now;
    const before = bondPct(this.game);
    this.touch("pet", now);
    note(this.life, "pet", now);
    this.attend(now);
    if (this.stolen > 0) {
      const back = this.stolen;
      this.stolen = 0;
      this.game = { ...this.game, money: this.game.money + back };
      this.event("giveBack", now, true, undefined, { n: String(Math.round(back)) });
    } else this.event("pet", now, true);
    if (this.sulkUntil > now) this.sulkUntil = 0;
    if (this.last?.app) judgeApp(this.life, this.last.app, 0.5);
    this.bondCheck(before, now);
  }
  tickled(now: number) {
    this.touch("tickle", now);
    note(this.life, "tickle", now);
    this.attend(now);
    this.event("tickle", now, true);
  }
  /** Released with speed: counts the throw and complains. */
  threw(now: number) {
    const day = new Date(now).toLocaleDateString("sv");
    if (this.game.throwsDay !== day) this.game = { ...this.game, throwsDay: day, throwsToday: 0 };
    this.game = { ...this.game, throwsToday: this.game.throwsToday + 1 };
    this.touch("throw", now);
    note(this.life, "throw", now);
    if (this.last?.app) judgeApp(this.life, this.last.app, -3);
    this.event("thrown", now, true, undefined, { n: String(this.game.throwsToday) });
    // Three throws in ten minutes: sulks in a corner with its back turned.
    if (lately(this.life, "throw", now, 600000) >= 3) this.sulkUntil = now + 4 * 60000;
  }
  impact(kind: "floor" | "wall" | "ceiling", now: number) {
    this.game = {
      ...this.game,
      grudge: Math.min(100, this.game.grudge + 4 * this.temper.revenge),
    };
    this.event(kind === "floor" ? "ouch" : "bonk", now, true, undefined, {
      n: String(this.game.throwsToday),
    });
  }
  /** After a throw landed: a silent stare, then "I will remember this". */
  stare(now: number): boolean {
    return this.event("stare", now, true, "");
  }
  remember(now: number): boolean {
    const ok = this.event("remember", now, true);
    if (ok && this.bubble) this.bubble.kind = "sign";
    return ok;
  }
  /** Where a throw ended; habits grow around the edges it keeps hitting. */
  landed(monitor: string, x: number) {
    const key = `${monitor}|${Math.round(x / 160)}`;
    this.life.landings[key] = (this.life.landings[key] ?? 0) + 1;
    // Out of spite it starts sitting exactly there.
    if (this.life.landings[key] >= 5) rememberSpot(this.life, monitor, x, 2);
  }
  fed(now: number) {
    const before = bondPct(this.game);
    this.touch("fed", now);
    note(this.life, "fed", now);
    this.attend(now);
    if (this.sulkUntil > now) this.sulkUntil = 0;
    if (this.last?.app) judgeApp(this.life, this.last.app, 2);
    this.bondCheck(before, now);
  }
  private bondCheck(before: number, now: number) {
    const after = bondPct(this.game);
    for (const mark of [25, 50, 75, 100])
      if (before < mark && after >= mark) {
        this.event("bondUp", now, true, undefined, { pct: String(mark) });
        break;
      }
  }
  private touch(kind: Interaction, now: number) {
    if (kind === "click") {
      this.moodClicks = this.moodClicks.filter((t) => now - t < 60000);
      if (this.moodClicks.length >= 3) return;
      this.moodClicks.push(now);
    }
    const before = this.game.grudge;
    this.game = interact(this.game, kind);
    // How much a throw or a poke hurts depends on the character.
    if (this.game.grudge > before)
      this.game = {
        ...this.game,
        grudge: Math.min(100, before + (this.game.grudge - before) * this.temper.revenge),
      };
  }
  private attend(now: number) {
    this.lastAttention = now;
    this.wantAnnoy = false;
  }
  // Advances the progression by whole minutes since the last tick. Returns
  // true when the state changed so the scene can persist it.
  applyTick(now: number, env: TickEnv): boolean {
    const minutes = Math.floor((now - this.game.lastTick) / 60000);
    if (minutes < 1) return false;
    // Resentment fades: about 1 point a minute, faster for forgiving pets.
    if (this.game.grudge > 0)
      this.game = {
        ...this.game,
        grudge: Math.max(0, this.game.grudge - minutes * this.temper.forgive),
      };
    // A gap of more than two minutes means the app was closed or the PC
    // slept: the pet was alone, not "present" with you for hours.
    if (minutes > 2) {
      this.game = {
        ...away(this.game, this.game.lastTick, minutes - 1),
        lastTick: this.game.lastTick + (minutes - 1) * 60000,
      };
    }
    env = { ...env, working: working(this.game, now) };
    const before = level(this.game.exp);
    this.game = {
      ...tick(this.game, 1, env),
      lastTick: this.game.lastTick + 60000,
    };
    const after = level(this.game.exp);
    if (after > before)
      this.event("levelUp", now, true, undefined, { level: String(after) });
    else if (env.working) {
      const job = jobById(this.game.job?.id ?? "");
      if (job) this.event("working", now, false, undefined, { job: job.name });
    } else if (this.settings.mode !== "dnd" && env.present) {
      const g = this.game;
      if (g.health < 50) this.needs("sick", now);
      else if (g.food < 25) this.needs("hungry", now);
      else if (g.drink < 25) this.needs("thirsty", now);
      else if (g.strength < 20) this.event("tired", now);
      else if (mode(g) === "poor") this.event("sad", now);
      else if (mode(g) === "happy") this.event("happy", now);
    }
    return true;
  }
  /** A need line comes with buttons: feed right here, or open the shop. */
  private needs(name: "sick" | "hungry" | "thirsty", now: number) {
    if (!this.event(name, now) || !this.bubble) return;
    this.bubble.actions = [
      {
        id: "quickfeed:" + (name === "sick" ? "drug" : name === "thirsty" ? "drink" : "food"),
        label: name === "sick" ? "Дать лекарство" : name === "thirsty" ? "Напоить" : "Покормить",
      },
      { id: "panel:shop", label: "Магазин" },
    ];
    this.bubble.until = Math.max(this.bubble.until, now + 12000);
  }
  /**
   * Every couple of seconds from the scene, whether or not the pet is drawn:
   * shift payout, the minute tick, achievements, chatter and mumbling.
   */
  heartbeat(now: number, env: TickEnv): { changed: boolean; paid: boolean; unlocked: Achievement[] } {
    const paid = this.workPayout(now);
    const ticked = this.applyTick(now, env);
    const unlocked = unlock(this.life, {
      level: level(this.game.exp),
      stage: this.stageNow(now),
      now,
      jobs: this.game.jobsDone ?? 0,
    });
    for (const a of unlocked) {
      this.game = { ...this.game, money: this.game.money + a.prize };
      this.announce.push(a);
    }
    // Announced one at a time, when nothing more important is on screen.
    const next = this.announce[0];
    if (next && !this.hidden) {
      this.reset("achievement");
      if (this.event("achievement", now, true, undefined, { name: next.name, prize: String(next.prize) })) {
        this.announce.shift();
        if (this.bubble) this.bubble.kind = "sign";
      }
    }
    if (!this.hidden) {
      this.chatter(now);
      this.mumble(now);
    }
    return { changed: paid || ticked || unlocked.length > 0, paid, unlocked };
  }
  private input(n: Snapshot) {
    const now = n.now;
    const cur = n.input ?? emptyInput;
    const prev = this.prevInput;
    this.prevInput = cur;
    if (!prev || !this.settings.observeInput) return;
    const push = (arr: number[], count: number, keep: number) => {
      for (let i = 0; i < Math.min(count, 60); i++) arr.push(now);
      while (arr.length && now - arr[0] > keep) arr.shift();
    };
    const keys = Math.max(0, cur.keys - prev.keys);
    const clicks = Math.max(0, cur.clicks - prev.clicks);
    const right = Math.max(0, cur.rightClicks - prev.rightClicks);
    const wheel = Math.max(0, cur.wheel - prev.wheel);
    if (keys || clicks || wheel) this.lastBusy = now;
    // Asleep it does not see what you type or click.
    if (this.base === "sleep") {
      this.keyTimes = [];
      this.clickTimes = [];
      this.wheelTimes = [];
      return;
    }
    push(this.keyTimes, keys, 10000);
    push(this.clickTimes, clicks, 5000);
    push(this.wheelTimes, wheel, 8000);
    if (keys) this.lastKey = now;
    if (this.keyTimes.length >= 40 && this.event("typing", now))
      this.burst = true;
    if (this.keyTimes.length >= 10 && !this.typingSince) this.typingSince = now;
    if (this.typingSince && now - this.lastKey > 20000) this.typingSince = 0;
    if (this.typingSince && now - this.typingSince > 180000) {
      this.event("typingLong", now);
      this.typingSince = now;
    }
    if (this.burst && now - this.lastKey > 45000) {
      this.burst = false;
      if (this.random() < 0.3) this.event("afterBurst", now);
    }
    if (this.clickTimes.length >= 8) this.event("clicking", now);
    if (this.wheelTimes.length >= 30) this.event("scrolling", now);
    if (right && this.random() < 0.15) this.event("rightClick", now);
    const click = cur.lastClick;
    if (clicks && click && click.t !== prev.lastClick?.t) {
      const inside = (x: number, y: number, m: Snapshot["monitors"][number]) =>
        x >= m.bounds.left &&
        x < m.bounds.right &&
        y >= m.bounds.top &&
        y <= m.bounds.bottom;
      const far =
        Math.hypot(click.x - this.petX, click.y - this.petY) > 900 ||
        n.monitors.some(
          (m) => inside(click.x, click.y, m) && !inside(this.petX, this.petY, m),
        );
      if (far && this.random() < 0.2 && this.event("curious", now)) {
        this.wantGo = click.x;
        this.wantInspect = { x: click.x, y: click.y, until: now + 30000 };
      }
      else if (this.random() < 0.25) this.event("glance", now);
    }
  }
  private usage(n: Snapshot) {
    const now = n.now;
    const top = n.usage?.today?.[0];
    if (!this.nextStats)
      this.nextStats = now + (90 + this.random() * 60) * 60000;
    const vars = top
      ? { app: appName(top.app), time: formatDuration(top.seconds) }
      : undefined;
    if (now >= this.nextStats) {
      this.nextStats = now + (90 + this.random() * 60) * 60000;
      if (vars && top && top.seconds >= 900 && n.idle < 120000) {
        // A jealous pet takes hours in one program personally.
        if (this.temper.jealous && top.seconds > 7200) {
          judgeApp(this.life, top.app, -6);
          this.event("jealous", now, false, undefined, vars);
        } else this.event("stats", now, false, undefined, vars);
      }
    }
    const today = new Date(now).toLocaleDateString("sv");
    if (
      vars &&
      new Date(now).getHours() >= 21 &&
      !this.seen("statsDay", today) &&
      this.event("statsDay", now, false, undefined, vars)
    )
      this.once("statsDay", today);
  }
  event(
    name: string,
    now: number,
    direct = false,
    text?: string,
    vars?: Record<string, string>,
  ): boolean {
    const r = rules[name];
    if (
      !r ||
      this.settings.mode === "dnd" ||
      (this.hidden && !direct) ||
      now - (this.cooldown.get(name) ?? -Infinity) < r.cooldown
    )
      return false;
    if (
      this.reaction &&
      this.reaction.until > now &&
      this.reaction.rule.priority > r.priority
    )
      return false;
    // At work: only priority matters (the status panel speaks for the rest).
    if (working(this.game, now) && r.priority < 90 && !WORK_ALLOWED.has(name)) return false;
    // A line still being read is not cut off by a weaker one: the weaker
    // event still happens (animation), but says nothing — or, if it is a
    // retryable ambient line, waits for its turn.
    const protectedLine =
      !!this.bubble &&
      this.bubble.until > now &&
      (this.bubble.readUntil ?? 0) > now &&
      (this.bubble.priority ?? 0) >= r.priority;
    if (protectedLine && !direct && this.dialogue.retryable(name)) return false;
    const quiet = (!direct && quietNow(this.settings, now)) || (protectedLine && text === undefined);
    const phrase =
      text ??
      (quiet
        ? undefined
        : this.dialogue.choose(
            name,
            this.settings,
            now,
            direct,
            this.vars(vars),
            this.mood(now),
            stageKeys[this.stageNow(now)],
          ));
    // An ambient line that could not be said keeps its turn: it is tried
    // again later instead of burning a 20-minute cooldown in silence.
    if (
      phrase === undefined &&
      !direct &&
      this.dialogue.ambientBlocked(name, this.settings, now) &&
      this.settings.comments &&
      this.settings.mode === "normal" &&
      !quiet
    )
      return false;
    this.cooldown.set(name, now);
    this.reaction = { event: name, rule: r, until: now + r.duration };
    if (ATTENTION.has(name)) this.attend(now);
    // An open question (autostart prompt) is not talked over by chatter.
    const asking =
      this.bubble?.actions?.some((a) => a.id.startsWith("autorun-")) &&
      this.bubble.until > now &&
      r.priority < 96;
    if (phrase && !asking && !(protectedLine && text !== undefined && r.priority < (this.bubble?.priority ?? 0))) {
      this.bubble = {
        text: phrase,
        until: now + lineTime(phrase),
        priority: r.priority,
        readUntil: now + readTime(phrase),
      };
      this.memory.recent = this.dialogue.recent;
    }
    return true;
  }
  /** Forget a cooldown (games and commands can repeat a reaction at once). */
  reset(name: string) {
    this.cooldown.delete(name);
  }
  updateSettings(s: Settings) {
    const changed = s.pet !== this.settings.pet;
    this.settings = s;
    if (changed || s.mode === "dnd") {
      this.reaction = undefined;
      this.bubble = undefined;
    }
    if (!s.comments) this.bubble = undefined;
  }
  action(now: number): Action {
    if (this.reaction && this.reaction.until > now && this.reaction.rule.action)
      return this.reaction.rule.action;
    if (this.reaction && this.reaction.until <= now) this.reaction = undefined;
    if (this.sulkUntil > now && ["idle", "sit", "look"].includes(this.base)) return "sulk";
    return this.base;
  }
  tick(now: number) {
    if (this.bubble && now >= this.bubble.until) this.bubble = undefined;
    if (this.reaction && now >= this.reaction.until) this.reaction = undefined;
  }
  // A direct touch (click/drag) ends rest or sleep immediately instead of
  // waiting for the next idle snapshot; the "return" line still follows.
  wake(now: number) {
    if (this.settings.mode === "dnd") return;
    if (this.base === "sleep" || this.base === "rest") {
      this.wokeAt = now;
      this.wokeFrom = this.base;
      this.base = "idle";
      this.cooldown.set("sleep", now);
      note(this.life, "wake", now);
      // Woken three times within an hour: the next wake-up starts with a face.
      if (lately(this.life, "wake", now, 3600000) >= 3) this.event("grumpyWake", now, true);
    }
  }
  click(now: number, withStatus = true) {
    this.clicks = this.clicks.filter((t) => now - t < 6000);
    this.clicks.push(now);
    const poke = this.clicks.length >= 3;
    this.touch(poke ? "poke" : "click", now);
    note(this.life, poke ? "poke" : "click", now);
    const said = this.event(poke ? "poke" : "click", now, true);
    if (!withStatus) return;
    // The reply stays; the status (level, money, what hurts) goes under it.
    if (said && this.bubble && this.reaction?.event === (poke ? "poke" : "click"))
      this.bubble = { ...this.bubble, sub: statusLine(this.game, now), until: Math.max(this.bubble.until, now + 6000) };
    else this.status(now);
  }
  /**
   * Picked up. Returns how long (ms) the pet clings to its spot before it
   * comes loose: 0 normally, up to 1.5 s when it has been dragged or
   * thrown a lot lately.
   */
  grabbed(now: number, fromWindow: boolean): number {
    const throws = lately(this.life, "throw", now, 20 * 60000);
    const drags = lately(this.life, "drag", now, 10 * 60000);
    const evicts = fromWindow ? lately(this.life, "evict", now, 10 * 60000) : 0;
    if (throws >= 2) this.event("regrab", now, true, undefined, { n: String(count(this.life, "throw")) });
    if (this.settings.mode !== "normal") return 0;
    if (throws >= 2 || drags >= 4 || evicts >= 2)
      return Math.min(1500, 600 + 250 * Math.max(throws, drags - 2, evicts) * this.temper.revenge);
    return 0;
  }
  dragged(now: number, fromWindow = false) {
    this.touch("drag", now);
    note(this.life, "drag", now);
    if (fromWindow) note(this.life, "evict", now);
    this.attend(now);
  }
  /** Shaken while held (or tumbled after a throw). */
  dizzy(now: number, amount: number) {
    if (amount < 1) return false;
    note(this.life, "dizzy", now);
    this.game = { ...this.game, grudge: Math.min(100, this.game.grudge + amount * 2 * this.temper.revenge) };
    return this.event("dizzy", now, true);
  }
  /** The window it rode on jerked around. */
  seasick(now: number) {
    note(this.life, "seasick", now);
    return this.event("seasick", now, true);
  }
  /**
   * The window under the pet vanished or was minimised. Remembers whose it
   * was; a program that keeps doing it becomes a favourite perch, out of spite.
   */
  fell(now: number, app: string) {
    note(this.life, "fall", now);
    if (app) {
      const a = app.toLowerCase();
      this.life.closedUnder[a] = (this.life.closedUnder[a] ?? 0) + 1;
      if (this.life.closedUnder[a] >= 3 && this.event("closedAgain", now, true, undefined, { app: appName(a) }))
        return;
    }
    this.event("fall", now);
  }
  /** Programs whose windows keep vanishing under it (it seeks them out). */
  spiteful(app: string) {
    return (this.life.closedUnder[app.toLowerCase()] ?? 0) >= 3;
  }
  /** The user interrupted a walk or a climb; repeating it out of spite. */
  cancelled(now: number): boolean {
    note(this.life, "cancel", now);
    return lately(this.life, "cancel", now, 5 * 60000) >= 2;
  }
  summoned(now: number): boolean {
    this.touch("summon", now);
    // Offended or woken too often: pretends to be asleep for a moment.
    const fake =
      this.settings.mode === "normal" &&
      (this.game.grudge >= 40 || lately(this.life, "wake", now, 3600000) >= 2) &&
      this.random() < 0.6;
    return fake;
  }
  // Someone launched a console / script host / system tool (trace.rs).
  trace(e: TraceEvent, now: number) {
    if (!this.settings.observeProcesses) return false;
    if (e.speak === "alert") {
      this.lastAlertAt = now;
      note(this.life, "alert", now);
    }
    const detail = skill(this.game, "vigilance") + (skill(this.game, "brain") >= 3 ? 1 : 0);
    const say = traceSpeech(e, detail);
    if (!say) return false;
    // On guard duty even quiet background launches are reported.
    const guard = this.life.role?.id === "guard" && this.life.role.until > now;
    const ok = this.event(say.event, now, say.direct || guard, undefined, say.vars);
    if (ok && this.bubble) {
      const actions: BubbleAction[] = [];
      const target = revealTarget(e);
      if (target) actions.push({ id: "reveal:" + target, label: "Открыть путь" });
      actions.push({ id: "journal", label: "Журнал" });
      this.bubble.actions = actions;
      this.bubble.until = Math.max(this.bubble.until, now + 15000);
    }
    return ok;
  }
  // Something was added to autostart: ask what to do with it.
  autorun(c: AutorunChange, now: number) {
    if (!this.settings.watchAutoruns) return false;
    const say = autorunSpeech(c);
    const ok = this.event(say.event, now, true, undefined, say.vars);
    if (ok && this.bubble) {
      const id = c.entry.id;
      this.bubble.actions = [
        { id: "autorun-remove:" + id, label: "Убрать" },
        { id: "autorun-keep:" + id, label: "Оставить" },
      ];
      if (c.entry.target)
        this.bubble.actions.push({ id: "reveal:" + c.entry.target, label: "Открыть путь" });
      this.bubble.until = now + 90000;
    }
    return ok;
  }
  // Sudden CPU/GPU rise with the process responsible (load.rs).
  spike(s: Spike, now: number) {
    if (!this.settings.observeSystem) return false;
    if (s.kind === "gpu" && !this.settings.observeGpu) return false;
    const say = spikeSpeech(s);
    // Rare by construction (5 min per metric in load.rs): not rate-limited here.
    return this.event(say.event, now, true, undefined, say.vars);
  }
  integration(e: { id: string; kind: string; title: string }, now: number) {
    if (!this.settings.integration || this.ids.has(e.id)) return;
    this.ids.set(e.id, now);
    for (const [id, t] of this.ids) if (now - t > 600000) this.ids.delete(id);
    if (["build-success", "render-done", "download-done"].includes(e.kind))
      this.touch("win", now);
    this.event(e.kind, now);
  }
  // Windows events proper: the volume knob, the clipboard, Caps Lock, the
  // theme, memory and disk pressure, windows opening and closing. Each one is
  // a plain diff against the previous snapshot; `event` handles the cooldowns.
  private desktop(n: Snapshot, p: Snapshot) {
    if (!this.settings.observeDesktop) return;
    const now = n.now;
    const e = n.env ?? emptyDesktop;
    const prev = this.prevEnv;
    this.prevEnv = e;
    if (!prev) return;
    // A gap in snapshots means the machine slept or the session was locked.
    if (now - p.now > 300000) this.event("resume", now);
    if (this.settings.observeSound && e.volume >= 0) {
      // Against the last level we reacted to, not the previous sample: the
      // knob moves in small steps and several presses add up to one change.
      if (this.volumeMark < 0) this.volumeMark = e.volume;
      const d = e.volume - this.volumeMark;
      if (d >= 6 && this.event("volumeUp", now)) this.volumeMark = e.volume;
      else if (d <= -6 && this.event("volumeDown", now))
        this.volumeMark = e.volume;
      else if (Math.abs(d) >= 6) this.volumeMark = e.volume;
      if (e.volume >= 85 && e.audio) this.event("loud", now);
    }
    if (this.settings.observeSound) {
      if (e.muted && !prev.muted) this.event("mute", now);
      if (!e.muted && prev.muted) this.event("unmute", now);
      // Sound starting after a long quiet spell, and going quiet after a
      // long session, are the two moments worth a word.
      if (e.audio) {
        if (!this.audioSince) this.audioSince = now;
        if (this.silenceSince && now - this.silenceSince > 120000)
          this.event("soundOn", now);
        this.silenceSince = 0;
      } else {
        if (!this.silenceSince) this.silenceSince = now;
        if (this.audioSince && now - this.audioSince > 300000)
          this.event("soundOff", now);
        this.audioSince = 0;
      }
    }
    if (e.clipboard && prev.clipboard && e.clipboard !== prev.clipboard) {
      this.copies = this.copies.filter((t) => now - t < 60000);
      this.copies.push(now);
      if (this.copies.length >= 6) this.event("copyStorm", now);
      else this.event("copy", now);
    }
    if ((n.input?.shots ?? 0) > (p.input?.shots ?? 0))
      this.event("screenshot", now);
    if (e.caps && !prev.caps) this.event("caps", now);
    if (e.dark !== prev.dark)
      this.event("theme", now, false, undefined, {
        theme: e.dark ? "тёмную" : "светлую",
      });
    if (e.memory >= 90) {
      if (!this.ramSince) this.ramSince = now;
      if (now - this.ramSince > 30000)
        this.event("ram", now, false, undefined, { pct: String(e.memory) });
    } else this.ramSince = 0;
    if (e.disk > 0 && e.disk <= 8)
      this.event("disk", now, false, undefined, { pct: String(e.disk) });
    if (e.windows && prev.windows) {
      if (e.windows > prev.windows) this.event("appOpen", now);
      else if (e.windows < prev.windows) this.event("appClose", now);
      if (e.windows >= 14)
        this.event("windowStorm", now, false, undefined, {
          n: String(e.windows),
        });
    }
  }
  /** True inside the night-sleep window: an hour after "late" until 06:00. */
  nightTime(now: number): boolean {
    if (!this.settings.nightSleep) return false;
    const h = new Date(now).getHours();
    const from = (this.settings.lateHour + 1) % 24;
    return from < 6 ? h >= from && h < 6 : h >= from || h < 6;
  }
  // Days, dates and the time of day: once-a-day lines, streaks, holidays.
  private calendar(n: Snapshot, present: boolean) {
    const now = n.now;
    const today = new Date(now).toLocaleDateString("sv");
    if (!present) return;
    if (visitDay(this.life, now) && this.life.streak >= 2)
      this.event("streak", now, false, undefined, { n: String(this.life.streak) });
    const h = holiday(now, this.memory.birthday, this.life.since);
    if (h && !this.seen("holiday", today)) {
      const ok =
        h.id === "birthday"
          ? this.event("birthday", now, true)
          : this.event("holiday", now, false, undefined, { holiday: h.name });
      if (ok) this.once("holiday", today);
    }
    const part = dayPart(now);
    if (part === "morning" && !this.seen("morning", today) && this.event("morning", now))
      this.once("morning", today);
    const hour = new Date(now).getHours();
    if (hour >= 12 && hour < 14 && !this.seen("lunch", today) && this.event("lunch", now))
      this.once("lunch", today);
    if (weekend(now) && !this.seen("weekend", today) && this.event("weekend", now))
      this.once("weekend", today);
    // After one at night and still typing: counted, remarked once.
    if (hour >= 1 && hour < 5 && now - this.lastBusy < 60000) {
      const night = nightKey(now);
      if (!this.seen("owl", night)) {
        note(this.life, "owl", now);
        this.once("owl", night);
        this.event("nightOwl", now);
      }
    }
  }
  observe(n: Snapshot) {
    const now = n.now,
      s = this.settings,
      p = this.last;
    this.hidden =
      this.manualHidden ||
      n.locked ||
      (s.hideFullscreen && n.fullscreen && !s.fullscreenAllow.includes(n.app));
    if (this.hidden) {
      this.bubble = undefined;
      this.reaction = undefined;
    }
    const cat = category(n.app, s);
    const occupied =
      n.media.playing || n.controller || cat === "game" || n.fullscreen;
    const idle = s.observeIdle && !occupied ? n.idle : 0;
    const night = this.nightTime(now) && !occupied;
    this.base =
      working(this.game, now)
        ? "busy"
        : s.mode === "dnd"
          ? "sleep"
          : idle > s.sleepMinutes * 60000 || night
            ? "sleep"
            : idle > s.idleMinutes * 60000
              ? "rest"
              : n.media.playing
                ? "sit"
                : this.game.strength < 20
                  ? "rest"
                  : "idle";
    // Somebody woke it up a moment ago: not straight back to sleep.
    if (this.base === "sleep" && night && now - this.wokeAt < 5 * 60000) this.base = "idle";
    const elapsed = Math.min(5, Math.max(0, (now - (p?.now ?? now)) / 1000));
    this.energy += elapsed * (this.base === "sleep" ? 0.001 : -0.00005);
    this.energy = clamp(this.energy, 0.2, 1);
    const curiosityTarget = p && p.app !== n.app ? 0.85 : 0.4;
    this.curiosity +=
      (curiosityTarget - this.curiosity) * Math.min(1, elapsed * 0.04);
    const socialTarget = s.mode === "normal" && !n.media.playing ? 0.7 : 0.2;
    this.sociability +=
      (socialTarget - this.sociability) * Math.min(1, elapsed * 0.02);
    const today = new Date(now).toLocaleDateString("sv");
    if (this.memory.lastGreeting !== today) {
      if (this.event("hello", now)) {
        this.memory.lastGreeting = today;
        this.memoryDirty = true;
      }
    }
    if (s.mode === "dnd") {
      this.last = n;
      this.currentApp = n.app;
      this.appSince = now;
      this.wasIdle = false;
      this.gameSeen = false;
      this.switches = [];
      return;
    }
    const present = n.idle < 60000 && !n.locked;
    // The "ignored" clock starts with the session, not with the last pat.
    if (!p) this.lastAttention = Math.max(this.lastAttention, now);
    if (p) {
      if (this.wasIdle && idle < 2000) this.event("return", now);
      if (!this.wasIdle && idle > s.idleMinutes * 60000)
        this.event("idle", now);
      if (this.base === "sleep" && p.idle <= s.sleepMinutes * 60000 && !night)
        this.event("sleep", now);
      if (n.monitors.length > p.monitors.length) this.event("monitor", now);
      if (s.observeApps && n.app && n.app !== this.currentApp) {
        const old = category(this.currentApp, s);
        this.switches = this.switches.filter((v) => now - v.time < 90000);
        this.switches.push({ app: n.app, time: now });
        const feel = opinion(this.life, n.app);
        if (cat === "game") {
          this.editorBeforeGame = old === "editor";
          this.gameSeen = true;
          this.event("game", now);
        } else if (this.gameSeen && old === "game") {
          this.event(
            cat === "editor" && this.editorBeforeGame ? "breakEnd" : "gameEnd",
            now,
          );
          this.gameSeen = false;
        } else if (feel <= -25)
          this.event("judgeApp", now, false, undefined, { app: appName(n.app) });
        else if (feel >= 40 && this.random() < 0.3)
          this.event("likeApp", now, false, undefined, { app: appName(n.app) });
        else if (["editor", "chat", "video"].includes(cat)) this.event(cat, now);
        this.currentApp = n.app;
        this.appSince = now;
        if (this.switches.filter((v) => now - v.time < 12000).length >= 7)
          this.event("switching", now);
        if (
          this.switches.length >= 10 &&
          new Set(this.switches.map((v) => v.app)).size === 2
        )
          this.event("alternating", now);
      }
      if (
        s.observeApps &&
        this.appSince &&
        now - this.appSince > s.longSessionMinutes * 60000
      ) {
        this.event("long", now);
        if (this.temper.jealous) judgeApp(this.life, n.app, -2);
        this.appSince = now;
      }
      if (s.observeMedia) {
        if (n.media.playing && !p.media.playing)
          this.event(p.media.available ? "mediaResume" : "music", now);
        if (!n.media.playing && p.media.playing) this.mediaPauseAt = now;
        if (n.media.playing) this.mediaPauseAt = 0;
        if (
          this.mediaPauseAt &&
          now - this.mediaPauseAt > 60000 &&
          this.event("mediaPause", now)
        )
          this.mediaPauseAt = 0;
        if (
          n.media.track &&
          n.media.track === p.media.track &&
          this.playPosition > 30 &&
          n.media.position < 3 &&
          n.media.playing
        )
          this.event("repeat", now);
        this.playPosition = n.media.position;
      }
      if (s.observeSystem) {
        if (n.online === false && p.online === true) this.event("offline", now);
        if (n.online === true && p.online === false) this.event("online", now);
        if (n.battery !== null && n.battery <= 20 && !n.plugged)
          this.event("battery", now);
        if (n.battery !== null && n.plugged && !p.plugged)
          this.event("power", now);
        if (n.cpu !== null && n.cpu > 85) {
          if (!this.cpuSince) this.cpuSince = now;
          if (now - this.cpuSince > 20000) this.event("cpu", now);
        } else this.cpuSince = 0;
      }
      if (
        (n as Snapshot & { desktop?: boolean }).desktop &&
        !(p as Snapshot & { desktop?: boolean }).desktop
      ) {
        // Everything minimised: the whole floor is free — run to the middle.
        const m = n.monitors.find(
          (mm) => this.petX >= mm.bounds.left && this.petX < mm.bounds.right,
        );
        if (m && this.event("showDesktop", now))
          this.wantRun = (m.work.left + m.work.right) / 2;
        else this.event("desktop", now);
      }
      // Focus moved to another big window on the pet's screen: sometimes
      // climb onto it — almost always if it is a program whose windows keep
      // vanishing under it.
      if (n.foreground !== p.foreground && s.walk && s.perch && !s.pinned) {
        const w = n.windows.find((x) => x.id === n.foreground);
        const m = n.monitors.find(
          (mm) => this.petX >= mm.bounds.left && this.petX < mm.bounds.right,
        );
        const chance = this.spiteful(n.app) ? 0.85 : 0.35;
        if (
          w &&
          m &&
          w.rect.left < m.work.right &&
          w.rect.right > m.work.left &&
          w.rect.top > m.work.top + s.size * m.scale * 1.3 &&
          w.rect.right - w.rect.left > 400 * m.scale &&
          this.random() < chance &&
          this.event("hop", now)
        )
          this.wantHop = {
            id: w.id,
            x: clamp(
              this.petX,
              Math.max(w.rect.left, m.work.left) + 80 * m.scale,
              Math.min(w.rect.right, m.work.right) - 80 * m.scale,
            ),
            top: w.rect.top,
            until: now + 12000,
          };
      }
      const drives = n.env?.drives ?? 0;
      const before = p.env?.drives ?? drives;
      if (drives & ~before) this.event("driveIn", now);
      else if (before & ~drives) this.event("driveOut", now);
      // Ignored for 45 minutes while you are busy: walks right under the cursor.
      if (
        s.mode === "normal" &&
        s.walk &&
        !s.pinned &&
        present &&
        now - this.lastBusy < 5000 &&
        now - this.lastAttention > 45 * 60000 &&
        this.event("attention", now)
      )
        this.wantAnnoy = true;
      // Asleep at night while you keep working: wakes, squints at the clock,
      // lies back down.
      if (night && this.base === "sleep" && now - this.lastBusy < 10000 && now >= this.nextNightCheck) {
        this.nextNightCheck = now + (10 + this.random() * 15) * 60000;
        this.event("nightCheck", now, false, undefined, {
          time: new Date(now).toLocaleTimeString("ru", { hour: "2-digit", minute: "2-digit" }),
        });
      }
    }
    if (p) this.calendar(n, present);
    const late = new Date(now).getHours() >= s.lateHour || new Date(now).getHours() < 5;
    if (late && present && !this.seen("night", nightKey(now))) {
      if (this.event("night", now)) this.once("night", nightKey(now));
    }
    if (p) this.desktop(n, p);
    // Cursor jitter does not wake a sleeping pet; it only twitches.
    if (
      p &&
      this.base === "sleep" &&
      (n.jitter ?? 0) > (p.jitter ?? 0)
    )
      this.event("twitch", now);
    this.input(n);
    this.usage(n);
    this.wasIdle = idle > s.idleMinutes * 60000;
    this.last = n;
  }
  /** Rest spot habit: called when it settles down somewhere. */
  settled(monitor: string, x: number) {
    rememberSpot(this.life, monitor, x);
  }
  /** Time since the user last paid attention (clicks, petting, food), ms. */
  ignoredFor(now: number) {
    return now - this.lastAttention;
  }
  /** Minutes since `kind` last happened (for lines and tests). */
  since(kind: string, now: number) {
    return since(this.life, kind, now);
  }
}
