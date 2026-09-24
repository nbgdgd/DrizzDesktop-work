import { Button, Flex, RadioCards, SegmentedControl, Select, Slider, Text, TextField } from "@radix-ui/themes";
import { temper } from "../../character";
import { pets, Settings } from "../../model";
import type { PanelState } from "../store";
import { Portrait, Row, Section, ToggleRow } from "../ui";
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
        {off && <Select.Item value="-1">выкл.</Select.Item>}
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
      <Section title="Персонаж">
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
                    {temper(x.id).trait}
                  </Text>
                </Flex>
              </Flex>
            </RadioCards.Item>
          ))}
        </RadioCards.Root>
      </Section>
      <Section title="Поведение">
        <Row label="Режим" hint="«Тихий» — без самостоятельных реплик, «Не мешать» — в угол и молча.">
          <SegmentedControl.Root value={d.mode} onValueChange={(v) => set("mode", v as Settings["mode"])} size="1">
            <SegmentedControl.Item value="normal">Обычный</SegmentedControl.Item>
            <SegmentedControl.Item value="quiet">Тихий</SegmentedControl.Item>
            <SegmentedControl.Item value="dnd">Не мешать</SegmentedControl.Item>
          </SegmentedControl.Root>
        </Row>
        <Row label="Активность">
          <SegmentedControl.Root value={d.activity} onValueChange={(v) => set("activity", v as Settings["activity"])} size="1">
            <SegmentedControl.Item value="calm">Спокойная</SegmentedControl.Item>
            <SegmentedControl.Item value="balanced">Обычная</SegmentedControl.Item>
            <SegmentedControl.Item value="active">Живая</SegmentedControl.Item>
          </SegmentedControl.Root>
        </Row>
        <Row label={`Размер · ${d.size}`} hint="Логические пиксели поверх масштаба Windows.">
          <Slider value={[d.size]} min={56} max={176} step={4} onValueChange={([v]) => set("size", v)} style={{ width: 180 }} aria-label="Размер" />
        </Row>
        {t("smooth", "Сглаживание", "Мягкие края при уменьшении; выключите ради чётких пикселей.")}
      </Section>
      <Section title="Движение">
        {t("walk", "Гулять по рабочему столу")}
        {t("perch", "Сидеть и лазать по окнам", "Запрыгивает, карабкается по краю, катается на окне.")}
        {t("pinned", "Закрепить на месте", "Перетаскивать всё равно можно.")}
        <Row label="Экран" hint="«Где находится» — ходит между соседними мониторами.">
          <Select.Root value={d.monitor} onValueChange={(v) => set("monitor", v)}>
            <Select.Trigger aria-label="Экран" />
            <Select.Content>
              <Select.Item value="auto">Где находится питомец</Select.Item>
              {p.monitors.map((m, i) => (
                <Select.Item key={m.id} value={m.id}>
                  Экран {i + 1}
                  {m.primary ? " · основной" : ""}
                </Select.Item>
              ))}
            </Select.Content>
          </Select.Root>
        </Row>
        <Row label="Любимое место для «Не мешать»" hint="Текущая позиция питомца.">
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
            Запомнить место
          </Button>
        </Row>
      </Section>
      <Section title="Характер">
        {t("cursorPlay", "Игры с курсором", "Трогает, ловит и, если обидели, охотится на курсор.")}
        {t("cursorPush", "Может толкать курсор", "После удара лапой курсор немного отъезжает. Никогда — пока зажата кнопка мыши.")}
        {t("mumble", "Бормочет сам с собой", "Считает пиксели, напевает, вздыхает — когда ничего не происходит.")}
        {t("mischief", "Шалости", "Приносит подарки, оставляет записки, иногда таскает мелочь.")}
        {t("nightSleep", "Спит по ночам", "После «ночного часа» ложится спать, даже если вы работаете.")}
      </Section>
      <Section title="Реплики и звук">
        {t("comments", "Реплики", "Мат и стёб сохранены. Текст исчезает сам.")}
        <Row label="Самостоятельно — не чаще">
          <Select.Root value={String(d.commentMinutes)} onValueChange={(v) => set("commentMinutes", Number(v))}>
            <Select.Trigger aria-label="Частота реплик" />
            <Select.Content>
              {[1, 3, 5, 7, 10, 15, 30, 60].map((n) => (
                <Select.Item key={n} value={String(n)}>
                  раз в {n} мин
                </Select.Item>
              ))}
            </Select.Content>
          </Select.Root>
        </Row>
        {t("sounds", "Звуки", "Шаги, прыжки, еда, монеты (синтез и Kenney CC0).")}
        {t("voice", "Бормотание вместо озвучки", "Каждая реплика — набор звуков, у каждого персонажа свой голос.")}
        <Row label={`Громкость · ${d.soundVolume}%`}>
          <Slider value={[d.soundVolume]} min={0} max={100} step={5} onValueChange={([v]) => set("soundVolume", v)} style={{ width: 180 }} aria-label="Громкость" />
        </Row>
      </Section>
      <Section title="Время">
        {num("idleMinutes", "Отдых без ввода, мин", 1, 60)}
        {num("sleepMinutes", "Сон без ввода, мин", 2, 120)}
        {num("longSessionMinutes", "Долго в одной программе, мин", 10, 240)}
        <Row label="Ночной час" hint="Позже — ворчит, что пора спать.">
          {hourSelect("lateHour", "Ночной час")}
        </Row>
        <Row label="Тихие часы" hint="Без реплик по своей инициативе в это время.">
          <Flex gap="2" align="center">
            {hourSelect("quietFrom", "Тихие часы с", true)}
            <Text size="2" color="gray">
              —
            </Text>
            {hourSelect("quietTo", "Тихие часы до", true)}
          </Flex>
        </Row>
      </Section>
      <Section title="Погода" description="Зонтик в дождь и снежинки зимой. Запрос к open-meteo.com раз в 30 минут, только с вашими координатами и только если включено.">
        {t("weather", "Показывать погоду")}
        {d.weather && (
          <Row label="Координаты" hint="Широта и долгота через запятую, например 55.75,37.62.">
            <TextField.Root value={d.weatherPlace} placeholder="55.75,37.62" onChange={(e) => set("weatherPlace", e.target.value)} style={{ width: 160 }} />
          </Row>
        )}
      </Section>
      <Section title="Запуск">{t("autostart", "Запускать с Windows", "По умолчанию выключено.")}</Section>
    </>
  );
}
