import { useEffect, useState } from "react";
import { Badge, Button, Card, Flex, Text } from "@radix-ui/themes";
import { command } from "../../bridge";
import { jobBlocked, jobById, jobPay, jobProgress, jobs, skill, upgradePrice, upgrades, working } from "../../game";
import type { PanelState } from "../store";
import { Meter, money } from "../ui";
import { tx } from "../../i18n";
export function Skills({ p }: { p: PanelState }) {
  const g = p.store.game;
  return (
    <>
      <Text as="p" size="2" color="gray" mb="3">
        {tx("Прокачка действует всё время: меняет, как быстро питомец голодает, устаёт и зарабатывает, как высоко прыгает и как подробно объясняет процессы.")}
      </Text>
      <div className="grid-cards">
        {upgrades.map((u) => {
          const lvl = skill(g, u.id);
          const price = upgradePrice(g, u.id);
          return (
            <Card key={u.id}>
              <Flex direction="column" gap="2">
                <Flex justify="between" align="center">
                  <Text size="2" weight="medium">
                    {tx(u.name)}
                  </Text>
                  <Flex gap="1" aria-label={tx("Уровень {n} из {max}", { n: lvl, max: u.max })}>
                    {Array.from({ length: u.max }, (_, i) => (
                      <span
                        key={i}
                        style={{
                          width: 8,
                          height: 8,
                          borderRadius: 2,
                          background: i < lvl ? "var(--accent-9)" : "var(--gray-a5)",
                        }}
                      />
                    ))}
                  </Flex>
                </Flex>
                <Text size="1" color="gray">
                  {tx(u.desc)} {tx("Каждый уровень: {step}.", { step: tx(u.step) })}
                </Text>
                <Button
                  size="1"
                  variant="soft"
                  disabled={price === null || g.money < price}
                  onClick={() => p.run(command("buy_upgrade", { id: u.id }))}
                >
                  {price === null ? tx("Максимум") : `Прокачать за ${money(price)}`}
                </Button>
              </Flex>
            </Card>
          );
        })}
      </div>
    </>
  );
}
export function Work({ p }: { p: PanelState }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(id);
  }, []);
  const g = p.store.game;
  return (
    <>
      <Text as="p" size="2" color="gray" mb="3">
        {tx("Смена идёт в реальном времени, даже если вы отошли, и тратит бодрость, еду и воду. Отработано смен: {n}.", { n: g.jobsDone ?? 0 })}
      </Text>
      {working(g, now) && (
        <Card mb="4">
          <Meter
            label={tx("Сейчас: {job}", { job: tx(jobById(g.job?.id ?? "")?.name ?? "") })}
            value={jobProgress(g, now) * 100}
            text={tx("{n} мин осталось", { n: Math.max(1, Math.ceil(((g.job?.endsAt ?? now) - now) / 60000)) })}
            color="gray"
          />
        </Card>
      )}
      <div className="grid-cards">
        {jobs.map((j) => {
          const why = jobBlocked(g, j);
          return (
            <Card key={j.id}>
              <Flex direction="column" gap="2">
                <Flex justify="between">
                  <Text size="2" weight="medium">
                    {tx(j.name)}
                  </Text>
                  <Badge variant="soft" color="gray">
                    {tx("{m} мин", { m: j.minutes })}
                  </Badge>
                </Flex>
                <Text size="1" color="gray">
                  {tx(j.desc)}
                </Text>
                <Text size="1">
                  {money(jobPay(g, j))} · {tx("опыт +{e} · бодрость −{s}", { e: j.exp, s: j.strength })}
                </Text>
                <Button size="1" variant="soft" disabled={!!why} onClick={() => p.run(command("start_job", { id: j.id }))}>
                  {why ? why[0].toUpperCase() + why.slice(1) : tx("На смену")}
                </Button>
              </Flex>
            </Card>
          );
        })}
      </div>
    </>
  );
}
