// Weather: WMO codes, what changed between readings, the lines and the
// country list for the setting.
import { describe, expect, it } from "vitest";
import { formatTemp, sky, skyName, visual, weatherLines, wet } from "./weather";
import { countries, findCountries } from "./places";
import { Dialogue } from "./dialogue";
import { rules } from "./director";
import { defaults } from "./model";
import { setLang } from "./i18n";
const events = (prev: Parameters<typeof weatherLines>[0], now: Parameters<typeof weatherLines>[1], announce = false) =>
  weatherLines(prev, now, "Казань, Россия", announce).map((l) => l.event);
describe("weather", () => {
  it("reads WMO codes", () => {
    expect([0, 1, 3, 45, 51, 61, 66, 71, 80, 85, 95, 99].map(sky)).toEqual([
      "clear",
      "clouds",
      "overcast",
      "fog",
      "drizzle",
      "rain",
      "rain",
      "snow",
      "showers",
      "snow",
      "storm",
      "storm",
    ]);
    expect(wet("showers")).toBe(true);
    expect(wet("snow")).toBe(false);
    expect(visual("drizzle")).toBe("rain");
    expect(visual("storm")).toBe("storm");
    expect(visual("clear")).toBeNull();
  });
  it("says what changed, not the same thing every half hour", () => {
    const clear = { sky: "clear" as const, temp: 18 };
    const rain = { sky: "rain" as const, temp: 12 };
    expect(events(clear, rain)).toEqual(["rainStart"]);
    expect(events(rain, clear)).toEqual(["rainStop"]);
    expect(events(rain, { sky: "storm", temp: 12 })).toEqual(["storm"]);
    expect(events(clear, { sky: "snow", temp: -3 })).toEqual(["snowStart"]);
    expect(events(clear, { sky: "fog", temp: 5 })).toEqual(["fog"]);
    expect(events(clear, { sky: "clear", temp: 31 })).toEqual(["heat"]);
    expect(events(clear, { sky: "clear", temp: -16 })).toEqual(["frost"]);
    // Still raining: the "rain" bank, which its rule allows once in 3 hours.
    expect(events(rain, rain)).toEqual(["rain"]);
    expect(rules.rain.cooldown).toBeGreaterThanOrEqual(3 * 3600000);
    expect(events(clear, { sky: "clouds", temp: 17 })).toEqual([]);
  });
  it("on the first reading reports the weather, and never says 'it started raining'", () => {
    expect(events(null, { sky: "rain", temp: 12 }, true)).toEqual(["weatherNow"]);
    expect(events(null, { sky: "rain", temp: 12 })).toEqual(["rain"]);
    expect(events(null, { sky: "clear", temp: 12 })).toEqual([]);
    const [line] = weatherLines(null, { sky: "clear", temp: -2.6 }, "Берлин", true);
    expect(line.vars).toEqual({ place: "Берлин", temp: "−3°", sky: "ясно" });
  });
  it("formats the temperature", () => {
    expect(formatTemp(12.4)).toBe("+12°");
    expect(formatTemp(-0.4)).toBe("0°");
    expect(formatTemp(-7)).toBe("−7°");
  });
  it("has lines for every weather event in both languages, with every variable filled", () => {
    for (const lang of ["ru", "en"] as const)
      for (const event of ["weatherNow", "rainStart", "rainStop", "storm", "snowStart", "fog", "frost", "heat", "rain", "snow"]) {
        expect(rules[event], event).toBeDefined();
        const d = new Dialogue([], () => 0.5);
        const text = d.choose(event, { ...defaults, lang }, 0, true, { place: "Kazan", temp: "+12°", sky: "rain" });
        expect(text, `${lang} ${event}`).toBeTruthy();
        expect(text).not.toMatch(/\{\w+\}/);
      }
  });
  it("names the sky in the interface language", () => {
    setLang("en");
    expect(skyName("storm")).toBe("thunderstorm");
    setLang("ru");
    expect(skyName("storm")).toBe("гроза");
  });
  it("finds countries by the start of the name in either language", () => {
    expect(findCountries("гер").map((c) => c.en)).toEqual(["Germany"]);
    expect(findCountries("ger").map((c) => c.ru)).toEqual(["Германия"]);
    expect(findCountries("а").length).toBe(0);
    expect(findCountries("Кишинев")).toEqual([]);
    for (const c of countries) {
      expect(Math.abs(c.lat)).toBeLessThanOrEqual(90);
      expect(Math.abs(c.lon)).toBeLessThanOrEqual(180);
    }
  });
});
