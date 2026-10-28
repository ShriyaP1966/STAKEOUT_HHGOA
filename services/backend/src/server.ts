import Fastify from "fastify";
import rateLimit from "@fastify/rate-limit";
import { z } from "zod";
import { llmEnv, loadEnv, serverEnv } from "./config.js";
import { hashBundle } from "../../../shared/hash/index.js";
import { openDb } from "./db.js";
import { extractComplaint, makeLlm, UserError } from "./extract.js";

const env = { ...loadEnv(serverEnv, "server"), ...loadEnv(llmEnv, "llm") };
const llm = makeLlm(env);
const db = openDb(env.DB_PATH);

const app = Fastify({ logger: true });
await app.register(rateLimit, { max: env.RATE_LIMIT_PER_MINUTE, timeWindow: "1 minute" });

app.setErrorHandler((err: Error & { statusCode?: number }, _req, reply) => {
  if (err instanceof UserError) return reply.status(err.status).send({ error: err.message });
  app.log.error(err);
  return reply.status(err.statusCode ?? 500).send({ error: err.message });
});

app.get("/health", async () => ({ ok: true, dataSource: env.DATA_SOURCE }));

const extractBody = z.object({ text: z.string().min(1).max(5000) });
app.post("/extract", async (req) => {
  const body = extractBody.safeParse(req.body);
  if (!body.success) throw new UserError("Body must be {\"text\": \"<complaint, up to 5000 chars>\"}");
  const complaint = await extractComplaint(llm, body.data.text);
  const record = { ...complaint, dataSource: env.DATA_SOURCE };
  const complaintHash = hashBundle(record);
  db.saveEvidence(complaintHash, record);
  return { complaint, dataSource: env.DATA_SOURCE, complaintHash };
});

app.get("/evidence/:hash", async (req) => {
  const { hash } = req.params as { hash: string };
  if (!/^0x[0-9a-fA-F]{64}$/.test(hash)) throw new UserError("hash must be 0x followed by 64 hex characters");
  const bundle = db.getEvidence(hash);
  if (!bundle) throw new UserError("No evidence stored for that hash", 404);
  return { hash, bundle };
});

app.get("/decisions", async (req) => {
  const limit = Math.min(Number((req.query as { limit?: string }).limit ?? env.DECISIONS_PAGE_SIZE), env.DECISIONS_PAGE_SIZE);
  return { decisions: db.listDecisions(limit), dataSource: env.DATA_SOURCE };
});

await app.listen({ port: env.PORT, host: "0.0.0.0" });
