import { Button, Card, Flex, Text } from "@radix-ui/themes";
import { Dices, Hand, MousePointerClick, Shield, Timer, Trash2 } from "lucide-react";
import { ReactNode } from "react";
import { emitAll } from "../../bridge";
import { skill } from "../../game";
import { GameKind, gameNames } from "../../minigames";
import type { PanelState } from "../store";
import { Section } from "../ui";
const games: [GameKind, ReactNode, string][] = [
  ["rps", <Dices size={18} />, "Кнопки в облачке. Победа — пара монет, проигрыш поднимает ему настроение."],
  ["hand", <Hand size={18} />, "Прячет монетку в лапе. Угадали — монета ваша."],
  ["clicker", <MousePointerClick size={18} />, "Десять секунд кликайте по питомцу. Два клика — рубль."],
  ["catch", <Timer size={18} />, "Двадцать секунд он гоняется за курсором. Поймает трижды — проиграли."],
];
export function Games({ p }: { p: PanelState }) {
  const g = p.store.game;
  const role = g.life.role && g.life.role.until > Date.now() ? g.life.role : null;
  const guardMinutes = 20 + 10 * skill(g, "vigilance");
  return (
    <>
      <Section title="Мини-игры" description="Игра начинается на рабочем столе, рядом с питомцем.">
        <div className="grid-cards">
          {games.map(([id, icon, desc]) => (
            <Card key={id} variant="surface">
              <Flex direction="column" gap="2">
                <Flex gap="2" align="center">
                  {icon}
                  <Text size="2" weight="medium">
                    {gameNames[id]}
                  </Text>
                </Flex>
                <Text size="1" color="gray">
                  {desc}
                </Text>
                <Button size="1" variant="soft" onClick={() => void emitAll("pet-command", { game: id })}>
                  Играть
                </Button>
              </Flex>
            </Card>
          ))}
        </div>
      </Section>
      <Section title="Роли" description="Работа питомца на ваш компьютер. Ничего не делается без вашего подтверждения.">
        <Flex justify="between" align="center" gap="4">
          <Flex gap="3" align="start">
            <Shield size={18} />
            <div>
              <Text as="div" size="2" weight="medium">
                Охранник
              </Text>
              <Text as="div" size="1" color="gray">
                {role?.id === "guard"
                  ? `На посту до ${new Date(role.until).toLocaleTimeString("ru", { hour: "2-digit", minute: "2-digit" })}. Сообщает даже о тихих фоновых запусках.`
                  : `${guardMinutes} минут сообщает о каждом фоновом запуске консолей и скриптов. «Бдительность» продлевает смену.`}
              </Text>
            </div>
          </Flex>
          <Button variant="soft" disabled={role?.id === "guard"} onClick={() => void emitAll("pet-command", { role: "guard" })}>
            {role?.id === "guard" ? "На посту" : "На пост"}
          </Button>
        </Flex>
        <Flex justify="between" align="center" gap="4">
          <Flex gap="3" align="start">
            <Trash2 size={18} />
            <div>
              <Text as="div" size="2" weight="medium">
                Уборщик
              </Text>
              <Text as="div" size="1" color="gray">
                Посчитает файлы старше суток во временной папке и спросит, удалить ли их. Занятые файлы пропускаются.
              </Text>
            </div>
          </Flex>
          <Button variant="soft" onClick={() => void emitAll("pet-command", { role: "clean" })}>
            Проверить Temp
          </Button>
        </Flex>
      </Section>
      <Section title="Команды" description="То же можно написать в «Разговоре». Слушается он не всегда: зависит от отношений, обиды и сытости.">
        <Flex gap="2" wrap="wrap">
          {["сядь", "иди сюда", "спать", "прыгни", "танцуй", "отвали"].map((c) => (
            <Button key={c} size="1" variant="surface" color="gray" onClick={() => void emitAll("pet-command", { text: c })}>
              {c}
            </Button>
          ))}
        </Flex>
      </Section>
    </>
  );
}
