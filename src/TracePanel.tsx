import { useEffect, useState } from "react";
import { command, on } from "./bridge";
import { appName } from "./apps";
import {
  AutorunEntry,
  LoadState,
  scopeLabel,
  TraceEvent,
  childName,
  revealTarget,
  viaLabel,
  flagLabels,
  signLabel,
  whereLabel,
} from "./trace";

interface Autoruns {
  entries: AutorunEntry[];
  quarantine: { entry: AutorunEntry; removed: number }[];
  pending: string[];
}
interface View {
  events: TraceEvent[];
  load: LoadState;
  enabled: boolean;
}
const verdictText = {
  ok: "обычно",
  notice: "обратить внимание",
  suspicious: "подозрительно",
};
const time = (t: number) =>
  new Date(t).toLocaleString("ru", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
const pct = (v: number | null | undefined) =>
  v === null || v === undefined ? "—" : `${Math.round(v)}%`;

// Process-trace journal: who launched which console, plus live CPU/GPU.
export function TracePanel({
  trusted,
  trust,
  onError,
}: {
  trusted: string[];
  trust: (exe: string) => void;
  onError: (e: string) => void;
}) {
  const [view, setView] = useState<View | null>(null);
  const [filter, setFilter] = useState<"all" | "visible" | "flagged">("all");
  const [autoruns, setAutoruns] = useState<Autoruns | null>(null);
  const [busy, setBusy] = useState("");
  const loadAutoruns = () =>
    void command<Autoruns>("autorun_view")
      .then((a) => a && setAutoruns(a))
      .catch((e) => onError(String(e)));
  useEffect(() => {
    loadAutoruns();
    const t = setInterval(loadAutoruns, 5000);
    let off: (() => void) | undefined;
    let gone = false;
    void on("autorun", () => loadAutoruns()).then((f) => {
      if (gone) f();
      else off = f;
    });
    return () => {
      gone = true;
      clearInterval(t);
      off?.();
    };
  }, []);
  const autorunAction = (cmd: string, id: string) => {
    setBusy(id);
    void command(cmd, { id })
      .then(() => loadAutoruns())
      .catch((e) => onError(String(e)))
      .finally(() => setBusy(""));
  };
  useEffect(() => {
    let gone = false;
    const load = () =>
      void command<View>("trace_view")
        .then((v) => {
          if (!gone && v) setView(v);
        })
        .catch((e) => onError(String(e)));
    load();
    const timer = setInterval(load, 2000);
    let off: (() => void) | undefined;
    void on<TraceEvent>("trace", () => load()).then((f) => {
      if (gone) f();
      else off = f;
    });
    return () => {
      gone = true;
      clearInterval(timer);
      off?.();
    };
  }, []);
  if (!view) return <p className="muted">Загрузка…</p>;
  const l = view.load;
  const events = view.events.filter((e) =>
    filter === "visible"
      ? e.visible || e.flash
      : filter === "flagged"
        ? e.verdict !== "ok"
        : true,
  );
  return (
    <>
      <p className="intro">
        Питомец следит, какие программы запускают командную строку, PowerShell,
        скрипты и системные утилиты, и откуда они взялись. Ничего не
        блокируется и не завершается. Командная строка читается только для
        признаков вроде «скрытое окно» и нигде не сохраняется.
      </p>
      {!view.enabled && (
        <p className="notice">Трассировка выключена во вкладке «Доступ».</p>
      )}
      <div className="load-row">
        <div>
          <small className="muted">Процессор</small>
          <strong>{pct(l.cpu)}</strong>
          <small className="muted">обычно {pct(l.cpuBase)}</small>
        </div>
        <div>
          <small className="muted">Видеокарта</small>
          <strong>{l.gpuAvailable ? pct(l.gpu) : "—"}</strong>
          <small className="muted">
            {l.gpuAvailable
              ? l.gpuTop
                ? `${appName(l.gpuTop.name)} ${Math.round(l.gpuTop.pct)}%`
                : `обычно ${pct(l.gpuBase)}`
              : "счётчики GPU недоступны"}
          </small>
        </div>
      </div>
      <div className="chips">
        {(
          [
            ["all", "Все"],
            ["visible", "На экране"],
            ["flagged", "Требуют внимания"],
          ] as const
        ).map(([id, name]) => (
          <button
            key={id}
            className={filter === id ? "chip selected" : "chip"}
            onClick={() => setFilter(id)}
          >
            {name}
          </button>
        ))}
      </div>
      {events.length === 0 && (
        <p className="muted">
          Пока ничего. Когда какая-нибудь программа откроет консоль или
          скрипт, здесь появится запись с виновником.
        </p>
      )}
      <div className="trace-list">
        {events.map((e) => {
          const o = e.origin;
          const isTrusted =
            !!o && (e.trusted || trusted.includes(o.name.toLowerCase()));
          return (
            <div className={`trace-item ${e.verdict}`} key={e.id}>
              <div className="trace-head">
                <strong>{childName(e.child.name)}</strong>
                <span className={`verdict ${e.verdict}`}>
                  {verdictText[e.verdict]}
                </span>
              </div>
              <small className="muted">
                {time(e.time)}
                {e.repeat > 1 ? ` · ${e.repeat} раз с ${time(e.first)}` : ""}
                {" · "}
                {e.flash ? "мелькнуло" : e.visible ? "на экране" : "в фоне"}
              </small>
              <p>
                Запустил:{" "}
                {o ? (
                  <>
                    <b>{appName(o.name)}</b>
                    {o.role ? ` — ${o.role}` : ""}
                    {[whereLabel(o), signLabel(o)].filter(Boolean).length
                      ? ` (${[whereLabel(o), signLabel(o)].filter(Boolean).join(", ")})`
                      : ""}
                  </>
                ) : (
                  "неизвестно — родитель закрылся раньше проверки"
                )}
              </p>
              {viaLabel(e) && (
                <p className="muted">Через: {viaLabel(e)}</p>
              )}
              {e.script && /^[a-z]:[\\/]/i.test(e.script) && (
                <small className="muted path">{e.script}</small>
              )}
              {e.chain.length > 1 && (
                <small className="muted chain">
                  Цепочка: {e.chain.join(" ← ")}
                </small>
              )}
              {o?.path && <small className="muted path">{o.path}</small>}
              {e.flags.length > 0 && (
                <div className="flags">
                  {e.flags.map((f) => (
                    <span key={f} className="flag">
                      {flagLabels[f] ?? f}
                    </span>
                  ))}
                </div>
              )}
              <div className="trace-actions">
                {revealTarget(e) && (
                  <button
                    className="text-button"
                    onClick={() =>
                      void command("trace_reveal", { path: revealTarget(e) }).catch(
                        (err) => onError(String(err)),
                      )
                    }
                  >
                    Показать файл
                  </button>
                )}
                {o && !isTrusted && (
                  <button
                    className="text-button"
                    onClick={() => trust(o.name.toLowerCase())}
                  >
                    Доверять «{appName(o.name)}»
                  </button>
                )}
                {isTrusted && <small className="muted">доверенный источник</small>}
              </div>
            </div>
          );
        })}
      </div>
      <h2>Автозапуск</h2>
      <p className="muted">
        Новые записи в Run/RunOnce и папках «Автозагрузка» питомец замечает сам
        и спрашивает, убрать ли их. «Убрать» сначала кладёт копию в карантин —
        её можно вернуть. Записи «для всех пользователей» Windows попросит
        подтвердить правами администратора.
      </p>
      {!autoruns && <p className="muted">Загрузка…</p>}
      <div className="trace-list">
        {autoruns?.entries.map((e) => {
          const fake = { location: e.location, signed: e.signed } as never;
          const isNew = autoruns.pending.includes(e.id);
          return (
            <div className={`trace-item ${isNew ? "notice" : "ok"}`} key={e.id}>
              <div className="trace-head">
                <strong>{e.name}</strong>
                <span className={`verdict ${isNew ? "notice" : ""}`}>
                  {isNew ? "новое" : scopeLabel(e.scope)}
                </span>
              </div>
              <small className="muted path">{e.command}</small>
              <small className="muted">
                {[whereLabel(fake), signLabel(fake)].filter(Boolean).join(", ")}
                {isNew ? " · " + scopeLabel(e.scope) : ""}
              </small>
              <div className="trace-actions">
                {e.target && (
                  <button
                    className="text-button"
                    onClick={() =>
                      void command("trace_reveal", { path: e.target }).catch((x) => onError(String(x)))
                    }
                  >
                    Открыть путь
                  </button>
                )}
                <button
                  className="text-button"
                  disabled={busy === e.id}
                  onClick={() => autorunAction("autorun_remove", e.id)}
                >
                  {e.user ? "Убрать" : "Убрать (администратор)"}
                </button>
                {isNew && (
                  <button
                    className="text-button"
                    onClick={() => autorunAction("autorun_keep", e.id)}
                  >
                    Оставить
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
      {!!autoruns?.quarantine.length && (
        <>
          <h2>Карантин</h2>
          <div className="trace-list">
            {autoruns.quarantine.map((q) => (
              <div className="trace-item" key={q.entry.id}>
                <div className="trace-head">
                  <strong>{q.entry.name}</strong>
                  <span className="verdict">убрано {time(q.removed)}</span>
                </div>
                <small className="muted path">{q.entry.command}</small>
                <div className="trace-actions">
                  <button
                    className="text-button"
                    disabled={busy === q.entry.id}
                    onClick={() => autorunAction("autorun_restore", q.entry.id)}
                  >
                    Вернуть в автозапуск
                  </button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
      <h2>Журнал</h2>
      <button
        className="danger"
        onClick={() =>
          void command("trace_clear")
            .then(() => setView({ ...view, events: [] }))
            .catch((e) => onError(String(e)))
        }
      >
        Очистить журнал
      </button>
    </>
  );
}
