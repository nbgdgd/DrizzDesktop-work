// "Береги уши": listening on headphones, per ear. The weekly sound dose
// follows WHO / ITU-T H.870 (safe listening): 100 % is the energy of 80 dBA
// for 40 hours a week (75 dBA in the gentle mode), with a 3 dB exchange rate
// (+3 dB halves the allowed time). The level is estimated from the Windows
// volume of each channel and the loudest level the headphones can make
// (`earsMax`, ~100 dB for typical earbuds at full volume) minus the typical
// gap between a music master's peak and its average (MUSIC_GAP). It is an
// estimate, not a measurement: the page says so.
//
// Pure: `earTick` takes the log, one sample and the settings and returns the
// new log, the lines to say and the per-ear gains to apply (balance and the
// ear-rest mode). Director.heartbeat calls it every couple of seconds.
export interface EarDay {
  day: string;
  /** Dose, fraction of the weekly allowance (1 = 100 %). */
  l: number;
  r: number;
  /** Minutes of listening on headphones. */
  min: number;
}
export interface EarLog {
  days: EarDay[];
  /** Current listening session, ms (resets after 5 quiet minutes). */
  session: number;
  sessionStart: number;
  lastSound: number;
  /** Since when the estimate stays at or above LOUD, 0 = not loud. */
  loudSince: number;
  /** Headphones were on in the previous sample. */
  hp: boolean;
  /** Ear rest: which ear is quieter now and since when. */
  restSide: "" | "l" | "r";
  restSince: number;
  /** One-off lines: key -> day or time they were said. */
  said: Record<string, string | number>;
}
export interface EarSample {
  headphones: boolean;
  playing: boolean;
  muted: boolean;
  /** Master volume 0..100, -1 unknown. */
  volume: number;
  /** Master and per-channel levels in dB (0 = full); -100 unknown. */
  db?: number;
  left?: number;
  right?: number;
  /** Balance / ear-rest gains applied in the mixer (balance.rs), 0..1 amplitude. */
  gains?: [number, number];
}
export interface EarSettings {
  ears: boolean;
  /** 80: adults (WHO mode 1), 75: gentle (mode 2). */
  earsNorm: number;
  /** "auto": only headphones/headsets; "always": count any output. */
  earsDevice: "auto" | "always";
  /** Loudest level of the headphones at full volume, dB SPL. */
  earsMax: number;
  /** Minutes of continuous listening before a break reminder. */
  earsBreak: number;
  /** Lower the volume by itself when the weekly dose runs out. */
  earsAutoLower: boolean;
  /** Ear rest: one ear quieter at a time, swapping every N minutes. */
  earsRest: boolean;
  earsRestMinutes: number;
  /** How much quieter the resting ear is, percent. */
  earsRestDim: number;
  /** -100 (only left) ... 0 ... 100 (only right). */
  balance: number;
  lateHour: number;
}
export interface EarEvent {
  name: string;
  vars?: Record<string, string>;
  /** Offer the "make it quieter" button. */
  lower?: boolean;
}
export const MUSIC_GAP = 12;
/** An estimate at or above this (dBA) for a few minutes is "loud". */
export const LOUD = 85;
export const VERY_LOUD = 92;
/** Volume the "make it quieter" button sets: about 75 dBA on average music. */
export const SAFE_DB = 75;
const QUIET_GAP = 5 * 60000;
export const emptyEars = (): EarLog => ({
  days: [],
  session: 0,
  sessionStart: 0,
  lastSound: 0,
  loudSince: 0,
  hp: false,
  restSide: "",
  restSince: 0,
  said: {},
});
export const dayKey = (now: number) => {
  const d = new Date(now);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
/** Windows' volume taper, roughly: 50 % ≈ −10 dB, 25 % ≈ −20 dB. */
export const volumeDb = (volume: number) => (volume <= 0 ? -100 : 33.2 * Math.log10(Math.min(100, volume) / 100));
/** Inverse of volumeDb: the Windows volume (0..1) that gives `db`. */
export const dbVolume = (db: number) => Math.max(0.02, Math.min(1, 10 ** (db / 33.2)));
/** Estimated average level at the ear, dBA, for a channel level in dB. */
export const earLevel = (channelDb: number, max: number) => (channelDb <= -99 ? 0 : max + channelDb - MUSIC_GAP);
/** Hours a week one may listen at `level` dBA for 100 % of the dose. */
export const allowedHours = (level: number, norm: number) => 40 * 10 ** ((norm - level) / 10);
/** Estimated levels of the left and right ear from a sample. */
export function levels(e: EarSample, max: number): [number, number] {
  const fallback = volumeDb(e.volume);
  const known = (v?: number) => (v !== undefined && v > -99 ? v : fallback);
  // Mixer gains are linear amplitude: 0.5 = −6 dB; a muted ear gets nothing.
  const gain = (g = 1) => (g <= 0.001 ? -100 : 20 * Math.log10(Math.min(1, g)));
  const ear = (db: number, g?: number) => (db + gain(g) <= -99 ? 0 : earLevel(db + gain(g), max));
  return [ear(known(e.left), e.gains?.[0]), ear(known(e.right), e.gains?.[1])];
}
/** Weekly dose per ear, fractions: the last seven days including today. */
export function weekly(log: EarLog, now: number): { l: number; r: number; min: number } {
  const from = now - 7 * 86400000;
  let l = 0,
    r = 0,
    min = 0;
  for (const d of log.days)
    if (new Date(d.day + "T12:00:00").getTime() > from) {
      l += d.l;
      r += d.r;
      min += d.min;
    }
  return { l, r, min };
}
/** Per-ear gains from the balance and the resting ear. */
export function gains(s: EarSettings, restSide: EarLog["restSide"]): [number, number] {
  const b = Math.max(-100, Math.min(100, s.balance)) / 100;
  let l = b > 0 ? 1 - b : 1,
    r = b < 0 ? 1 + b : 1;
  const dim = 1 - Math.max(0, Math.min(90, s.earsRestDim)) / 100;
  if (restSide === "l") l *= dim;
  if (restSide === "r") r *= dim;
  const top = Math.max(l, r, 0.01);
  return [Math.round((l / top) * 100) / 100, Math.round((r / top) * 100) / 100];
}
const sideName = (side: "l" | "r", lang: string) =>
  lang === "en" ? (side === "l" ? "left" : "right") : side === "l" ? "левое" : "правое";
/** One step. `dt` is the time since the previous sample, ms (capped). */
export function earTick(
  prev: EarLog,
  e: EarSample,
  s: EarSettings,
  now: number,
  dt: number,
  lang = "ru",
): { log: EarLog; events: EarEvent[]; gains: [number, number] } {
  const log: EarLog = { ...prev, days: prev.days.map((d) => ({ ...d })), said: { ...prev.said } };
  const events: EarEvent[] = [];
  const today = dayKey(now);
  const step = Math.max(0, Math.min(dt, 60000));
  const onHeadphones = e.headphones || s.earsDevice === "always";
  const listening = s.ears && e.playing && !e.muted && onHeadphones;
  const cool = (key: string, ms: number) => {
    const t = Number(log.said[key] ?? 0);
    if (now - t < ms) return false;
    log.said[key] = now;
    return true;
  };
  // Headphones plugged in (with sound on the way): a short "I'm watching".
  if (s.ears && e.headphones && !log.hp && cool("on", 30 * 60000)) events.push({ name: "earsOn" });
  log.hp = e.headphones;
  if (!log.days.length || log.days[log.days.length - 1].day !== today) log.days.push({ day: today, l: 0, r: 0, min: 0 });
  log.days = log.days.slice(-8);
  const day = log.days[log.days.length - 1];
  const [ll, lr] = levels(e, s.earsMax);
  const loudest = Math.max(ll, lr);
  if (listening) {
    const h = step / 3600000;
    day.l += h / allowedHours(ll, s.earsNorm);
    day.r += h / allowedHours(lr, s.earsNorm);
    day.min += step / 60000;
    if (!log.sessionStart || now - log.lastSound > QUIET_GAP) log.sessionStart = now - step;
    log.session = now - log.sessionStart;
    log.lastSound = now;
  } else if (log.sessionStart && now - log.lastSound > QUIET_GAP) {
    // A real break: five quiet minutes (or the headphones came off).
    if (log.session >= 45 * 60000 && s.ears) events.push({ name: "earsRested" });
    log.session = 0;
    log.sessionStart = 0;
  }
  const minutes = Math.round(log.session / 60000);
  const week = weekly(log, now);
  const dose = Math.max(week.l, week.r);
  if (listening) {
    if (log.session >= 2 * 60000 && log.said.hello !== today) {
      log.said.hello = today;
      events.push({ name: "earsHello", vars: { db: String(Math.round(loudest)) } });
    }
    // Loud: a spike right after turning it up, or a few minutes on end.
    log.loudSince = loudest >= LOUD ? log.loudSince || now : 0;
    if (loudest >= VERY_LOUD && cool("veryLoud", 10 * 60000))
      events.push({ name: "earsVeryLoud", vars: { db: String(Math.round(loudest)) }, lower: true });
    else if (log.loudSince && now - log.loudSince >= 3 * 60000 && cool("loud", 20 * 60000))
      events.push({ name: "earsLoud", vars: { db: String(Math.round(loudest)) }, lower: true });
    // Breaks: first at earsBreak minutes, then every half hour, louder.
    const first = Math.max(15, s.earsBreak) * 60000;
    if (log.session >= first) {
      const n = 1 + Math.floor((log.session - first) / (30 * 60000));
      const key = `break:${log.sessionStart}`;
      if (Number(log.said[key] ?? 0) < n) {
        for (const k of Object.keys(log.said)) if (k.startsWith("break:")) delete log.said[k];
        log.said[key] = n;
        events.push({ name: n === 1 ? "earsBreak" : "earsBreakLong", vars: { min: String(minutes) } });
      }
    }
    // Night: late, on headphones for a while.
    const hour = new Date(now).getHours();
    const night = hour >= s.lateHour || hour < 5;
    const nightKey = dayKey(now - 5 * 3600000);
    if (night && log.session >= 20 * 60000 && log.said.night !== nightKey) {
      log.said.night = nightKey;
      events.push({ name: "earsNight", lower: loudest >= 70 });
    }
  } else log.loudSince = 0;
  // Weekly dose milestones, each once until the dose drops back.
  const mark = Number(log.said.dose ?? 0);
  const reached = dose >= 1 ? 100 : dose >= 0.8 ? 80 : dose >= 0.5 ? 50 : 0;
  if (reached > mark && s.ears) {
    log.said.dose = reached;
    events.push({ name: `earsDose${reached}`, vars: { pct: String(Math.round(dose * 100)) }, lower: reached === 100 });
    if (reached === 100 && s.earsAutoLower && listening) events.push({ name: "earsLowered" });
  } else if (reached < mark && dose < mark / 100 - 0.1) log.said.dose = reached;
  // One ear takes much more than the other (balance, one-sided listening).
  const hi = Math.max(week.l, week.r),
    lo = Math.min(week.l, week.r);
  if (s.ears && hi >= 0.4 && hi > lo * 1.6 && log.said.uneven !== today) {
    log.said.uneven = today;
    events.push({ name: "earsUneven", vars: { side: sideName(week.l > week.r ? "l" : "r", lang) } });
  }
  // Ear rest: one ear quieter, swapping every N minutes while listening.
  if (s.ears && s.earsRest && listening) {
    const every = Math.max(5, s.earsRestMinutes) * 60000;
    if (!log.restSide || now - log.restSince >= every) {
      log.restSide = log.restSide === "l" ? "r" : "l";
      log.restSince = now;
      events.push({ name: "earsRestSwap", vars: { side: sideName(log.restSide, lang) } });
    }
  } else if (!s.earsRest || !s.ears || (log.restSide && now - log.lastSound > QUIET_GAP)) {
    log.restSide = "";
    log.restSince = 0;
  }
  return { log, events, gains: gains(s, s.ears ? log.restSide : "") };
}
/** Clean a stored log (from state.json). */
export function cleanEars(raw: unknown): EarLog {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const num = (v: unknown, max = 8.64e15) => (Number.isFinite(Number(v)) ? Math.max(0, Math.min(max, Number(v))) : 0);
  const days = Array.isArray(r.days)
    ? (r.days as Record<string, unknown>[])
        .filter((d) => d && typeof d.day === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d.day as string))
        .map((d) => ({ day: d.day as string, l: num(d.l, 1000), r: num(d.r, 1000), min: num(d.min, 1440) }))
        .slice(-8)
    : [];
  const said: Record<string, string | number> = {};
  if (r.said && typeof r.said === "object")
    for (const [k, v] of Object.entries(r.said as Record<string, unknown>).slice(-20))
      if (k.length <= 40 && (typeof v === "string" || typeof v === "number")) said[k] = typeof v === "string" ? v.slice(0, 20) : v;
  return {
    days,
    session: num(r.session),
    sessionStart: num(r.sessionStart),
    lastSound: num(r.lastSound),
    loudSince: num(r.loudSince),
    hp: r.hp === true,
    restSide: r.restSide === "l" || r.restSide === "r" ? r.restSide : "",
    restSince: num(r.restSince),
    said,
  };
}
