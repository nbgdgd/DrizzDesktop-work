// Interface language. Strings are written in Russian right in the code and
// wrapped in `tx()`; in English they are looked up in i18n.en.ts by the
// Russian text itself (gettext style), so a missing entry falls back to
// Russian instead of breaking. `{name}` placeholders are filled from `vars`.
import type { Lang } from "./model";
import { EN } from "./i18n.en";
let current: Lang = "ru";
export function setLang(lang: Lang) {
  current = lang === "en" ? "en" : "ru";
  if (typeof document !== "undefined") document.documentElement.lang = current;
}
export const getLang = () => current;
export function tx(ru: string, vars?: Record<string, string | number>): string {
  let s = current === "en" ? (EN[ru] ?? ru) : ru;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v));
  return s;
}
/** Money as the pet says it: "120 ₽" in Russian, "$120" in English. */
export const money = (n: number) => (current === "en" ? `$${Math.floor(n).toLocaleString("en")}` : `${Math.floor(n).toLocaleString("ru")} ₽`);
/** Russian plural: 1 минута, 2 минуты, 5 минут. English takes [one, many]. */
export function plural(n: number, ru: [string, string, string], en: [string, string]): string {
  if (current === "en") return n === 1 ? en[0] : en[1];
  const a = Math.abs(n) % 100,
    b = a % 10;
  return a > 10 && a < 20 ? ru[2] : b === 1 ? ru[0] : b >= 2 && b <= 4 ? ru[1] : ru[2];
}
