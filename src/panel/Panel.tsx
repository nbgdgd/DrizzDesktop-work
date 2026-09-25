// The settings window, rebuilt on Radix Themes (MIT) with Lucide icons
// (ISC): a sidebar of sections, a header with the pet's state and a page.
import "@radix-ui/themes/styles.css";
import "./panel.css";
import { ReactNode, useEffect, useState } from "react";
import { Badge, Box, Button, Callout, Flex, IconButton, ScrollArea, Separator, Text, Theme, Tooltip } from "@radix-ui/themes";
import {
  BellRing,
  Headphones,
  Briefcase,
  Brain,
  ChartColumn,
  EyeOff,
  Gamepad2,
  HeartPulse,
  Info,
  LocateFixed,
  MessageCircle,
  Radar,
  ShieldCheck,
  ShoppingBasket,
  SlidersHorizontal,
  TrendingUp,
  Trophy,
} from "lucide-react";
import { command, native } from "../bridge";
import { pets } from "../model";
import { level } from "../game";
import { usePanel } from "./store";
import { Money, Portrait, accents } from "./ui";
import { Home } from "./pages/Home";
import { Shop } from "./pages/Shop";
import { Skills, Work } from "./pages/Growth";
import { Games } from "./pages/Games";
import { Collection } from "./pages/Collection";
import { Stats } from "./pages/Stats";
import { Trace } from "./pages/Trace";
import { Chat } from "./pages/Chat";
import { MemoryPage } from "./pages/MemoryPage";
import { Behavior } from "./pages/Behavior";
import { Privacy } from "./pages/Privacy";
import { Welcome } from "./pages/Welcome";
import { Ears } from "./pages/Ears";
import { About } from "./pages/About";
import { stage, stageNames } from "../chronicle";
import { bondPct } from "../director";
import { tx } from "../i18n";
type Page = { id: string; name: string; icon: ReactNode; group: string };
const pages: Page[] = [
  { id: "status", name: "Состояние", icon: <HeartPulse size={16} />, group: "Питомец" },
  { id: "shop", name: "Еда и аптека", icon: <ShoppingBasket size={16} />, group: "Питомец" },
  { id: "games", name: "Игры и роли", icon: <Gamepad2 size={16} />, group: "Питомец" },
  { id: "collection", name: "Коллекция", icon: <Trophy size={16} />, group: "Питомец" },
  { id: "skills", name: "Прокачка", icon: <TrendingUp size={16} />, group: "Развитие" },
  { id: "work", name: "Работа", icon: <Briefcase size={16} />, group: "Развитие" },
  { id: "chat", name: "Разговор", icon: <MessageCircle size={16} />, group: "Общение" },
  { id: "memory", name: "Память", icon: <Brain size={16} />, group: "Общение" },
  { id: "stats", name: "Статистика", icon: <ChartColumn size={16} />, group: "Компьютер" },
  { id: "trace", name: "Трассировка", icon: <Radar size={16} />, group: "Компьютер" },
  { id: "settings", name: "Поведение", icon: <SlidersHorizontal size={16} />, group: "Настройки" },
  { id: "ears", name: "Уши", icon: <Headphones size={16} />, group: "Настройки" },
  { id: "privacy", name: "Доступ", icon: <ShieldCheck size={16} />, group: "Настройки" },
  { id: "about", name: "О программе", icon: <Info size={16} />, group: "Настройки" },
];
export default function Panel({ initialTab }: { initialTab: string }) {
  const p = usePanel();
  const [tab, setTab] = useState(pages.some((x) => x.id === initialTab) ? initialTab : "status");
  const [welcome, setWelcome] = useState(initialTab === "welcome");
  useEffect(() => {
    const t = p.tabEvent.split("|")[0];
    if (t === "welcome") setWelcome(true);
    else if (t && pages.some((x) => x.id === t)) setTab(t);
  }, [p.tabEvent]);
  const pet = pets.find((x) => x.id === p.draft.pet) ?? pets[0];
  const g = p.store.game;
  const now = Date.now();
  const st = stage(bondPct(g), g.life, now);
  const groups = [...new Set(pages.map((x) => x.group))];
  const current = pages.find((x) => x.id === tab)!;
  const saveable = ["settings", "privacy"].includes(tab);
  if (welcome)
    return (
      <Theme className="toon" appearance="light" accentColor={accents[pet.id] ?? "lime"} grayColor="sand" radius="large" scaling="100%" panelBackground="solid">
        {p.loaded ? <Welcome p={p} done={() => setWelcome(false)} /> : null}
      </Theme>
    );
  return (
    <Theme className="toon" appearance="light" accentColor={accents[pet.id] ?? "lime"} grayColor="sand" radius="medium" scaling="95%" panelBackground="solid">
      <div className="shell">
        <aside className="side">
          <Flex align="center" gap="3" px="3" pt="4" pb="3">
            <Portrait pet={pet.id} size={40} />
            <Box minWidth="0">
              <Text as="div" size="3" weight="bold" truncate>
                {pet.name}
              </Text>
              <Text as="div" size="1" color="gray" truncate>
                {tx(pet.trait)}
              </Text>
            </Box>
          </Flex>
          <Flex gap="2" px="3" pb="3" wrap="wrap">
            <Badge variant="soft">{tx("ур. {n}", { n: level(g.exp) })}</Badge>
            <Badge variant="soft" color="gray">
              {tx(stageNames[st])}
            </Badge>
          </Flex>
          <Separator size="4" />
          <ScrollArea type="auto" scrollbars="vertical" style={{ flex: 1 }}>
            <nav className="nav">
              {groups.map((group) => (
                <div key={group}>
                  <Text as="div" size="1" color="gray" className="nav-group">
                    {tx(group)}
                  </Text>
                  {pages
                    .filter((x) => x.group === group)
                    .map((x) => (
                      <button
                        key={x.id}
                        className="nav-item"
                        aria-current={tab === x.id ? "page" : undefined}
                        onClick={() => {
                          setTab(x.id);
                          p.setStatus("");
                          p.setError("");
                        }}
                      >
                        {x.icon}
                        <span>{tx(x.name)}</span>
                      </button>
                    ))}
                </div>
              ))}
            </nav>
          </ScrollArea>
          <Separator size="4" />
          <Flex gap="2" p="3" justify="between">
            <Tooltip content={tx("Позвать к курсору · Ctrl+Alt+D")}>
              <IconButton variant="soft" aria-label={tx("Позвать")} onClick={() => void command("summon_pet")}>
                <BellRing size={16} />
              </IconButton>
            </Tooltip>
            <Tooltip content={tx("Вернуть на экран")}>
              <IconButton variant="soft" color="gray" aria-label={tx("Вернуть на экран")} onClick={() => void command("recenter_pet")}>
                <LocateFixed size={16} />
              </IconButton>
            </Tooltip>
            <Tooltip content={tx("Скрыть питомца")}>
              <IconButton variant="soft" color="gray" aria-label={tx("Скрыть")} onClick={() => void command("hide_pet")}>
                <EyeOff size={16} />
              </IconButton>
            </Tooltip>
          </Flex>
        </aside>
        <main className="main">
          <header className="head">
            <Text size="5" weight="bold">
              {tx(current.name)}
            </Text>
            <Money value={g.money} />
          </header>
          <ScrollArea type="auto" scrollbars="vertical" className="page">
            <div className="page-inner">
              {!native && (
                <Callout.Root color="gray" size="1" mb="4">
                  <Callout.Icon>
                    <Info size={14} />
                  </Callout.Icon>
                  <Callout.Text>{tx("Превью интерфейса. Системные функции работают только в приложении для Windows.")}</Callout.Text>
                </Callout.Root>
              )}
              {!p.loaded ? (
                <Text color="gray">{tx("Загрузка...")}</Text>
              ) : (
                <>
                  {tab === "status" && <Home p={p} go={setTab} />}
                  {tab === "shop" && <Shop p={p} />}
                  {tab === "skills" && <Skills p={p} />}
                  {tab === "work" && <Work p={p} />}
                  {tab === "games" && <Games p={p} />}
                  {tab === "collection" && <Collection p={p} />}
                  {tab === "stats" && <Stats p={p} />}
                  {tab === "trace" && <Trace p={p} />}
                  {tab === "chat" && <Chat p={p} />}
                  {tab === "memory" && <MemoryPage p={p} />}
                  {tab === "settings" && <Behavior p={p} />}
                  {tab === "privacy" && <Privacy p={p} />}
                  {tab === "ears" && <Ears p={p} />}
                  {tab === "about" && <About p={p} />}
                </>
              )}
            </div>
          </ScrollArea>
          {(p.error || p.status || (saveable && p.dirty)) && (
            <footer className="foot">
              {p.error ? (
                <Text size="2" color="red" role="alert">
                  {p.error}
                </Text>
              ) : (
                <Text size="2" color="gray" aria-live="polite">
                  {p.status || tx("Есть несохранённые изменения")}
                </Text>
              )}
              {saveable && (
                <Button disabled={p.saving || !p.dirty} onClick={() => void p.save()}>
                  {p.saving ? tx("Сохраняю...") : tx("Сохранить")}
                </Button>
              )}
            </footer>
          )}
        </main>
      </div>
    </Theme>
  );
}
