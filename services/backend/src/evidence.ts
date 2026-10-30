import { z } from "zod";
import { hashBundle } from "../../../shared/hash/index.js";
import type { Rules } from "./config.js";
import type { Db } from "./db.js";
import { UserError } from "./errors.js";
import type { Llm } from "./llm.js";
import { buildSummary } from "./summary.js";
import type { AnalysisProposal } from "./verifier/graphAnalysisProposal.js";

/** Version of shared/schemas/evidence.json that this builder writes. */
export const EVIDENCE_SCHEMA_VERSION = 1;

const address = z.string().regex(/^0x[a-fA-F0-9]{40}$/);

/** Mirror of shared/schemas/evidence.json (read only, owned by Person 2). evidence-selftest checks the two cannot drift. */
export const evidenceBundleSchema = z.strictObject({
  schemaVersion: z.number().int().min(1),
  target: address,
  clusterId: z.string().nullable(),
  behaviorScore: z.number(),
  signals: z.array(z.record(z.string(), z.unknown())),
  /** optional: bundles made before this field existed have none and must keep their hash, so an absent field is never written as undefined */
  metrics: z.array(z.strictObject({ name: z.string(), value: z.number() })).optional(),
  members: z.array(address),
  exitPoints: z.array(address),
  unrelatedReporterCount: z.number().int().min(0),
  thresholdsUsed: z.record(z.string(), z.unknown()),
  aiSummary: z.strictObject({ text: z.string(), source: z.enum(["llm", "template"]) }),
  dataSource: z.enum(["synthetic", "testnet"]),
  createdAt: z.iso.datetime(),
});
export type EvidenceBundle = z.infer<typeof evidenceBundleSchema>;

export type EvidenceDeps = {
  llm: Llm;
  rules: Rules;
  /** From DATA_SOURCE in the config. The graph's own label must agree with it. */
  dataSource: "synthetic" | "testnet";
  db: Db;
  now?: () => Date;
};

/** The graph's metrics, in the order it returned them; undefined when it sent none. A malformed entry is refused, not dropped. */
function metricsOf(analysis: AnalysisProposal): EvidenceBundle["metrics"] {
  if (analysis.metrics === undefined) return undefined;
  const parsed = evidenceBundleSchema.shape.metrics.safeParse(analysis.metrics);
  if (!parsed.success) {
    throw new UserError(`The Graph Service sent metrics that are not a list of { name, value } with a numeric value: ${parsed.error.issues[0].message}`, 502);
  }
  return parsed.data;
}

/**
 * Builds, hashes and stores the evidence bundle for one graph analysis.
 * The AI is asked only to EXPLAIN the returned facts; nothing it writes decides, changes or is used by any decision.
 */
export async function createEvidence(deps: EvidenceDeps, analysis: AnalysisProposal): Promise<{ hash: string; bundle: EvidenceBundle }> {
  if (analysis.dataSource !== deps.dataSource) {
    throw new UserError(
      `The Graph Service labels this data "${analysis.dataSource}" but DATA_SOURCE is "${deps.dataSource}". Refusing to mix them.`,
      502,
    );
  }
  // Only graph facts go to the AI: no thresholds, no timestamps, nothing that could invite a verdict.
  const facts = {
    target: analysis.target,
    clusterId: analysis.clusterId,
    behaviorScore: analysis.behaviorScore,
    signals: analysis.signals,
    members: analysis.members,
    exitPoints: analysis.exitPoints,
    unrelatedReporterCount: analysis.unrelatedReporterCount,
    dataSource: analysis.dataSource,
  };
  const aiSummary = await buildSummary(deps.llm, facts);

  const metrics = metricsOf(analysis);
  const bundle = evidenceBundleSchema.parse({
    schemaVersion: EVIDENCE_SCHEMA_VERSION,
    ...facts,
    ...(metrics ? { metrics } : {}),
    thresholdsUsed: { ...deps.rules },
    aiSummary,
    createdAt: (deps.now?.() ?? new Date()).toISOString(),
  });
  const hash = hashBundle(bundle);
  deps.db.saveEvidence(hash, bundle);
  return { hash, bundle };
}
