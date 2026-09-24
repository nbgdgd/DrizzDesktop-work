// Weather for the pet: WMO codes from Open-Meteo turned into a "sky", what
// changed since the last check (rain started or stopped, a storm, snow, fog,
// heat, frost) and the words for it. Pure; PetScene fetches every 30 minutes
// and says the lines, props.ts draws the little cloud.
import { tx } from "./i18n";
export type Sky = "clear" | "clouds" | "overcast" | "fog" | "drizzle" | "rain" | "showers" | "snow" | "storm";
export interface WeatherNow {
  sky: Sky;
  temp: number;
}
/** WMO weather interpretation codes (Open-Meteo "weather_code"). */
export function sky(code: number): Sky {
  if (code >= 95) return "storm";
  if (code === 71 || code === 73 || code === 75 || code === 77 || code === 85 || code === 86) return "snow";
  if (code >= 80 && code <= 82) return "showers";
  if (code >= 61 && code <= 67) return "rain";
  if (code >= 51 && code <= 57) return "drizzle";
  if (code === 45 || code === 48) return "fog";
  if (code === 3) return "overcast";
  if (code === 1 || code === 2) return "clouds";
  return "clear";
}
export const wet = (s: Sky) => s === "drizzle" || s === "rain" || s === "showers" || s === "storm";
/** What the cloud above the pet shows, if anything. */
export function visual(s: Sky): "rain" | "storm" | "snow" | null {
  return s === "storm" ? "storm" : wet(s) ? "rain" : s === "snow" ? "snow" : null;
}
export function skyName(s: Sky): string {
  return tx(
    {
      clear: "ясно",
      clouds: "переменная облачность",
      overcast: "пасмурно",
      fog: "туман",
      drizzle: "морось",
      rain: "дождь",
      showers: "ливень",
      snow: "снег",
      storm: "гроза",
    }[s],
  );
}
/** "+12°", "−3°", "0°". */
export const formatTemp = (t: number) => {
  const r = Math.round(t);
  return `${r > 0 ? "+" : r < 0 ? "−" : ""}${Math.abs(r)}°`;
};
export interface WeatherLine {
  event: string;
  vars: Record<string, string>;
}
/**
 * Lines for a new reading. `prev` is the last reading for the same place
 * (null right after start or after the place changed); `announce` asks for
 * a "here is the weather" line (new place, or the first reading of the day).
 */
export function weatherLines(prev: WeatherNow | null, now: WeatherNow, place: string, announce: boolean): WeatherLine[] {
  const vars = { place, temp: formatTemp(now.temp), sky: skyName(now.sky) };
  const out: WeatherLine[] = [];
  const was = prev?.sky;
  if (prev && was) {
    // A change since the last reading: said as news.
    if (now.sky === "storm" && was !== "storm") out.push({ event: "storm", vars });
    else if (wet(now.sky) && !wet(was)) out.push({ event: "rainStart", vars });
    else if (now.sky === "snow" && was !== "snow") out.push({ event: "snowStart", vars });
    else if (wet(was) && !wet(now.sky)) out.push({ event: "rainStop", vars });
    else if (now.sky === "fog" && was !== "fog") out.push({ event: "fog", vars });
    else if (now.temp >= 30 && prev.temp < 30) out.push({ event: "heat", vars });
    else if (now.temp <= -15 && prev.temp > -15) out.push({ event: "frost", vars });
    // Still raining or snowing: an occasional word (the rules allow one in 3 h).
    else if (wet(was) && wet(now.sky)) out.push({ event: "rain", vars });
    else if (was === "snow" && now.sky === "snow") out.push({ event: "snow", vars });
    return out;
  }
  // First reading (start, new place): a report, or what is going on anyway.
  if (announce) out.push({ event: "weatherNow", vars });
  else if (wet(now.sky)) out.push({ event: "rain", vars });
  else if (now.sky === "snow") out.push({ event: "snow", vars });
  else if (now.temp >= 30) out.push({ event: "heat", vars });
  else if (now.temp <= -15) out.push({ event: "frost", vars });
  return out;
}
