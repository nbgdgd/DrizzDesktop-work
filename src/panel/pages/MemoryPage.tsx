import { useState } from "react";
import { AlertDialog, Button, Flex, IconButton, Select, Text, TextField } from "@radix-ui/themes";
import { Plus, X } from "lucide-react";
import { emptyMemory } from "../../model";
import type { PanelState } from "../store";
import { Row, Section } from "../ui";
const months = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];
export function MemoryPage({ p }: { p: PanelState }) {
  const [fact, setFact] = useState("");
  const m = p.memory;
  const [bm, bd] = (m.birthday || "-").split("-");
  const setBirthday = (month: string, day: string) =>
    void p.saveMemory({ birthday: month && day ? `${month}-${day}` : "" });
  return (
    <>
      <Text as="p" size="2" color="gray" mb="3">
        Здесь только то, что вы сами попросили запомнить. Переписки, названия треков и список действий не хранятся.
      </Text>
      <Section title="О вас">
        <Row label="Как обращаться" hint="Появляется в тёплых репликах, когда вы подружитесь.">
          <Flex gap="2">
            <TextField.Root
              maxLength={40}
              value={m.address}
              placeholder="Имя или прозвище"
              onChange={(e) => p.setMemory({ ...m, address: e.target.value })}
            />
            <Button variant="soft" onClick={() => void p.saveMemory({ address: m.address })}>
              Сохранить
            </Button>
          </Flex>
        </Row>
        <Row label="День рождения" hint="Питомец поздравит и наденет колпак.">
          <Flex gap="2">
            <Select.Root value={bd || "none"} onValueChange={(v) => setBirthday(bm || "01", v === "none" ? "" : v)}>
              <Select.Trigger placeholder="день" />
              <Select.Content>
                <Select.Item value="none">—</Select.Item>
                {Array.from({ length: 31 }, (_, i) => String(i + 1).padStart(2, "0")).map((d) => (
                  <Select.Item key={d} value={d}>
                    {Number(d)}
                  </Select.Item>
                ))}
              </Select.Content>
            </Select.Root>
            <Select.Root value={bm || "none"} onValueChange={(v) => setBirthday(v === "none" ? "" : v, bd || "01")}>
              <Select.Trigger placeholder="месяц" />
              <Select.Content>
                <Select.Item value="none">—</Select.Item>
                {months.map((name, i) => (
                  <Select.Item key={name} value={String(i + 1).padStart(2, "0")}>
                    {name}
                  </Select.Item>
                ))}
              </Select.Content>
            </Select.Root>
          </Flex>
        </Row>
      </Section>
      <Section title="Факты" description="Питомец может вспомнить их в шутку, когда вы станете своими.">
        {m.facts.length === 0 && (
          <Text size="2" color="gray">
            Пока ничего. Добавьте здесь или напишите «Запомни: …» в разговоре.
          </Text>
        )}
        {m.facts.map((f, i) => (
          <Flex key={i + f} gap="2">
            <TextField.Root
              style={{ flex: 1 }}
              maxLength={240}
              defaultValue={f}
              aria-label={`Факт ${i + 1}`}
              onBlur={(e) => {
                if (e.target.value === f) return;
                const facts = [...m.facts];
                facts[i] = e.target.value.trim();
                void p.saveMemory({ facts: facts.filter(Boolean) });
              }}
            />
            <IconButton variant="soft" color="gray" aria-label={`Удалить факт ${i + 1}`} onClick={() => void p.saveMemory({ facts: m.facts.filter((_, j) => j !== i) })}>
              <X size={14} />
            </IconButton>
          </Flex>
        ))}
        <Flex gap="2">
          <TextField.Root style={{ flex: 1 }} maxLength={240} value={fact} placeholder="Например: люблю кооперативные игры" onChange={(e) => setFact(e.target.value)} />
          <Button
            variant="soft"
            disabled={!fact.trim()}
            onClick={() => {
              void p.saveMemory({ facts: [...m.facts, fact.trim()].slice(-30) });
              setFact("");
            }}
          >
            <Plus size={14} /> Добавить
          </Button>
        </Flex>
      </Section>
      <Section title="Техническая память" description="Позиция, дневные отметки и недавние реплики — чтобы не повторяться. Воспоминания о бросках и привычки хранятся вместе с прогрессом.">
        <Flex gap="2" wrap="wrap">
          <Button variant="soft" color="gray" onClick={() => void p.saveMemory({ recent: [], lastGreeting: "", favorite: null, daily: {} }, true)}>
            Сбросить привычки
          </Button>
          <AlertDialog.Root>
            <AlertDialog.Trigger>
              <Button variant="soft" color="red">
                Очистить всю память
              </Button>
            </AlertDialog.Trigger>
            <AlertDialog.Content maxWidth="420px">
              <AlertDialog.Title>Очистить память?</AlertDialog.Title>
              <AlertDialog.Description size="2">Удалятся имя, факты, день рождения, позиция и история реплик.</AlertDialog.Description>
              <Flex gap="3" mt="4" justify="end">
                <AlertDialog.Cancel>
                  <Button variant="soft" color="gray">
                    Отмена
                  </Button>
                </AlertDialog.Cancel>
                <AlertDialog.Action>
                  <Button color="red" onClick={() => void p.saveMemory({ ...emptyMemory, cardShown: true }, true)}>
                    Очистить
                  </Button>
                </AlertDialog.Action>
              </Flex>
            </AlertDialog.Content>
          </AlertDialog.Root>
        </Flex>
      </Section>
    </>
  );
}
