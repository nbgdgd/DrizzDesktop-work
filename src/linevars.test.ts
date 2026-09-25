// Static audit of every place that fires a reaction: the event name must
// have a rule, and each variable its lines use ({app}, {n}, ...) must be passed
// by that call - otherwise the balloon shows a literal "{app}". Reads the
// sources with the TypeScript parser, so a new call site is checked too.
import { describe, expect, it } from "vitest";
import ts from "typescript";
import { phrases } from "./dialogue";
import { en } from "./lines.en";
import { rules } from "./director";

// The same raw-source import the i18n test uses (no Node types in the build).
const sources = import.meta.glob(["./*.ts", "!./*.test.ts"], { query: "?raw", import: "default", eager: true }) as Record<string, string>;
/** Filled in by Director.vars() for every line; {name}/{fact} lines are skipped when missing. */
const ALWAYS = new Set(["name", "fact", "pet"]);

interface Call {
  file: string;
  line: number;
  event: string;
  /** Keys of the vars object, or null when it is not a literal (unknown). */
  keys: string[] | null;
  /** A literal text was passed: the bank is not used at all. */
  text: boolean;
}

function calls(): { found: Call[]; dynamic: string[] } {
  const found: Call[] = [];
  const dynamic: string[] = [];
  for (const [file, text] of Object.entries(sources)) {
    const f = file.replace("./", "");
    const sf = ts.createSourceFile(f, text, ts.ScriptTarget.Latest, true);
    const visit = (n: ts.Node) => {
      if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && n.expression.name.text === "event" && n.arguments.length >= 2) {
        const [name, , , txt, vars] = n.arguments;
        const line = sf.getLineAndCharacterOfPosition(n.getStart()).line + 1;
        if (ts.isStringLiteral(name)) {
          let keys: string[] | null = [];
          if (vars && !(vars.kind === ts.SyntaxKind.UndefinedKeyword || (ts.isIdentifier(vars) && vars.text === "undefined"))) {
            keys = ts.isObjectLiteralExpression(vars)
              ? vars.properties.flatMap((p) => (p.name && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name)) ? [p.name.text] : ts.isSpreadAssignment(p) ? ["..."] : []))
              : null;
            if (keys?.includes("...")) keys = null;
          }
          const literalText = !!txt && !(ts.isIdentifier(txt) && txt.text === "undefined");
          found.push({ file: f, line, event: name.text, keys, text: literalText });
        } else dynamic.push(`${f}:${line} ${name.getText(sf)}`);
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
  }
  return { found, dynamic };
}
const varsOf = (lines: string[]) => new Set(lines.flatMap((l) => [...l.matchAll(/\{(\w+)\}/g)].map((m) => m[1])));
const banksFor = (event: string, table: Record<string, string[]>) =>
  Object.entries(table)
    .filter(([k]) => k === event || k.startsWith(event + "@") || k.startsWith(event + "~"))
    .flatMap(([, v]) => v);

describe("line variables at every call site", () => {
  const { found } = calls();
  it("finds the call sites", () => {
    expect(found.length).toBeGreaterThan(100);
  });
  it("every fired event has a rule", () => {
    const missing = [...new Set(found.map((c) => c.event))].filter((e) => !rules[e]);
    expect(missing).toEqual([]);
  });
  it("every variable a line uses is passed by the call", () => {
    const bad: string[] = [];
    for (const c of found) {
      if (c.keys === null || c.text) continue;
      const used = new Set([...varsOf(banksFor(c.event, phrases)), ...varsOf(banksFor(c.event, en))]);
      const miss = [...used].filter((v) => !ALWAYS.has(v) && !c.keys!.includes(v));
      if (miss.length) bad.push(`${c.file}:${c.line} ${c.event} lacks {${miss.join("}, {")}}`);
    }
    expect(bad).toEqual([]);
  });
  it("Russian and English banks of one event use the same variables", () => {
    const bad: string[] = [];
    for (const k of Object.keys(phrases)) {
      const ru = varsOf(phrases[k]),
        eng = varsOf(en[k] ?? []);
      const diff = [...ru].filter((v) => !eng.has(v)).concat([...eng].filter((v) => !ru.has(v)));
      if (diff.length) bad.push(`${k}: ${diff.join(", ")}`);
    }
    expect(bad).toEqual([]);
  });
});
describe("a line never shows a raw {variable}", () => {
  it("lines needing a variable the caller did not pass are skipped", async () => {
    const { Dialogue } = await import("./dialogue");
    const { defaults } = await import("./model");
    const s = { ...defaults, lang: "ru" as const, comments: true, mode: "normal" as const };
    let i = 0;
    // workDone lines use {job} and {pay}; only {pay} is passed.
    for (let k = 0; k < 30; k++) {
      const d = new Dialogue([], () => ((i = (i * 7 + 3) % 97) / 97));
      const t = d.choose("workDone", s, 0, true, { pay: "45 ₽" });
      expect(t).toBeDefined();
      expect(t).not.toMatch(/\{\w+\}/);
    }
  });
});
describe("translation happens when drawn, not when a module loads", () => {
  // tx() at module level runs before the language is set, so the text stays
  // Russian in English mode forever (it hit the shop tabs, game descriptions
  // and statistics periods).
  const all = import.meta.glob(["./**/*.ts", "./**/*.tsx", "!./**/*.test.ts"], { query: "?raw", import: "default", eager: true }) as Record<string, string>;
  it("no tx() call outside a function", () => {
    const bad: string[] = [];
    for (const [file, text] of Object.entries(all)) {
      const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
      const visit = (n: ts.Node, inFn: boolean) => {
        const fn = inFn || ts.isFunctionLike(n);
        if (!fn && ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === "tx")
          bad.push(`${file}:${sf.getLineAndCharacterOfPosition(n.getStart()).line + 1}`);
        ts.forEachChild(n, (c) => visit(c, fn));
      };
      visit(sf, false);
    }
    expect(bad).toEqual([]);
  });
});
