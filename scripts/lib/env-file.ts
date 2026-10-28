import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parse } from "dotenv";
import { ROOT_DIR } from "./deploy-config";

export const ROOT_ENV_FILE = path.join(ROOT_DIR, ".env");

export function readRootEnv(): Record<string, string> {
  if (!existsSync(ROOT_ENV_FILE)) throw new Error("No .env in the repository root. Create it from .env.example first.");
  return parse(readFileSync(ROOT_ENV_FILE));
}

export function hasRootEnvValue(name: string): boolean {
  return (readRootEnv()[name] ?? "").trim() !== "";
}

export function fillEmptyRootEnvValue(name: string, value: string): void {
  if (hasRootEnvValue(name)) throw new Error(`${name} already has a value in .env. Refusing to replace it.`);
  const source = readFileSync(ROOT_ENV_FILE, "utf8");
  const newline = source.includes("\r\n") ? "\r\n" : "\n";
  const lines = source.split(/\r?\n/);
  const emptyLine = lines.findIndex((line) => line.trim() === `${name}=`);
  if (emptyLine >= 0) {
    lines[emptyLine] = `${name}=${value}`;
  } else {
    if (lines[lines.length - 1] === "") lines.pop();
    lines.push(`${name}=${value}`, "");
  }
  writeFileSync(ROOT_ENV_FILE, lines.join(newline));
  if (readRootEnv()[name] !== value) throw new Error(`${name} was not written to .env correctly.`);
}
