// What the pet remembers about you: counters of what happened, when it last
// happened, which programs it likes, where it likes to sit, what it has
// unlocked. Pure data inside `Game.life`, persisted with the game (save_game).
// Nothing here stores window titles, text or key codes — only counts, times
// and .exe names that the app already sees.
export interface Life {
  /** First launch, ms. */
  since: number;
  /** Last calendar day the pet saw you and the run of consecutive days. */
  lastDay: string;
  streak: number;
  bestStreak: number;
  /** Totals: throw, drag, poke, pet, fed, wake, alert, swat, … */
  counts: Record<string, number>;
  /** Last time of each kind, ms. */
  marks: Record<string, number>;
  /** Up to 20 recent timestamps for kinds where "lately" matters. */
  recent: Record<string, number[]>;
  /** Opinion of programs, -100 (hates) … 100 (loves), by .exe name. */
  apps: Record<string, number>;
  /** Where it chose to rest: "monitor|bucket" -> weight. */
  spots: Record<string, number>;
  /** Where throws ended: "monitor|left|right|floor" -> count. */
  landings: Record<string, number>;
  /** Programs whose window vanished under the pet -> count. */
  closedUnder: Record<string, number>;
  /** Unlocked achievements -> time. */
  achievements: Record<string, number>;
  /** Stickers and trinkets -> count. */
  collection: Record<string, number>;
  /** Food kept for later (gifts, stolen goods) -> count. */
  pantry: Record<string, number>;
  /** Worn accessory id or "". */
  wear: string;
  /** Active role and when it ends. */
  role: { id: string; until: number } | null;
}
export const RECENT_KINDS = [
  "throw",
  "drag",
  "poke",
  "wake",
  "evict",
  "cancel",
  "pet",
  "fed",
  "click",
  "fall",
  "alert",
];
export const newLife = (now: number): Life => ({
  since: now,
  lastDay: "",
  streak: 0,
  bestStreak: 0,
  counts: {},
  marks: {},
  recent: {},
  apps: {},
  spots: {},
  landings: {},
  closedUnder: {},
  achievements: {},
  collection: {},
  pantry: {},
  wear: "",
  role: null,
});
const numMap = (raw: unknown, limit: number, lo = -1e9, hi = 1e9) => {
  const out: Record<string, number> = {};
  if (!raw || typeof raw !== "object") return out;
  const entries = Object.entries(raw as Record<string, unknown>)
    .filter(([k, v]) => k.length <= 80 && Number.isFinite(Number(v)))
    .slice(-limit);
  for (const [k, v] of entries) out[k] = Math.max(lo, Math.min(hi, Number(v)));
  return out;
};
export function cleanLife(raw: unknown, now: number): Life {
  const base = newLife(now);
  if (!raw || typeof raw !== "object") return base;
  const r = raw as Record<string, unknown>;
  const n = (v: unknown, d: number) => (Number.isFinite(Number(v)) ? Number(v) : d);
  const recent: Record<string, number[]> = {};
  if (r.recent && typeof r.recent === "object")
    for (const k of RECENT_KINDS) {
      const v = (r.recent as Record<string, unknown>)[k];
      if (Array.isArray(v))
        recent[k] = v.map(Number).filter(Number.isFinite).slice(-20);
    }
  const role = r.role as Life["role"];
  return {
    since: Math.min(now, n(r.since, now)),
    lastDay: typeof r.lastDay === "string" ? r.lastDay.slice(0, 10) : "",
    streak: Math.max(0, Math.floor(n(r.streak, 0))),
    bestStreak: Math.max(0, Math.floor(n(r.bestStreak, 0))),
    counts: numMap(r.counts, 80, 0),
    marks: numMap(r.marks, 80, 0),
    recent,
    apps: numMap(r.apps, 60, -100, 100),
    spots: numMap(r.spots, 60, 0, 1e6),
    landings: numMap(r.landings, 30, 0),
    closedUnder: numMap(r.closedUnder, 30, 0),
    achievements: numMap(r.achievements, 80, 0),
    collection: numMap(r.collection, 80, 0),
    pantry: numMap(r.pantry, 40, 0, 99),
    wear: typeof r.wear === "string" ? r.wear.slice(0, 30) : "",
    role:
      role && typeof role.id === "string" && Number.isFinite(Number(role.until)) && Number(role.until) > now
        ? { id: role.id.slice(0, 20), until: Number(role.until) }
        : null,
  };
}
/** Something happened: count it, time it, keep it in the short list. */
export function note(life: Life, kind: string, now: number, by = 1) {
  life.counts[kind] = (life.counts[kind] ?? 0) + by;
  life.marks[kind] = now;
  if (RECENT_KINDS.includes(kind)) {
    const list = (life.recent[kind] ??= []);
    list.push(now);
    if (list.length > 20) list.splice(0, list.length - 20);
  }
}
export const count = (life: Life, kind: string) => life.counts[kind] ?? 0;
/** How many times `kind` happened within the last `ms`. */
export const lately = (life: Life, kind: string, now: number, ms: number) =>
  (life.recent[kind] ?? []).filter((t) => now - t < ms).length;
export const since = (life: Life, kind: string, now: number) =>
  life.marks[kind] ? now - life.marks[kind] : Infinity;
/** Nudge the opinion of a program; returns the new value. */
export function judgeApp(life: Life, app: string, delta: number): number {
  if (!app) return 0;
  const a = app.toLowerCase().slice(0, 60);
  const v = Math.max(-100, Math.min(100, (life.apps[a] ?? 0) + delta));
  life.apps[a] = Math.round(v * 10) / 10;
  const keys = Object.keys(life.apps);
  if (keys.length > 60) {
    // Forget the most indifferent one.
    keys.sort((x, y) => Math.abs(life.apps[x]) - Math.abs(life.apps[y]));
    delete life.apps[keys[0]];
  }
  return life.apps[a];
}
export const opinion = (life: Life, app: string) => life.apps[app.toLowerCase()] ?? 0;
/** Rest spots are remembered in 160 px buckets per monitor. */
export const SPOT = 160;
export function rememberSpot(life: Life, monitor: string, x: number, weight = 1) {
  const key = `${monitor}|${Math.round(x / SPOT)}`;
  // Old habits fade a little every time a new one is recorded.
  for (const k of Object.keys(life.spots)) {
    life.spots[k] *= 0.985;
    if (life.spots[k] < 0.2) delete life.spots[k];
  }
  life.spots[key] = (life.spots[key] ?? 0) + weight;
}
/** Favourite spot on this monitor, as an x in desktop pixels, once it is a habit. */
export function favoriteSpot(life: Life, monitor: string): number | null {
  let best = "",
    w = 0;
  for (const [k, v] of Object.entries(life.spots))
    if (k.startsWith(monitor + "|") && v > w) {
      best = k;
      w = v;
    }
  return w >= 4 ? Number(best.split("|")[1]) * SPOT : null;
}
/** A new day seen: updates the streak. Returns true on the first call of a day. */
export function visitDay(life: Life, now: number): boolean {
  const day = new Date(now).toLocaleDateString("sv");
  if (life.lastDay === day) return false;
  const yesterday = new Date(now - 86400000).toLocaleDateString("sv");
  life.streak = life.lastDay === yesterday ? life.streak + 1 : 1;
  life.bestStreak = Math.max(life.bestStreak, life.streak);
  life.lastDay = day;
  return true;
}
export const daysTogether = (life: Life, now: number) =>
  Math.max(0, Math.floor((now - life.since) / 86400000));
// ------------------------------------------------------------ relationship
export type Stage = 0 | 1 | 2 | 3 | 4;
export const stageNames = ["Чужой", "Терпит", "Привык", "Свой", "Лучший друг"];
/** Bank suffix for the dialogue: "click~stranger", "chatter~close", … */
export const stageKeys = ["stranger", "tolerant", "used", "close", "best"];
/**
 * Relationship grows with likability and time together and is dragged down
 * by a pattern of abuse, not by a single throw.
 */
export function stage(bondPct: number, life: Life, now: number): Stage {
  const days = daysTogether(life, now);
  const abuse = lately(life, "throw", now, 86400000) + lately(life, "poke", now, 86400000) / 2;
  let s: number =
    bondPct >= 85 ? 4 : bondPct >= 60 ? 3 : bondPct >= 35 ? 2 : bondPct >= 12 ? 1 : 0;
  // Trust takes days: no best friends on the first evening.
  if (days < 1) s = Math.min(s, 1);
  else if (days < 3) s = Math.min(s, 2);
  else if (days < 7) s = Math.min(s, 3);
  if (abuse >= 10) s -= 1;
  return Math.max(0, Math.min(4, s)) as Stage;
}
// ------------------------------------------------------------ achievements
export interface Achievement {
  id: string;
  name: string;
  desc: string;
  /** Money reward. */
  prize: number;
  /** Reached when this returns true. */
  test: (life: Life, ctx: { level: number; stage: Stage; now: number; jobs: number }) => boolean;
}
export const achievements: Achievement[] = [
  { id: "firstAlert", name: "Бдительный", desc: "Поймал первую подозрительную консоль", prize: 60, test: (l) => count(l, "alert") >= 1 },
  { id: "throw10", name: "Лётчик-испытатель", desc: "Пережил 10 бросков", prize: 30, test: (l) => count(l, "throw") >= 10 },
  { id: "throw100", name: "Несгибаемый", desc: "Пережил 100 бросков", prize: 150, test: (l) => count(l, "throw") >= 100 },
  { id: "calmWeek", name: "Тихая неделя", desc: "Неделя без тревог", prize: 120, test: (l, c) => c.now - l.since > 7 * 86400000 && since(l, "alert", c.now) > 7 * 86400000 },
  { id: "streak7", name: "Неделя вместе", desc: "7 дней подряд за компьютером с питомцем", prize: 100, test: (l) => l.streak >= 7 },
  { id: "streak30", name: "Месяц вместе", desc: "30 дней подряд", prize: 400, test: (l) => l.streak >= 30 },
  { id: "fed50", name: "Кормилец", desc: "Покормил 50 раз", prize: 80, test: (l) => count(l, "fed") >= 50 },
  { id: "pet100", name: "Золотые руки", desc: "Погладил 100 раз", prize: 80, test: (l) => count(l, "pet") >= 100 },
  { id: "level5", name: "Подрос", desc: "5 уровень", prize: 50, test: (_, c) => c.level >= 5 },
  { id: "level10", name: "Ветеран", desc: "10 уровень", prize: 150, test: (_, c) => c.level >= 10 },
  { id: "level20", name: "Легенда рабочего стола", desc: "20 уровень", prize: 500, test: (_, c) => c.level >= 20 },
  { id: "close", name: "Свой", desc: "Питомец считает тебя своим", prize: 100, test: (_, c) => c.stage >= 3 },
  { id: "best", name: "Лучшие друзья", desc: "Высшая ступень отношений", prize: 300, test: (_, c) => c.stage >= 4 },
  { id: "swat10", name: "Кот-мститель", desc: "Отлупил курсор 10 раз", prize: 40, test: (l) => count(l, "swat") >= 10 },
  { id: "pounce", name: "Прыжок пантеры", desc: "Прыгнул на курсор", prize: 30, test: (l) => count(l, "pounce") >= 1 },
  { id: "dizzy", name: "Взболтан, не смешан", desc: "Укачало от тряски", prize: 20, test: (l) => count(l, "dizzy") >= 1 },
  { id: "work10", name: "Трудяга", desc: "10 смен на работе", prize: 100, test: (_, c) => c.jobs >= 10 },
  { id: "win10", name: "Игрок", desc: "10 побед в мини-играх", prize: 80, test: (l) => count(l, "win") >= 10 },
  { id: "owl", name: "Сова", desc: "10 ночей за компьютером после часа ночи", prize: 50, test: (l) => count(l, "owl") >= 10 },
  { id: "gift", name: "Подарочек", desc: "Принял подарок от питомца", prize: 20, test: (l) => count(l, "gift") >= 1 },
  { id: "clean", name: "Уборщик", desc: "Почистил временные файлы вместе с питомцем", prize: 60, test: (l) => count(l, "clean") >= 1 },
  { id: "traveller", name: "Путешественник", desc: "Перешёл на другой монитор", prize: 20, test: (l) => count(l, "cross") >= 1 },
  { id: "seasick", name: "Морская болезнь", desc: "Укачало на окне", prize: 20, test: (l) => count(l, "seasick") >= 1 },
  { id: "note", name: "Не трогать", desc: "Нашёл записку питомца", prize: 15, test: (l) => count(l, "noteRead") >= 1 },
];
/** Newly reached achievements, recorded in `life`. */
export function unlock(
  life: Life,
  ctx: { level: number; stage: Stage; now: number; jobs: number },
): Achievement[] {
  const fresh = achievements.filter((a) => !life.achievements[a.id] && a.test(life, ctx));
  for (const a of fresh) life.achievements[a.id] = ctx.now;
  return fresh;
}
