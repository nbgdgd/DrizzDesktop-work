// Progression in the spirit of VPet (LorisYounger/VPet, Apache-2.0):
// level from exp, mood/stamina/food/drink/health/likability and a food shop.
// Pure functions over a plain `Game` record; PetScene owns the live copy.
import { Life, cleanLife, newLife } from "./chronicle";
import { money, tx } from "./i18n";
import { EarLog, cleanEars, emptyEars } from "./ears";
export interface Game {
  exp: number;
  money: number;
  strength: number;
  food: number;
  drink: number;
  feeling: number;
  health: number;
  likability: number;
  storeStrength: number;
  storeFood: number;
  storeDrink: number;
  lastTick: number;
  /** Bought upgrades, id -> level (see `upgrades`). */
  skills: Record<string, number>;
  /** The job being done right now, if any. */
  job: ActiveJob | null;
  /** Finished jobs, for the "worked N times" line in the status. */
  jobsDone: number;
  /** Short-term resentment 0..100: throws and pokes add, petting and food take away. */
  grudge: number;
  /** Throws today and the day they were counted on (for "the 5th time, sadist"). */
  throwsToday: number;
  throwsDay: string;
  /** Long-term memory: counters, habits, opinions, achievements. */
  life: Life;
  /** Ear care: weekly sound dose per ear, the listening session. */
  ears: EarLog;
}
export interface ActiveJob {
  id: string;
  startedAt: number;
  endsAt: number;
}
export type PetMode = "happy" | "normal" | "poor" | "ill";
export interface TickEnv {
  present: boolean;
  resting: boolean;
  music: boolean;
  /** A shift is running: the pet drains faster and keeps earning while away. */
  working?: boolean;
}
export type Interaction = "click" | "poke" | "drag" | "summon" | "win" | "pet" | "tickle" | "throw" | "fed";
export interface Item {
  id: string;
  name: string;
  kind: "drink" | "snack" | "meal" | "functional" | "drug";
  price: number;
  exp: number;
  strength: number;
  food: number;
  drink: number;
  health: number;
  feeling: number;
  icon: string;
  desc: string;
}
const MAX_CATCH_UP = 480;
const c01 = (v: number, max = 100) => Math.max(0, Math.min(max, v));
export const newGame = (now: number): Game => ({
  exp: 0,
  money: 1000,
  strength: 100,
  food: 100,
  drink: 100,
  feeling: 60,
  health: 100,
  likability: 0,
  storeStrength: 0,
  storeFood: 0,
  storeDrink: 0,
  lastTick: now,
  skills: {},
  job: null,
  jobsDone: 0,
  grudge: 0,
  throwsToday: 0,
  throwsDay: "",
  life: newLife(now),
  ears: emptyEars(),
});
export const level = (exp: number) =>
  exp < 0 ? 1 : Math.floor(Math.sqrt(exp) / 10) + 1;
export const levelUpNeed = (lvl: number) => (lvl * 10) ** 2;
export const likabilityMax = (lvl: number) => 90 + lvl * 10;
// ---------------------------------------------------------------- upgrades
export interface Upgrade {
  id: string;
  name: string;
  desc: string;
  /** What one more level does, in the pet's own words. */
  step: string;
  max: number;
  base: number;
}
export const upgrades: Upgrade[] = [
  {
    id: "stomach",
    name: "Лужёный желудок",
    desc: "Жрёт реже, а наедается так же.",
    step: "голод тратится на 14% медленнее",
    max: 5,
    base: 120,
  },
  {
    id: "camel",
    name: "Верблюд",
    desc: "Пить можно и раз в день.",
    step: "жажда растёт на 14% медленнее",
    max: 5,
    base: 120,
  },
  {
    id: "stamina",
    name: "Выносливость",
    desc: "Меньше валяется, быстрее отдыхает.",
    step: "бодрость восстанавливается на 30% быстрее",
    max: 5,
    base: 160,
  },
  {
    id: "cheek",
    name: "Наглость",
    desc: "Выпрашивает деньги эффективнее.",
    step: "+25% к деньгам за время рядом с тобой",
    max: 5,
    base: 200,
  },
  {
    id: "brain",
    name: "Мозги",
    desc: "Схватывает быстрее. Теоретически.",
    step: "+20% опыта",
    max: 5,
    base: 220,
  },
  {
    id: "liver",
    name: "Железное здоровье",
    desc: "Болеет реже и выздоравливает сам.",
    step: "здоровье восстанавливается на 0.2 в минуту",
    max: 5,
    base: 260,
  },
  {
    id: "zen",
    name: "Пофигизм",
    desc: "Настроение падает медленнее.",
    step: "настроение проседает на 20% медленнее",
    max: 5,
    base: 180,
  },
  {
    id: "hustle",
    name: "Деловая хватка",
    desc: "За работу платят больше.",
    step: "+20% к оплате работы",
    max: 5,
    base: 320,
  },
  {
    id: "agility",
    name: "Ловкость",
    desc: "Прыгает выше, реже промахивается по курсору и реже падает.",
    step: "+12% к высоте прыжка, −15% промахов",
    max: 5,
    base: 150,
  },
  {
    id: "vigilance",
    name: "Бдительность",
    desc: "Внимательнее к процессам: подробнее объясняет, дольше стоит на страже.",
    step: "+1 деталь в объяснениях и +10 минут роли «охранник»",
    max: 5,
    base: 240,
  },
];
export const upgradeById = (id: string) => upgrades.find((u) => u.id === id);
export const skill = (g: Game, id: string) =>
  Math.max(0, Math.min(upgradeById(id)?.max ?? 0, Math.floor(g.skills?.[id] ?? 0)));
/** Price of the next level; null when it is already maxed. */
export function upgradePrice(g: Game, id: string): number | null {
  const u = upgradeById(id);
  if (!u) return null;
  const lvl = skill(g, id);
  if (lvl >= u.max) return null;
  return Math.round(u.base * Math.pow(1.75, lvl));
}
export function buyUpgrade(game: Game, id: string): Game | null {
  const price = upgradePrice(game, id);
  if (price === null || game.money < price) return null;
  const g = { ...game, skills: { ...game.skills }, money: game.money - price };
  g.skills[id] = skill(game, id) + 1;
  return g;
}
// ------------------------------------------------------------------- work
export interface Job {
  id: string;
  name: string;
  desc: string;
  /** Pilot level the job opens at. */
  level: number;
  minutes: number;
  pay: number;
  exp: number;
  /** Stamina spent over the whole shift. */
  strength: number;
  food: number;
  drink: number;
  feeling: number;
}
export const jobs: Job[] = [
  {
    id: "flyers",
    name: "Раздавать флаеры",
    desc: "Стоять у метро и совать бумажки прохожим. Работа мечты.",
    level: 1,
    minutes: 5,
    pay: 45,
    exp: 25,
    strength: 18,
    food: 8,
    drink: 12,
    feeling: -4,
  },
  {
    id: "stream",
    name: "Стримить",
    desc: "Сидеть на камеру и орать. У тебя бы не вышло.",
    level: 3,
    minutes: 10,
    pay: 120,
    exp: 70,
    strength: 26,
    food: 12,
    drink: 20,
    feeling: 6,
  },
  {
    id: "qa",
    name: "Тыкать баги",
    desc: "Ломать чужой софт за деньги. Наконец-то по специальности.",
    level: 5,
    minutes: 15,
    pay: 230,
    exp: 140,
    strength: 32,
    food: 16,
    drink: 18,
    feeling: -8,
  },
  {
    id: "mining",
    name: "Майнить на твоей видюхе",
    desc: "Греет комнату, жрёт электричество, приносит бабки.",
    level: 8,
    minutes: 20,
    pay: 380,
    exp: 200,
    strength: 38,
    food: 10,
    drink: 26,
    feeling: -10,
  },
  {
    id: "night",
    name: "Ночная смена",
    desc: "Сторожить чужие серверы, пока ты спишь.",
    level: 12,
    minutes: 30,
    pay: 700,
    exp: 360,
    strength: 50,
    food: 28,
    drink: 30,
    feeling: -14,
  },
];
export const jobById = (id: string) => jobs.find((j) => j.id === id);
/** Why the job cannot be started right now, or "" when it can. */
export function jobBlocked(g: Game, job: Job): string {
  if (g.job) return tx("уже работаю");
  if (level(g.exp) < job.level) return tx("нужен уровень {n}", { n: job.level });
  if (g.strength < job.strength) return tx("нет сил");
  if (g.food < 15) return tx("сначала покорми");
  if (g.drink < 15) return tx("сначала напои");
  if (g.health < 30) return tx("болею");
  return "";
}
export const jobPay = (g: Game, job: Job) =>
  Math.round(job.pay * (1 + 0.2 * skill(g, "hustle")));
export function startJob(game: Game, id: string, now: number): Game | null {
  const job = jobById(id);
  if (!job || jobBlocked(game, job)) return null;
  return {
    ...game,
    job: { id, startedAt: now, endsAt: now + job.minutes * 60000 },
  };
}
export interface JobResult {
  game: Game;
  done?: { job: Job; pay: number; exp: number };
}
/** Pays out a finished shift; the drain itself happens in `minute`. */
export function workTick(game: Game, now: number): JobResult {
  const active = game.job;
  if (!active) return { game };
  const job = jobById(active.id);
  if (!job) return { game: { ...game, job: null } };
  if (now < active.endsAt) return { game };
  const pay = jobPay(game, job);
  const g = { ...game, job: null, jobsDone: (game.jobsDone ?? 0) + 1 };
  g.money += pay;
  g.exp += Math.round(job.exp * (1 + 0.2 * skill(game, "brain")));
  setFeeling(g, g.feeling + job.feeling);
  return { game: g, done: { job, pay, exp: job.exp } };
}
export const working = (g: Game, now: number) =>
  !!g.job && now < g.job.endsAt;
/** 0..1 through the current shift. */
export function jobProgress(g: Game, now: number): number {
  if (!g.job) return 0;
  const total = Math.max(1, g.job.endsAt - g.job.startedAt);
  return Math.max(0, Math.min(1, (now - g.job.startedAt) / total));
}
export function mode(g: Game): PetMode {
  const lik = g.likability;
  const realhel =
    60 - (g.feeling >= 80 ? 12 : 0) - (lik >= 80 ? 12 : lik >= 40 ? 6 : 0);
  if (g.health <= realhel) return g.health <= realhel / 2 ? "ill" : "poor";
  const realfel = 0.9 - (lik >= 80 ? 0.2 : lik >= 40 ? 0.1 : 0);
  const felps = g.feeling / 100;
  if (felps >= realfel) return "happy";
  if (felps <= realfel / 2) return "poor";
  return "normal";
}
// VPet setters: an empty stomach or a mood below zero bleeds into health,
// likability above its cap bleeds into health too.
function setHealth(g: Game, v: number) {
  g.health = c01(v);
}
function setFeeling(g: Game, v: number) {
  v = Math.min(100, v);
  if (v <= 0) {
    setHealth(g, g.health + v / 2);
    setLikability(g, g.likability + v / 2);
    g.feeling = 0;
  } else g.feeling = v;
}
function setFood(g: Game, v: number) {
  v = Math.min(100, v);
  if (v <= 0) {
    setHealth(g, g.health + v);
    g.food = 0;
  } else g.food = v;
}
function setDrink(g: Game, v: number) {
  v = Math.min(100, v);
  if (v <= 0) {
    setHealth(g, g.health + v);
    g.drink = 0;
  } else g.drink = v;
}
function setLikability(g: Game, v: number) {
  const max = likabilityMax(level(g.exp));
  v = Math.max(0, v);
  if (v > max) {
    g.likability = max;
    setHealth(g, g.health + v - max);
  } else g.likability = v;
}
function storeTake(g: Game) {
  const t = 10;
  let s = g.storeStrength / t;
  g.storeStrength -= s;
  if (Math.abs(g.storeStrength) < 1) g.storeStrength = 0;
  else g.strength = c01(g.strength + s);
  s = g.storeDrink / t;
  g.storeDrink -= s;
  if (Math.abs(g.storeDrink) < 1) g.storeDrink = 0;
  else setDrink(g, g.drink + s);
  s = g.storeFood / t;
  g.storeFood -= s;
  if (Math.abs(g.storeFood) < 1) g.storeFood = 0;
  else setFood(g, g.food + s);
}
function minute(g: Game, env: TickEnv) {
  const decay = env.present ? 1 : 0.25;
  // Upgrades are multipliers on the same VPet curves, never new rules.
  const less = (id: string, per: number) => 1 - per * skill(g, id);
  const job = env.working ? jobById(g.job?.id ?? "") : undefined;
  const shift = job ? Math.max(1, job.minutes) : 1;
  setFood(g, g.food - (0.4 * decay + (job ? job.food / shift : 0)) * less("stomach", 0.14));
  setDrink(g, g.drink - (0.6 * decay + (job ? job.drink / shift : 0)) * less("camel", 0.14));
  if (job) g.strength = c01(g.strength - job.strength / shift);
  else if (env.resting) g.strength = c01(g.strength + 2 * (1 + 0.3 * skill(g, "stamina")));
  else g.strength = c01(g.strength - 0.3 * decay * less("stamina", 0.1));
  setFeeling(
    g,
    g.feeling - 0.15 * decay * less("zen", 0.2) + (env.music ? 0.1 : 0),
  );
  if (g.food <= 25 || g.drink <= 25) setHealth(g, g.health - 1);
  else setHealth(g, g.health + 0.2 * skill(g, "liver"));
  storeTake(g);
  if (!env.present && !env.working) return;
  const brain = 1 + 0.2 * skill(g, "brain");
  g.exp += 1 * brain;
  if (g.feeling >= 75) {
    g.exp += 2 * brain;
    setHealth(g, g.health + 1);
    if (g.feeling >= 90) setLikability(g, g.likability + 1);
  } else if (g.feeling <= 25) {
    setLikability(g, g.likability - 1);
    g.exp = Math.max(0, g.exp - 1);
  }
  if (env.present)
    g.money += 1.5 * (1 + 0.1 * level(g.exp)) * (1 + 0.25 * skill(g, "cheek"));
}
export function tick(game: Game, minutes: number, env: TickEnv): Game {
  const g = { ...game };
  const n = Math.min(MAX_CATCH_UP, Math.max(0, Math.floor(minutes)));
  for (let i = 0; i < n; i++) minute(g, env);
  return g;
}
/**
 * Minutes the pet spent alone (app closed, PC asleep): it slept, got a
 * little hungry, earned nothing for being near you and finished a shift if
 * one was running. Starts at `from` (ms) so a shift ends at the right minute.
 */
export function away(game: Game, from: number, minutes: number): Game {
  const g = { ...game };
  const n = Math.min(MAX_CATCH_UP, Math.max(0, Math.floor(minutes)));
  for (let i = 0; i < n; i++) {
    const t = from + i * 60000;
    minute(g, {
      present: false,
      resting: true,
      music: false,
      working: !!g.job && t < g.job.endsAt,
    });
  }
  return g;
}
export function interact(game: Game, kind: Interaction): Game {
  const g = { ...game };
  switch (kind) {
    case "click":
      setFeeling(g, g.feeling + 2);
      break;
    case "poke":
      setFeeling(g, g.feeling - 1);
      break;
    case "drag":
      setFeeling(g, g.feeling - 0.5);
      break;
    case "summon":
      setFeeling(g, g.feeling + 1);
      break;
    case "win":
      setFeeling(g, g.feeling + 5);
      g.money += 20;
      break;
    case "pet":
      setFeeling(g, g.feeling + 3);
      g.likability = Math.min(likabilityMax(level(g.exp)), g.likability + 1);
      g.grudge = Math.max(0, g.grudge - 10);
      break;
    case "tickle":
      setFeeling(g, g.feeling + 2);
      g.grudge = Math.max(0, g.grudge - 3);
      break;
    case "throw":
      setFeeling(g, g.feeling - 2);
      g.grudge = Math.min(100, g.grudge + 12);
      break;
    case "fed":
      g.grudge = Math.max(0, g.grudge - 12);
      g.likability = Math.min(likabilityMax(level(g.exp)), g.likability + 0.5);
      break;
  }
  if (kind === "poke") g.grudge = Math.min(100, g.grudge + 8);
  if (kind === "drag") g.grudge = Math.min(100, g.grudge + 3);
  return g;
}
export function eat(game: Game, item: Item): Game | null {
  if (game.money < item.price) return null;
  const g = { ...game, money: game.money - item.price };
  g.exp += item.exp;
  let tmp = item.strength / 2;
  g.strength = c01(g.strength + tmp);
  g.storeStrength += tmp;
  tmp = item.food / 2;
  setFood(g, g.food + tmp);
  g.storeFood += tmp;
  tmp = item.drink / 2;
  setDrink(g, g.drink + tmp);
  g.storeDrink += tmp;
  setFeeling(g, g.feeling + item.feeling);
  setHealth(g, g.health + item.health);
  return g;
}
export function cleanGame(raw: Partial<Game> | null | undefined, now: number): Game {
  const base = newGame(now);
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<
    string,
    unknown
  >;
  type NumKey = {
    [K in keyof Game]: Game[K] extends number ? K : never;
  }[keyof Game];
  const num = (k: NumKey, min: number, max: number): number => {
    const v = Number(r[k]);
    return Number.isFinite(v) ? Math.max(min, Math.min(max, v)) : base[k];
  };
  const g: Game = {
    exp: num("exp", 0, 1e9),
    money: num("money", 0, 1e9),
    strength: num("strength", 0, 100),
    food: num("food", 0, 100),
    drink: num("drink", 0, 100),
    feeling: num("feeling", 0, 100),
    health: num("health", 0, 100),
    likability: num("likability", 0, 100000),
    storeStrength: num("storeStrength", -500, 500),
    storeFood: num("storeFood", -500, 500),
    storeDrink: num("storeDrink", -500, 500),
    lastTick: num("lastTick", 0, 8.64e15),
    skills: {},
    job: null,
    jobsDone: num("jobsDone", 0, 1e6),
    grudge: num("grudge", 0, 100),
    throwsToday: num("throwsToday", 0, 1e6),
    throwsDay: typeof r.throwsDay === "string" ? r.throwsDay.slice(0, 10) : "",
    life: cleanLife(r.life, now),
    ears: cleanEars(r.ears),
  };
  const rawSkills = (r.skills ?? {}) as Record<string, unknown>;
  for (const u of upgrades) {
    const v = Math.floor(Number(rawSkills[u.id]));
    if (Number.isFinite(v) && v > 0) g.skills[u.id] = Math.min(u.max, v);
  }
  const rawJob = r.job as Partial<ActiveJob> | null | undefined;
  if (
    rawJob &&
    typeof rawJob.id === "string" &&
    jobById(rawJob.id) &&
    Number.isFinite(Number(rawJob.endsAt)) &&
    // A shift that ended while the app was closed is still paid out.
    Number(rawJob.endsAt) > now - 7 * 86400000
  )
    g.job = {
      id: rawJob.id,
      startedAt: Number(rawJob.startedAt) || now,
      endsAt: Number(rawJob.endsAt),
    };
  g.likability = num("likability", 0, likabilityMax(level(g.exp)));
  if (!Number.isFinite(Number(r.lastTick))) g.lastTick = now;
  return g;
}
const item = (
  id: string,
  name: string,
  kind: Item["kind"],
  price: number,
  [exp, strength, food, drink, health, feeling]: number[],
  desc: string,
): Item => ({
  id,
  name,
  kind,
  price,
  exp,
  strength,
  food,
  drink,
  health,
  feeling,
  icon: `/shop/${id}.png`,
  desc,
});
// Values ported from VPet `mod/0000_core/food/food.lps` and `drug.lps`:
// [exp, strength, food, drink, health, feeling].
export const items: Item[] = [
  item("juice", "Сок", "drink", 10.5, [8, 10, 4, 40, 3, 7], "Половину тебе, половину мне."),
  item("cola", "Кола", "drink", 9, [4, 10, 2, 50, -1, 50], "Сахар, газ и счастье."),
  item("tea", "Холодный чай", "drink", 16.5, [20, 10, 1, 60, 5, 12], "Чтобы не перегреться."),
  item("coconut", "Кокосовое молоко", "drink", 11.5, [8, 15, 4, 50, 2, 25], "Пляж не прилагается."),
  item("coffee", "Кофе", "functional", 12, [32, 80, 3, 20, -1, 0], "Проливать на клавиатуру не обязательно."),
  item("energy", "Энергетик", "functional", 22.5, [112, 80, 3, 20, -5, 20], "Сердце стучит — значит работает."),
  item("beer", "Пиво", "drink", 14, [10, -10, 5, 40, -3, 45], "Холодное. Последствия — твои."),
  item("popcorn", "Попкорн", "snack", 8.5, [8, 40, 30, -5, -1, 25], "Кино не включено."),
  item("icecream", "Мороженое", "snack", 10, [4, 40, 24, 5, -0.5, 50], "Холодное счастье."),
  item("chips", "Чипсы", "snack", 6.5, [8, 10, 28, -5, 0, 12], "Хрустит громче тебя."),
  item("chocolate", "Шоколад", "snack", 11, [8, 30, 38, -5, 0, 37], "Чистый дофамин."),
  item("candy", "Молочные конфеты", "snack", 6.5, [12, 8, 15, -2, 0, 37], "Сладкие, как ты. Почти."),
  item("sausage", "Сосиска", "snack", 9, [4, 40, 38, 0, -0.5, 0], "Мясная палка."),
  item("seeds", "Семечки", "snack", 8.5, [4, 30, 26, -2, 0, 37], "Щёлк-щёлк-щёлк."),
  item("sandwich", "Сэндвич", "meal", 28, [40, 80, 85, 0, 0, 37], "Быстро и по делу."),
  item("burger", "Бургер", "meal", 23, [40, 60, 60, 0, 0, 50], "Классика."),
  item("pizza", "Пицца", "meal", 46, [120, 100, 100, 0, 0, 50], "Целая. Делиться не буду."),
  item("pasta", "Паста с томатами", "meal", 42, [80, 100, 110, 0, 1, 50], "Итальянская, честно."),
  item("chicken", "Куриная ножка", "meal", 18.5, [40, 40, 40, 0, 0, 50], "Жареная, хрустящая."),
  item("waffle", "Вафли", "meal", 33.5, [56, 100, 80, 0, 0, 75], "С сиропом. Иначе зачем."),
  item("borscht", "Борщ", "meal", 42.5, [80, 100, 110, 0, 0, 75], "Со сметаной, естественно."),
  item("salad", "Салат", "meal", 49, [120, 80, 80, 0, 10, 12], "Полезно. Скучно, но полезно."),
  item("steak", "Стейк", "meal", 84.5, [180, 140, 150, 0, 10, 100], "Прожарка medium, как надо."),
  item("pork", "Свиная рулька", "meal", 46, [120, 100, 85, 0, 1, 75], "Тяжёлая артиллерия."),
  item("vitamin", "Витамин C", "drug", 16.5, [40, 0, 0, 0, 10, 0], "Для профилактики."),
  item("cold", "Порошок от простуды", "drug", 46.5, [160, 0, 0, 0, 20, 0], "Горячий, противный, работает."),
  item("power", "Пилюля силы", "drug", 94, [240, 20, 0, 0, 50, 50], "Состав не спрашивай."),
  item("aspirin", "Аспирин", "drug", 131.5, [400, 0, 0, 0, 65, 0], "От всего сразу."),
];
export const itemById = (id: string) => items.find((i) => i.id === id);
/** One line for the bubble when the pet is clicked: level, money, what hurts. */
export function statusLine(g: Game, now = Date.now()): string {
  const lvl = level(g.exp);
  const need = levelUpNeed(lvl) - levelUpNeed(lvl - 1);
  const have = g.exp - levelUpNeed(lvl - 1);
  const pct = Math.max(0, Math.min(99, Math.floor((have / Math.max(1, need)) * 100)));
  const parts = [tx("{lvl} уровень ({pct}%)", { lvl, pct }), money(g.money)];
  if (working(g, now)) {
    const left = Math.max(1, Math.ceil((g.job!.endsAt - now) / 60000));
    parts.push(tx("на работе, ещё {n} мин", { n: left }));
  } else if (g.health < 50) parts.push(tx("болею"));
  else if (g.food < 25) parts.push(tx("жрать хочу"));
  else if (g.drink < 25) parts.push(tx("пить хочу"));
  else if (g.strength < 20) parts.push(tx("сил нет"));
  else if (g.feeling < 30) parts.push(tx("настроение дно"));
  else parts.push(tx("настроение {n}", { n: Math.round(g.feeling) }));
  return parts.join(", ");
}
