import "dotenv/config";
import { readFileSync } from "node:fs";
import { z } from "zod";
import { parseWebhookSecret } from "./dodo.js";
import { parseTimeZone } from "./timezone.js";

/** Every env var is required; nothing has a default value in code. */
const nonEmpty = z.string().min(1, "is empty");

export const llmEnv = z.object({
  LLM_BASE_URL: z.url(),
  LLM_API_KEY: nonEmpty,
  LLM_MODEL: nonEmpty,
  LLM_MAX_RETRIES: z.coerce.number().int().min(0),
  LLM_TIMEOUT_MS: z.coerce.number().int().positive(),
  LLM_RETRY_MAX_WAIT_SECONDS: z.coerce.number().int().min(0),
});

export const serverEnv = z.object({
  PORT: z.coerce.number().int().positive(),
  DB_PATH: nonEmpty,
  DATA_SOURCE: z.enum(["synthetic", "testnet"]),
  GRAPH_SERVICE_URL: z.url(),
  GRAPH_TIMEOUT_MS: z.coerce.number().int().positive(),
  RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive(),
  DEFAULT_TIMEZONE: z.string().refine((v) => parseTimeZone(v) !== null, "must be an IANA time zone name in Region/City form (or UTC)").transform((v) => parseTimeZone(v) as string),
  DECISIONS_PAGE_SIZE: z.coerce.number().int().positive(),
  DECISIONS_MAX_LIMIT: z.coerce.number().int().positive(),
  CORS_ORIGINS: z.string().transform((raw, ctx) => {
    const origins: string[] = [];
    for (const part of raw.split(",").map((s) => s.trim()).filter(Boolean)) {
      try {
        origins.push(new URL(part).origin);
      } catch {
        ctx.issues.push({ code: "custom", message: `"${part}" is not a valid origin (expected something like https://example.com)`, input: raw });
      }
    }
    if (origins.length === 0 && ctx.issues.length === 0) {
      ctx.issues.push({ code: "custom", message: "is empty; list the web app origins, comma-separated", input: raw });
    }
    return origins;
  }),
});

export const chainEnv = z.object({
  RPC_URL: z.url(),
  CHAIN_ID: z.coerce.number().int().positive(),
  VERIFIER_PRIVATE_KEY: z.string().regex(/^0x[0-9a-fA-F]{64}$/, "must be a 0x-prefixed 32-byte hex key"),
  DEPLOYMENT_PATH: nonEmpty,
  RULES_PATH: nonEmpty,
});

/** An empty value in .env means "not set" for optional variables. */
const emptyToUndefined = (v: unknown) => (v === "" ? undefined : v);

/** Optional viaSocket webhook. Unset or empty means no notifications at all. If the URL is set, the timeout is required. */
const notifyFields = {
  NOTIFY_WEBHOOK_URL: z.preprocess(emptyToUndefined, z.url().optional()),
  NOTIFY_TIMEOUT_MS: z.preprocess(emptyToUndefined, z.coerce.number().int().positive().optional()),
};
const notifyTimeoutCheck = (v: { NOTIFY_WEBHOOK_URL?: unknown; NOTIFY_TIMEOUT_MS?: unknown }) => !v.NOTIFY_WEBHOOK_URL || v.NOTIFY_TIMEOUT_MS !== undefined;
const notifyTimeoutProblem = { path: ["NOTIFY_TIMEOUT_MS"], message: "is required when NOTIFY_WEBHOOK_URL is set" };

/** Everything the verifier process reads from .env (the API server does not need these). */
export const verifierEnv = chainEnv.extend({
  DB_PATH: nonEmpty,
  DATA_SOURCE: z.enum(["synthetic", "testnet"]),
  GRAPH_SERVICE_URL: z.url(),
  GRAPH_TIMEOUT_MS: z.coerce.number().int().positive(),
  RPC_TIMEOUT_MS: z.coerce.number().int().positive(),
  VERIFIER_DRY_RUN: z.enum(["true", "false"], "must be true or false").transform((v) => v === "true"),
  VERIFIER_POLL_INTERVAL_MS: z.coerce.number().int().positive(),
  VERIFIER_LOG_CHUNK_BLOCKS: z.coerce.number().int().positive(),
  ...notifyFields,
}).refine(notifyTimeoutCheck, notifyTimeoutProblem);

/** Just the optional webhook settings, for `npm run notify-test`. Same fields and same rule as the verifier's. */
export const notifyEnv = z.object(notifyFields).refine(notifyTimeoutCheck, notifyTimeoutProblem);

/**
 * Optional Dodo Payments webhook (test mode). Both empty means the route answers 503. The secret is validated here so a typo
 * stops startup, but its value is never printed. If the secret is set, the timestamp tolerance is required.
 */
export const dodoEnv = z
  .object({
    DODO_WEBHOOK_SECRET: z.preprocess(
      emptyToUndefined,
      z.string().refine((v) => { try { parseWebhookSecret(v); return true; } catch { return false; } }, "is not a valid webhook secret (expected whsec_ followed by base64)").optional(),
    ),
    DODO_WEBHOOK_TOLERANCE_SECONDS: z.preprocess(emptyToUndefined, z.coerce.number().int().positive().optional()),
  })
  .refine((v) => !v.DODO_WEBHOOK_SECRET || v.DODO_WEBHOOK_TOLERANCE_SECONDS !== undefined, {
    path: ["DODO_WEBHOOK_TOLERANCE_SECONDS"],
    message: "is required when DODO_WEBHOOK_SECRET is set",
  });

/** Needed only by GET /blocklist. Checked when the endpoint is first used, so the rest of the API runs without a chain. */
export const blocklistEnv = z.object({
  RPC_URL: z.url(),
  CHAIN_ID: z.coerce.number().int().positive(),
  DEPLOYMENT_PATH: nonEmpty,
  RPC_TIMEOUT_MS: z.coerce.number().int().positive(),
  BLOCKLIST_LOG_CHUNK_BLOCKS: z.coerce.number().int().positive(),
});

/** Every schema that reads the environment; the env-parity check compares these with .env.example. */
export const envSchemas = [llmEnv, serverEnv, chainEnv, verifierEnv, blocklistEnv, dodoEnv];

/** Validate process.env against a schema; print every problem by name (never the value) and exit. */
export function loadEnv<T extends z.ZodObject>(schema: T, label: string): z.infer<T> {
  const parsed = schema.safeParse(process.env);
  if (parsed.success) return parsed.data;
  const lines = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`);
  console.error(`Config error (${label}). Fix .env (see .env.example):\n${lines.join("\n")}`);
  process.exit(1);
}

/**
 * Shape of config/rules.json as Person 2 reads it. Field names are a PROPOSAL
 * from the plan's wording (threshold, minimum signals, report effect,
 * confirmations to wait); the team must agree them in Phase 0.
 */
export const rulesSchema = z.object({
  behaviorThreshold: z.number(),
  minSignals: z.number().int().nonnegative(),
  reportConfidenceBoostPerReporter: z.number().nonnegative(),
  confirmationsToWait: z.number().int().nonnegative(),
});
export type Rules = z.infer<typeof rulesSchema>;

export class ConfigError extends Error {}

/** Reads and validates the rules file. Throws ConfigError with a message that says what is wrong and who owns the file. */
export function readRules(path: string): Rules {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    throw new ConfigError(
      `Rules file not found at RULES_PATH=${path}. config/rules.json is agreed by Person 1 and Person 3 (Person 2 only reads it); ` +
        "expected fields are listed in docs/rules-proposal.md. Nothing is assumed in its absence.",
    );
  }
  if (raw.trim() === "") throw new ConfigError(`Rules file ${path} is empty. Expected fields: see docs/rules-proposal.md.`);
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (e) {
    throw new ConfigError(`Rules file ${path} is not valid JSON: ${(e as Error).message}`);
  }
  const parsed = rulesSchema.safeParse(json);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`).join("\n");
    throw new ConfigError(`Invalid rules file ${path} (expected fields: see docs/rules-proposal.md):\n${problems}`);
  }
  return parsed.data;
}

/** For processes that cannot run without the rules (the verifier): print the problem and stop. */
export function loadRules(path: string): Rules {
  try {
    return readRules(path);
  } catch (e) {
    if (!(e instanceof ConfigError)) throw e;
    console.error(e.message);
    process.exit(1);
  }
}
