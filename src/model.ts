import type { Game } from "./game";
export type Mode = "normal" | "quiet" | "dnd";
export type Action =
  | "idle"
  | "walkRight"
  | "walkLeft"
  | "wave"
  | "jump"
  | "celebrate"
  | "rest"
  | "sleep"
  | "sit"
  | "look"
  | "drag"
  | "land";
export type Category = "editor" | "game" | "chat" | "video" | "other";
export interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}
export interface Monitor {
  id: string;
  bounds: Rect;
  work: Rect;
  scale: number;
  primary: boolean;
}
export interface Surface {
  id: number;
  rect: Rect;
}
export interface Input {
  clicks: number;
  rightClicks: number;
  wheel: number;
  keys: number;
  shots: number;
  lastClick: { x: number; y: number; t: number } | null;
}
export interface UsageEntry {
  app: string;
  seconds: number;
}
export const emptyInput: Input = {
  clicks: 0,
  rightClicks: 0,
  wheel: 0,
  keys: 0,
  shots: 0,
  lastClick: null,
};
/** What Windows itself is doing: sound, clipboard, theme, pressure, windows. */
export interface Desktop {
  volume: number;
  muted: boolean;
  audio: boolean;
  clipboard: number;
  caps: boolean;
  dark: boolean;
  memory: number;
  disk: number;
  windows: number;
  drives?: number;
}
export const emptyDesktop: Desktop = {
  volume: -1,
  muted: false,
  audio: false,
  clipboard: 0,
  caps: false,
  dark: false,
  memory: 0,
  disk: 0,
  windows: 0,
};
export interface Snapshot {
  now: number;
  idle: number;
  app: string;
  fullscreen: boolean;
  foreground: number;
  windows: Surface[];
  monitors: Monitor[];
  media: {
    playing: boolean;
    available: boolean;
    track: string;
    position: number;
  };
  cpu: number | null;
  online: boolean | null;
  battery: number | null;
  plugged: boolean;
  controller: boolean;
  locked: boolean;
  desktop?: boolean;
  input?: Input;
  usage?: { today: UsageEntry[] };
  env?: Desktop;
  /** Cursor twitches filtered out as jitter, cumulative. */
  jitter?: number;
  gpu?: number | null;
}
export interface Settings {
  pet: string;
  mode: Mode;
  size: number;
  smooth: boolean;
  activity: "calm" | "balanced" | "active";
  walk: boolean;
  perch: boolean;
  pinned: boolean;
  monitor: string;
  comments: boolean;
  commentMinutes: number;
  idleMinutes: number;
  sleepMinutes: number;
  longSessionMinutes: number;
  lateHour: number;
  observeApps: boolean;
  observeIdle: boolean;
  observeMedia: boolean;
  observeSystem: boolean;
  observeCursor: boolean;
  observeInput: boolean;
  observeDesktop: boolean;
  observeProcesses: boolean;
  watchAutoruns: boolean;
  observeGpu: boolean;
  traceBackground: boolean;
  traceTrusted: string[];
  observeSound: boolean;
  trackUsage: boolean;
  sounds: boolean;
  soundVolume: number;
  hideFullscreen: boolean;
  fullscreenAllow: string[];
  games: string[];
  editors: string[];
  chatApps: string[];
  autostart: boolean;
  integration: boolean;
  ai: boolean;
  model: string;
  sendContext: boolean;
  diagnostics: boolean;
}
export interface Memory {
  address: string;
  /** The first-run card has been held up once; it never comes back. */
  cardShown: boolean;
  facts: string[];
  recent: string[];
  lastGreeting: string;
  favorite: { x: number; y: number; monitor: string } | null;
  position: { x: number; y: number } | null;
}
export interface Store {
  settings: Settings;
  memory: Memory;
  game: Game;
  token: string;
  hasKey: boolean;
}
export const defaults: Settings = {
  pet: "drizz",
  mode: "normal",
  size: 76,
  smooth: true,
  activity: "balanced",
  walk: true,
  perch: true,
  pinned: false,
  monitor: "auto",
  comments: true,
  commentMinutes: 3,
  idleMinutes: 3,
  sleepMinutes: 10,
  longSessionMinutes: 60,
  lateHour: 23,
  observeApps: true,
  observeIdle: true,
  observeMedia: true,
  observeSystem: true,
  observeCursor: true,
  observeInput: true,
  observeDesktop: true,
  observeProcesses: true,
  watchAutoruns: true,
  observeGpu: true,
  traceBackground: true,
  traceTrusted: [],
  observeSound: true,
  trackUsage: true,
  sounds: true,
  soundVolume: 55,
  hideFullscreen: true,
  fullscreenAllow: [],
  games: [],
  editors: [
    "code.exe",
    "devenv.exe",
    "godot.exe",
    "godot_v4.5-stable_win64.exe",
    "blender.exe",
    "idea64.exe",
    "rider64.exe",
  ],
  chatApps: ["telegram.exe", "discord.exe"],
  autostart: false,
  integration: false,
  ai: false,
  model: "google/gemini-3.1-flash-lite",
  sendContext: false,
  diagnostics: false,
};
export const emptyMemory: Memory = {
  address: "",
  cardShown: false,
  facts: [],
  recent: [],
  lastGreeting: "",
  favorite: null,
  position: null,
};
export const pets = [
  { id: "drizz", name: "Drizz", color: "#b4e62e", trait: "Наглый сосед" },
  {
    id: "claude",
    name: "Claude",
    color: "#f2853a",
    trait: "Спокойный наблюдатель",
  },
  {
    id: "eigenblob",
    name: "Eigenblob",
    color: "#c6a8f5",
    trait: "Любопытный сгусток",
  },
  {
    id: "aqua-wisp",
    name: "Aqua Wisp",
    color: "#3fd0d8",
    trait: "Тихий попутчик",
  },
  {
    id: "nezukocoder",
    name: "Nezuko Coder",
    color: "#e0567a",
    trait: "Энергичная соседка",
  },
];
export const clamp = (n: number, min: number, max: number) =>
  Math.max(min, Math.min(max, n));
export function cleanMemory(raw: Partial<Memory>): Memory {
  const m = { ...emptyMemory, ...raw };
  m.address = typeof m.address === "string" ? m.address.slice(0, 40) : "";
  for (const k of ["facts", "recent"] as const)
    m[k] = Array.isArray(m[k])
      ? m[k]
          .filter((v) => typeof v === "string")
          .map((v) => v.slice(0, 500))
          .slice(k === "facts" ? -30 : -20)
      : [];
  m.lastGreeting = typeof m.lastGreeting === "string" ? m.lastGreeting : "";
  m.cardShown = m.cardShown === true;
  const point = (p: unknown) =>
    !!p &&
    typeof p === "object" &&
    ["x", "y"].every((k) => Number.isFinite((p as Record<string, unknown>)[k]));
  if (!point(m.position)) m.position = null;
  if (!point(m.favorite) || typeof m.favorite?.monitor !== "string")
    m.favorite = null;
  return m;
}
export function cleanSettings(raw: Partial<Settings>): Settings {
  const s = { ...defaults, ...raw };
  for (const k of [
    "games",
    "editors",
    "chatApps",
    "fullscreenAllow",
    "traceTrusted",
  ] as const) {
    s[k] = Array.isArray(s[k])
      ? s[k]
          .filter((x) => typeof x === "string")
          .map((x) => x.trim().toLowerCase())
          .slice(0, 80)
      : defaults[k];
  }
  if (!["normal", "quiet", "dnd"].includes(s.mode)) s.mode = "normal";
  if (!["calm", "balanced", "active"].includes(s.activity))
    s.activity = "balanced";
  for (const key of Object.keys(defaults) as (keyof Settings)[]) {
    if (typeof defaults[key] === "boolean" && typeof s[key] !== "boolean")
      (s as unknown as Record<string, unknown>)[key] = defaults[key];
  }
  s.model =
    typeof s.model === "string" && s.model.length <= 100
      ? s.model
      : defaults.model;
  s.monitor = typeof s.monitor === "string" ? s.monitor : "auto";
  s.pet = pets.some((p) => p.id === s.pet) ? s.pet : "drizz";
  s.size = clamp(Number(s.size) || 76, 56, 176);
  s.commentMinutes = clamp(Number(s.commentMinutes) || 3, 1, 60);
  s.idleMinutes = clamp(Number(s.idleMinutes) || 3, 1, 60);
  s.sleepMinutes = Math.max(
    s.idleMinutes + 1,
    clamp(Number(s.sleepMinutes) || 10, 2, 120),
  );
  s.longSessionMinutes = clamp(Number(s.longSessionMinutes) || 60, 10, 240);
  s.soundVolume = clamp(
    Number.isFinite(Number(s.soundVolume)) ? Number(s.soundVolume) : 55,
    0,
    100,
  );
  s.lateHour = Number.isFinite(Number(s.lateHour))
    ? clamp(Number(s.lateHour), 0, 23)
    : 23;
  return s;
}
export function category(app: string, s: Settings): Category {
  const a = app.toLowerCase();
  if (s.games.includes(a)) return "game";
  if (
    s.editors.includes(a) ||
    /^(godot.*|blender|code|devenv|idea64|rider64)\.exe$/.test(a)
  )
    return "editor";
  if (s.chatApps.includes(a)) return "chat";
  if (/^(vlc|mpv|potplayer.*|aniblaze)\.exe$/.test(a)) return "video";
  return "other";
}
