import { Button, Flex, RadioCards, SegmentedControl, Select, Slider, Text, TextField } from "@radix-ui/themes";
import { temper } from "../../character";
import { pets, Settings } from "../../model";
import type { PanelState } from "../store";
import { Portrait, Row, Section, ToggleRow } from "../ui";
import { tx } from "../../i18n";
import { WeatherPlace } from "./WeatherPlace";
import { PetCreditLine } from "./About";
const hours = Array.from({ length: 24 }, (_, h) => h);
export function Behavior({ p }: { p: PanelState }) {
  const d = p.draft;
  const set = p.set;
  const t = (k: keyof Settings, label: string, hint?: string) => (
    <ToggleRow label={label} hint={hint} checked={!!d[k]} onChange={(v) => set(k, v as never)} />
  );
  const num = (k: "idleMinutes" | "sleepMinutes" | "longSessionMinutes", label: string, min: number, max: number) => (
    <Row label={label}>
      <TextField.Root
        type="number"
        min={min}
        max={max}
        value={String(d[k])}
        onChange={(e) => set(k, Number(e.target.value))}
        style={{ width: 90 }}
        aria-label={label}
      />
    </Row>
  );
  const hourSelect = (k: "lateHour" | "quietFrom" | "quietTo", label: string, off = false) => (
    <Select.Root value={String(d[k])} onValueChange={(v) => set(k, Number(v))}>
      <Select.Trigger aria-label={label} style={{ minWidth: 90 }} />
      <Select.Content>
        {off && <Select.Item value="-1">{tx("выкл.")}</Select.Item>}
        {hours.map((h) => (
          <Select.Item key={h} value={String(h)}>
            {String(h).padStart(2, "0")}:00
          </Select.Item>
        ))}
      </Select.Content>
    </Select.Root>
  );
  return (
    <>
      <Section title={tx("Язык")}>
        <Row label={tx("Язык интерфейса и реплик")}>
          <SegmentedControl.Root value={d.lang} onValueChange={(v) => set("lang", v as Settings["lang"])}>
            <SegmentedControl.Item value="ru">Русский</SegmentedControl.Item>
            <SegmentedControl.Item value="en">English</SegmentedControl.Item>
          </SegmentedControl.Root>
        </Row>
        {d.lang === "en" && t("swear", tx("Мат в английских репликах"), tx("По умолчанию питомец говорит по-английски без мата. Русские реплики не меняются."))}
      </Section>
      <Section title={tx("Персонаж")}>
        <RadioCards.Root value={d.pet} onValueChange={(v) => set("pet", v)} columns={{ initial: "1", sm: "2" }} size="1">
          {pets.map((x) => (
            <RadioCards.Item key={x.id} value={x.id}>
              <Flex gap="3" align="center" width="100%">
                <Portrait pet={x.id} size={44} />
                <Flex direction="column" gap="1" style={{ minWidth: 0 }}>
                  <Text size="2" weight="bold">
                    {x.name}
                  </Text>
                  <Text size="1" color="gray">
                    {tx(temper(x.id).trait)}
                  </Text>
                  <PetCreditLine id={x.id} />
                </Flex>
              </Flex>
            </RadioCards.Item>
          ))}
        </RadioCards.Root>
      </Section>
      <Section title={tx("Поведение")}>
        <Row label={tx("Режим")} hint={tx("«Тихий» - без самостоятельных реплик, «Не мешать» - в угол и молча.")}>
          <SegmentedControl.Root value={d.mode} onValueChange={(v) => set("mode", v as Settings["mode"])} size="1">
            <SegmentedControl.Item value="normal">{tx("Обычный")}</SegmentedControl.Item>
            <SegmentedControl.Item value="quiet">{tx("Тихий")}</SegmentedControl.Item>
            <SegmentedControl.Item value="dnd">{tx("Не мешать")}</SegmentedControl.Item>
          </SegmentedControl.Root>
        </Row>
        <Row label={tx("Активность")}>
          <SegmentedControl.Root value={d.activity} onValueChange={(v) => set("activity", v as Settings["activity"])} size="1">
            <SegmentedControl.Item value="calm">{tx("Спокойная")}</SegmentedControl.Item>
            <SegmentedControl.Item value="balanced">{tx("Обычная")}</SegmentedControl.Item>
            <SegmentedControl.Item value="active">{tx("Живая")}</SegmentedControl.Item>
          </SegmentedControl.Root>
        </Row>
        <Row label={tx("Размер · {n}", { n: d.size })} hint={tx("Логические пиксели поверх масштаба Windows.")}>
          <Slider value={[d.size]} min={56} max={176} step={4} onValueChange={([v]) => set("size", v)} style={{ width: 180 }} aria-label={tx("Размер")} />
        </Row>
        {t("smooth", tx("Сглаживание"), tx("Мягкие края при уменьшении; выключите ради чётких пикселей."))}
      </Section>
      <Section title={tx("Движение")}>
        {t("walk", tx("Гулять по рабочему столу"))}
        {t("perch", tx("Сидеть и лазать по окнам"), tx("Запрыгивает, карабкается по краю, катается на окне."))}
        {t("pinned", tx("Закрепить на месте"), tx("Перетаскивать всё равно можно."))}
        <Row label={tx("Экран")} hint={tx("«Где находится» - ходит между соседними мониторами.")}>
          <Select.Root value={d.monitor} onValueChange={(v) => set("monitor", v)}>
            <Select.Trigger aria-label={tx("Экран")} />
            <Select.Content>
              <Select.Item value="auto">{tx("Где находится питомец")}</Select.Item>
              {p.monitors.map((m, i) => (
                <Select.Item key={m.id} value={m.id}>
                  {tx("Экран {n}", { n: i + 1 })}
                  {m.primary ? tx(" · основной") : ""}
                </Select.Item>
              ))}
            </Select.Content>
          </Select.Root>
        </Row>
        <Row label={tx("Любимое место для «Не мешать»")} hint={tx("Текущая позиция питомца.")}>
          <Button
            variant="soft"
            color="gray"
            onClick={() => {
              const pos = p.latest.current.position;
              if (!pos) return;
              const m = p.monitors.find((x) => pos.x >= x.work.left && pos.x <= x.work.right && pos.y >= x.work.top && pos.y <= x.work.bottom);
              void p.saveMemory({ favorite: { ...pos, monitor: d.monitor === "auto" ? (m?.id ?? "auto") : d.monitor } });
            }}
          >
            {tx("Запомнить место")}
          </Button>
        </Row>
      </Section>
      <Section title={tx("Характер")}>
        {t("cursorPlay", tx("Игры с курсором"), tx("Трогает, ловит и, если обидели, охотится на курсор."))}
        {d.cursorPlay && (
          <Row label={tx("Хулиганит с курсором")} hint={tx("Как часто бьёт курсор просто так, без обиды.")}>
            <SegmentedControl.Root value={d.teaseRate} onValueChange={(v) => set("teaseRate", v as Settings["teaseRate"])}>
              <SegmentedControl.Item value="never">{tx("никогда")}</SegmentedControl.Item>
              <SegmentedControl.Item value="rare">{tx("редко")}</SegmentedControl.Item>
              <SegmentedControl.Item value="normal">{tx("иногда")}</SegmentedControl.Item>
              <SegmentedControl.Item value="often">{tx("часто")}</SegmentedControl.Item>
            </SegmentedControl.Root>
          </Row>
        )}
        {t("cursorPush", tx("Может толкать курсор"), tx("После удара лапой курсор немного отъезжает. Никогда - пока зажата кнопка мыши."))}
        {t("drunkWindows", tx("Пьяный бьёт окна"), tx("После пива трясёт, толкает и сворачивает настоящие окна. Панель задач, рабочий стол и полноэкранные игры не трогает."))}
        {t("drunkClose", tx("...и может закрыть окно"), tx("Совсем в хлам - отправляет окну команду «закрыть». Программа успеет спросить про несохранённое. По умолчанию выключено."))}
        {t("mumble", tx("Бормочет сам с собой"), tx("Считает пиксели, напевает, вздыхает - когда ничего не происходит."))}
        {t("mischief", tx("Шалости"), tx("Приносит подарки, оставляет записки, иногда таскает мелочь."))}
        {t("nightSleep", tx("Спит по ночам"), tx("После «ночного часа» ложится спать, даже если вы работаете."))}
      </Section>
      <Section title={tx("Реплики и звук")}>
        {t("comments", tx("Реплики"), tx("Мат и стёб сохранены. Текст исчезает сам."))}
        <Row label={tx("Самостоятельно - не чаще")}>
          <Select.Root value={String(d.commentMinutes)} onValueChange={(v) => set("commentMinutes", Number(v))}>
            <Select.Trigger aria-label={tx("Частота реплик")} />
            <Select.Content>
              {[1, 3, 5, 7, 10, 15, 30, 60].map((n) => (
                <Select.Item key={n} value={String(n)}>
                  {tx("раз в {n} мин", { n })}
                </Select.Item>
              ))}
            </Select.Content>
          </Select.Root>
        </Row>
        {t("sounds", tx("Звуки"), tx("Шаги, прыжки, еда, монеты (синтез и Kenney CC0)."))}
        {t("voice", tx("Бормотание вместо озвучки"), tx("Каждая реплика - набор звуков, у каждого персонажа свой голос."))}
        {t("musicViz", tx("Эквалайзер и танец под музыку"), tx("Когда играет музыка или видео, у ног питомца прыгают полоски, а танцует он в такт. Звук не записывается и никуда не уходит."))}
        <Row label={tx("Громкость · {n}%", { n: d.soundVolume })} hint={tx("По слуху: 15 % слышно, 50 % - примерно вдвое тише максимума.")}>
          <Slider value={[d.soundVolume]} min={0} max={100} step={5} onValueChange={([v]) => set("soundVolume", v)} style={{ width: 180 }} aria-label={tx("Громкость")} />
        </Row>
        <Row label={tx("Голос · {n}%", { n: d.voiceVolume })} hint={tx("Бормотание под репликами.")}>
          <Slider value={[d.voiceVolume]} min={0} max={100} step={5} onValueChange={([v]) => set("voiceVolume", v)} style={{ width: 180 }} aria-label={tx("Голос")} />
        </Row>
        <Row label={tx("Эффекты · {n}%", { n: d.effectsVolume })} hint={tx("Шаги, прыжки, еда, монеты, удары.")}>
          <Slider value={[d.effectsVolume]} min={0} max={100} step={5} onValueChange={([v]) => set("effectsVolume", v)} style={{ width: 180 }} aria-label={tx("Эффекты")} />
        </Row>
        <Row label={tx("Реплик в час, не больше")} hint={tx("Свои реплики. Ответы на клики, броски и кнопки не считаются.")}>
          <Select.Root value={String(d.linesPerHour)} onValueChange={(v) => set("linesPerHour", Number(v))}>
            <Select.Trigger aria-label={tx("Реплик в час, не больше")} style={{ minWidth: 120 }} />
            <Select.Content>
              {[5, 10, 20, 30, 60, 0].map((n) => (
                <Select.Item key={n} value={String(n)}>
                  {n === 0 ? tx("без ограничения") : String(n)}
                </Select.Item>
              ))}
            </Select.Content>
          </Select.Root>
        </Row>
      </Section>
      <Section title={tx("Время")}>
        {num("idleMinutes", tx("Отдых без ввода, мин"), 1, 60)}
        {num("sleepMinutes", tx("Сон без ввода, мин"), 2, 120)}
        {num("longSessionMinutes", tx("Долго в одной программе, мин"), 10, 240)}
        <Row label={tx("Ночной час")} hint={tx("Позже - ворчит, что пора спать.")}>
          {hourSelect("lateHour", tx("Ночной час"))}
        </Row>
        <Row label={tx("Тихие часы")} hint={tx("Без реплик по своей инициативе в это время.")}>
          <Flex gap="2" align="center">
            {hourSelect("quietFrom", tx("Тихие часы с"), true)}
            <Text size="2" color="gray">
              -
            </Text>
            {hourSelect("quietTo", tx("Тихие часы до"), true)}
          </Flex>
        </Row>
      </Section>
      <Section title={tx("Погода")} description={tx("Питомец говорит, когда пошёл или кончился дождь, гроза, снег, туман, жара или мороз, и показывает облачко с зонтиком. Запрос к Open-Meteo (данные CC BY 4.0) раз в 30 минут, только если включено.")}>
        {t("weather", tx("Показывать погоду"))}
        {d.weather && <WeatherPlace p={p} />}
      </Section>
      <Section title={tx("Запуск")}>{t("autostart", tx("Запускать с Windows"), tx("По умолчанию выключено."))}</Section>
    </>
  );
}
