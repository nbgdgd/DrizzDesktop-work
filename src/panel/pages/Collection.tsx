import { Badge, Card, Flex, RadioCards, Text } from "@radix-ui/themes";
import { Lock } from "lucide-react";
import { emitAll } from "../../bridge";
import { achievements } from "../../chronicle";
import { level } from "../../game";
import { accessories, accessoryUnlocked } from "../../props";
import type { PanelState } from "../store";
import { Section } from "../ui";
export function Collection({ p }: { p: PanelState }) {
  const g = p.store.game;
  const life = g.life;
  const lvl = level(g.exp);
  const stickers = Object.entries(life.collection).filter(([k, n]) => k.startsWith("sticker:") && n > 0);
  const got = achievements.filter((a) => life.achievements[a.id]);
  return (
    <>
      <Section title="Гардероб" description="Открывается уровнями. В праздники питомец наряжается сам.">
        <RadioCards.Root
          value={life.wear}
          onValueChange={(v) => void emitAll("pet-command", { wear: v })}
          columns={{ initial: "2", sm: "4" }}
          size="1"
        >
          {accessories
            .filter((a) => a.level > 0 || a.id === "")
            .map((a) => {
              const open = accessoryUnlocked(a.id, lvl, life.collection);
              return (
                <RadioCards.Item key={a.id} value={a.id} disabled={!open}>
                  <Flex direction="column" gap="1">
                    <Text size="2" weight="medium">
                      {a.name}
                    </Text>
                    <Text size="1" color="gray">
                      {a.id === "" ? "без шапки" : open ? `с ${a.level} уровня` : <><Lock size={11} /> {a.level} уровень</>}
                    </Text>
                  </Flex>
                </RadioCards.Item>
              );
            })}
        </RadioCards.Root>
      </Section>
      <Section title={`Достижения · ${got.length} из ${achievements.length}`}>
        <div className="grid-cards">
          {achievements.map((a) => {
            const at = life.achievements[a.id];
            return (
              <Card key={a.id} variant={at ? "surface" : "ghost"} style={{ opacity: at ? 1 : 0.55 }}>
                <Flex justify="between" gap="2">
                  <Text size="2" weight="medium">
                    {a.name}
                  </Text>
                  <Badge size="1" color={at ? "amber" : "gray"} variant="soft">
                    +{a.prize} ₽
                  </Badge>
                </Flex>
                <Text as="div" size="1" color="gray" mt="1">
                  {a.desc}
                </Text>
                {at && (
                  <Text as="div" size="1" color="gray" mt="1">
                    {new Date(at).toLocaleDateString("ru")}
                  </Text>
                )}
              </Card>
            );
          })}
        </div>
      </Section>
      <Section title="Стикеры" description="Питомец иногда приносит их в подарок, если вы с ним ладите.">
        {stickers.length ? (
          <Flex gap="2" wrap="wrap">
            {stickers.map(([k, n]) => (
              <Badge key={k} size="2" variant="surface">
                {k.slice(8)} × {n}
              </Badge>
            ))}
          </Flex>
        ) : (
          <Text size="2" color="gray">
            Пока пусто.
          </Text>
        )}
      </Section>
    </>
  );
}
