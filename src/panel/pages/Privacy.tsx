import { useEffect, useState } from "react";
import { Button, Flex, Text, TextArea, TextField } from "@radix-ui/themes";
import { command } from "../../bridge";
import { Settings } from "../../model";
import type { PanelState } from "../store";
import { Row, Section, ToggleRow } from "../ui";
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
        Только сигналы, которые вы разрешили. Без чтения переписок, заголовков окон, буфера обмена и содержимого экрана.
      </Text>
      <Section title="Наблюдение">
        {t("observeApps", "Активная программа", "Только имя .exe. Никакой истории действий на диске.")}
        {t("observeIdle", "Время без ввода", "Учитывается активность контроллера.")}
        {t("observeMedia", "Музыка и видео", "Системная медиасессия. Название трека не сохраняется.")}
        {t("observeSystem", "Нагрузка, сеть и батарея")}
        {t("observeCursor", "Реагировать на курсор")}
        {t("observeDesktop", "События Windows", "Громкость, буфер (только номер изменения), Caps Lock, тема, память, диск, число окон.")}
        {t("observeSound", "Звук системы", "Уровень громкости и играет ли что-то. Сам звук не записывается.")}
        {t("observeInput", "Клики и печать в других программах", "Только счётчики. Какие клавиши — не читается.")}
        {t("trackUsage", "Учёт времени по программам", "Секунды по имени .exe в usage.json, 90 дней.")}
      </Section>
      <Section title="Трассировка и нагрузка">
        {t("observeProcesses", "Кто запускает консоли", "Командная строка, PowerShell, скрипты, системные утилиты. Ничего не блокирует.")}
        {t("watchAutoruns", "Следить за автозапуском", "Новая запись — питомец спросит, убрать ли её.")}
        {t("traceBackground", "Говорить о фоновых запусках", "Не чаще раза в 2 часа на программу; подозрительное — всегда.")}
        {t("observeGpu", "Нагрузка видеокарты")}
        <ListField label="Доверенные источники (.exe)" value={d.traceTrusted} set={(v) => set("traceTrusted", v)} placeholder="steam.exe, updater.exe" />
        {t("hideFullscreen", "Скрывать в полном экране")}
        {t("diagnostics", "Диагностика в файл", "%LOCALAPPDATA%\\DrizzDesktop\\diagnostic.log, до 1 МБ.")}
      </Section>
      <Section title="Программы">
        <ListField label="Показывать компактно в полном экране" value={d.fullscreenAllow} set={(v) => set("fullscreenAllow", v)} />
        <ListField label="Игры" value={d.games} set={(v) => set("games", v)} placeholder="game.exe" />
        <ListField label="Редакторы" value={d.editors} set={(v) => set("editors", v)} />
        <ListField label="Мессенджеры" value={d.chatApps} set={(v) => set("chatApps", v)} />
      </Section>
      <Section title="Подключения">
        {t("integration", "События от программ", "Локальный API на 127.0.0.1:49753. Сам ничего не отслеживает.")}
        {d.integration && (
          <>
            <Text size="1" color="gray">
              {p.integrationStatus || "После сохранения: POST http://127.0.0.1:49753/event"}
            </Text>
            <Row label="Локальный токен" hint="Не публикуйте. Скрипт отправки — в README.">
              <TextField.Root type="password" readOnly value={p.store.token} style={{ width: 220 }} />
            </Row>
          </>
        )}
        {t("ai", "Модель для разговора", "OpenRouter. Платные запросы — только после вашего сообщения.")}
        {d.ai && (
          <>
            <Row label="Модель">
              <TextField.Root value={d.model} onChange={(e) => set("model", e.target.value)} style={{ width: 260 }} />
            </Row>
            <Row label={`Ключ${p.store.hasKey ? " · сохранён (DPAPI)" : ""}`}>
              <Flex gap="2">
                <TextField.Root type="password" value={key} autoComplete="off" placeholder="sk-or-…" onChange={(e) => setKey(e.target.value)} />
                <Button
                  variant="soft"
                  disabled={!key.trim()}
                  onClick={() =>
                    p.run(
                      command("save_key", { key }).then(() => setKey("")),
                      "Ключ защищён и сохранён",
                    )
                  }
                >
                  Сохранить
                </Button>
                {p.store.hasKey && (
                  <Button variant="soft" color="red" onClick={() => p.run(command("save_key", { key: "" }), "Ключ удалён")}>
                    Удалить
                  </Button>
                )}
              </Flex>
            </Row>
            {t("sendContext", "Отправлять состояние питомца", "Только персонаж и режим; не список окон.")}
          </>
        )}
      </Section>
    </>
  );
}
