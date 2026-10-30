import Fastify from "fastify";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import { openBlocklist } from "./blocklist.js";
import { chainEnv, ConfigError, dodoEnv, llmEnv, loadEnv, readRules, serverEnv } from "./config.js";
import { openDb } from "./db.js";
import { installErrorHandler, makeRedactor, UserError } from "./errors.js";
import { makeLlm } from "./llm.js";
import { describeRoutes, registerRoutes } from "./routes.js";

const env = { ...loadEnv(serverEnv, "server"), ...loadEnv(llmEnv, "llm") };
const dodo = loadEnv(dodoEnv, "dodo");
if (env.DECISIONS_PAGE_SIZE > env.DECISIONS_MAX_LIMIT) {
  console.error("Config error: DECISIONS_PAGE_SIZE must not be larger than DECISIONS_MAX_LIMIT.");
  process.exit(1);
}
const db = openDb(env.DB_PATH);

const app = Fastify({ logger: true });
await app.register(cors, { origin: env.CORS_ORIGINS });
await app.register(rateLimit, { max: env.RATE_LIMIT_PER_MINUTE, timeWindow: "1 minute" });

// The RPC URL (used by /blocklist) can carry a key, so it is redacted from every response and log line too.
installErrorHandler(app, makeRedactor([env.LLM_API_KEY, process.env.RPC_URL, dodo.DODO_WEBHOOK_SECRET]));
// Retry events carry only the attempt number, the reason and the wait: never headers, keys or the complaint text.
const llm = makeLlm(env, (e) => app.log.warn(e, "AI provider call failed, retrying"));

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

const served = registerRoutes(app, {
  db,
  llm,
  dataSource: env.DATA_SOURCE,
  defaultTimezone: env.DEFAULT_TIMEZONE,
  graph: { baseUrl: env.GRAPH_SERVICE_URL, timeoutMs: env.GRAPH_TIMEOUT_MS },
  loadRules: loadRulesForEvidence,
  openBlocklist: () => openBlocklist(process.env),
  dodo: { secret: dodo.DODO_WEBHOOK_SECRET, toleranceSeconds: dodo.DODO_WEBHOOK_TOLERANCE_SECONDS },
  decisions: { pageSize: env.DECISIONS_PAGE_SIZE, maxLimit: env.DECISIONS_MAX_LIMIT },
  exposeWriteRoutes: env.EXPOSE_WRITE_ROUTES,
});

await app.listen({ port: env.PORT, host: env.LISTEN_HOST });
const bound = app.server.address();
if (bound === null || typeof bound === "string") throw new Error("The server did not report a TCP address after listen.");
console.log(`Backend listening on ${bound.address} port ${bound.port} (LISTEN_HOST=${env.LISTEN_HOST}, PORT=${env.PORT}).`);
console.log(describeRoutes(env.EXPOSE_WRITE_ROUTES, served));
