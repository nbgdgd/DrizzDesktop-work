// Focus timer (pomodoro) and health reminders. Pure: Director.heartbeat
// calls `focusTick` and `remindTick` every couple of seconds and says the
// events they return.
//  * Focus: 25 minutes of quiet (the pet keeps its lines to itself, like
//    during a shift, and leaves the cursor alone), then it calls a break;
//    after the break it calls you back; every fourth break is a long one.
//  * Reminders: water, posture, eyes (20-20-20: every 20 minutes look 20 feet,
//    6 m, away for 20 seconds). Counted in time you are actually at the PC,
//    held back during focus, said at the next break instead.
export interface Focus {
  phase: "" | "focus" | "break";
  /** When the current phase ends, ms. */
  until: number;
  /** Focus rounds finished in this run. */
  round: number;
  /** When the current phase started, ms (for the progress bar). */
  since: number;
}
export const noFocus: Focus = { phase: "", until: 0, round: 0, since: 0 };
export interface FocusSettings {
  focusMinutes: number;
  breakMinutes: number;
  longBreakMinutes: number;
}
export interface Reminders {
  /** Time at the PC since the last reminder of each kind, ms. */
  water: number;
  posture: number;
  eyes: number;
}
export const noReminders: Reminders = { water: 0, posture: 0, eyes: 0 };
export interface ReminderSettings {
  /** Minutes at the PC between reminders, 0 = off. */
  remindWater: number;
  remindPosture: number;
  remindEyes: number;
}
export const startFocus = (s: FocusSettings, now: number, round = 0): Focus => ({ phase: "focus", until: now + s.focusMinutes * 60000, round, since: now });
export const focusProgress = (f: Focus, now: number) => (f.phase ? Math.max(0, Math.min(1, (now - f.since) / Math.max(1, f.until - f.since))) : 0);
/** One step; events: focusBreak / focusLongBreak (vars min), focusBack. */
export function focusTick(f: Focus, s: FocusSettings, now: number): { focus: Focus; events: { name: string; vars?: Record<string, string> }[] } {
  if (!f.phase || now < f.until) return { focus: f, events: [] };
  if (f.phase === "focus") {
    const round = f.round + 1;
    const long = round % 4 === 0;
    const min = long ? s.longBreakMinutes : s.breakMinutes;
    return {
      focus: { phase: "break", until: now + min * 60000, round, since: now },
      events: [{ name: long ? "focusLongBreak" : "focusBreak", vars: { min: String(min), n: String(round) } }],
    };
  }
  return { focus: startFocus(s, now, f.round), events: [{ name: "focusBack", vars: { min: String(s.focusMinutes) } }] };
}
/**
 * Reminders due now. `idle`: ms since the last input (time away does not
 * count; five minutes away rests the eyes and the back); `hold`: not now
 * (focus, fullscreen, the pet is hidden), counted but not said.
 */
export function remindTick(r: Reminders, s: ReminderSettings, dt: number, idle: number, hold: boolean): { reminders: Reminders; due: string[] } {
  const next = { ...r };
  const due: string[] = [];
  const step = idle < 120000 ? Math.max(0, Math.min(dt, 60000)) : 0;
  if (idle >= 300000) next.eyes = next.posture = 0;
  for (const [k, event, every] of [
    ["eyes", "remindEyes", s.remindEyes],
    ["posture", "remindPosture", s.remindPosture],
    ["water", "remindWater", s.remindWater],
  ] as const) {
    if (!every) {
      next[k] = 0;
      continue;
    }
    next[k] += step;
    if (next[k] >= every * 60000 && !hold) {
      next[k] = 0;
      // One at a time: the others wait for the next tick.
      if (!due.length) due.push(event);
      else next[k] = every * 60000;
    }
  }
  return { reminders: next, due };
}
