import Fastify from "fastify";
import rateLimit from "@fastify/rate-limit";
import { z } from "zod";
import { llmEnv, loadEnv, serverEnv } from "./config.js";
import { extractComplaint, makeLlm, UserError } from "./extract.js";

const env = { ...loadEnv(serverEnv, "server"), ...loadEnv(llmEnv, "llm") };
const llm = makeLlm(env);

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
  return { complaint, dataSource: env.DATA_SOURCE };
});

await app.listen({ port: env.PORT, host: "0.0.0.0" });
