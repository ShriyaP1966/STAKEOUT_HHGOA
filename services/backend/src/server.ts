import Fastify from "fastify";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import { z } from "zod";
import { openBlocklist, registerBlocklistRoute } from "./blocklist.js";
import { chainEnv, ConfigError, dodoEnv, llmEnv, loadEnv, readRules, serverEnv } from "./config.js";
import { openDb } from "./db.js";
import { registerDodoRoute } from "./dodo.js";
import { installErrorHandler, makeRedactor, UserError } from "./errors.js";
import { registerEvidenceRoutes } from "./evidenceRoutes.js";
import { registerExtractRoute } from "./extractRoute.js";
import { makeLlm } from "./llm.js";

const env = { ...loadEnv(serverEnv, "server"), ...loadEnv(llmEnv, "llm") };
const dodo = loadEnv(dodoEnv, "dodo");
const db = openDb(env.DB_PATH);

const app = Fastify({ logger: true });
await app.register(cors, { origin: env.CORS_ORIGINS });
await app.register(rateLimit, { max: env.RATE_LIMIT_PER_MINUTE, timeWindow: "1 minute" });

// The RPC URL (used by /blocklist) can carry a key, so it is redacted from every response and log line too.
installErrorHandler(app, makeRedactor([env.LLM_API_KEY, process.env.RPC_URL, dodo.DODO_WEBHOOK_SECRET]));
// Retry events carry only the attempt number, the reason and the wait: never headers, keys or the complaint text.
const llm = makeLlm(env, (e) => app.log.warn(e, "AI provider call failed, retrying"));

app.get("/health", async () => ({ ok: true, dataSource: env.DATA_SOURCE }));

registerExtractRoute(app, { llm, db, dataSource: env.DATA_SOURCE, defaultTimezone: env.DEFAULT_TIMEZONE });

// The agreed config/rules.json may not exist yet. Reading it only when evidence is built keeps /extract and the rest running,
// and a missing or invalid file is reported on the request that needs it.
function loadRulesForEvidence() {
  const path = chainEnv.pick({ RULES_PATH: true }).safeParse(process.env);
  if (!path.success) throw new UserError("RULES_PATH is not set in .env, so evidence cannot be built (it records the rules applied).", 503);
  try {
    return readRules(path.data.RULES_PATH);
  } catch (e) {
    if (e instanceof ConfigError) throw new UserError(e.message, 503);
    throw e;
  }
}

registerEvidenceRoutes(app, {
  db,
  llm,
  graph: { baseUrl: env.GRAPH_SERVICE_URL, timeoutMs: env.GRAPH_TIMEOUT_MS },
  dataSource: env.DATA_SOURCE,
  loadRules: loadRulesForEvidence,
});

// PROPOSED: hashed addresses of Confirmed and Linked wallets, read from contract events. Needs RPC_URL, CHAIN_ID and DEPLOYMENT_PATH when first used.
registerBlocklistRoute(app, { open: () => openBlocklist(process.env), dataSource: env.DATA_SOURCE });

// Dodo Payments test-mode webhook. Needs DODO_WEBHOOK_SECRET; without it this route answers 503 and nothing else is affected.
// The real Dodo account and a live delivery have NOT been run.
registerDodoRoute(app, { db, config: { secret: dodo.DODO_WEBHOOK_SECRET, toleranceSeconds: dodo.DODO_WEBHOOK_TOLERANCE_SECONDS } });

if (env.DECISIONS_PAGE_SIZE > env.DECISIONS_MAX_LIMIT) {
  console.error("Config error: DECISIONS_PAGE_SIZE must not be larger than DECISIONS_MAX_LIMIT.");
  process.exit(1);
}
const limitMessage = `limit must be a whole number from 1 to ${env.DECISIONS_MAX_LIMIT}`;
const decisionsQuery = z.object({
  limit: z.coerce.number(limitMessage).int(limitMessage).min(1, limitMessage).max(env.DECISIONS_MAX_LIMIT, limitMessage)
    .default(env.DECISIONS_PAGE_SIZE),
});

app.get("/decisions", async (req) => {
  const query = decisionsQuery.safeParse(req.query);
  if (!query.success) throw new UserError(query.error.issues[0].message);
  return { decisions: db.listDecisions(query.data.limit), dataSource: env.DATA_SOURCE };
});

await app.listen({ port: env.PORT, host: "0.0.0.0" });
