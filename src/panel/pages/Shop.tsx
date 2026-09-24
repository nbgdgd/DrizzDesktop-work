import { useState } from "react";
import { Badge, Button, Card, Flex, SegmentedControl, Text } from "@radix-ui/themes";
import { command, emitAll } from "../../bridge";
import { Item, itemById, items } from "../../game";
import type { PanelState } from "../store";
import { Section, money } from "../ui";
const kinds: [Item["kind"] | "all", string][] = [
  ["all", "Всё"],
  ["meal", "Еда"],
  ["snack", "Снеки"],
  ["drink", "Напитки"],
  ["functional", "Бодрящее"],
  ["drug", "Аптека"],
];
const effects = (i: Item) =>
  [
    i.food ? ["сытость", i.food] : null,
    i.drink ? ["вода", i.drink] : null,
    i.strength ? ["бодрость", i.strength] : null,
    i.feeling ? ["настроение", i.feeling] : null,
    i.health ? ["здоровье", i.health] : null,
  ].filter(Boolean) as [string, number][];
export function Shop({ p }: { p: PanelState }) {
  const [kind, setKind] = useState<Item["kind"] | "all">("all");
  const g = p.store.game;
  const pantry = Object.entries(g.life.pantry).filter(([id, n]) => n > 0 && itemById(id));
  return (
    <>
      <Text as="p" size="2" color="gray" mb="3">
        Купите кнопкой или перетащите иконку из этого окна прямо на питомца — он съест сам. Деньги капают, пока вы за компьютером, и за
        работу.
      </Text>
      {pantry.length > 0 && (
        <Section title="Запасы" description="Подарки и то, что питомец утащил к себе. Бесплатно.">
          <Flex gap="2" wrap="wrap">
            {pantry.map(([id, n]) => (
              <Button key={id} variant="soft" color="gray" onClick={() => void emitAll("pet-command", { feed: id })}>
                <img src={itemById(id)!.icon} alt="" width={20} height={20} /> {itemById(id)!.name} × {n}
              </Button>
            ))}
          </Flex>
        </Section>
      )}
      <SegmentedControl.Root value={kind} onValueChange={(v) => setKind(v as Item["kind"] | "all")} mb="4" size="1">
        {kinds.map(([id, name]) => (
          <SegmentedControl.Item key={id} value={id}>
            {name}
          </SegmentedControl.Item>
        ))}
      </SegmentedControl.Root>
      <div className="grid-cards">
        {items
          .filter((i) => kind === "all" || i.kind === kind)
          .map((i) => (
            <Card key={i.id}>
              <Flex gap="3" align="start">
                <img
                  className="item-icon drag-food"
                  src={i.icon}
                  alt=""
                  draggable={false}
                  title="Перетащите на питомца"
                  onPointerDown={(e) => {
                    if (g.money < i.price) return;
                    (e.target as HTMLElement).setPointerCapture(e.pointerId);
                    void emitAll("carry", { id: i.id });
                  }}
                />
                <Flex direction="column" gap="1" style={{ flex: 1, minWidth: 0 }}>
                  <Flex justify="between" gap="2">
                    <Text size="2" weight="medium">
                      {i.name}
                    </Text>
                    <Text size="2" color={g.money < i.price ? "red" : undefined}>
                      {money(i.price)}
                    </Text>
                  </Flex>
                  <Text size="1" color="gray">
                    {i.desc}
                  </Text>
                  <Flex gap="1" wrap="wrap" mt="1">
                    {effects(i).map(([name, v]) => (
                      <Badge key={name} size="1" color={v < 0 ? "red" : "gray"} variant="soft">
                        {name} {v > 0 ? "+" : ""}
                        {v}
                      </Badge>
                    ))}
                  </Flex>
                  <Button
                    size="1"
                    mt="2"
                    variant="soft"
                    disabled={g.money < i.price}
                    onClick={() => p.run(command("buy_item", { id: i.id }))}
                  >
                    Купить
                  </Button>
                </Flex>
              </Flex>
            </Card>
          ))}
      </div>
      <Text as="p" size="1" color="gray" mt="4">
        Иконки еды — VPet (LorisYounger), github.com/LorisYounger/VPet.
      </Text>
    </>
  );
}
