// Where the weather comes from: search a city (Open-Meteo geocoding, only
// when "Find" is pressed), pick a country (its capital), or type
// coordinates by hand. Stored as settings.weatherPlace "lat,lon" plus a
// readable settings.weatherName for the lines.
import { useState } from "react";
import { Badge, Box, Button, Flex, Select, Text, TextField } from "@radix-ui/themes";
import { MapPin, Search } from "lucide-react";
import { command } from "../../bridge";
import { countries, findCountries } from "../../places";
import { getLang, tx } from "../../i18n";
import type { PanelState } from "../store";
import { Row } from "../ui";
interface Found {
  name: string;
  hint: string;
  place: string;
}
export function WeatherPlace({ p }: { p: PanelState }) {
  const d = p.draft;
  const en = getLang() === "en";
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<Found[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const pick = (f: { name: string; place: string }) => {
    p.set("weatherPlace", f.place);
    p.set("weatherName", f.name);
    setFound(null);
    setQuery("");
  };
  const search = async () => {
    const q = query.trim();
    if (q.length < 2) return;
    setBusy(true);
    setProblem("");
    const local: Found[] = findCountries(q).map((c) => ({
      name: en ? c.en : c.ru,
      hint: tx("страна · погода по столице ({city})", { city: en ? c.capitalEn : c.capitalRu }),
      place: `${c.lat},${c.lon}`,
    }));
    try {
      const online = (await command<{ name: string; region: string; country: string; lat: number; lon: number }[]>("weather_search", { query: q })) ?? [];
      setFound([
        ...local,
        ...online.map((x) => ({
          name: [x.name, x.country].filter(Boolean).join(", "),
          hint: [x.region, `${x.lat.toFixed(2)}, ${x.lon.toFixed(2)}`].filter(Boolean).join(" · "),
          place: `${x.lat},${x.lon}`,
        })),
      ]);
    } catch (e) {
      setFound(local);
      setProblem(tx(String(e).replace(/^Error:\s*/, "")));
    } finally {
      setBusy(false);
    }
  };
  const sorted = [...countries].sort((a, b) => (en ? a.en.localeCompare(b.en, "en") : a.ru.localeCompare(b.ru, "ru")));
  return (
    <>
      <Row label={tx("Место")} hint={d.weatherPlace ? d.weatherPlace : tx("Не выбрано — погода не запрашивается.")}>
        {d.weatherPlace ? (
          <Badge size="2" color="green">
            <MapPin size={13} /> {d.weatherName || tx("координаты")}
          </Badge>
        ) : (
          <Badge size="2" color="gray">
            {tx("не выбрано")}
          </Badge>
        )}
      </Row>
      <Box>
        <Text as="div" size="2" weight="medium" mb="1">
          {tx("Город или страна")}
        </Text>
        <Flex gap="2">
          <TextField.Root
            style={{ flex: 1 }}
            value={query}
            placeholder={tx("Например: Казань, Берлин, Германия")}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void search()}
            aria-label={tx("Город или страна")}
          />
          <Button disabled={busy || query.trim().length < 2} onClick={() => void search()}>
            <Search size={15} /> {busy ? tx("Ищу…") : tx("Найти")}
          </Button>
        </Flex>
        <Text as="div" size="1" color="gray" mt="1">
          {tx("Поиск идёт через Open-Meteo: уходит только набранное название. Для большой страны лучше выбрать город.")}
        </Text>
        {problem && (
          <Text as="div" size="1" color="red" mt="1">
            {problem}
          </Text>
        )}
        {found && (
          <Flex direction="column" gap="1" mt="2" className="place-list">
            {found.length === 0 && (
              <Text size="2" color="gray">
                {tx("Ничего не нашлось. Попробуй по-другому или выбери страну ниже.")}
              </Text>
            )}
            {found.map((f) => (
              <button key={f.place + f.name} className="place-item" onClick={() => pick(f)}>
                <MapPin size={14} />
                <span className="place-name">{f.name}</span>
                <span className="place-hint">{f.hint}</span>
              </button>
            ))}
          </Flex>
        )}
      </Box>
      <Row label={tx("Или страна")} hint={tx("Погода по столице.")}>
        <Select.Root
          value=""
          onValueChange={(v) => {
            const c = countries.find((x) => x.en === v);
            if (c) pick({ name: en ? c.en : c.ru, place: `${c.lat},${c.lon}` });
          }}
        >
          <Select.Trigger placeholder={tx("Выбрать страну")} style={{ minWidth: 180 }} />
          <Select.Content>
            {sorted.map((c) => (
              <Select.Item key={c.en} value={c.en}>
                {en ? c.en : c.ru}
              </Select.Item>
            ))}
          </Select.Content>
        </Select.Root>
      </Row>
      <details className="place-manual">
        <summary>{tx("Координаты вручную")}</summary>
        <Row label={tx("Координаты")} hint={tx("Широта и долгота через запятую, например 55.75,37.62.")}>
          <TextField.Root
            value={d.weatherPlace}
            placeholder="55.75,37.62"
            onChange={(e) => {
              p.set("weatherPlace", e.target.value);
              p.set("weatherName", "");
            }}
            style={{ width: 160 }}
          />
        </Row>
      </details>
    </>
  );
}
