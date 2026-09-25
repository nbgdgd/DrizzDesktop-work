// "Уши": the ear care page. Live state comes from the pet ("ears-live",
// every couple of seconds), the weekly dose from the saved game. Settings
// here apply at once (no Save button): the balance slider has to be felt.
import { useEffect, useState } from "react";
import { Badge, Box, Button, Callout, Flex, Grid, SegmentedControl, Select, Slider, Switch, Text } from "@radix-ui/themes";
import { Headphones, Info, Speaker } from "lucide-react";
import { command, on } from "../../bridge";
import { cleanSettings, Settings } from "../../model";
import { allowedHours, weekly } from "../../ears";
import { getLang, tx } from "../../i18n";
import type { PanelState } from "../store";
import { Meter, Row, Section } from "../ui";
export interface EarLive {
  /** Windows "Mono audio" is on. */
  mono?: boolean;
  headphones: boolean;
  playing: boolean;
  level: number;
  /** The level comes from what really plays (tap.rs), not from the slider. */
  measured?: boolean;
  session: number;
  gains: [number, number];
}
const tone = (db: number) => (db >= 85 ? "red" : db >= 78 ? "amber" : "green");
export function Ears({ p }: { p: PanelState }) {
  const [live, setLive] = useState<EarLive | null>(null);
  const [balance, setBalance] = useState(p.store.settings.balance);
  useEffect(() => {
    let off: (() => void) | undefined;
    void on<EarLive>("ears-live", setLive).then((f) => (off = f));
    return () => off?.();
  }, []);
  useEffect(() => setBalance(p.store.settings.balance), [p.store.settings.balance]);
  const s = p.store.settings;
  const [guardTest, setGuardTest] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const testGuard = async () => {
    setTesting(true);
    try {
      const ms = await command<number>("ear_guard_test");
      setGuardTest(tx("Работает: скачок срезан за {ms} мс.", { ms }));
    } catch (e) {
      const why = String(e);
      setGuardTest(
        why.includes("no headphones")
          ? tx("Наушники не найдены - защита сейчас не действует.")
          : why.includes("off")
            ? tx("Защита выключена.")
            : tx("Не сработало: {why}", { why }),
      );
    } finally {
      setTesting(false);
    }
  };
  const apply = <K extends keyof Settings>(k: K, v: Settings[K]) =>
    p.run(command("save_settings", { settings: cleanSettings({ ...s, [k]: v }) }));
  const now = Date.now();
  const log = p.store.game.ears;
  const week = weekly(log, now);
  const days = [...log.days].slice(-7);
  const pct = (v: number) => Math.round(v * 100);
  const hours = allowedHours(Math.max(0, live?.level ?? 0), s.earsNorm);
  const minutes = Math.round((live?.session ?? 0) / 60000);
  return (
    <>
      <Text as="p" size="2" color="gray" mb="3">
        {tx("Питомец считает, сколько звука попало в каждое ухо за неделю, по нормам ВОЗ и МСЭ (H.870): 100 % - это 80 дБ в течение 40 часов в неделю. Он слушает, насколько громко на самом деле играет звук в каждом канале, и прибавляет громкость Windows и громкость наушников на максимуме. Это оценка, а не шумомер: точность зависит от наушников.")}
      </Text>
      <Grid columns={{ initial: "1", sm: "2" }} gap="4">
        <Section title={tx("Сейчас")}>
          <Flex align="center" gap="3">
            {live?.headphones || s.earsDevice === "always" ? <Headphones size={28} /> : <Speaker size={28} />}
            <Box>
              <Text as="div" size="2" weight="medium">
                {live === null
                  ? tx("Жду данные от питомца...")
                  : live.headphones
                    ? tx("Наушники подключены")
                    : s.earsDevice === "always"
                      ? tx("Считаю любой вывод звука как наушники")
                      : tx("Наушники не найдены - звук идёт в колонки")}
              </Text>
              <Text as="div" size="1" color="gray">
                {live?.playing ? tx("Играет звук") : tx("Тишина")}
                {minutes > 0 ? " · " + tx("{n} мин подряд", { n: minutes }) : ""}
              </Text>
            </Box>
          </Flex>
          {live?.playing && live.level > 0 && (
            <Flex align="center" gap="2" wrap="wrap">
              <Badge size="2" color={tone(live.level)}>
                ≈ {Math.round(live.level)} {tx("дБ")}
              </Badge>
              <Badge size="1" color="gray" variant="soft" title={live.measured ? tx("По тому, что реально играет.") : tx("Пока по ползунку Windows: звук только начался.")}>
                {live.measured ? tx("по звуку") : tx("по ползунку")}
              </Badge>
              <Text size="1" color="gray">
                {hours >= 40
                  ? tx("на такой громкости можно слушать всю неделю")
                  : tx("на такой громкости недельная норма кончится за {h} ч", { h: hours >= 10 ? Math.round(hours) : hours.toFixed(1) })}
              </Text>
            </Flex>
          )}
          <Text size="1" color="gray">
            {tx("Сегодня в наушниках: {n} мин", { n: Math.round(days[days.length - 1]?.min ?? 0) })}
          </Text>
        </Section>
        <Section title={tx("Недельная доза")}>
          <Meter label={tx("Левое ухо")} value={pct(week.l)} text={`${pct(week.l)} %`} color={week.l >= 1 ? "red" : week.l >= 0.8 ? "amber" : "green"} />
          <Meter label={tx("Правое ухо")} value={pct(week.r)} text={`${pct(week.r)} %`} color={week.r >= 1 ? "red" : week.r >= 0.8 ? "amber" : "green"} />
          <Flex gap="2" align="end" style={{ height: 56 }} aria-label={tx("По дням")}>
            {days.map((d) => {
              const v = Math.max(d.l, d.r);
              return (
                <Flex key={d.day} direction="column" align="center" gap="1" style={{ flex: 1 }}>
                  <div
                    title={`${d.day}: ${pct(v)} %, ${Math.round(d.min)} ${tx("мин")}`}
                    style={{
                      width: "100%",
                      height: Math.max(3, Math.min(40, v * 40 * 3)),
                      borderRadius: 3,
                      background: v >= 0.3 ? "var(--red-9)" : v >= 0.15 ? "var(--amber-9)" : "var(--accent-9)",
                    }}
                  />
                  <Text size="1" color="gray">
                    {new Date(d.day + "T12:00:00").toLocaleDateString(getLang(), { weekday: "short" })}
                  </Text>
                </Flex>
              );
            })}
          </Flex>
        </Section>
      </Grid>
      <Section
        title={tx("Баланс")}
        description={tx("Громкость левого и правого уха для всех программ - через микшер Windows, поэтому работает на любых наушниках, в том числе Bluetooth. Общий ползунок громкости не меняется. При выходе баланс возвращается.")}
        action={
          <Button size="1" variant="soft" color="gray" disabled={balance === 0} onClick={() => apply("balance", 0)}>
            {tx("По центру")}
          </Button>
        }
      >
        <Flex align="center" gap="3">
          <Text size="2" weight="bold">
            {tx("Л")}
          </Text>
          <Slider
            min={-100}
            max={100}
            step={5}
            value={[balance]}
            onValueChange={([v]) => setBalance(v)}
            onValueCommit={([v]) => apply("balance", v)}
            aria-label={tx("Баланс")}
          />
          <Text size="2" weight="bold">
            {tx("П")}
          </Text>
        </Flex>
        {live?.mono && (
          <Callout.Root color="amber" size="1">
            <Callout.Icon>
              <Info size={14} />
            </Callout.Icon>
            <Callout.Text>
              {tx("В Windows включён «Монофонический звук»: оба канала сводятся в один, поэтому баланс и отдых ушей слышны в обоих ушах одинаково. Выключите его в параметрах Windows.")}{" "}
              <Button size="1" variant="soft" color="amber" onClick={() => void command("open_sound_settings").catch(() => undefined)}>
                {tx("Открыть настройки звука")}
              </Button>
            </Callout.Text>
          </Callout.Root>
        )}
        <Text size="1" color="gray">
          {balance === 0
            ? tx("по центру")
            : Math.abs(balance) >= 100
              ? tx(balance > 0 ? "Левое ухо выключено - звук только справа." : "Правое ухо выключено - звук только слева.")
              : tx(balance > 0 ? "Левое ухо тише на {n} %" : "Правое ухо тише на {n} %", { n: Math.abs(balance) })}
        </Text>
      </Section>
      <Section
        title={tx("Отдых ушей")}
        description={tx("Одно ухо слушает тише, потом они меняются. Удобно в длинные сессии: каждое ухо по очереди получает меньше звука.")}
        action={<Switch checked={s.earsRest} onCheckedChange={(v) => apply("earsRest", v)} aria-label={tx("Отдых ушей")} />}
      >
        <Row label={tx("Меняться каждые")}>
          <Select.Root value={String(s.earsRestMinutes)} onValueChange={(v) => apply("earsRestMinutes", Number(v))}>
            <Select.Trigger style={{ minWidth: 110 }} />
            <Select.Content>
              {[10, 15, 20, 30, 45, 60].map((n) => (
                <Select.Item key={n} value={String(n)}>
                  {tx("{m} мин", { m: n })}
                </Select.Item>
              ))}
            </Select.Content>
          </Select.Root>
        </Row>
        <Row label={tx("Насколько тише")}>
          <SegmentedControl.Root value={String(s.earsRestDim)} onValueChange={(v) => apply("earsRestDim", Number(v))}>
            {[30, 50, 70].map((n) => (
              <SegmentedControl.Item key={n} value={String(n)}>
                {n} %
              </SegmentedControl.Item>
            ))}
          </SegmentedControl.Root>
        </Row>
      </Section>
      <Section
        title={tx("Защита от скачков")}
        description={tx("Потолок громкости в наушниках: если программа или звуковая карта резко выкрутит звук, питомец срежет его за доли секунды. Работает с ползунком громкости Windows.")}
        action={<Switch checked={s.earsGuard} onCheckedChange={(v) => apply("earsGuard", v)} aria-label={tx("Защита от скачков")} />}
      >
        <Row label={tx("Потолок громкости")} hint={tx("Выше этого значения звук не поднимется, пока надеты наушники.")}>
          <Flex align="center" gap="3" style={{ minWidth: 240 }}>
            <Slider
              value={[s.earsCeiling]}
              min={10}
              max={95}
              step={5}
              disabled={!s.earsGuard}
              onValueChange={(v) => apply("earsCeiling", v[0])}
              aria-label={tx("Потолок громкости")}
            />
            <Text size="2" weight="bold" style={{ minWidth: 40, textAlign: "right" }}>
              {s.earsCeiling}%
            </Text>
          </Flex>
        </Row>
        <Row label={tx("Громкость при подключении")} hint={tx("Когда подключаешь наушники или компьютер просыпается, звук ставится на это значение (только вниз).")}>
          <Flex align="center" gap="3" style={{ minWidth: 240 }}>
            <Slider
              value={[s.earsSafe]}
              min={0}
              max={60}
              step={5}
              disabled={!s.earsGuard}
              onValueChange={(v) => apply("earsSafe", v[0])}
              aria-label={tx("Громкость при подключении")}
            />
            <Text size="2" weight="bold" style={{ minWidth: 40, textAlign: "right" }}>
              {s.earsSafe ? `${s.earsSafe}%` : tx("выкл")}
            </Text>
          </Flex>
        </Row>
        <Row label={tx("Внезапно громкие места")} hint={tx("Крик в видео или реклама на 10 дБ громче того, что играло: звук приглушается на пару секунд и возвращается. Работает, даже если потолок выключен.")}>
          <Switch checked={s.earsSpike} disabled={!s.ears} onCheckedChange={(v) => apply("earsSpike", v)} aria-label={tx("Внезапно громкие места")} />
        </Row>
        <Row label={tx("Проверка")} hint={guardTest ?? tx("Поднимет громкость на 2 % выше потолка и посмотрит, как быстро её срежет.")}>
          <Button variant="soft" disabled={!s.earsGuard || testing} onClick={() => void testGuard()}>
            {tx("Проверить")}
          </Button>
        </Row>
      </Section>
      <Section title={tx("Настройки")}>
        <Row label={tx("Береги уши")} hint={tx("Считать дозу, напоминать о перерывах и громкости.")}>
          <Switch checked={s.ears} onCheckedChange={(v) => apply("ears", v)} aria-label={tx("Береги уши")} />
        </Row>
        <Row label={tx("Норма")} hint={tx("Бережная - для детей, при звоне в ушах и после болезни уха.")}>
          <SegmentedControl.Root value={String(s.earsNorm)} onValueChange={(v) => apply("earsNorm", Number(v))}>
            <SegmentedControl.Item value="80">{tx("Обычная · 80 дБ")}</SegmentedControl.Item>
            <SegmentedControl.Item value="75">{tx("Бережная · 75 дБ")}</SegmentedControl.Item>
          </SegmentedControl.Root>
        </Row>
        <Row label={tx("Что считать наушниками")} hint={tx("Bluetooth-наушники иногда определяются как колонки.")}>
          <Select.Root value={s.earsDevice} onValueChange={(v) => apply("earsDevice", v as Settings["earsDevice"])}>
            <Select.Trigger style={{ minWidth: 180 }} />
            <Select.Content>
              <Select.Item value="auto">{tx("Определять сам")}</Select.Item>
              <Select.Item value="always">{tx("Любой вывод звука")}</Select.Item>
            </Select.Content>
          </Select.Root>
        </Row>
        <Row label={tx("Громкость наушников на максимуме")} hint={tx("Не знаешь - оставь 100 дБ. Мощные мониторные - 105-110.")}>
          <Select.Root value={String(s.earsMax)} onValueChange={(v) => apply("earsMax", Number(v))}>
            <Select.Trigger style={{ minWidth: 110 }} />
            <Select.Content>
              {[90, 95, 100, 105, 110].map((n) => (
                <Select.Item key={n} value={String(n)}>
                  {n} {tx("дБ")}
                </Select.Item>
              ))}
            </Select.Content>
          </Select.Root>
        </Row>
        <Row label={tx("Перерыв каждые")}>
          <Select.Root value={String(s.earsBreak)} onValueChange={(v) => apply("earsBreak", Number(v))}>
            <Select.Trigger style={{ minWidth: 110 }} />
            <Select.Content>
              {[30, 45, 60, 90, 120].map((n) => (
                <Select.Item key={n} value={String(n)}>
                  {tx("{m} мин", { m: n })}
                </Select.Item>
              ))}
            </Select.Content>
          </Select.Root>
        </Row>
        <Row label={tx("Убавлять самому")} hint={tx("Когда недельная норма кончилась, питомец сам снижает громкость до безопасной. Как советует ВОЗ.")}>
          <Switch checked={s.earsAutoLower} onCheckedChange={(v) => apply("earsAutoLower", v)} aria-label={tx("Убавлять самому")} />
        </Row>
      </Section>
      <Section title={tx("Как беречь уши")}>
        <ul className="tips">
          <li>{tx("Правило 60/60: не громче 60 % и не дольше 60 минут подряд.")}</li>
          <li>{tx("Каждый час - 5-10 минут тишины. После концерта или клуба дайте ушам сутки покоя.")}</li>
          <li>{tx("В шуме (метро, улица) не прибавляйте громкость - лучше наушники с шумоподавлением.")}</li>
          <li>{tx("Звон, заложенность, «вата» после прослушивания - сигнал перебора. Не проходит за сутки - к ЛОР-врачу.")}</li>
          <li>{tx("Не засыпайте в наушниках, ночью делайте тише.")}</li>
          <li>{tx("Раз в год проверяйте слух - например, в бесплатном приложении ВОЗ hearWHO.")}</li>
        </ul>
        <Callout.Root color="gray" size="1">
          <Callout.Icon>
            <Info size={14} />
          </Callout.Icon>
          <Callout.Text>{tx("Источник: ВОЗ и МСЭ, «Глобальный стандарт безопасного прослушивания» (ITU-T H.870).")}</Callout.Text>
        </Callout.Root>
      </Section>
    </>
  );
}
