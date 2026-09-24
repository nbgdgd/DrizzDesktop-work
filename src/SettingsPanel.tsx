import { useEffect, useRef, useState, ReactNode } from "react";
import { command, on, native } from "./bridge";
import {
  cleanSettings,
  cleanMemory,
  defaults,
  emptyMemory,
  Memory,
  Monitor,
  pets,
  Settings,
  Store,
} from "./model";
import { phrases } from "./dialogue";
import { TracePanel } from "./TracePanel";
import { appName, formatDuration } from "./apps";
import {
  cleanGame,
  items,
  jobBlocked,
  jobById,
  jobPay,
  jobProgress,
  jobs,
  level,
  levelUpNeed,
  likabilityMax,
  mode,
  newGame,
  skill,
  upgradePrice,
  upgrades,
  working,
  Item,
} from "./game";
const tabs = [
  ["settings", "Питомец"],
  ["status", "Статус"],
  ["shop", "Магазин"],
  ["skills", "Прокачка"],
  ["work", "Работа"],
  ["stats", "Статистика"],
  ["trace", "Трассировка"],
  ["chat", "Разговор"],
  ["memory", "Память"],
  ["privacy", "Доступ"],
] as const;
interface UsageStats {
  today: { app: string; seconds: number }[];
  week: { app: string; seconds: number }[];
  month: { app: string; seconds: number }[];
  all: { app: string; seconds: number }[];
}
const periods = [
  ["today", "Сегодня"],
  ["week", "7 дней"],
  ["month", "30 дней"],
  ["all", "Всё время"],
] as const;
const modeNames = {
  happy: "Счастлив",
  normal: "Обычный",
  poor: "Не в духе",
  ill: "Болеет",
};
const kindNames: Record<Item["kind"], string> = {
  drink: "Напитки",
  snack: "Снеки",
  meal: "Еда",
  functional: "Бодрящее",
  drug: "Аптека",
};
function Bar({
  name,
  value,
  max = 100,
  text,
}: {
  name: string;
  value: number;
  max?: number;
  text?: string;
}) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div className="bar">
      <div className="bar-head">
        <span>{name}</span>
        <span className="muted">{text ?? `${Math.round(value)} / ${max}`}</span>
      </div>
      <div className="bar-track">
        <div className="bar-fill" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
const effect = (i: Item) =>
  [
    i.food ? `сытость ${i.food > 0 ? "+" : ""}${i.food}` : "",
    i.drink ? `вода ${i.drink > 0 ? "+" : ""}${i.drink}` : "",
    i.strength ? `бодрость +${i.strength}` : "",
    i.feeling ? `настроение ${i.feeling > 0 ? "+" : ""}${i.feeling}` : "",
    i.health ? `здоровье ${i.health > 0 ? "+" : ""}${i.health}` : "",
    i.exp ? `опыт +${i.exp}` : "",
  ]
    .filter(Boolean)
    .join(" · ");
function Row({
  name,
  hint,
  children,
}: {
  name: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="row">
      <div>
        <label>{name}</label>
        {hint && <small>{hint}</small>}
      </div>
      {children}
    </div>
  );
}
function Toggle({
  value,
  onChange,
  label,
}: {
  value: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={value}
      aria-label={label}
      className="switch"
      onClick={() => onChange(!value)}
    >
      <span />
    </button>
  );
}
function ListInput({
  value,
  set,
  placeholder,
}: {
  value: string[];
  set: (v: string[]) => void;
  placeholder?: string;
}) {
  const [text, setText] = useState(value.join(", "));
  useEffect(() => {
    setText(value.join(", "));
  }, [JSON.stringify(value)]);
  return (
    <input
      className="wide-input"
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
  );
}
export function SettingsPanel({ initialTab }: { initialTab: string }) {
  const [tab, setTab] = useState(initialTab);
  // A shift runs in real time, so the work bars need a clock of their own.
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(id);
  }, []);
  const [store, setStore] = useState<Store>({
    settings: defaults,
    memory: emptyMemory,
    game: newGame(0),
    token: "",
    hasKey: false,
  });
  const [usage, setUsage] = useState<UsageStats | null>(null);
  const [period, setPeriod] = useState<(typeof periods)[number][0]>("today");
  const [shopKind, setShopKind] = useState<Item["kind"] | "all">("all");
  const [draft, setDraft] = useState(defaults);
  const [memory, setMemory] = useState(emptyMemory);
  const [monitors, setMonitors] = useState<Monitor[]>([]);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [key, setKey] = useState("");
  const [fact, setFact] = useState("");
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<{ role: string; content: string }[]>(
    [],
  );
  const [waiting, setWaiting] = useState(false);
  const [integrationStatus, setIntegrationStatus] = useState("");
  const epoch = useRef(0);
  const disposed = useRef(false);
  const recentMemory = useRef(emptyMemory);
  const scroll = useRef<HTMLDivElement>(null);
  const accept = (s: Store) => {
    setStore({
      ...s,
      settings: cleanSettings(s.settings),
      memory: cleanMemory(s.memory),
      game: cleanGame(s.game, Date.now()),
    });
    recentMemory.current = cleanMemory(s.memory);
  };
  useEffect(() => {
    let gone = false;
    const offs: (() => void)[] = [];
    disposed.current = false;
    void command<Store>("load_store")
      .then((s) => {
        if (!gone) {
          accept(s);
          setMemory(cleanMemory(s.memory));
          setDraft(cleanSettings(s.settings));
          setLoaded(true);
        }
      })
      .catch((e) => setError(String(e)));
    void command<Monitor[]>("monitors").then((m) => {
      if (!gone) setMonitors(m ?? []);
    });
    for (const [name, fn] of [
      ["store", accept],
      ["tab", (v: string) => setTab(v)],
      ["integration-status", (v: string) => setIntegrationStatus(v)],
    ] as [string, (v: any) => void][]) {
      void on(name, fn).then((off) => {
        if (gone) off();
        else offs.push(off);
      });
    }
    return () => {
      gone = true;
      disposed.current = true;
      epoch.current++;
      offs.forEach((f) => f());
    };
  }, []);
  useEffect(() => {
    if (tab !== "stats") return;
    let gone = false;
    const load = () =>
      void command<UsageStats>("usage_stats")
        .then((u) => {
          if (!gone) setUsage(u);
        })
        .catch((e) => setError(String(e)));
    load();
    const timer = setInterval(load, 30000);
    return () => {
      gone = true;
      clearInterval(timer);
    };
  }, [tab]);
  const persistedSettings = JSON.stringify(store.settings);
  useEffect(() => setDraft(store.settings), [persistedSettings]);
  useEffect(() => {
    epoch.current++;
    setWaiting(false);
  }, [tab, store.settings.mode, store.settings.ai, store.settings.pet]);
  useEffect(() => {
    scroll.current?.scrollTo({
      top: scroll.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages, waiting]);
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => {
    setDraft((s) => ({ ...s, [k]: v }));
    setStatus("");
  };
  const toggle = (k: keyof Settings, label: string) => (
    <Toggle
      label={label}
      value={!!draft[k]}
      onChange={(v) => set(k, v as never)}
    />
  );
  const save = async () => {
    setError("");
    setSaving(true);
    try {
      const settings = cleanSettings(draft);
      await command("save_settings", { settings });
      setDraft(settings);
      setStatus("Сохранено");
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  };
  const saveMemory = async (m: Memory) => {
    try {
      const next = { ...recentMemory.current, ...m };
      await command("save_memory", { memory: next });
      setMemory(next);
      setStatus("Память сохранена");
    } catch (e) {
      setError(String(e));
    }
  };
  const send = async () => {
    const text = input.trim();
    if (!text || waiting) return;
    setInput("");
    setError("");
    const before = messages;
    setMessages((m) => [...m, { role: "user", content: text }]);
    if (/^запомни[: ,]/i.test(text)) {
      const value = text
        .replace(/^запомни[: ,]+/i, "")
        .trim()
        .slice(0, 240);
      if (value) {
        const m = {
          ...recentMemory.current,
          facts: [...recentMemory.current.facts, value].slice(-30),
        };
        await saveMemory(m);
        setMessages((v) => [
          ...v,
          {
            role: "assistant",
            content:
              "Запомнил. Посмотреть, поправить или удалить можно во вкладке «Память».",
          },
        ]);
      }
      return;
    }
    if (!store.settings.ai) {
      const answer =
        phrases.localChat[
          Math.floor(before.length / 2) % phrases.localChat.length
        ];
      setMessages((m) => [...m, { role: "assistant", content: answer }]);
      return;
    }
    if (!store.hasKey) {
      setError("Сначала добавьте ключ OpenRouter во вкладке «Доступ».");
      return;
    }
    const request = ++epoch.current;
    setWaiting(true);
    try {
      const reply = await command<string>("chat", {
        text,
        recent: before.slice(-6),
        context: store.settings.sendContext
          ? JSON.stringify({
              pet: store.settings.pet,
              mode: store.settings.mode,
            })
          : null,
      });
      if (request === epoch.current && !disposed.current)
        setMessages((m) => [...m, { role: "assistant", content: reply }]);
    } catch (e) {
      if (request === epoch.current && !disposed.current) {
        setError(String(e));
        setMessages((m) => [
          ...m,
          {
            role: "assistant",
            content:
              "Связь подвисла, блядь. Я всё равно здесь. Движение и обычные реакции работают без сети.",
          },
        ]);
      }
    } finally {
      if (request === epoch.current) setWaiting(false);
    }
  };
  const pet = pets.find((p) => p.id === draft.pet)!;
  const dirty = JSON.stringify(draft) !== JSON.stringify(store.settings);
  return (
    <div
      className="app"
      style={{ "--accent": pet.color } as React.CSSProperties}
    >
      <aside>
        <div className="brand">
          <span className="brand-dot" />
          TracePet<span className="version">0.1</span>
        </div>
        <nav>
          {tabs.map(([id, name]) => (
            <button
              className={tab === id ? "selected" : ""}
              key={id}
              onClick={() => {
                setTab(id);
                setStatus("");
                setError("");
              }}
            >
              {name}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <span className="local-dot" />
          Локальный режим
          <br />
          <small>Модель — только по запросу</small>
          <button
            className="text-button"
            onClick={() => void command("summon_pet")}
          >
            Позвать · Ctrl+Alt+D
          </button>
          <button
            className="text-button"
            onClick={() => void command("recenter_pet")}
          >
            Вернуть на экран
          </button>
        </div>
      </aside>
      <main>
        <header>
          <h1>{tabs.find((t) => t[0] === tab)?.[1] ?? "Питомец"}</h1>
          <button className="subtle" onClick={() => void command("hide_pet")}>
            Скрыть питомца
          </button>
        </header>
        {!native && (
          <div className="notice">
            Превью интерфейса. Системные функции доступны в Windows-приложении.
          </div>
        )}
        {!loaded ? (
          <p>Загрузка…</p>
        ) : (
          <div className="content">
            {tab === "settings" && (
              <>
                <div className="identity">
                  <div
                    className="portrait"
                    style={{
                      backgroundImage: `url('/pets/${pet.id}/spritesheet.webp')`,
                    }}
                  />
                  <div>
                    <select
                      className="pet-select"
                      aria-label="Персонаж"
                      value={draft.pet}
                      onChange={(e) => set("pet", e.target.value)}
                    >
                      {pets.map((p) => (
                        <option value={p.id} key={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                    <p>{pet.trait}</p>
                    <small>
                      Перетащите за персонажа. Правый клик — настройки.
                    </small>
                  </div>
                </div>
                <h2>Поведение</h2>
                <Row name="Режим">
                  <select
                    aria-label="Режим"
                    value={draft.mode}
                    onChange={(e) =>
                      set("mode", e.target.value as Settings["mode"])
                    }
                  >
                    <option value="normal">Обычный</option>
                    <option value="quiet">Тихий</option>
                    <option value="dnd">Не мешать</option>
                  </select>
                </Row>
                <Row name="Активность">
                  <select
                    aria-label="Активность"
                    value={draft.activity}
                    onChange={(e) =>
                      set("activity", e.target.value as Settings["activity"])
                    }
                  >
                    <option value="calm">Спокойная</option>
                    <option value="balanced">Обычная</option>
                    <option value="active">Живая</option>
                  </select>
                </Row>
                <Row name="Размер">
                  <div className="range">
                    <input
                      aria-label="Размер"
                      type="range"
                      min="56"
                      max="176"
                      step="4"
                      value={draft.size}
                      onChange={(e) => set("size", +e.target.value)}
                    />
                    <output>{draft.size}</output>
                  </div>
                </Row>
                <Row
                  name="Сглаживание"
                  hint="Мягкие края при уменьшении. Выключите ради чётких пикселей."
                >
                  {toggle("smooth", "Сглаживание")}
                </Row>
                <Row name="Гулять по рабочему столу">
                  {toggle("walk", "Гулять")}
                </Row>
                <Row
                  name="Сидеть на окнах"
                  hint="Перенесите на верхний край окна и отпустите."
                >
                  {toggle("perch", "Сидеть на окнах")}
                </Row>
                <Row
                  name="Закрепить на месте"
                  hint="Перетаскивание вручную остаётся доступно."
                >
                  {toggle("pinned", "Закрепить")}
                </Row>
                <Row name="Экран">
                  <select
                    aria-label="Экран"
                    value={draft.monitor}
                    onChange={(e) => set("monitor", e.target.value)}
                  >
                    <option value="auto">Где находится питомец</option>
                    {monitors.map((m, i) => (
                      <option key={m.id} value={m.id}>
                        Экран {i + 1}
                        {m.primary ? " · основной" : ""}
                      </option>
                    ))}
                  </select>
                </Row>
                <Row
                  name="Любимое место"
                  hint="Текущая позиция для режима «Не мешать»."
                >
                  <button
                    onClick={() => {
                      const m = {
                        ...recentMemory.current,
                        favorite: recentMemory.current.position
                          ? {
                              ...recentMemory.current.position,
                              monitor:
                                draft.monitor === "auto"
                                  ? (monitors.find((m) => {
                                      const p = recentMemory.current.position!;
                                      return (
                                        p.x >= m.work.left &&
                                        p.x <= m.work.right &&
                                        p.y >= m.work.top &&
                                        p.y <= m.work.bottom
                                      );
                                    })?.id ?? "auto")
                                  : draft.monitor,
                            }
                          : null,
                      };
                      void saveMemory(m);
                    }}
                  >
                    Запомнить место
                  </button>
                </Row>
                <h2>Реплики</h2>
                <Row
                  name="Комментарии"
                  hint="Мат и стёб сохранены. Текст сам исчезает."
                >
                  {toggle("comments", "Комментарии")}
                </Row>
                <Row
                  name="Звуки"
                  hint="Короткие эффекты на клик, еду, уровень и зарплату (Kenney, CC0)."
                >
                  {toggle("sounds", "Звуки")}
                </Row>
                <Row name="Громкость звуков">
                  <select
                    aria-label="Громкость звуков"
                    value={draft.soundVolume}
                    onChange={(e) => set("soundVolume", +e.target.value)}
                  >
                    {[0, 15, 30, 45, 55, 70, 85, 100].map((n) => (
                      <option key={n} value={n}>
                        {n}%
                      </option>
                    ))}
                  </select>
                </Row>
                <Row name="Самостоятельно — не чаще">
                  <select
                    aria-label="Частота реплик"
                    value={draft.commentMinutes}
                    onChange={(e) => set("commentMinutes", +e.target.value)}
                  >
                    {[1, 3, 5, 7, 10, 15, 30, 60].map((n) => (
                      <option key={n} value={n}>
                        Раз в {n} мин
                      </option>
                    ))}
                  </select>
                </Row>
                <details>
                  <summary>Паузы и длительные сессии</summary>
                  {(
                    [
                      ["idleMinutes", "Отдых без ввода, мин", 1, 60],
                      ["sleepMinutes", "Сон без ввода, мин", 2, 120],
                      ["longSessionMinutes", "Долго в программе, мин", 10, 240],
                      ["lateHour", "Ночной режим после, час", 0, 23],
                    ] as const
                  ).map(([k, label, min, max]) => (
                    <Row name={label} key={k}>
                      <input
                        aria-label={label}
                        className="number"
                        type="number"
                        min={min}
                        max={max}
                        value={draft[k]}
                        onChange={(e) => set(k, +e.target.value)}
                      />
                    </Row>
                  ))}
                  <p className="muted">
                    Музыка, полноэкранный режим, указанная игра и активный
                    контроллер не считаются уходом от ПК.
                  </p>
                </details>
                <h2>Запуск</h2>
                <Row name="Запускать с Windows" hint="По умолчанию выключено.">
                  {toggle("autostart", "Запускать с Windows")}
                </Row>
              </>
            )}
            {tab === "privacy" && (
              <>
                <p className="intro">
                  Только сигналы, которые вы разрешили. Без чтения переписок,
                  заголовков окон, буфера обмена и содержимого экрана.
                </p>
                <h2>Наблюдение</h2>
                <Row
                  name="Активная программа"
                  hint="Только имя .exe. Никакой истории действий на диске."
                >
                  {toggle("observeApps", "Активная программа")}
                </Row>
                <Row
                  name="Время без ввода"
                  hint="Без перехвата клавиш. Учитывается активность контроллера."
                >
                  {toggle("observeIdle", "Время без ввода")}
                </Row>
                <Row
                  name="Музыка и видео"
                  hint="Системная медиасессия. Название трека не сохраняется."
                >
                  {toggle("observeMedia", "Медиа")}
                </Row>
                <Row name="Нагрузка, сеть и батарея">
                  {toggle("observeSystem", "Система")}
                </Row>
                <Row name="Реагировать на курсор">
                  {toggle("observeCursor", "Курсор")}
                </Row>
                <Row
                  name="События Windows"
                  hint="Громкость, буфер обмена, Caps Lock, тема, память, диск, открытые окна. Только числа и флаги: ни заголовков окон, ни содержимого буфера."
                >
                  {toggle("observeDesktop", "События Windows")}
                </Row>
                <Row
                  name="Звук системы"
                  hint="Уровень громкости, «выключен ли звук» и играет ли что-то прямо сейчас. Сам звук не записывается."
                >
                  {toggle("observeSound", "Звук системы")}
                </Row>
                <Row
                  name="Клики и печать в других программах"
                  hint="Только счётчики нажатий, кликов и прокрутки. Какие клавиши — не читается и не сохраняется."
                >
                  {toggle("observeInput", "Клики и печать")}
                </Row>
                <Row
                  name="Учёт времени по программам"
                  hint="Секунды на каждое имя .exe в %LOCALAPPDATA%\DrizzDesktop\usage.json, 90 дней. Заголовки окон не пишутся."
                >
                  {toggle("trackUsage", "Учёт времени")}
                </Row>
                <h2>Трассировка и нагрузка</h2>
                <Row
                  name="Кто запускает консоли"
                  hint="Командная строка, PowerShell, скрипты и системные утилиты: кто их запустил и откуда. Ничего не блокирует."
                >
                  {toggle("observeProcesses", "Трассировка процессов")}
                </Row>
                <Row
                  name="Следить за автозапуском"
                  hint="Новая запись в Run или «Автозагрузке» — питомец спросит, убрать ли её."
                >
                  {toggle("watchAutoruns", "Автозапуск")}
                </Row>
                <Row
                  name="Говорить о фоновых запусках"
                  hint="Консоль без окна от недоверенной программы — не чаще раза в 2 часа на программу. Подозрительное сообщается всегда."
                >
                  {toggle("traceBackground", "Фоновые запуски")}
                </Row>
                <Row
                  name="Нагрузка видеокарты"
                  hint="Счётчики GPU Windows (как в диспетчере задач). Скачки процессора — через «Нагрузка, сеть и батарея»."
                >
                  {toggle("observeGpu", "Видеокарта")}
                </Row>
                <label className="field-label">
                  Доверенные источники · имена .exe (записываются, но не озвучиваются)
                </label>
                <ListInput
                  value={draft.traceTrusted}
                  set={(v) => set("traceTrusted", v)}
                  placeholder="steam.exe, updater.exe"
                />
                <Row name="Скрывать в полном экране">
                  {toggle("hideFullscreen", "Скрывать в полном экране")}
                </Row>
                <Row
                  name="Диагностика в файл"
                  hint="Только для поиска неполадок: ресурс, состояние, DPI, видимость. Файл %LOCALAPPDATA%\DrizzDesktop\diagnostic.log, не больше 1 МБ."
                >
                  {toggle("diagnostics", "Диагностика в файл")}
                </Row>
                <details>
                  <summary>Исключения и категории программ</summary>
                  <label className="field-label">
                    Показывать компактно в полном экране
                  </label>
                  <ListInput
                    value={draft.fullscreenAllow}
                    set={(v) => set("fullscreenAllow", v)}
                  />
                  <label className="field-label">Игры · имена .exe</label>
                  <ListInput
                    value={draft.games}
                    set={(v) => set("games", v)}
                    placeholder="game.exe"
                  />
                  <label className="field-label">Редакторы</label>
                  <ListInput
                    value={draft.editors}
                    set={(v) => set("editors", v)}
                  />
                  <label className="field-label">Мессенджеры</label>
                  <ListInput
                    value={draft.chatApps}
                    set={(v) => set("chatApps", v)}
                  />
                </details>
                <h2>Подключения</h2>
                <Row
                  name="События от программ"
                  hint="Локальный API. Подключается явно, само ничего не отслеживает."
                >
                  {toggle("integration", "Интеграции")}
                </Row>
                {draft.integration && (
                  <div className="inset">
                    <p>
                      {integrationStatus ||
                        "После сохранения: POST http://127.0.0.1:49753/event"}
                    </p>
                    <label className="field-label">
                      Локальный токен · не публикуйте
                    </label>
                    <input type="password" readOnly value={store.token} />
                    <small>
                      Инструкция и готовый скрипт — в README проекта. События
                      сборки, рендера, загрузки и окончания серии. Повторы
                      отбрасываются.
                    </small>
                  </div>
                )}
                <Row
                  name="Модель для разговора"
                  hint="OpenRouter. Платные запросы только после вашего сообщения."
                >
                  {toggle("ai", "Модель")}
                </Row>
                {draft.ai && (
                  <div className="inset">
                    <label className="field-label">Модель</label>
                    <input
                      className="wide-input"
                      value={draft.model}
                      onChange={(e) => set("model", e.target.value)}
                    />
                    <label className="field-label">
                      Ключ {store.hasKey ? "· сохранён в Windows DPAPI" : ""}
                    </label>
                    <div className="input-actions">
                      <input
                        type="password"
                        value={key}
                        autoComplete="off"
                        placeholder="sk-or-…"
                        onChange={(e) => setKey(e.target.value)}
                      />
                      <button
                        disabled={!key.trim()}
                        onClick={async () => {
                          try {
                            await command("save_key", { key });
                            setKey("");
                            setStatus("Ключ защищён и сохранён");
                          } catch (e) {
                            setError(String(e));
                          }
                        }}
                      >
                        Сохранить ключ
                      </button>
                    </div>
                    {store.hasKey && (
                      <button
                        className="text-button"
                        onClick={() =>
                          void command("save_key", { key: "" }).catch((e) =>
                            setError(String(e)),
                          )
                        }
                      >
                        Удалить ключ
                      </button>
                    )}
                    <Row
                      name="Отправлять состояние питомца"
                      hint="Только выбранный персонаж и режим; не список окон."
                    >
                      {toggle("sendContext", "Контекст")}
                    </Row>
                    <small>
                      Отправляются ваше сообщение, до 6 последних сообщений,
                      обращение и явно сохранённые факты. Обычные реакции
                      остаются локальными.
                    </small>
                  </div>
                )}
              </>
            )}
            {tab === "skills" && (
              <>
                <p className="intro">
                  Деньги можно потратить не только на еду. Прокачка работает
                  постоянно: она меняет то, как быстро питомец голодает,
                  устаёт и зарабатывает.
                </p>
                <div className="shop-head">
                  <span>Деньги: {store.game.money.toFixed(1)} ₽</span>
                </div>
                <div className="shop">
                  {upgrades.map((u) => {
                    const lvl = skill(store.game, u.id);
                    const price = upgradePrice(store.game, u.id);
                    return (
                      <div className="item" key={u.id}>
                        <div className="item-body">
                          <strong>
                            {u.name} · {lvl} / {u.max}
                          </strong>
                          <small>{u.desc}</small>
                          <small className="muted">
                            Каждый уровень: {u.step}
                          </small>
                        </div>
                        <button
                          className="primary"
                          disabled={price === null || store.game.money < price}
                          onClick={() => {
                            setError("");
                            void command("buy_upgrade", { id: u.id }).catch((e) =>
                              setError(String(e)),
                            );
                          }}
                        >
                          {price === null ? "Максимум" : `${price} ₽`}
                        </button>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
            {tab === "work" && (
              <>
                <p className="intro">
                  Работа — единственный быстрый способ заработать. Смена тратит
                  бодрость, еду и воду, поэтому сначала покормите. Питомец
                  работает, даже если вы отойдёте.
                </p>
                <div className="shop-head">
                  <span>Деньги: {store.game.money.toFixed(1)} ₽</span>
                  <span className="muted">
                    Смен отработано: {store.game.jobsDone ?? 0}
                  </span>
                </div>
                {working(store.game, now) && (
                  <Bar
                    name={`Сейчас: ${jobById(store.game.job?.id ?? "")?.name ?? ""}`}
                    value={jobProgress(store.game, now) * 100}
                    text={`${Math.max(
                      1,
                      Math.ceil(
                        ((store.game.job?.endsAt ?? now) - now) / 60000,
                      ),
                    )} мин осталось`}
                  />
                )}
                <div className="shop">
                  {jobs.map((j) => {
                    const why = jobBlocked(store.game, j);
                    return (
                      <div className="item" key={j.id}>
                        <div className="item-body">
                          <strong>
                            {j.name} · {j.minutes} мин
                          </strong>
                          <small>{j.desc}</small>
                          <small className="muted">
                            {jobPay(store.game, j)} ₽ · опыт +{j.exp} · бодрость
                            −{j.strength}
                            {why ? ` · ${why}` : ""}
                          </small>
                        </div>
                        <button
                          className="primary"
                          disabled={!!why}
                          onClick={() => {
                            setError("");
                            void command("start_job", { id: j.id }).catch((e) =>
                              setError(String(e)),
                            );
                          }}
                        >
                          {why ? "Нельзя" : "На смену"}
                        </button>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
            {tab === "status" && (
              <>
                <p className="intro">
                  Опыт капает, пока вы за компьютером; хорошее настроение
                  ускоряет рост. Еда, вода и бодрость тратятся со временем.
                </p>
                <div className="level-card">
                  <div className="level-num">
                    <small>Уровень</small>
                    {level(store.game.exp)}
                  </div>
                  <div className="level-body">
                    <Bar
                      name="Опыт"
                      value={
                        store.game.exp - levelUpNeed(level(store.game.exp) - 1)
                      }
                      max={
                        levelUpNeed(level(store.game.exp)) -
                        levelUpNeed(level(store.game.exp) - 1)
                      }
                      text={`${Math.floor(store.game.exp)} / ${levelUpNeed(level(store.game.exp))}`}
                    />
                    <div className="level-meta">
                      <span>Состояние: {modeNames[mode(store.game)]}</span>
                      <span>Деньги: {store.game.money.toFixed(1)} ₽</span>
                    </div>
                  </div>
                </div>
                <Bar name="Настроение" value={store.game.feeling} />
                <Bar name="Бодрость" value={store.game.strength} />
                <Bar name="Сытость" value={store.game.food} />
                <Bar name="Вода" value={store.game.drink} />
                <Bar
                  name="Симпатия"
                  value={store.game.likability}
                  max={likabilityMax(level(store.game.exp))}
                />
                {working(store.game, now) && (
                  <Bar
                    name={`На смене: ${jobById(store.game.job?.id ?? "")?.name ?? ""}`}
                    value={jobProgress(store.game, now) * 100}
                    text={`${Math.max(
                      1,
                      Math.ceil(
                        ((store.game.job?.endsAt ?? now) - now) / 60000,
                      ),
                    )} мин осталось`}
                  />
                )}
                <div className="level-meta">
                  <span>
                    Прокачка:{" "}
                    {upgrades
                      .filter((u) => skill(store.game, u.id) > 0)
                      .map((u) => `${u.name} ${skill(store.game, u.id)}`)
                      .join(", ") || "ничего не куплено"}
                  </span>
                </div>
                <p className="muted">
                  Клик по питомцу показывает уровень, деньги и состояние прямо
                  в облачке. Клики поднимают настроение (не больше трёх в
                  минуту), тыканье и таскание — опускают. Деньги идут за время
                  рядом с вами, за работу и за удачные сборки.
                </p>
              </>
            )}
            {tab === "shop" && (
              <>
                <div className="shop-head">
                  <span>Деньги: {store.game.money.toFixed(1)} ₽</span>
                  <div className="chips">
                    {(["all", ...Object.keys(kindNames)] as const).map((k) => (
                      <button
                        key={k}
                        className={shopKind === k ? "chip selected" : "chip"}
                        onClick={() => setShopKind(k as Item["kind"] | "all")}
                      >
                        {k === "all" ? "Всё" : kindNames[k as Item["kind"]]}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="shop">
                  {items
                    .filter((i) => shopKind === "all" || i.kind === shopKind)
                    .map((i) => (
                      <div className="item" key={i.id}>
                        <img src={i.icon} alt="" width={48} height={48} />
                        <div className="item-body">
                          <strong>{i.name}</strong>
                          <small>{i.desc}</small>
                          <small className="muted">{effect(i)}</small>
                        </div>
                        <button
                          className="primary"
                          disabled={store.game.money < i.price}
                          onClick={() => {
                            setError("");
                            void command("buy_item", { id: i.id }).catch((e) =>
                              setError(String(e)),
                            );
                          }}
                        >
                          {i.price} ₽
                        </button>
                      </div>
                    ))}
                </div>
                <p className="muted">
                  Иконки еды — VPet (LorisYounger),{" "}
                  <a href="https://github.com/LorisYounger/VPet" target="_blank" rel="noreferrer">
                    github.com/LorisYounger/VPet
                  </a>
                  .
                </p>
              </>
            )}
            {tab === "trace" && (
              <TracePanel
                trusted={store.settings.traceTrusted}
                onError={setError}
                trust={(exe) => {
                  const settings = cleanSettings({
                    ...store.settings,
                    traceTrusted: [...store.settings.traceTrusted, exe],
                  });
                  void command("save_settings", { settings })
                    .then(() => setStatus(`«${appName(exe)}» теперь в доверенных`))
                    .catch((e) => setError(String(e)));
                }}
              />
            )}
            {tab === "stats" && (
              <>
                <div className="chips">
                  {periods.map(([id, name]) => (
                    <button
                      key={id}
                      className={period === id ? "chip selected" : "chip"}
                      onClick={() => setPeriod(id)}
                    >
                      {name}
                    </button>
                  ))}
                </div>
                {(() => {
                  const rows = usage?.[period] ?? [];
                  const total = rows.reduce((a, r) => a + r.seconds, 0);
                  return rows.length ? (
                    <>
                      <p className="muted">Всего за период: {formatDuration(total)}</p>
                      <div className="usage">
                        {rows.slice(0, 40).map((r) => (
                          <div className="usage-row" key={r.app}>
                            <div className="usage-head">
                              <span title={r.app}>{appName(r.app)}</span>
                              <span className="muted">{formatDuration(r.seconds)}</span>
                            </div>
                            <div className="bar-track">
                              <div
                                className="bar-fill"
                                style={{ width: `${(r.seconds / Math.max(1, rows[0].seconds)) * 100}%` }}
                              />
                            </div>
                          </div>
                        ))}
                      </div>
                    </>
                  ) : (
                    <p className="muted">
                      {usage ? "Пока пусто. Время считается, пока вы за компьютером." : "Загрузка…"}
                    </p>
                  );
                })()}
                <button
                  className="danger"
                  onClick={() => {
                    void command("usage_clear")
                      .then(() => setUsage({ today: [], week: [], month: [], all: [] }))
                      .catch((e) => setError(String(e)));
                  }}
                >
                  Очистить статистику
                </button>
              </>
            )}
            {tab === "memory" && (
              <>
                <p className="intro">
                  Только то, что вы сами попросили запомнить. Переписки,
                  названия треков и список ваших действий здесь не хранятся.
                </p>
                <label className="field-label">Как к вам обращаться</label>
                <div className="input-actions">
                  <input
                    maxLength={40}
                    value={memory.address}
                    placeholder="Имя или прозвище"
                    onChange={(e) =>
                      setMemory((m) => ({ ...m, address: e.target.value }))
                    }
                  />
                  <button
                    onClick={() =>
                      void saveMemory({
                        ...recentMemory.current,
                        address: memory.address,
                      })
                    }
                  >
                    Сохранить
                  </button>
                </div>
                <h2>Ваши факты</h2>
                {recentMemory.current.facts.length === 0 && (
                  <p className="muted">
                    Пока ничего. Добавьте здесь или напишите «Запомни: …» в
                    разговоре.
                  </p>
                )}
                {recentMemory.current.facts.map((f, i) => (
                  <div className="fact" key={i}>
                    <input
                      maxLength={240}
                      aria-label={`Факт ${i + 1}`}
                      defaultValue={f}
                      onBlur={(e) => {
                        if (e.target.value !== f) {
                          const facts = [...recentMemory.current.facts];
                          facts[i] = e.target.value.trim();
                          void saveMemory({
                            ...recentMemory.current,
                            facts: facts.filter(Boolean),
                          });
                        }
                      }}
                    />
                    <button
                      aria-label={`Удалить факт ${i + 1}`}
                      onClick={() =>
                        void saveMemory({
                          ...recentMemory.current,
                          facts: recentMemory.current.facts.filter(
                            (_, j) => i !== j,
                          ),
                        })
                      }
                    >
                      ×
                    </button>
                  </div>
                ))}
                <div className="input-actions">
                  <input
                    maxLength={240}
                    value={fact}
                    placeholder="Например: люблю кооперативные игры"
                    onChange={(e) => setFact(e.target.value)}
                  />
                  <button
                    disabled={!fact.trim()}
                    onClick={() => {
                      void saveMemory({
                        ...recentMemory.current,
                        facts: [
                          ...recentMemory.current.facts,
                          fact.trim(),
                        ].slice(-30),
                      });
                      setFact("");
                    }}
                  >
                    Добавить
                  </button>
                </div>
                <h2>Техническая память</h2>
                <p className="muted">
                  Положение, любимое место, дата приветствия и 20 недавних
                  реплик — чтобы не повторяться.
                </p>
                <button
                  onClick={() =>
                    void saveMemory({
                      ...recentMemory.current,
                      recent: [],
                      lastGreeting: "",
                      favorite: null,
                    })
                  }
                >
                  Сбросить привычки
                </button>
                <button
                  className="danger"
                  onClick={() => {
                    if (
                      window.confirm(
                        "Удалить имя, факты, позицию и историю реплик?",
                      )
                    )
                      void saveMemory({ ...emptyMemory });
                  }}
                >
                  Очистить всю память
                </button>
              </>
            )}
            {tab === "chat" && (
              <div className="chat">
                <p className="intro">
                  {store.settings.ai
                    ? "Модель включена. Запрос уходит только после отправки."
                    : "Без модели — короткие локальные ответы. Обычному поведению API не нужен."}
                </p>
                <div className="messages" ref={scroll}>
                  {messages.length === 0 && (
                    <div className="chat-empty">
                      <div
                        className="portrait"
                        style={{
                          backgroundImage: `url('/pets/${store.settings.pet}/spritesheet.webp')`,
                        }}
                      />
                      <p>Ну? Я весь внимание.</p>
                      <small>
                        Разговор открывается только по вашей просьбе.
                      </small>
                    </div>
                  )}
                  {messages.map((m, i) => (
                    <div key={i} className={`message ${m.role}`}>
                      <small>
                        {m.role === "user"
                          ? "Вы"
                          : pets.find((p) => p.id === store.settings.pet)?.name}
                      </small>
                      <p>{m.content}</p>
                    </div>
                  ))}
                  {waiting && <p className="muted">Думаю…</p>}
                </div>
                <form
                  className="chat-input"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void send();
                  }}
                >
                  <input
                    aria-label="Сообщение"
                    maxLength={2000}
                    value={input}
                    placeholder="Сказать что-нибудь…"
                    onChange={(e) => setInput(e.target.value)}
                  />
                  <button
                    className="primary"
                    disabled={waiting || !input.trim()}
                  >
                    Отправить
                  </button>
                </form>
                <button
                  className="text-button"
                  onClick={() => {
                    epoch.current++;
                    setWaiting(false);
                    setMessages([]);
                  }}
                >
                  Очистить разговор
                </button>
              </div>
            )}
          </div>
        )}
        {error && (
          <div role="alert" className="error">
            {error}
          </div>
        )}
        <footer>
          <span aria-live="polite">
            {status ||
              (dirty
                ? "Есть несохранённые изменения"
                : "На рабочем столе — только персонаж.")}
          </span>
          {["settings", "privacy"].includes(tab) && (
            <button
              className="primary"
              disabled={saving || !loaded || !dirty}
              onClick={() => void save()}
            >
              {saving ? "Сохраняю…" : "Сохранить"}
            </button>
          )}
        </footer>
      </main>
    </div>
  );
}
