// "Проверка слуха" on the ears page: pulsed tones, one ear at a time,
// louder every 1.5 s until "Слышу". Compares the ears and offers a balance.
// WebAudio only, nothing is recorded; the pet hears about it when it ends.
import { useEffect, useRef, useState } from "react";
import { Badge, Box, Button, Callout, Flex, Grid, Text } from "@radix-ui/themes";
import { Ear as EarIcon, Info, Play, Square } from "lucide-react";
import { emitAll } from "../../bridge";
import { FREQS, MAX_DB, Results, START_DB, STEP_DB, Tone, gainOf, key, plan, verdict } from "../../hearing";
import { tx } from "../../i18n";
export function HearingCheck({ onBalance }: { onBalance: (b: number) => void }) {
  const [step, setStep] = useState(-1);
  const [level, setLevel] = useState(START_DB);
  const [results, setResults] = useState<Results>({});
  const ctx = useRef<AudioContext | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const tones = plan();
  const tone: Tone | undefined = tones[step];
  const done = step >= tones.length;
  const stop = () => {
    window.clearInterval(timer.current);
    timer.current = undefined;
  };
  useEffect(() => () => (stop(), void ctx.current?.close()), []);
  // Three short beeps at the current level, then 5 dB louder.
  useEffect(() => {
    stop();
    if (!tone) return;
    const a = (ctx.current ??= new AudioContext());
    let db = START_DB;
    setLevel(db);
    const beep = () => {
      const t = a.currentTime;
      const osc = a.createOscillator();
      const gain = a.createGain();
      const pan = a.createStereoPanner();
      osc.frequency.value = tone.freq;
      pan.pan.value = tone.ear === "l" ? -1 : 1;
      gain.gain.setValueAtTime(0, t);
      for (let i = 0; i < 3; i++) {
        const s = t + i * 0.4;
        gain.gain.linearRampToValueAtTime(gainOf(db), s + 0.03);
        gain.gain.setValueAtTime(gainOf(db), s + 0.22);
        gain.gain.linearRampToValueAtTime(0, s + 0.25);
      }
      osc.connect(gain).connect(pan).connect(a.destination);
      osc.start(t);
      osc.stop(t + 1.3);
    };
    beep();
    timer.current = window.setInterval(() => {
      db += STEP_DB;
      if (db > MAX_DB) {
        // Not heard even at the loudest step.
        answer(null);
        return;
      }
      setLevel(db);
      beep();
    }, 1500);
    return stop;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);
  const answer = (db: number | null) => {
    if (!tone) return;
    stop();
    setResults((r) => ({ ...r, [key(tone)]: db }));
    const next = step + 1;
    setStep(next);
    if (next >= tones.length) void emitAll("pet-command", { hearing: true });
  };
  const v = done ? verdict(results) : null;
  if (step < 0 || (done && !v))
    return (
      <Flex direction="column" gap="2">
        <Text size="2" color="gray">
          {tx("Надень наушники, найди тихое место и поставь громкость Windows около 50 %. Будут короткие писки в одно ухо, всё громче: нажимай «Слышу», как только услышишь. Минуты три.")}
        </Text>
        <Box>
          <Button onClick={() => (setResults({}), setStep(0))}>
            <Play size={15} /> {tx("Начать проверку")}
          </Button>
        </Box>
      </Flex>
    );
  if (!done && tone)
    return (
      <Flex direction="column" gap="3">
        <Flex gap="2" align="center" wrap="wrap">
          <Badge size="2">{tone.ear === "l" ? tx("левое ухо") : tx("правое ухо")}</Badge>
          <Badge size="2" color="gray">
            {tone.freq} {tx("Гц")}
          </Badge>
          <Text size="1" color="gray">
            {tx("{n} из {m}", { n: step + 1, m: tones.length })} · {level} {tx("дБ")}
          </Text>
        </Flex>
        <Flex gap="2">
          <Button size="3" onClick={() => answer(level)}>
            <EarIcon size={16} /> {tx("Слышу")}
          </Button>
          <Button size="3" variant="soft" color="gray" onClick={() => (stop(), setStep(-1))}>
            <Square size={14} /> {tx("Стоп")}
          </Button>
        </Flex>
      </Flex>
    );
  return (
    <Flex direction="column" gap="3">
      <Grid columns="6" gap="1" style={{ fontSize: 12 }}>
        <Text size="1" color="gray" />
        {FREQS.map((f) => (
          <Text key={f} size="1" color="gray" align="center">
            {f >= 1000 ? `${f / 1000}k` : f}
          </Text>
        ))}
        {(["l", "r"] as const).map((ear) => [
          <Text key={ear} size="1" weight="medium">
            {ear === "l" ? tx("Левое") : tx("Правое")}
          </Text>,
          ...FREQS.map((f) => {
            const x = results[`${ear}${f}`];
            return (
              <Text key={ear + f} size="1" align="center" color={x === null ? "red" : undefined}>
                {x === null ? "-" : x}
              </Text>
            );
          }),
        ])}
      </Grid>
      <Text size="2">
        {v!.worse
          ? tx(v!.worse === "l" ? "Левое ухо слышит тише примерно на {n} дБ." : "Правое ухо слышит тише примерно на {n} дБ.", { n: Math.round(Math.abs(v!.diff)) })
          : tx("Уши слышат примерно одинаково.")}
        {v!.unheard.length ? " " + tx("Не услышаны: {f} Гц - для высоких частот это бывает и с возрастом.", { f: v!.unheard.join(", ") }) : ""}
      </Text>
      <Flex gap="2" wrap="wrap">
        {v!.balance !== 0 && (
          <Button variant="soft" onClick={() => onBalance(v!.balance)}>
            {tx("Поставить баланс: {side} тише на {n} %", { side: v!.balance > 0 ? tx("левое") : tx("правое"), n: Math.abs(v!.balance) })}
          </Button>
        )}
        <Button variant="soft" color="gray" onClick={() => (setResults({}), setStep(0))}>
          {tx("Пройти ещё раз")}
        </Button>
      </Flex>
      <Callout.Root color={v!.worse || v!.gaps.length ? "amber" : "gray"} size="1">
        <Callout.Icon>
          <Info size={14} />
        </Callout.Icon>
        <Callout.Text>
          {tx("Это ориентир, а не диагноз: наушники, шум вокруг и громкость Windows сильно влияют на цифры. Разница между ушами, звон или заложенность - повод сходить к ЛОР-врачу или сурдологу.")}
        </Callout.Text>
      </Callout.Root>
    </Flex>
  );
}
