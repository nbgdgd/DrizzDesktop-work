import { useEffect, useRef, useState } from "react";
import { Button, Callout, Card, Flex, Text, TextField } from "@radix-ui/themes";
import { Send } from "lucide-react";
import { command, emitAll, on } from "../../bridge";
import { phrases } from "../../dialogue";
import { parse } from "../../commands";
import { pets } from "../../model";
import type { PanelState } from "../store";
import { Portrait } from "../ui";
interface Msg {
  role: "user" | "assistant";
  content: string;
}
export function Chat({ p }: { p: PanelState }) {
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Msg[]>([]);
  const [waiting, setWaiting] = useState(false);
  const epoch = useRef(0);
  const box = useRef<HTMLDivElement>(null);
  const pending = useRef<((t: string) => void) | null>(null);
  const s = p.store.settings;
  const pet = pets.find((x) => x.id === s.pet) ?? pets[0];
  useEffect(() => {
    let off: (() => void) | undefined;
    let gone = false;
    // The pet answers commands on the desktop and echoes the line here.
    void on<{ text: string }>("pet-reply", (r) => {
      pending.current?.(r.text);
      pending.current = null;
    }).then((f) => (gone ? f() : (off = f)));
    return () => {
      gone = true;
      epoch.current++;
      off?.();
    };
  }, []);
  useEffect(() => {
    box.current?.scrollTo({ top: box.current.scrollHeight, behavior: "smooth" });
  }, [messages, waiting]);
  const say = (content: string) => setMessages((m) => [...m, { role: "assistant", content }]);
  const send = async (raw?: string) => {
    const text = (raw ?? input).trim();
    if (!text || waiting) return;
    setInput("");
    p.setError("");
    const before = messages;
    setMessages((m) => [...m, { role: "user", content: text }]);
    if (/^запомни[: ,]/i.test(text)) {
      const value = text.replace(/^запомни[: ,]+/i, "").trim().slice(0, 240);
      if (value) {
        await p.saveMemory({ facts: [...p.latest.current.facts, value].slice(-30) });
        say("Запомнил. Посмотреть и удалить можно в «Памяти».");
      }
      return;
    }
    if (parse(text)) {
      // A command: the pet does it and answers on the desktop.
      const reply = new Promise<string>((resolve) => {
        pending.current = resolve;
        setTimeout(() => resolve(""), 1500);
      });
      void emitAll("pet-command", { text });
      const r = await reply;
      say(r || "(ответил на рабочем столе)");
      return;
    }
    if (!s.ai) {
      say(phrases.localChat[Math.floor(before.length / 2) % phrases.localChat.length]);
      return;
    }
    if (!p.store.hasKey) {
      p.setError("Сначала добавьте ключ OpenRouter во вкладке «Доступ».");
      return;
    }
    const request = ++epoch.current;
    setWaiting(true);
    try {
      const reply = await command<string>("chat", {
        text,
        recent: before.slice(-6),
        context: s.sendContext ? JSON.stringify({ pet: s.pet, mode: s.mode }) : null,
      });
      if (request === epoch.current) say(reply);
    } catch (e) {
      if (request === epoch.current) {
        p.setError(String(e));
        say("Связь подвисла, блядь. Я всё равно здесь: движение и обычные реакции работают без сети.");
      }
    } finally {
      if (request === epoch.current) setWaiting(false);
    }
  };
  return (
    <>
      <Callout.Root size="1" color="gray" mb="3">
        <Callout.Text>
          {s.ai ? "Модель включена: запрос уходит только после отправки." : "Без модели — команды и короткие локальные ответы."} Команды:
          «сядь», «иди сюда», «спать», «танцуй», «прыгни», «отвали», «играть». «Запомни: …» сохраняет факт.
        </Callout.Text>
      </Callout.Root>
      <Card mb="3">
        <div className="messages" ref={box}>
          {messages.length === 0 && (
            <Flex direction="column" align="center" gap="2" py="6">
              <Portrait pet={pet.id} size={64} />
              <Text size="2">Ну? Я весь внимание.</Text>
            </Flex>
          )}
          {messages.map((m, i) => (
            <div key={i} className={`bubble ${m.role === "user" ? "user" : ""}`}>
              <Text size="2">{m.content}</Text>
            </div>
          ))}
          {waiting && (
            <Text size="1" color="gray">
              Думаю…
            </Text>
          )}
        </div>
      </Card>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <Flex gap="2">
          <TextField.Root
            style={{ flex: 1 }}
            aria-label="Сообщение"
            maxLength={2000}
            value={input}
            placeholder="Сказать что-нибудь…"
            onChange={(e) => setInput(e.target.value)}
          />
          <Button type="submit" disabled={waiting || !input.trim()}>
            <Send size={15} /> Отправить
          </Button>
        </Flex>
      </form>
      <Flex gap="2" mt="3" wrap="wrap">
        {["сядь", "иди сюда", "танцуй", "играть", "спать", "отвали"].map((c) => (
          <Button key={c} size="1" variant="surface" color="gray" onClick={() => void send(c)}>
            {c}
          </Button>
        ))}
        <Button
          size="1"
          variant="ghost"
          color="gray"
          onClick={() => {
            epoch.current++;
            setWaiting(false);
            setMessages([]);
          }}
        >
          Очистить разговор
        </Button>
      </Flex>
    </>
  );
}
