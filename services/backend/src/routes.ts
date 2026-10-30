import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { registerBlocklistRoute, type BlocklistIndex } from "./blocklist.js";
import type { Rules } from "./config.js";
import type { Db } from "./db.js";
import { registerDodoRoute } from "./dodo.js";
import { UserError } from "./errors.js";
import { registerEvidenceBuildRoute, registerEvidenceReadRoute } from "./evidenceRoutes.js";
import { registerExtractRoute } from "./extractRoute.js";
import type { Llm } from "./llm.js";

/** Routes that only read stored data. They are always served. */
export const READ_ROUTES = ["GET /health", "GET /decisions", "GET /evidence/:hash"] as const;
/** Routes that call the AI, the Graph Service or the chain, or write to the database. Served only when EXPOSE_WRITE_ROUTES is true. */
export const WRITE_ROUTES = ["POST /extract", "POST /evidence/build", "POST /webhooks/dodo", "GET /blocklist"] as const;

export type RouteDeps = {
  db: Db;
  llm: Llm;
  dataSource: "synthetic" | "testnet";
  defaultTimezone: string;
  graph: { baseUrl: string; timeoutMs: number };
  loadRules: () => Rules;
  openBlocklist: () => Promise<BlocklistIndex>;
  dodo: { secret: string | undefined; toleranceSeconds: number | undefined };
  decisions: { pageSize: number; maxLimit: number };
  exposeWriteRoutes: boolean;
};

/** Registers the routes for the chosen mode and returns the list that is served. */
export function registerRoutes(app: FastifyInstance, deps: RouteDeps): string[] {
  app.get("/health", async () => ({ ok: true, dataSource: deps.dataSource }));

  if (deps.exposeWriteRoutes) {
    registerExtractRoute(app, { llm: deps.llm, db: deps.db, dataSource: deps.dataSource, defaultTimezone: deps.defaultTimezone });
    registerEvidenceBuildRoute(app, { db: deps.db, llm: deps.llm, graph: deps.graph, dataSource: deps.dataSource, loadRules: deps.loadRules });
    // PROPOSED: hashed addresses of Confirmed and Linked wallets, read from contract events. Needs RPC_URL, CHAIN_ID and DEPLOYMENT_PATH when first used.
    registerBlocklistRoute(app, { open: deps.openBlocklist, dataSource: deps.dataSource });
    // Dodo Payments test-mode webhook. Needs DODO_WEBHOOK_SECRET; without it this route answers 503 and nothing else is affected.
    // The real Dodo account and a live delivery have NOT been run.
    registerDodoRoute(app, { db: deps.db, config: { secret: deps.dodo.secret, toleranceSeconds: deps.dodo.toleranceSeconds } });
  }
  // GET /evidence/:hash only reads, so it is served in both modes.
  registerEvidenceReadRoute(app, deps.db);

  const limitMessage = `limit must be a whole number from 1 to ${deps.decisions.maxLimit}`;
  const decisionsQuery = z.object({
    limit: z.coerce.number(limitMessage).int(limitMessage).min(1, limitMessage).max(deps.decisions.maxLimit, limitMessage)
      .default(deps.decisions.pageSize),
  });
  app.get("/decisions", async (req) => {
    const query = decisionsQuery.safeParse(req.query);
    if (!query.success) throw new UserError(query.error.issues[0].message);
    return { decisions: deps.db.listDecisions(query.data.limit), dataSource: deps.dataSource };
  });

  return deps.exposeWriteRoutes ? [...READ_ROUTES, ...WRITE_ROUTES] : [...READ_ROUTES];
}

/** One startup line: the mode and the routes served. Contains no setting value other than the mode. */
export function describeRoutes(exposeWriteRoutes: boolean, served: string[]): string {
  const mode = exposeWriteRoutes ? "EXPOSE_WRITE_ROUTES=true (full API)" : "EXPOSE_WRITE_ROUTES=false (public read-only instance)";
  const left = exposeWriteRoutes ? "" : ` Not served: ${WRITE_ROUTES.join(", ")}.`;
  return `${mode}. Serving: ${served.join(", ")}.${left}`;
}
