"use client";

import { useSyncExternalStore } from "react";
import { parseThemePreference, resolveTheme, THEME_STORAGE_KEY, type ThemePreference } from "@/lib/theme";
import { MonitorIcon, MoonIcon, SunIcon } from "./icons";

const listeners = new Set<() => void>();
const DARK_QUERY = "(prefers-color-scheme: dark)";

function readPreference(): ThemePreference {
  try {
    return parseThemePreference(window.localStorage.getItem(THEME_STORAGE_KEY));
  } catch {
    return "system";
  }
}

function applyPreference(preference: ThemePreference) {
  const theme = resolveTheme(preference, window.matchMedia(DARK_QUERY).matches);
  document.documentElement.setAttribute("data-theme", theme);
}

function notify() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  const media = window.matchMedia(DARK_QUERY);
  const onSystemChange = () => {
    if (readPreference() === "system") applyPreference("system");
    listener();
  };
  const onStorage = (event: StorageEvent) => {
    if (event.key !== THEME_STORAGE_KEY) return;
    applyPreference(readPreference());
    listener();
  };
  media.addEventListener("change", onSystemChange);
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    media.removeEventListener("change", onSystemChange);
    window.removeEventListener("storage", onStorage);
  };
}

function choose(preference: ThemePreference) {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, preference);
  } catch {}
  applyPreference(preference);
  notify();
}

const OPTIONS: { value: ThemePreference; label: string; Icon: typeof SunIcon }[] = [
  { value: "light", label: "Light theme", Icon: SunIcon },
  { value: "dark", label: "Dark theme", Icon: MoonIcon },
  { value: "system", label: "Match system theme", Icon: MonitorIcon },
];

export function ThemeSwitch() {
  const preference = useSyncExternalStore(subscribe, readPreference, () => "system" as ThemePreference);
  return (
    <div role="group" aria-label="Color theme" className="inline-flex rounded-md border border-header-line p-0.5">
      {OPTIONS.map(({ value, label, Icon }) => {
        const active = preference === value;
        return (
          <button
            key={value}
            type="button"
            aria-label={label}
            aria-pressed={active}
            title={label}
            onClick={() => choose(value)}
            className={`inline-flex h-10 w-10 items-center justify-center rounded-[5px] transition-colors duration-150 ${
              active ? "bg-header-active text-accent" : "text-header-muted hover:text-header-fg"
            }`}
          >
            <Icon size={17} />
          </button>
        );
      })}
    </div>
  );
}
