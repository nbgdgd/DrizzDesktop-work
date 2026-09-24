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
  | "land"
  // Held and shaken, hanging from a window edge, moods and chores.
  | "flail"
  | "shaken"
  | "pained"
  | "dizzy"
  | "grumpy"
  | "sigh"
  | "sulk"
  | "judge"
  | "busy"
  | "swat"
  | "eat"
  | "dance"
  | "hang"
  | "stretch";
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
  /** Default output is headphones/headset; master and per-ear levels, dB. */
  headphones?: boolean;
  db?: number;
  left?: number;
  right?: number;
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
export type Lang = "ru" | "en";
export interface Settings {
  pet: string;
  /** Language of the pet's lines and of the whole interface. */
  lang: Lang;
  /** English only: lets the pet swear. Russian lines are never softened. */
  swear: boolean;
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
  /** Hunts, swats and chases the cursor. */
  cursorPlay: boolean;
  /** May actually move the cursor a little when it hits it. */
  cursorPush: boolean;
  /** Drunk pet may shake, shove and minimise real windows. */
  drunkWindows: boolean;
  /** …and even ask one to close (WM_CLOSE). Off by default. */
  drunkClose: boolean;
  /** Talks to itself when nothing happens. */
  mumble: boolean;
  /** Animal Crossing-like babble under every line. */
  voice: boolean;
  /** Leaves notes, brings gifts, steals trinkets. */
  mischief: boolean;
  /** Goes to sleep at night even while you work. */
  nightSleep: boolean;
  /** Real weather (Open-Meteo) for umbrella and snow; off until allowed. */
  weather: boolean;
  /** Coordinates for the weather, "55.75,37.62" (from the city search, a country or typed). */
  weatherPlace: string;
  /** How the place is called in lines and in the panel: "Казань, Россия". */
  weatherName: string;
  /** Quiet hours: no lines of its own from…to (hours), -1 = off. */
  quietFrom: number;
  quietTo: number;
  /** Ear care (ears.ts): weekly sound dose on headphones, breaks, warnings. */
  ears: boolean;
  /** 80 dBA·40 h (adults) or 75 (gentle), WHO / ITU-T H.870. */
  earsNorm: number;
  earsDevice: "auto" | "always";
  /** Loudest level of the headphones, dB SPL at full volume. */
  earsMax: number;
  earsBreak: number;
  earsAutoLower: boolean;
  /** Spike guard (guard.rs): a hard volume ceiling on headphones, percent. */
  earsGuard: boolean;
  earsCeiling: number;
  /** Volume set when headphones are plugged in or the PC wakes, percent (0 = off). */
  earsSafe: number;
  earsRest: boolean;
  earsRestMinutes: number;
  earsRestDim: number;
  /** Left/right balance, -100 (left only) … 100 (right only). */
  balance: number;
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
  /** Your birthday, "MM-DD" or "". */
  birthday: string;
  /** Once-a-day lines already said: key -> day ("night" -> "2026-09-24"). */
  daily: Record<string, string>;
  /** Bumped by the panel when the user resets memory, so the pet takes the reset. */
  epoch: number;
}
export interface Store {
  settings: Settings;
  memory: Memory;
  game: Game;
  token: string;
  hasKey: boolean;
}
export const defaults: Settings = {
  pet: "aqua-wisp",
  lang: "ru",
  swear: false,
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
  cursorPlay: true,
  cursorPush: true,
  drunkWindows: true,
  drunkClose: false,
  mumble: true,
  voice: true,
  mischief: true,
  nightSleep: true,
  weather: false,
  weatherPlace: "",
  weatherName: "",
  quietFrom: -1,
  quietTo: -1,
  ears: true,
  earsNorm: 80,
  earsDevice: "auto",
  earsMax: 100,
  earsBreak: 60,
  earsAutoLower: false,
  earsGuard: false,
  earsCeiling: 60,
  earsSafe: 20,
  earsRest: false,
  earsRestMinutes: 20,
  earsRestDim: 50,
  balance: 0,
};
export const emptyMemory: Memory = {
  address: "",
  cardShown: false,
  facts: [],
  recent: [],
  lastGreeting: "",
  favorite: null,
  position: null,
  birthday: "",
  daily: {},
  epoch: 0,
};
export const pets = [
  { id: "drizz", name: "Drizz", color: "#b4e62e", trait: "Наглый" },
  { id: "claude", name: "Claude", color: "#f2853a", trait: "Ворчливый философ" },
  { id: "eigenblob", name: "Eigenblob", color: "#c6a8f5", trait: "Немного туповатый" },
  { id: "aqua-wisp", name: "Aqua Wisp", color: "#3fd0d8", trait: "Меланхолик" },
  { id: "nezukocoder", name: "Nezuko Coder", color: "#e0567a", trait: "Энергичная и ревнивая" },
];
/** True inside the user's quiet hours (handles ranges over midnight). */
export function quietNow(s: Settings, now: number): boolean {
  if (s.quietFrom < 0 || s.quietTo < 0 || s.quietFrom === s.quietTo) return false;
  const h = new Date(now).getHours();
  return s.quietFrom < s.quietTo
    ? h >= s.quietFrom && h < s.quietTo
    : h >= s.quietFrom || h < s.quietTo;
}
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
  m.birthday =
    typeof m.birthday === "string" && /^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(m.birthday)
      ? m.birthday
      : "";
  const daily: Record<string, string> = {};
  if (m.daily && typeof m.daily === "object")
    for (const [k, v] of Object.entries(m.daily).slice(-40))
      if (typeof v === "string" && k.length <= 40) daily[k] = v.slice(0, 10);
  m.daily = daily;
  m.epoch = Number.isFinite(Number(m.epoch)) ? Number(m.epoch) : 0;
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
  if (s.lang !== "en") s.lang = "ru";
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
  for (const k of ["quietFrom", "quietTo"] as const)
    s[k] = Number.isInteger(Number(s[k])) ? clamp(Number(s[k]), -1, 23) : -1;
  s.weatherName = typeof s.weatherName === "string" ? s.weatherName.trim().slice(0, 80) : "";
  s.earsNorm = Number(s.earsNorm) === 75 ? 75 : 80;
  if (s.earsDevice !== "always") s.earsDevice = "auto";
  s.earsMax = clamp(Number(s.earsMax) || 100, 85, 120);
  s.earsBreak = clamp(Number(s.earsBreak) || 60, 15, 180);
  s.earsGuard = s.earsGuard === true;
  s.earsCeiling = clamp(Math.round(Number(s.earsCeiling) || 60), 10, 95);
  s.earsSafe = clamp(Math.round(Number.isFinite(Number(s.earsSafe)) ? Number(s.earsSafe) : 20), 0, 60);
  s.earsRestMinutes = clamp(Number(s.earsRestMinutes) || 20, 5, 120);
  s.earsRestDim = clamp(Number.isFinite(Number(s.earsRestDim)) ? Number(s.earsRestDim) : 50, 10, 90);
  s.balance = clamp(Math.round(Number(s.balance) || 0), -100, 100);
  s.weatherPlace =
    typeof s.weatherPlace === "string" && /^-?\d{1,2}(\.\d+)?,\s*-?\d{1,3}(\.\d+)?$/.test(s.weatherPlace.trim())
      ? s.weatherPlace.trim()
      : "";
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
