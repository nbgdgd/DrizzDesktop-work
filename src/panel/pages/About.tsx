// "О программе": version, what the program keeps on the PC, and the
// credits - every character with its author, source and terms, then the
// libraries, sounds, icons, font and data the pet is built from.
import { Badge, Box, Card, Flex, Heading, Link, Text } from "@radix-ui/themes";
import { ExternalLink, Heart } from "lucide-react";
import { command, native } from "../../bridge";
import { Credit, otherCredits, petCredits } from "../../credits";
import { pets } from "../../model";
import { temper } from "../../character";
import { tx } from "../../i18n";
import { version } from "../../../package.json";
import type { PanelState } from "../store";
import { Portrait, Section } from "../ui";
function Source({ c, p }: { c: Credit; p: PanelState }) {
  const open = () => (native ? p.run(command("open_link", { url: c.url })) : window.open(c.url, "_blank", "noopener"));
  return (
    <Link
      href={c.url}
      size="1"
      onClick={(e) => {
        e.preventDefault();
        open();
      }}
    >
      {c.url.replace(/^https:\/\//, "")} <ExternalLink size={11} />
    </Link>
  );
}
/** "Eigenblob - codex-pet.com gallery, author not listed..." under a pet card. */
export function PetCreditLine({ id }: { id: string }) {
  const c = petCredits.find((x) => x.id === id);
  if (!c) return null;
  return (
    <Text as="div" size="1" color="gray" className="credit-line">
      {c.title}
      {c.author ? ` · ${c.author}` : ""} - {tx(c.terms)}
    </Text>
  );
}
export function About({ p }: { p: PanelState }) {
  return (
    <>
      <Card size="3" mb="4">
        <Flex gap="4" align="center" wrap="wrap">
          <Portrait pet={p.store.settings.pet} size={72} />
          <Box>
            <Heading size="5">Drizz Desktop</Heading>
            <Flex gap="2" mt="1" align="center" wrap="wrap">
              <Badge>{tx("версия {v}", { v: version })}</Badge>
              <Text size="2" color="gray">
                {tx("Питомец для рабочего стола Windows. Бесплатно и некоммерчески.")}
              </Text>
            </Flex>
            <Text as="p" size="1" color="gray" mt="2">
              {tx("Всё хранится только на этом компьютере: %LOCALAPPDATA%\\DrizzDesktop. В сеть уходит только то, что вы включили сами: погода, разговор с моделью.")}
            </Text>
          </Box>
        </Flex>
      </Card>
      <Section title={tx("Персонажи")} description={tx("Спрайты сделали другие люди. Спасибо им!")}>
        {petCredits.map((c) => {
          const pet = pets.find((x) => x.id === c.id);
          return (
            <Flex key={c.id} gap="3" align="start" className="credit-pet">
              <Portrait pet={c.id} size={48} />
              <Box minWidth="0">
                <Text as="div" size="2" weight="bold">
                  {pet?.name ?? c.title}
                  {c.author ? <Text weight="regular" color="gray">{` · ${c.author}`}</Text> : null}
                </Text>
                <Text as="div" size="1" color="gray">
                  {tx(temper(c.id).trait)}
                </Text>
                <Text as="div" size="1" mt="1">
                  {tx(c.terms)}
                </Text>
                <Source c={c} p={p} />
              </Box>
            </Flex>
          );
        })}
      </Section>
      <Section title={tx("Благодарности")} description={tx("Код, звуки, шрифт и данные, на которых сделан питомец.")}>
        {otherCredits.map((c) => (
          <Flex key={c.id} justify="between" gap="3" align="start" wrap="wrap">
            <Box minWidth="0" style={{ flex: 1 }}>
              <Text as="div" size="2" weight="medium">
                {c.title}
                {c.author ? <Text weight="regular" color="gray">{` · ${c.author}`}</Text> : null}
              </Text>
              <Text as="div" size="1" color="gray">
                {tx(c.terms)}
              </Text>
            </Box>
            <Source c={c} p={p} />
          </Flex>
        ))}
      </Section>
      <Text as="p" size="1" color="gray">
        <Heart size={12} /> {tx("Нашли своего персонажа и хотите, чтобы его убрали или подписали иначе - напишите в репозитории проекта.")}
      </Text>
    </>
  );
}
