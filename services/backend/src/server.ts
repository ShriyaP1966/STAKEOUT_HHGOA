import Fastify from "fastify";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import { z } from "zod";
import { llmEnv, loadEnv, serverEnv } from "./config.js";
import { hashBundle } from "../../../shared/hash/index.js";
import { openDb } from "./db.js";
import { installErrorHandler, makeRedactor, UserError } from "./errors.js";
import { extractComplaint } from "./extract.js";
import { makeLlm } from "./llm.js";

const env = { ...loadEnv(serverEnv, "server"), ...loadEnv(llmEnv, "llm") };
const db = openDb(env.DB_PATH);

const app = Fastify({ logger: true });
await app.register(cors, { origin: env.CORS_ORIGINS });
await app.register(rateLimit, { max: env.RATE_LIMIT_PER_MINUTE, timeWindow: "1 minute" });

installErrorHandler(app, makeRedactor([env.LLM_API_KEY]));
// Retry events carry only the attempt number, the reason and the wait: never headers, keys or the complaint text.
const llm = makeLlm(env, (e) => app.log.warn(e, "AI provider call failed, retrying"));

app.get("/health", async () => ({ ok: true, dataSource: env.DATA_SOURCE }));

const extractBody = z.object({ text: z.string().trim().min(1).max(5000), targetAddress: z.string().optional() });
app.post("/extract", async (req) => {
  const body = extractBody.safeParse(req.body);
  if (!body.success) throw new UserError("Body must be {\"text\": \"<complaint, up to 5000 chars>\"}");
  const text = body.data.text;
  const complaint = await extractComplaint(llm, text, body.data.targetAddress);
  const record = { text, complaint, dataSource: env.DATA_SOURCE };
  const complaintHash = hashBundle(record);
  db.saveEvidence(complaintHash, record);
  return { complaint, dataSource: env.DATA_SOURCE, text, complaintHash };
});

app.get("/evidence/:hash", async (req) => {
  const { hash } = req.params as { hash: string };
  if (!/^0x[0-9a-fA-F]{64}$/.test(hash)) throw new UserError("hash must be 0x followed by 64 hex characters");
  const bundle = db.getEvidence(hash);
  if (!bundle) throw new UserError("No evidence stored for that hash", 404);
  return { hash, bundle };
});

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
