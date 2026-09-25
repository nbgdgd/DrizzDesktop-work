import { useEffect, useState } from "react";
import { Button, Flex, Text, TextArea, TextField } from "@radix-ui/themes";
import { command } from "../../bridge";
import { Settings } from "../../model";
import type { PanelState } from "../store";
import { Row, Section, ToggleRow } from "../ui";
import { tx } from "../../i18n";
function ListField({ label, value, set, placeholder }: { label: string; value: string[]; set: (v: string[]) => void; placeholder?: string }) {
  const [text, setText] = useState(value.join(", "));
  useEffect(() => setText(value.join(", ")), [JSON.stringify(value)]);
  return (
    <div>
      <Text as="label" size="2" weight="medium">
        {label}
      </Text>
      <TextArea
        mt="1"
        rows={2}
        value={text}
        placeholder={placeholder ?? "program.exe, another.exe"}
        onChange={(e) => setText(e.target.value)}
        onBlur={(e) =>
          set(
            e.target.value
              .split(",")
              .map((s) => s.trim().toLowerCase())
              .filter(Boolean),
          )
        }
      />
    </div>
  );
}
export function Privacy({ p }: { p: PanelState }) {
  const d = p.draft;
  const set = p.set;
  const [key, setKey] = useState("");
  const t = (k: keyof Settings, label: string, hint?: string) => (
    <ToggleRow label={label} hint={hint} checked={!!d[k]} onChange={(v) => set(k, v as never)} />
  );
  return (
    <>
      <Text as="p" size="2" color="gray" mb="3">
        {tx("Только сигналы, которые вы разрешили. Без чтения переписок, заголовков окон, буфера обмена и содержимого экрана.")}
      </Text>
      <Section title={tx("Наблюдение")}>
        {t("observeApps", tx("Активная программа"), tx("Только имя .exe. Никакой истории действий на диске."))}
        {t("observeIdle", tx("Время без ввода"), tx("Учитывается активность контроллера."))}
        {t("observeMedia", tx("Музыка и видео"), tx("Системная медиасессия. Название трека не сохраняется."))}
        {t("observeSystem", tx("Нагрузка, сеть и батарея"))}
        {t("observeCursor", tx("Реагировать на курсор"))}
        {t("observeDesktop", tx("События Windows"), tx("Громкость, буфер (только номер изменения), Caps Lock, тема, память, диск, число окон."))}
        {t("observeSound", tx("Звук системы"), tx("Уровень громкости и играет ли что-то. Сам звук не записывается."))}
        {t("observeInput", tx("Клики и печать в других программах"), tx("Только счётчики. Какие клавиши - не читается."))}
        {t("trackUsage", tx("Учёт времени по программам"), tx("Секунды по имени .exe в usage.json, 90 дней."))}
      </Section>
      <Section title={tx("Трассировка и нагрузка")}>
        {t("observeProcesses", tx("Кто запускает консоли"), tx("Командная строка, PowerShell, скрипты, системные утилиты. Ничего не блокирует."))}
        {t("watchAutoruns", tx("Следить за автозапуском"), tx("Новая запись - питомец спросит, убрать ли её."))}
        {t("traceBackground", tx("Говорить о фоновых запусках"), tx("Не чаще раза в 2 часа на программу; подозрительное - всегда."))}
        {t("observeGpu", tx("Нагрузка видеокарты"))}
        <ListField label={tx("Доверенные источники (.exe)")} value={d.traceTrusted} set={(v) => set("traceTrusted", v)} placeholder="steam.exe, updater.exe" />
        {t("hideFullscreen", tx("Скрывать в полном экране"))}
        {t("diagnostics", tx("Диагностика в файл"), "%LOCALAPPDATA%\\DrizzDesktop\\diagnostic.log, до 1 МБ.")}
      </Section>
      <Section title={tx("Программы")}>
        <ListField label={tx("Показывать компактно в полном экране")} value={d.fullscreenAllow} set={(v) => set("fullscreenAllow", v)} />
        <ListField label={tx("Игры")} value={d.games} set={(v) => set("games", v)} placeholder="game.exe" />
        <ListField label={tx("Редакторы")} value={d.editors} set={(v) => set("editors", v)} />
        <ListField label={tx("Мессенджеры")} value={d.chatApps} set={(v) => set("chatApps", v)} />
      </Section>
      <Section title={tx("Подключения")}>
        {t("integration", tx("События от программ"), tx("Локальный API на 127.0.0.1:49753. Сам ничего не отслеживает."))}
        {d.integration && (
          <>
            <Text size="1" color="gray">
              {p.integrationStatus === "ready"
                ? tx("Готов: 127.0.0.1:49753")
                : p.integrationStatus === "busy"
                  ? tx("Порт 49753 занят. Интеграция недоступна.")
                  : tx("После сохранения: POST http://127.0.0.1:49753/event")}
            </Text>
            <Row label={tx("Локальный токен")} hint={tx("Не публикуйте. Скрипт отправки - в README.")}>
              <TextField.Root type="password" readOnly value={p.store.token} style={{ width: 220 }} />
            </Row>
          </>
        )}
        {t("ai", tx("Модель для разговора"), tx("OpenRouter. Платные запросы - только после вашего сообщения."))}
        {d.ai && (
          <>
            <Row label={tx("Модель")}>
              <TextField.Root value={d.model} onChange={(e) => set("model", e.target.value)} style={{ width: 260 }} />
            </Row>
            <Row label={`Ключ${p.store.hasKey ? tx(" · сохранён (DPAPI)") : ""}`}>
              <Flex gap="2">
                <TextField.Root type="password" value={key} autoComplete="off" placeholder="sk-or-..." onChange={(e) => setKey(e.target.value)} />
                <Button
                  variant="soft"
                  disabled={!key.trim()}
                  onClick={() =>
                    p.run(
                      command("save_key", { key }).then(() => setKey("")),
                      tx("Ключ защищён и сохранён"),
                    )
                  }
                >
                  {tx("Сохранить")}
                </Button>
                {p.store.hasKey && (
                  <Button variant="soft" color="red" onClick={() => p.run(command("save_key", { key: "" }), tx("Ключ удалён"))}>
                    {tx("Удалить")}
                  </Button>
                )}
              </Flex>
            </Row>
            {t("sendContext", tx("Отправлять состояние питомца"), tx("Только персонаж и режим; не список окон."))}
          </>
        )}
      </Section>
    </>
  );
}
