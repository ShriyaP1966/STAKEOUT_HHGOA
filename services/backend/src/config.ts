import "dotenv/config";
import { readFileSync } from "node:fs";
import { z } from "zod";

/** Every env var is required; nothing has a default value in code. */
const nonEmpty = z.string().min(1, "is empty");

export const llmEnv = z.object({
  LLM_BASE_URL: z.url(),
  LLM_API_KEY: nonEmpty,
  LLM_MODEL: nonEmpty,
});

export const serverEnv = z.object({
  PORT: z.coerce.number().int().positive(),
  DB_PATH: nonEmpty,
  DATA_SOURCE: z.enum(["synthetic", "testnet"]),
  GRAPH_SERVICE_URL: z.url(),
  RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive(),
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

/** Everything the verifier process reads from .env (the API server does not need these). */
export const verifierEnv = chainEnv.extend({
  DB_PATH: nonEmpty,
  GRAPH_SERVICE_URL: z.url(),
  GRAPH_TIMEOUT_MS: z.coerce.number().int().positive(),
  RPC_TIMEOUT_MS: z.coerce.number().int().positive(),
  VERIFIER_DRY_RUN: z.enum(["true", "false"], "must be true or false").transform((v) => v === "true"),
  VERIFIER_POLL_INTERVAL_MS: z.coerce.number().int().positive(),
  VERIFIER_LOG_CHUNK_BLOCKS: z.coerce.number().int().positive(),
});

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

export function loadRules(path: string): Rules {
  const fail = (message: string): never => {
    console.error(message);
    process.exit(1);
  };
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return fail(
      `Rules file not found at RULES_PATH=${path}. config/rules.json is agreed by Person 1 and Person 3 (Person 2 only reads it); ` +
        "expected fields are listed in docs/rules-proposal.md. Nothing is assumed in its absence.",
    );
  }
  if (raw.trim() === "") return fail(`Rules file ${path} is empty. Expected fields: see docs/rules-proposal.md.`);
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (e) {
    return fail(`Rules file ${path} is not valid JSON: ${(e as Error).message}`);
  }
  const parsed = rulesSchema.safeParse(json);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`).join("\n");
    return fail(`Invalid rules file ${path} (expected fields: see docs/rules-proposal.md):\n${problems}`);
  }
  return parsed.data;
}
