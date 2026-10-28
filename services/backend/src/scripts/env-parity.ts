// Checks that every environment variable the code reads is listed in .env.example, and the other way round.
// Names only: it never reads .env and never prints a value. Usage: npm run env-parity
import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { chainEnv, llmEnv, serverEnv, verifierEnv } from "../config.js";

const backend = fileURLToPath(new URL("../../", import.meta.url));

// 1. Variables declared in the config schemas (the one place the backend validates its environment).
const declared = new Set<string>();
for (const schema of [llmEnv, serverEnv, chainEnv, verifierEnv]) for (const key of Object.keys(schema.shape)) declared.add(key);

// 2. Variables read directly from the process environment object anywhere in src (these must be declared too).
const readDirectly = new Map<string, string[]>();
function walk(dir: string) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) walk(path);
    else if (path.endsWith(".ts")) {
      for (const m of readFileSync(path, "utf8").matchAll(/process\.env\.([A-Z][A-Z0-9_]*)/g)) {
        readDirectly.set(m[1], [...(readDirectly.get(m[1]) ?? []), path.slice(backend.length)]);
      }
    }
  }
}
walk(join(backend, "src"));

// 3. Names listed in .env.example (and whether any line carries a value).
const example = new Set<string>();
const withValue: string[] = [];
for (const line of readFileSync(join(backend, ".env.example"), "utf8").split(/\r?\n/)) {
  if (!line.trim() || line.trim().startsWith("#")) continue;
  const [name, ...rest] = line.split("=");
  example.add(name.trim());
  if (rest.join("=").trim() !== "") withValue.push(name.trim());
}

const problems: string[] = [];
for (const n of declared) if (!example.has(n)) problems.push(`${n} is read by the config but missing from .env.example`);
for (const n of example) if (!declared.has(n)) problems.push(`${n} is in .env.example but no config schema reads it`);
for (const [n, files] of readDirectly) if (!declared.has(n)) problems.push(`${n} is read with process.env in ${[...new Set(files)].join(", ")} but is not declared in a config schema`);
for (const n of withValue) problems.push(`${n} has a value in .env.example (names only, no values)`);

console.log(`config declares ${declared.size} variables; .env.example lists ${example.size}; ${readDirectly.size} read directly with process.env`);
if (problems.length) {
  for (const p of problems) console.log(`MISMATCH: ${p}`);
  process.exitCode = 1;
} else {
  console.log("env parity OK: every variable the code reads is in .env.example and the other way round; no values in .env.example");
}
