import { useEffect, useState } from "react";
import { Badge, Button, Card, DataList, Flex, Grid, Heading, Text } from "@radix-ui/themes";
import { Gamepad2, Shield, Utensils } from "lucide-react";
import { emitAll } from "../../bridge";
import { pets } from "../../model";
import { jobById, jobProgress, level, levelUpNeed, likabilityMax, mode, skill, upgrades, working } from "../../game";
import { count, daysTogether, stage, stageNames } from "../../chronicle";
import { bondPct } from "../../director";
import { temper } from "../../character";
import type { PanelState } from "../store";
import { Meter, Portrait, Section } from "../ui";
import { tx } from "../../i18n";
const modeNames = { happy: "Счастлив", normal: "Обычный", poor: "Не в духе", ill: "Болеет" };
export function Home({ p, go }: { p: PanelState; go: (tab: string) => void }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(id);
  }, []);
  const g = p.store.game;
  const life = g.life;
  const lvl = level(g.exp);
  const pet = pets.find((x) => x.id === p.store.settings.pet) ?? pets[0];
  const st = stage(bondPct(g), life, now);
  const job = working(g, now) ? jobById(g.job?.id ?? "") : undefined;
  const skills = upgrades.filter((u) => skill(g, u.id) > 0);
  return (
    <>
      <Card size="3" mb="4">
        <Flex gap="5" align="center" wrap="wrap">
          <Portrait pet={pet.id} size={96} />
          <Flex direction="column" gap="2" style={{ flex: 1, minWidth: 240 }}>
            <Flex align="center" gap="2" wrap="wrap">
              <Heading size="5">{pet.name}</Heading>
              <Badge>{tx("{n} уровень", { n: lvl })}</Badge>
              <Badge color="gray">{tx(modeNames[mode(g)])}</Badge>
              <Badge color={st >= 3 ? "green" : st <= 0 ? "red" : "gray"}>{tx(stageNames[st])}</Badge>
            </Flex>
            <Text size="2" color="gray">
              {tx(temper(pet.id).trait)}
            </Text>
            <Meter
              label={tx("Опыт")}
              value={g.exp - levelUpNeed(lvl - 1)}
              max={levelUpNeed(lvl) - levelUpNeed(lvl - 1)}
              text={`${Math.floor(g.exp)} / ${levelUpNeed(lvl)}`}
              color="gray"
            />
          </Flex>
        </Flex>
        <Flex gap="2" mt="4" wrap="wrap">
          <Button variant="soft" onClick={() => go("shop")}>
            <Utensils size={15} /> {tx("Покормить")}
          </Button>
          <Button variant="soft" onClick={() => void emitAll("pet-command", { text: "play" })}>
            <Gamepad2 size={15} /> {tx("Поиграть")}
          </Button>
          <Button variant="soft" color="gray" onClick={() => void emitAll("pet-command", { role: "guard" })}>
            <Shield size={15} /> {tx("Поставить на охрану")}
          </Button>
        </Flex>
      </Card>
      <Grid columns={{ initial: "1", sm: "2" }} gap="4">
        <Section title={tx("Самочувствие")}>
          <Meter label={tx("Настроение")} value={g.feeling} />
          <Meter label={tx("Сытость")} value={g.food} />
          <Meter label={tx("Вода")} value={g.drink} />
          <Meter label={tx("Бодрость")} value={g.strength} />
          <Meter label={tx("Здоровье")} value={g.health} />
          {job && (
            <Meter
              label={tx("На смене: {job}", { job: tx(job.name) })}
              value={jobProgress(g, now) * 100}
              text={tx("{m} мин", { m: Math.max(1, Math.ceil(((g.job?.endsAt ?? now) - now) / 60000)) })}
              color="gray"
            />
          )}
        </Section>
        <Section title={tx("Отношения")}>
          <Meter label={tx("Симпатия")} value={g.likability} max={likabilityMax(lvl)} color="green" />
          <Meter label={tx("Обида")} value={g.grudge} color={g.grudge >= 50 ? "red" : "gray"} text={g.grudge >= 50 ? tx("злится") : g.grudge >= 20 ? tx("дуется") : tx("спокоен")} />
          <DataList.Root size="2" mt="1">
            <DataList.Item>
              <DataList.Label>{tx("Вместе")}</DataList.Label>
              <DataList.Value>{tx("{n} дн.", { n: daysTogether(life, now) })}</DataList.Value>
            </DataList.Item>
            <DataList.Item>
              <DataList.Label>{tx("Подряд")}</DataList.Label>
              <DataList.Value>
                {tx("{n} дн. (рекорд {best})", { n: life.streak, best: life.bestStreak })}
              </DataList.Value>
            </DataList.Item>
            <DataList.Item>
              <DataList.Label>{tx("Помнит")}</DataList.Label>
              <DataList.Value>
                {tx("{t} бросков, {f} кормлений, {p} поглаживаний", { t: count(life, "throw"), f: count(life, "fed"), p: count(life, "pet") })}
              </DataList.Value>
            </DataList.Item>
            <DataList.Item>
              <DataList.Label>{tx("Курсор")}</DataList.Label>
              <DataList.Value>
                {tx("бил {s} раз, промахнулся {m}", { s: count(life, "swat"), m: count(life, "miss") })}
              </DataList.Value>
            </DataList.Item>
            <DataList.Item>
              <DataList.Label>{tx("Прокачка")}</DataList.Label>
              <DataList.Value>{skills.map((u) => `${tx(u.name)} ${skill(g, u.id)}`).join(", ") || tx("ничего")}</DataList.Value>
            </DataList.Item>
          </DataList.Root>
        </Section>
      </Grid>
      <Text as="p" size="1" color="gray">
        {tx("Клик по питомцу — ответ и строка состояния. Правый клик — карточка с уровнем и нуждами. Медленно провести курсором — погладить, быстро поводить — пощекотать. Броски и тыканье он запоминает; когда обида большая, он охотится на курсор.")}
      </Text>
    </>
  );
}
