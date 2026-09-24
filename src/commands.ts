// Text commands from the chat ("сядь", "иди сюда", "спать", "отвали"…) and
// whether the pet feels like obeying: depends on the relationship, the
// grudge, hunger and the character. Pure; the scene carries them out.
import type { Temper } from "./character";
export type Command = "sit" | "come" | "sleep" | "go" | "jump" | "dance" | "play" | "rps" | "hand" | "clicker" | "catch" | "wake" | "guard" | "clean";
const words: [RegExp, Command][] = [
  [/^(сядь|сиди|сесть|садись|sit)\b/i, "sit"],
  [/^(иди сюда|ко мне|сюда|к ноге|come|here)\b/i, "come"],
  [/^(спать|спи|усни|ложись|баиньки|sleep)\b/i, "sleep"],
  [/^(отвали|уйди|свали|пошёл вон|пошел вон|уходи|брысь|go away)\b/i, "go"],
  [/^(прыгни|прыгай|прыг|jump)\b/i, "jump"],
  [/^(танцуй|потанцуй|танец|dance)\b/i, "dance"],
  [/^(играть|поиграем|давай играть|игра|play)\b/i, "play"],
  [/^(камень|ножницы|бумага|кнб)\b/i, "rps"],
  [/^(угадай|в какой руке)\b/i, "hand"],
  [/^(кликер|кликай)\b/i, "clicker"],
  [/^(поймай|догони|лови|поймай курсор)\b/i, "catch"],
  [/^(проснись|подъём|подъем|вставай|wake)\b/i, "wake"],
  [/^(охраняй|сторожи|на пост|guard)\b/i, "guard"],
  [/^(уберись|почисти|уборка|clean)\b/i, "clean"],
];
export function parse(text: string): { cmd: Command; arg: string } | null {
  const t = text.trim().toLowerCase().replace(/[!.?,]+$/g, "");
  for (const [re, cmd] of words) {
    const m = t.match(re);
    if (m) return { cmd, arg: t.slice(m[0].length).trim() };
  }
  return null;
}
export interface Obedience {
  stage: number;
  grudge: number;
  hungry: boolean;
  temper: Temper;
  random: () => number;
}
/**
 * Chance to obey: friends almost always do, strangers and offended pets
 * mostly refuse; "go away" is always obeyed (and taken personally).
 */
export function obeys(cmd: Command, o: Obedience): boolean {
  if (["go", "play", "rps", "hand", "clicker", "catch", "clean", "guard"].includes(cmd)) return true;
  let p = 0.35 + o.stage * 0.15;
  p -= o.grudge / 150;
  if (o.hungry) p -= 0.2;
  // Nezuko will do anything that involves moving; Aqua does not want to.
  if (o.temper.chase === "aggressive" && ["come", "jump", "dance"].includes(cmd)) p += 0.2;
  if (o.temper.chase === "lazy" && ["come", "jump", "dance"].includes(cmd)) p -= 0.15;
  if (o.temper.chase === "lazy" && cmd === "sleep") p += 0.3;
  return o.random() < Math.max(0.05, Math.min(0.97, p));
}
