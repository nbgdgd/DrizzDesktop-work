import { useEffect, useState } from "react";
import { Badge, Button, Callout, Card, Flex, Grid, SegmentedControl, Text } from "@radix-ui/themes";
import { command, on } from "../../bridge";
import { appName } from "../../apps";
import { cleanSettings } from "../../model";
import {
  AutorunEntry,
  LoadState,
  TraceEvent,
  TraceProc,
  childName,
  flagLabel,
  revealTarget,
  scopeLabel,
  signLabel,
  viaLabel,
  whereLabel,
} from "../../trace";
import type { PanelState } from "../store";
import { Section } from "../ui";
import { getLang, tx } from "../../i18n";
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
const verdict = {
  ok: [tx("обычно"), "gray"],
  notice: [tx("обратить внимание"), "amber"],
  suspicious: [tx("подозрительно"), "red"],
} as const;
const time = (t: number) =>
  new Date(t).toLocaleString(getLang(), { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
const pct = (v: number | null | undefined) => (v === null || v === undefined ? "—" : `${Math.round(v)}%`);
// Process-trace journal: who launched which console, autostart, live CPU/GPU.
export function Trace({ p }: { p: PanelState }) {
  const [view, setView] = useState<View | null>(null);
  const [filter, setFilter] = useState<"all" | "visible" | "flagged">("all");
  const [autoruns, setAutoruns] = useState<Autoruns | null>(null);
  const [busy, setBusy] = useState("");
  const onError = (e: unknown) => p.setError(String(e));
  const loadAutoruns = () =>
    void command<Autoruns>("autorun_view")
      .then((a) => a && setAutoruns(a))
      .catch(onError);
  useEffect(() => {
    let gone = false;
    const offs: (() => void)[] = [];
    const load = () =>
      void command<View>("trace_view")
        .then((v) => !gone && v && setView(v))
        .catch(onError);
    load();
    loadAutoruns();
    const t1 = setInterval(load, 2000);
    const t2 = setInterval(loadAutoruns, 5000);
    void on("trace", () => load()).then((f) => (gone ? f() : offs.push(f)));
    void on("autorun", () => loadAutoruns()).then((f) => (gone ? f() : offs.push(f)));
    return () => {
      gone = true;
      clearInterval(t1);
      clearInterval(t2);
      offs.forEach((f) => f());
    };
  }, []);
  const autorunAction = (cmd: string, id: string) => {
    setBusy(id);
    void command(cmd, { id })
      .then(() => loadAutoruns())
      .catch(onError)
      .finally(() => setBusy(""));
  };
  const trusted = p.store.settings.traceTrusted;
  const trust = (exe: string) =>
    p.run(
      command("save_settings", { settings: cleanSettings({ ...p.store.settings, traceTrusted: [...trusted, exe] }) }),
      tx("«{app}» теперь в доверенных", { app: appName(exe) }),
    );
  if (!view)
    return (
      <Text color="gray" size="2">
        {tx("Загрузка…")}
      </Text>
    );
  const l = view.load;
  const events = view.events.filter((e) =>
    filter === "visible" ? e.visible || e.flash : filter === "flagged" ? e.verdict !== "ok" : true,
  );
  const origin = (o: TraceProc) => {
    const extra = [whereLabel(o), signLabel(o)].filter(Boolean).join(", ");
    return `${appName(o.name)}${o.role ? ` — ${tx(o.role)}` : ""}${extra ? ` (${extra})` : ""}`;
  };
  return (
    <>
      <Text as="p" size="2" color="gray" mb="3">
        {tx("Какие программы запускают командную строку, PowerShell, скрипты и системные утилиты, и откуда они взялись. Ничего не блокируется; командная строка читается только для признаков вроде «скрытое окно» и не сохраняется.")}
      </Text>
      {!view.enabled && (
        <Callout.Root color="amber" size="1" mb="3">
          <Callout.Text>{tx("Трассировка выключена во вкладке «Доступ».")}</Callout.Text>
        </Callout.Root>
      )}
      <Grid columns="2" gap="3" mb="4">
        <Card>
          <Text as="div" size="1" color="gray">
            {tx("Процессор")}
          </Text>
          <Text as="div" size="6" weight="bold">
            {pct(l.cpu)}
          </Text>
          <Text size="1" color="gray">
            {tx("обычно {v}", { v: pct(l.cpuBase) })}
          </Text>
        </Card>
        <Card>
          <Text as="div" size="1" color="gray">
            {tx("Видеокарта")}
          </Text>
          <Text as="div" size="6" weight="bold">
            {l.gpuAvailable ? pct(l.gpu) : "—"}
          </Text>
          <Text size="1" color="gray">
            {l.gpuAvailable
              ? l.gpuTop
                ? `${appName(l.gpuTop.name)} ${Math.round(l.gpuTop.pct)}%`
                : tx("обычно {v}", { v: pct(l.gpuBase) })
              : tx("счётчики GPU недоступны")}
          </Text>
        </Card>
      </Grid>
      <SegmentedControl.Root value={filter} onValueChange={(v) => setFilter(v as typeof filter)} size="1" mb="3">
        <SegmentedControl.Item value="all">{tx("Все")}</SegmentedControl.Item>
        <SegmentedControl.Item value="visible">{tx("На экране")}</SegmentedControl.Item>
        <SegmentedControl.Item value="flagged">{tx("Требуют внимания")}</SegmentedControl.Item>
      </SegmentedControl.Root>
      {events.length === 0 && (
        <Text as="p" size="2" color="gray" mb="4">
          {tx("Пока ничего. Когда программа откроет консоль или скрипт, здесь появится запись с виновником.")}
        </Text>
      )}
      <Flex direction="column" gap="2" mb="5">
        {events.map((e) => {
          const o = e.origin;
          const isTrusted = !!o && (e.trusted || trusted.includes(o.name.toLowerCase()));
          const [vText, vColor] = verdict[e.verdict];
          return (
            <Card key={e.id} style={e.verdict === "suspicious" ? { boxShadow: "inset 3px 0 0 var(--red-9)" } : undefined}>
              <Flex justify="between" gap="2">
                <Text size="2" weight="medium">
                  {childName(e.child.name)}
                </Text>
                <Badge color={vColor} variant="soft">
                  {vText}
                </Badge>
              </Flex>
              <Text as="div" size="1" color="gray">
                {time(e.time)}
                {e.repeat > 1 ? ` · ${e.repeat} раз с ${time(e.first)}` : ""} · {e.flash ? tx("мелькнуло") : e.visible ? tx("на экране") : tx("в фоне")}
              </Text>
              <Text as="div" size="2" mt="1">
                Запустил: {o ? origin(o) : tx("неизвестно — родитель закрылся раньше проверки")}
              </Text>
              {viaLabel(e) && (
                <Text as="div" size="1" color="gray">
                  {tx("Через: {v}", { v: viaLabel(e) })}
                </Text>
              )}
              {e.chain.length > 1 && <div className="mono">{tx("Цепочка: {c}", { c: e.chain.join(" ← ") })}</div>}
              {o?.path && <div className="mono">{o.path}</div>}
              {e.flags.length > 0 && (
                <Flex gap="1" wrap="wrap" mt="1">
                  {e.flags.map((f) => (
                    <Badge key={f} size="1" color="amber" variant="outline">
                      {flagLabel(f)}
                    </Badge>
                  ))}
                </Flex>
              )}
              <Flex gap="2" mt="2" wrap="wrap">
                {revealTarget(e) && (
                  <Button size="1" variant="ghost" onClick={() => p.run(command("trace_reveal", { path: revealTarget(e) }))}>
                    {tx("Показать файл")}
                  </Button>
                )}
                {o && !isTrusted && (
                  <Button size="1" variant="ghost" color="gray" onClick={() => trust(o.name.toLowerCase())}>
                    {tx("Доверять «{app}»", { app: appName(o.name) })}
                  </Button>
                )}
                {isTrusted && (
                  <Text size="1" color="gray">
                    {tx("доверенный источник")}
                  </Text>
                )}
              </Flex>
            </Card>
          );
        })}
      </Flex>
      <Section
        title={tx("Автозапуск")}
        description={tx("Новые записи в Run/RunOnce и папках «Автозагрузка» питомец замечает сам и спрашивает, убрать ли их. «Убрать» кладёт копию в карантин.")}
      >
        {!autoruns && (
          <Text size="2" color="gray">
            {tx("Загрузка…")}
          </Text>
        )}
        {autoruns?.entries.map((e) => {
          const fake = { location: e.location, signed: e.signed } as TraceProc;
          const isNew = autoruns.pending.includes(e.id);
          return (
            <Flex key={e.id} direction="column" gap="1" pb="2" style={{ borderBottom: "1px solid var(--gray-a3)" }}>
              <Flex justify="between" gap="2">
                <Text size="2" weight="medium">
                  {e.name}
                </Text>
                <Badge color={isNew ? "amber" : "gray"} variant="soft">
                  {isNew ? tx("новое") : scopeLabel(e.scope)}
                </Badge>
              </Flex>
              <div className="mono">{e.command}</div>
              <Text size="1" color="gray">
                {[whereLabel(fake), signLabel(fake)].filter(Boolean).join(", ")}
              </Text>
              <Flex gap="2">
                {e.target && (
                  <Button size="1" variant="ghost" onClick={() => p.run(command("trace_reveal", { path: e.target }))}>
                    {tx("Открыть путь")}
                  </Button>
                )}
                <Button size="1" variant="ghost" color="red" disabled={busy === e.id} onClick={() => autorunAction("autorun_remove", e.id)}>
                  {e.user ? tx("Убрать") : tx("Убрать (администратор)")}
                </Button>
                {isNew && (
                  <Button size="1" variant="ghost" color="gray" onClick={() => autorunAction("autorun_keep", e.id)}>
                    {tx("Оставить")}
                  </Button>
                )}
              </Flex>
            </Flex>
          );
        })}
      </Section>
      {!!autoruns?.quarantine.length && (
        <Section title={tx("Карантин")}>
          {autoruns.quarantine.map((q) => (
            <Flex key={q.entry.id} justify="between" align="center" gap="3">
              <div>
                <Text as="div" size="2" weight="medium">
                  {q.entry.name}
                </Text>
                <Text as="div" size="1" color="gray">
                  {tx("убрано {t}", { t: time(q.removed) })}
                </Text>
              </div>
              <Button size="1" variant="soft" disabled={busy === q.entry.id} onClick={() => autorunAction("autorun_restore", q.entry.id)}>
                {tx("Вернуть")}
              </Button>
            </Flex>
          ))}
        </Section>
      )}
      <Button color="red" variant="soft" onClick={() => p.run(command("trace_clear").then(() => setView({ ...view, events: [] })), tx("Журнал очищен"))}>
        {tx("Очистить журнал")}
      </Button>
    </>
  );
}
