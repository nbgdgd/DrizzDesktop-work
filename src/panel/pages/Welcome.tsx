// First launch: a short welcome in four steps — language, the pet, the few
// settings that matter (swearing in English, cursor games, sounds, ear care,
// autostart, your name) and a start button. Replaces the old paper card.
import { useState } from "react";
import { Box, Button, Flex, Heading, RadioCards, Switch, Text, TextField } from "@radix-ui/themes";
import { ArrowLeft, ArrowRight, Check, Headphones, Keyboard, MousePointer2, Power, Radar, Volume2 } from "lucide-react";
import { pets, Settings } from "../../model";
import { temper } from "../../character";
import { getLang, setLang, tx } from "../../i18n";
import type { PanelState } from "../store";
import { Portrait } from "../ui";
type Toggle = { key: keyof Settings; icon: JSX.Element; label: string; hint: string };
export function Welcome({ p, done }: { p: PanelState; done: () => void }) {
  const [step, setStep] = useState(0);
  const [name, setName] = useState(p.memory.address);
  const [, redraw] = useState(0);
  const d = p.draft;
  const pet = pets.find((x) => x.id === d.pet) ?? pets[0];
  const pick = (lang: Settings["lang"]) => {
    setLang(lang);
    p.set("lang", lang);
    redraw((n) => n + 1);
  };
  const toggles: Toggle[] = [
    ...(getLang() === "en"
      ? [{ key: "swear" as const, icon: <Keyboard size={18} />, label: tx("Мат в английских репликах"), hint: tx("Выключено: питомец дерзит, но без мата.") }]
      : []),
    { key: "cursorPlay", icon: <MousePointer2 size={18} />, label: tx("Игры с курсором"), hint: tx("Охотится на курсор, бьёт его лапой, если обидели.") },
    { key: "cursorPush", icon: <MousePointer2 size={18} />, label: tx("Может толкать курсор"), hint: tx("Сдвигает настоящий курсор на пару сантиметров. Никогда при зажатой кнопке.") },
    { key: "sounds", icon: <Volume2 size={18} />, label: tx("Звуки и голос"), hint: tx("Бормотание под реплики, шаги, прыжки.") },
    { key: "ears", icon: <Headphones size={18} />, label: tx("Береги уши"), hint: tx("Следит за громкостью в наушниках, напоминает о перерывах, считает недельную дозу звука по нормам ВОЗ.") },
    { key: "observeProcesses", icon: <Radar size={18} />, label: tx("Следить за консолями"), hint: tx("Скажет, какая программа запустила cmd, PowerShell или скрипт. Ничего не блокирует.") },
    { key: "autostart", icon: <Power size={18} />, label: tx("Запускать с Windows"), hint: tx("Можно поменять в любой момент.") },
  ];
  const finish = async () => {
    await p.save();
    await p.saveMemory({ address: name.trim().slice(0, 40), cardShown: true });
    p.setStatus("");
    done();
  };
  const steps = [tx("Язык"), tx("Питомец"), tx("Настройки"), tx("Готово")];
  return (
    <div className="welcome">
      <div className="welcome-card">
        <Flex gap="2" mb="5" justify="center" aria-label={tx("Шаг {n} из {all}", { n: step + 1, all: steps.length })}>
          {steps.map((s, i) => (
            <div key={s} className="welcome-dot" data-on={i <= step || undefined} title={s} />
          ))}
        </Flex>
        {step === 0 && (
          <Flex direction="column" align="center" gap="4">
            <Portrait pet={pet.id} size={112} />
            <Heading size="7" align="center">
              Привет! · Hi!
            </Heading>
            <Text color="gray" align="center">
              Выберите язык · Choose your language
            </Text>
            <Flex gap="3" mt="2" wrap="wrap" justify="center">
              {(["ru", "en"] as const).map((l) => (
                <button key={l} className="welcome-lang" data-on={d.lang === l || undefined} onClick={() => pick(l)}>
                  <span className="welcome-lang-code">{l.toUpperCase()}</span>
                  <span>{l === "ru" ? "Русский" : "English"}</span>
                </button>
              ))}
            </Flex>
            <Text size="1" color="gray" align="center" style={{ maxWidth: 420 }}>
              {d.lang === "en"
                ? "The pet speaks English without swearing by default. You can allow it on the next steps."
                : "По-русски питомец говорит как есть — дерзко и с матом. Английская версия по умолчанию без мата."}
            </Text>
          </Flex>
        )}
        {step === 1 && (
          <>
            <Heading size="6" align="center" mb="1">
              {tx("Кто будет жить у тебя на столе?")}
            </Heading>
            <Text as="p" color="gray" align="center" mb="4">
              {tx("Характер у каждого свой. Поменять можно потом в «Поведении».")}
            </Text>
            <RadioCards.Root value={d.pet} onValueChange={(v) => p.set("pet", v)} columns={{ initial: "1", sm: "2" }} size="1">
              {pets.map((x) => (
                <RadioCards.Item key={x.id} value={x.id}>
                  <Flex gap="3" align="center" width="100%">
                    <Portrait pet={x.id} size={52} />
                    <Box minWidth="0">
                      <Text as="div" size="2" weight="bold">
                        {x.name}
                      </Text>
                      <Text as="div" size="1" color="gray">
                        {tx(temper(x.id).trait)}
                      </Text>
                    </Box>
                  </Flex>
                </RadioCards.Item>
              ))}
            </RadioCards.Root>
          </>
        )}
        {step === 2 && (
          <>
            <Heading size="6" align="center" mb="1">
              {tx("Самое важное")}
            </Heading>
            <Text as="p" color="gray" align="center" mb="4">
              {tx("Остальное — в настройках. Всё можно выключить.")}
            </Text>
            <Flex direction="column" gap="2">
              <label className="welcome-row">
                <span className="welcome-icon">
                  <Check size={18} />
                </span>
                <Box style={{ flex: 1 }}>
                  <Text as="div" size="2" weight="medium">
                    {tx("Как тебя называть?")}
                  </Text>
                  <Text as="div" size="1" color="gray">
                    {tx("Необязательно. Питомец иногда обращается по имени.")}
                  </Text>
                </Box>
                <TextField.Root value={name} maxLength={40} placeholder={tx("Имя")} onChange={(e) => setName(e.target.value)} style={{ width: 160 }} />
              </label>
              {toggles.map((t) => (
                <label key={t.key} className="welcome-row">
                  <span className="welcome-icon">{t.icon}</span>
                  <Box style={{ flex: 1 }}>
                    <Text as="div" size="2" weight="medium">
                      {t.label}
                    </Text>
                    <Text as="div" size="1" color="gray">
                      {t.hint}
                    </Text>
                  </Box>
                  <Switch checked={!!d[t.key]} onCheckedChange={(v) => p.set(t.key, v as never)} aria-label={t.label} />
                </label>
              ))}
            </Flex>
          </>
        )}
        {step === 3 && (
          <Flex direction="column" align="center" gap="3">
            <Portrait pet={pet.id} size={120} cell={2} />
            <Heading size="6" align="center">
              {tx("{pet} уже на рабочем столе", { pet: pet.name })}
            </Heading>
            <Text as="p" color="gray" align="center" style={{ maxWidth: 440 }}>
              {tx("Клик — ответит, правый клик — карточка с уровнем и нуждами, перетащи — полетит. Корми его, не кидай слишком часто, и он к тебе привыкнет.")}
            </Text>
            {d.ears && (
              <Text as="p" size="1" color="gray" align="center" style={{ maxWidth: 440 }}>
                {tx("В наушниках он считает недельную дозу звука и напомнит о перерыве. Баланс каналов и отдых ушей — во вкладке «Уши».")}
              </Text>
            )}
          </Flex>
        )}
        <Flex justify="between" mt="5" gap="3">
          <Button variant="soft" color="gray" disabled={step === 0} onClick={() => setStep(step - 1)}>
            <ArrowLeft size={15} /> {tx("Назад")}
          </Button>
          {step < 3 ? (
            <Button onClick={() => setStep(step + 1)}>
              {tx("Дальше")} <ArrowRight size={15} />
            </Button>
          ) : (
            <Button disabled={p.saving} onClick={() => void finish()}>
              {tx("Поехали")} <Check size={15} />
            </Button>
          )}
        </Flex>
      </div>
    </div>
  );
}
