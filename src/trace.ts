// Types and wording for process tracing and load spikes (Rust: trace.rs,
// load.rs). Kept apart from the director so the phrasing of "who launched
// what" can be unit-tested without a snapshot.
import { appName } from "./apps";
import { tx } from "./i18n";

export interface TraceProc {
  pid: number;
  name: string;
  path: string;
  location: "system" | "programs" | "appdata" | "temp" | "other" | "unknown";
  signed: boolean | null;
  role: string;
}
export interface TraceEvent {
  id: number;
  time: number;
  first: number;
  kind: "console" | "script" | "tool" | "temp-exe";
  child: TraceProc;
  origin: TraceProc | null;
  chain: string[];
  visible: boolean;
  flash: boolean;
  flags: string[];
  score: number;
  verdict: "ok" | "notice" | "suspicious";
  trusted: boolean;
  repeat: number;
  speak: "none" | "visible" | "background" | "alert";
  via?: TraceProc | null;
  script?: string;
}
const scriptName = (s: string) =>
  s.startsWith("(") ? tx(s) : s.startsWith("модуль ") ? tx("модуль {m}", { m: s.slice(7) }) : s.split(/[\\/]/).pop() || s;
/// "скрипт bot.py через python" / "" — the middle of the chain in words.
export function viaLabel(e: TraceEvent) {
  const interp = e.via ?? (e.script ? e.child : null);
  if (!interp && !e.script) return "";
  const who = interp ? appName(interp.name) : "";
  if (e.script) return who ? tx("скрипт {s} через {who}", { s: scriptName(e.script), who }) : tx("скрипт {s}", { s: scriptName(e.script) });
  return who ? tx("через {who}", { who }) : "";
}
/// Best file to show for an event: the script if it is a real path, else
/// the origin executable.
export function revealTarget(e: TraceEvent): string {
  if (e.script && /^[a-z]:[\\/]/i.test(e.script)) return e.script;
  return e.origin?.path || e.via?.path || "";
}
export interface Culprit {
  pid: number;
  name: string;
  path: string;
  pct: number;
}
export interface Spike {
  kind: "cpu" | "gpu";
  value: number;
  base: number;
  top: Culprit[];
}
export interface LoadState {
  cpu: number | null;
  gpu: number | null;
  cpuBase: number | null;
  gpuBase: number | null;
  gpuAvailable: boolean;
  gpuTop: Culprit | null;
}

export interface AutorunEntry {
  id: string;
  scope: string;
  name: string;
  command: string;
  target: string;
  location: TraceProc["location"];
  signed: boolean | null;
  user: boolean;
}
export interface AutorunChange {
  kind: "added" | "changed";
  entry: AutorunEntry;
}
export const scopeLabel = (scope: string) =>
  tx(({
    "hkcu-run": "реестр пользователя (Run)",
    "hkcu-runonce": "реестр пользователя (RunOnce)",
    "hklm-run": "реестр для всех пользователей (Run)",
    "hklm-runonce": "реестр для всех (RunOnce)",
    "hklm32-run": "реестр для всех, 32-бит (Run)",
    "startup-user": "папка «Автозагрузка»",
    "startup-common": "общая папка «Автозагрузка»",
  })[scope] ?? scope);
export function autorunSpeech(c: AutorunChange) {
  const e = c.entry;
  const fake = { location: e.location, signed: e.signed } as TraceProc;
  const details = [whereLabel(fake), signLabel(fake)].filter(Boolean).join(", ");
  const risky =
    e.location === "temp" ||
    (e.signed === false && !["system", "programs"].includes(e.location));
  return {
    event: c.kind === "changed" ? "autorunChanged" : risky ? "autorunRisky" : "autorunAdded",
    vars: {
      name: e.name,
      details: details ? ` (${details})` : "",
      scope: scopeLabel(e.scope),
    },
  };
}
export const flagLabels: Record<string, string> = {
  encoded: "закодированная команда",
  hidden: "скрытое окно",
  bypass: "обход политики скриптов",
  "exec-string": "выполнение строки как кода",
  decode: "декодирование base64",
  network: "обращение в сеть",
  lolbin: "системная утилита в нетипичной роли",
  persistence: "автозапуск / задача планировщика",
  "office-parent": "запущено из Office",
  "browser-parent": "запущено из браузера",
  "temp-origin": "источник во временной папке или Загрузках",
  "appdata-origin": "источник в AppData",
  "unsigned-origin": "источник без цифровой подписи",
  background: "без окна, в фоне",
  flash: "мелькнуло и закрылось",
};

const childNames: Record<string, string> = {
  "cmd.exe": "командная строка",
  "powershell.exe": "PowerShell",
  "pwsh.exe": "PowerShell",
  "powershell_ise.exe": "PowerShell ISE",
  "wscript.exe": "скрипт Windows Script Host",
  "cscript.exe": "консольный скрипт cscript",
  "mshta.exe": "HTML-приложение mshta",
};
export const childName = (exe: string) => (childNames[exe] ? tx(childNames[exe]) : exe);
export const flagLabel = (f: string) => (flagLabels[f] ? tx(flagLabels[f]) : f);

export const whereLabel = (p: TraceProc) =>
  tx(({
    system: "из папки Windows",
    programs: "из Program Files",
    appdata: "из AppData",
    temp: "из временной папки",
    other: "",
    unknown: "",
  })[p.location] ?? "");

export const signLabel = (p: TraceProc) =>
  tx(p.signed === true
    ? "подписан"
    : p.signed === false
      ? "без подписи"
      : p.location === "system"
        ? "компонент Windows"
        : "");

export const originLabel = (p: TraceProc | null) =>
  p ? appName(p.name) + (p.role ? ` (${tx(p.role)})` : "") : "";

/// Director event name and phrase variables for a trace notification.
/// `detail` (vigilance and brains upgrades) adds more flags and, from 2 up,
/// the launch chain to the explanation.
export function traceSpeech(
  e: TraceEvent,
  detail = 0,
): { event: string; vars: Record<string, string>; direct: boolean } | null {
  if (e.speak === "none") return null;
  const o = e.origin;
  const details = o
    ? [whereLabel(o), signLabel(o)].filter(Boolean).join(", ")
    : "";
  const via = viaLabel(e);
  const chain =
    detail >= 2 && e.chain.length > 1 ? tx("; цепочка: {chain}", { chain: e.chain.slice(0, 4).map(appName).join(" ← ") }) : "";
  const vars = {
    child: childName(e.child.name),
    origin: originLabel(o) + (via ? ` (${via})` : ""),
    details: (details ? `, ${details}` : "") + chain,
    flags: e.flags
      .filter((f) => !["background", "flash"].includes(f))
      .slice(0, 2 + Math.max(0, detail))
      .map(flagLabel)
      .join(", "),
  };
  if (e.speak === "alert") return { event: "traceAlert", vars, direct: true };
  if (!o) return { event: "traceOrphan", vars, direct: e.visible };
  if (e.speak === "visible")
    return {
      event: e.flash ? "traceFlash" : "traceVisible",
      vars,
      direct: true,
    };
  return { event: "traceBackground", vars, direct: false };
}

export function spikeSpeech(s: Spike): {
  event: string;
  vars: Record<string, string>;
} {
  const top = s.top[0];
  return {
    event:
      (s.kind === "gpu" ? "gpuSpike" : "cpuSpike") + (top ? "" : "Anon"),
    vars: {
      pct: String(Math.round(s.value)),
      base: String(Math.round(s.base)),
      top: top ? appName(top.name) : "",
      share: top ? String(Math.round(top.pct)) : "",
    },
  };
}
