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
              <Badge>{lvl} уровень</Badge>
              <Badge color="gray">{modeNames[mode(g)]}</Badge>
              <Badge color={st >= 3 ? "green" : st <= 0 ? "red" : "gray"}>{stageNames[st]}</Badge>
            </Flex>
            <Text size="2" color="gray">
              {temper(pet.id).trait}
            </Text>
            <Meter
              label="Опыт"
              value={g.exp - levelUpNeed(lvl - 1)}
              max={levelUpNeed(lvl) - levelUpNeed(lvl - 1)}
              text={`${Math.floor(g.exp)} / ${levelUpNeed(lvl)}`}
              color="gray"
            />
          </Flex>
        </Flex>
        <Flex gap="2" mt="4" wrap="wrap">
          <Button variant="soft" onClick={() => go("shop")}>
            <Utensils size={15} /> Покормить
          </Button>
          <Button variant="soft" onClick={() => void emitAll("pet-command", { text: "играть" })}>
            <Gamepad2 size={15} /> Поиграть
          </Button>
          <Button variant="soft" color="gray" onClick={() => void emitAll("pet-command", { role: "guard" })}>
            <Shield size={15} /> Поставить на охрану
          </Button>
        </Flex>
      </Card>
      <Grid columns={{ initial: "1", sm: "2" }} gap="4">
        <Section title="Самочувствие">
          <Meter label="Настроение" value={g.feeling} />
          <Meter label="Сытость" value={g.food} />
          <Meter label="Вода" value={g.drink} />
          <Meter label="Бодрость" value={g.strength} />
          <Meter label="Здоровье" value={g.health} />
          {job && (
            <Meter
              label={`На смене: ${job.name}`}
              value={jobProgress(g, now) * 100}
              text={`${Math.max(1, Math.ceil(((g.job?.endsAt ?? now) - now) / 60000))} мин`}
              color="gray"
            />
          )}
        </Section>
        <Section title="Отношения">
          <Meter label="Симпатия" value={g.likability} max={likabilityMax(lvl)} color="green" />
          <Meter label="Обида" value={g.grudge} color={g.grudge >= 50 ? "red" : "gray"} text={g.grudge >= 50 ? "злится" : g.grudge >= 20 ? "дуется" : "спокоен"} />
          <DataList.Root size="2" mt="1">
            <DataList.Item>
              <DataList.Label>Вместе</DataList.Label>
              <DataList.Value>{daysTogether(life, now)} дн.</DataList.Value>
            </DataList.Item>
            <DataList.Item>
              <DataList.Label>Подряд</DataList.Label>
              <DataList.Value>
                {life.streak} дн. (рекорд {life.bestStreak})
              </DataList.Value>
            </DataList.Item>
            <DataList.Item>
              <DataList.Label>Помнит</DataList.Label>
              <DataList.Value>
                {count(life, "throw")} бросков, {count(life, "fed")} кормлений, {count(life, "pet")} поглаживаний
              </DataList.Value>
            </DataList.Item>
            <DataList.Item>
              <DataList.Label>Курсор</DataList.Label>
              <DataList.Value>
                бил {count(life, "swat")} раз, промахнулся {count(life, "miss")}
              </DataList.Value>
            </DataList.Item>
            <DataList.Item>
              <DataList.Label>Прокачка</DataList.Label>
              <DataList.Value>{skills.map((u) => `${u.name} ${skill(g, u.id)}`).join(", ") || "ничего"}</DataList.Value>
            </DataList.Item>
          </DataList.Root>
        </Section>
      </Grid>
      <Text as="p" size="1" color="gray">
        Клик по питомцу — ответ и строка состояния. Медленно провести курсором — погладить, быстро поводить — пощекотать. Броски и тыканье
        он запоминает; когда обида большая, он охотится на курсор.
      </Text>
    </>
  );
}
