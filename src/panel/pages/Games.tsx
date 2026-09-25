import { Button, Card, Flex, Text } from "@radix-ui/themes";
import { Dices, Hand, MousePointerClick, Shield, Timer, Trash2 } from "lucide-react";
import { ReactNode } from "react";
import { emitAll } from "../../bridge";
import { skill } from "../../game";
import { GameKind, gameNames } from "../../minigames";
import type { PanelState } from "../store";
import { Section } from "../ui";
import { getLang, tx } from "../../i18n";
// A function: tx() must run when the page is drawn, not when the module
// loads (the language is not known yet then).
const games = (): [GameKind, ReactNode, string][] => [
  ["rps", <Dices size={18} />, tx("Кнопки в облачке. Победа — пара монет, проигрыш поднимает ему настроение.")],
  ["hand", <Hand size={18} />, tx("Прячет монетку в лапе. Угадали — монета ваша.")],
  ["clicker", <MousePointerClick size={18} />, tx("Десять секунд кликайте по питомцу. Два клика — рубль.")],
  ["catch", <Timer size={18} />, tx("Двадцать секунд он гоняется за курсором. Поймает трижды — проиграли.")],
];
export function Games({ p }: { p: PanelState }) {
  const g = p.store.game;
  const role = g.life.role && g.life.role.until > Date.now() ? g.life.role : null;
  const guardMinutes = 20 + 10 * skill(g, "vigilance");
  return (
    <>
      <Section title={tx("Мини-игры")} description={tx("Игра начинается на рабочем столе, рядом с питомцем.")}>
        <div className="grid-cards">
          {games().map(([id, icon, desc]) => (
            <Card key={id} variant="surface">
              <Flex direction="column" gap="2">
                <Flex gap="2" align="center">
                  {icon}
                  <Text size="2" weight="medium">
                    {tx(gameNames[id])}
                  </Text>
                </Flex>
                <Text size="1" color="gray">
                  {desc}
                </Text>
                <Button size="1" variant="soft" onClick={() => void emitAll("pet-command", { game: id })}>
                  {tx("Играть")}
                </Button>
              </Flex>
            </Card>
          ))}
        </div>
      </Section>
      <Section title={tx("Роли")} description={tx("Работа питомца на ваш компьютер. Ничего не делается без вашего подтверждения.")}>
        <Flex justify="between" align="center" gap="4">
          <Flex gap="3" align="start">
            <Shield size={18} />
            <div>
              <Text as="div" size="2" weight="medium">
                {tx("Охранник")}
              </Text>
              <Text as="div" size="1" color="gray">
                {role?.id === "guard"
                  ? tx("На посту до {time}. Сообщает даже о тихих фоновых запусках.", { time: new Date(role.until).toLocaleTimeString(getLang(), { hour: "2-digit", minute: "2-digit" }) })
                  : tx("{n} минут сообщает о каждом фоновом запуске консолей и скриптов. «Бдительность» продлевает смену.", { n: guardMinutes })}
              </Text>
            </div>
          </Flex>
          <Button variant="soft" disabled={role?.id === "guard"} onClick={() => void emitAll("pet-command", { role: "guard" })}>
            {role?.id === "guard" ? tx("На посту") : tx("На пост")}
          </Button>
        </Flex>
        <Flex justify="between" align="center" gap="4">
          <Flex gap="3" align="start">
            <Trash2 size={18} />
            <div>
              <Text as="div" size="2" weight="medium">
                {tx("Уборщик")}
              </Text>
              <Text as="div" size="1" color="gray">
                {tx("Посчитает файлы старше недели во временной папке и спросит, удалить ли их. Занятые файлы пропускаются.")}
              </Text>
            </div>
          </Flex>
          <Button variant="soft" onClick={() => void emitAll("pet-command", { role: "clean" })}>
            {tx("Проверить Temp")}
          </Button>
        </Flex>
      </Section>
      <Section title={tx("Команды")} description={tx("То же можно написать в «Разговоре». Слушается он не всегда: зависит от отношений, обиды и сытости.")}>
        <Flex gap="2" wrap="wrap">
          {[tx("сядь"), tx("иди сюда"), tx("спать"), tx("прыгни"), tx("танцуй"), tx("отвали")].map((c) => (
            <Button key={c} size="1" variant="surface" color="gray" onClick={() => void emitAll("pet-command", { text: c })}>
              {c}
            </Button>
          ))}
        </Flex>
      </Section>
    </>
  );
}
