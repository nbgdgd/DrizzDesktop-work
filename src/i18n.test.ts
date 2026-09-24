// Every Russian literal passed to tx() has an English entry with the same
// placeholders; data tables translated at display time too.
/// <reference types="vite/client" />
import { describe, expect, it } from "vitest";
import { EN } from "./i18n.en";
import { getLang, money, setLang, tx } from "./i18n";
import { items, jobs, upgrades } from "./game";
import { achievements, stageNames } from "./chronicle";
import { accessories } from "./props";
import { gameNames } from "./minigames";
import { temper } from "./character";
import { pets } from "./model";
const sources = import.meta.glob(["./**/*.ts", "./**/*.tsx", "!./**/*.test.ts"], { query: "?raw", import: "default", eager: true }) as Record<string, string>;
const literals = () => {
  const out = new Set<string>();
  for (const text of Object.values(sources))
    for (const m of text.matchAll(/\btx\(\s*"((?:[^"\\]|\\.)*)"/g)) out.add(JSON.parse(`"${m[1]}"`));
  return [...out];
};
const vars = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");
describe("interface language", () => {
  it("has English for every tx() literal, with the same placeholders", () => {
    expect(literals().length).toBeGreaterThan(400);
    const missing = literals().filter((s) => /[А-Яа-яЁё]/.test(s) && !(s in EN));
    expect(missing).toEqual([]);
    for (const s of literals()) if (EN[s]) expect(vars(EN[s]), s).toBe(vars(s));
  });
  it("has English for the data shown through tx(name)", () => {
    const shown = [
      ...items.flatMap((i) => [i.name, i.desc]),
      ...jobs.flatMap((j) => [j.name, j.desc]),
      ...upgrades.flatMap((u) => [u.name, u.desc, u.step]),
      ...achievements.flatMap((a) => [a.name, a.desc]),
      ...stageNames,
      ...accessories.map((a) => a.name),
      ...Object.values(gameNames),
      ...pets.map((p) => p.trait),
      ...pets.map((p) => temper(p.id).trait),
    ];
    expect(shown.filter((s) => !(s in EN))).toEqual([]);
  });
  it("switches at runtime and falls back to Russian", () => {
    setLang("en");
    expect(getLang()).toBe("en");
    expect(tx("нужен уровень {n}", { n: 3 })).toBe("needs level 3");
    expect(tx("строка без перевода")).toBe("строка без перевода");
    expect(money(1200)).toBe("$1,200");
    setLang("ru");
    expect(tx("нужен уровень {n}", { n: 3 })).toBe("нужен уровень 3");
    expect(money(1200)).toMatch(/1\s200 ₽/);
  });
});
describe("credits", () => {
  it("every pet is credited, with its terms in both languages", async () => {
    const { petCredits, otherCredits } = await import("./credits");
    for (const p of pets) {
      const c = petCredits.find((x) => x.id === p.id);
      expect(c, p.id).toBeDefined();
      expect(c!.url).toMatch(/^https:\/\//);
    }
    for (const c of [...petCredits, ...otherCredits]) {
      expect(c.url, c.id).toMatch(/^https:\/\/[^\s"'<>]+$/);
      expect(EN[c.terms], c.terms).toBeDefined();
    }
  });
});
