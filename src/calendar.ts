import { tx } from "./i18n";
// Time of day, weekends and the few dates the pet cares about. Local time;
// the user's birthday comes from Memory ("MM-DD"), never from the network.
export type DayPart = "night" | "morning" | "day" | "evening";
export function dayPart(now: number): DayPart {
  const h = new Date(now).getHours();
  return h < 5 ? "night" : h < 11 ? "morning" : h < 18 ? "day" : h < 23 ? "evening" : "night";
}
export const weekend = (now: number) => [0, 6].includes(new Date(now).getDay());
/** "Night" days start at 05:00: 01:30 on the 3rd still belongs to the 2nd. */
export function nightKey(now: number): string {
  return new Date(now - 5 * 3600000).toLocaleDateString("sv");
}
export interface Holiday {
  id: "newyear" | "halloween" | "birthday" | "petday" | "valentine";
  name: string;
  /** Accessory the pet puts on for the day. */
  wear: string;
}
const md = (now: number) => {
  const d = new Date(now);
  return `${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
/** Today's occasion, if any. `birthday` is "MM-DD" or "". */
export function holiday(now: number, birthday = "", since = 0): Holiday | null {
  const today = md(now);
  if (birthday && today === birthday) return { id: "birthday", name: tx("твой день рождения"), wear: "party" };
  if (["12-31", "01-01", "01-02"].includes(today)) return { id: "newyear", name: tx("Новый год"), wear: "santa" };
  if (today === "10-31") return { id: "halloween", name: tx("Хэллоуин"), wear: "pumpkin" };
  if (today === "02-14") return { id: "valentine", name: tx("день всех влюблённых"), wear: "bow" };
  if (since && now - since > 300 * 86400000 && md(since) === today)
    return { id: "petday", name: tx("годовщина знакомства"), wear: "party" };
  return null;
}
export function cleanBirthday(v: unknown): string {
  return typeof v === "string" && /^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(v) ? v : "";
}
