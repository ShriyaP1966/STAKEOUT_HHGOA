import { describe, expect, it } from "vitest";
import { parseThemePreference, resolveTheme, THEME_BOOT_SCRIPT, THEME_STORAGE_KEY } from "./theme";

describe("parseThemePreference", () => {
  it("accepts the three known preferences", () => {
    expect(parseThemePreference("light")).toBe("light");
    expect(parseThemePreference("dark")).toBe("dark");
    expect(parseThemePreference("system")).toBe("system");
  });

  it("falls back to system for anything else", () => {
    expect(parseThemePreference(null)).toBe("system");
    expect(parseThemePreference("")).toBe("system");
    expect(parseThemePreference("blue")).toBe("system");
    expect(parseThemePreference(1)).toBe("system");
  });
});

describe("resolveTheme", () => {
  it("keeps an explicit choice regardless of the system setting", () => {
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
  });

  it("follows the system setting for system", () => {
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
  });
});

describe("THEME_BOOT_SCRIPT", () => {
  it("reads the same storage key the switch writes", () => {
    expect(THEME_BOOT_SCRIPT).toContain(`"${THEME_STORAGE_KEY}"`);
  });
});
