import { describe, expect, it } from "vitest";
import { appName, formatDuration } from "./apps";

describe("appName", () => {
  it("maps known executables and strips the extension otherwise", () => {
    expect(appName("chrome.exe")).toBe("Chrome");
    expect(appName("Code.exe")).toBe("VS Code");
    expect(appName("explorer.exe")).toBe("Проводник");
    expect(appName("foo.exe")).toBe("foo");
    expect(appName("")).toBe("что-то");
  });
});
describe("formatDuration", () => {
  it("speaks Russian hours and minutes", () => {
    expect(formatDuration(45)).toBe("меньше минуты");
    expect(formatDuration(2400)).toBe("40 мин");
    expect(formatDuration(8100)).toBe("2 ч 15 мин");
    expect(formatDuration(7200)).toBe("2 ч");
  });
});
