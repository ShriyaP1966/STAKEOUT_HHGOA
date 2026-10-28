import type { FastifyInstance } from "fastify";
import { ZeroAddress, getAddress, isAddress } from "ethers";
import { z } from "zod";
import type { Rules } from "./config.js";
import type { Db } from "./db.js";
import { UserError } from "./errors.js";
import { createEvidence } from "./evidence.js";
import type { Llm } from "./llm.js";
import { fetchAnalysis, graphErrorToUserError } from "./verifier/graphClient.js";

export type EvidenceRouteDeps = {
  db: Db;
  llm: Llm;
  graph: { baseUrl: string; timeoutMs: number };
  dataSource: "synthetic" | "testnet";
  /** Reads the rules when a build is requested; throws UserError(503) if the agreed file is not there yet. */
  loadRules: () => Rules;
  now?: () => Date;
};

const buildBody = z.object({ target: z.string() });

export function registerEvidenceRoutes(app: FastifyInstance, deps: EvidenceRouteDeps) {
  app.post("/evidence/build", async (req) => {
    const body = buildBody.safeParse(req.body);
    if (!body.success || !isAddress(body.data.target) || getAddress(body.data.target) === ZeroAddress) {
      throw new UserError("Body must be {\"target\": \"<valid, non-zero wallet address>\"}");
    }
    const target = getAddress(body.data.target);
    const rules = deps.loadRules();

    let analysis;
    try {
      analysis = await fetchAnalysis(deps.graph.baseUrl, target, deps.graph.timeoutMs);
    } catch (e) {
      throw graphErrorToUserError(e);
    }
    if (analysis.target !== target) {
      throw new UserError("The Graph Service answered for a different wallet than the one requested. Nothing was built.", 502);
    }
    return createEvidence({ llm: deps.llm, rules, dataSource: deps.dataSource, db: deps.db, now: deps.now }, analysis);
  });

  app.get("/evidence/:hash", async (req) => {
    const { hash } = req.params as { hash: string };
    if (!/^0x[0-9a-fA-F]{64}$/.test(hash)) throw new UserError("hash must be 0x followed by 64 hex characters");
    const bundle = deps.db.getEvidence(hash);
    if (!bundle) throw new UserError("No evidence stored for that hash", 404);
    return { hash, bundle };
  });
}
