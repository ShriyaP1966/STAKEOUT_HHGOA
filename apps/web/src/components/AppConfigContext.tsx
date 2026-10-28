"use client";

import { createContext, useContext } from "react";
import type { AppConfig } from "@/lib/app-config";

const AppConfigContext = createContext<AppConfig | null>(null);

export const AppConfigProvider = AppConfigContext.Provider;

export function useAppConfig(): AppConfig {
  const config = useContext(AppConfigContext);
  if (!config) throw new Error("App configuration is not loaded.");
  return config;
}
