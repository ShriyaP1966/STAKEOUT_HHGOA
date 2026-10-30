// PROPOSED, NOT AGREED WITH PERSON 1. This file and docs/graph-analysis-proposal.md describe what the backend
// would like the Graph Service to return. Do not treat it as the real contract until Person 1's
// shared/schemas/analysis.json exists and replaces it. It is the ONLY place the shape and routes are written,
// so a changed schema is a change to this file (plus graphClient.ts for the routes).
import { z } from "zod";
import { getAddress, isAddress } from "ethers";
import { clusterIdSchema } from "../clusterId.js";

const address = z.string().refine((v) => isAddress(v), "must be a valid address").transform((v) => getAddress(v));

/** PROPOSED route on the Graph Service for one wallet. */
export const proposedAnalysisPath = (target: string) => `/analysis/${target}`;
/** PROPOSED route listing wallets that might join a confirmed cluster. */
export const proposedLinkCandidatesPath = (clusterId: string) => `/clusters/${clusterId}/link-candidates`;

/**
 * PROPOSED: why a wallet might be Linked. The graph decides these facts (they are behavior, not opinion);
 * the verifier only applies the linking rule in AGENTS.md section 4 to them.
 */
export const linkEvidenceSchema = z.object({
  /** sends funds into the cluster or its exit points in a repeated, structured way */
  repeatedStructuredOutflowToCluster: z.boolean(),
  /** received funds from the cluster */
  fundedByCluster: z.boolean(),
  /** forwards funds onward the way a cluster member does */
  forwardsOnwardLikeMember: z.boolean(),
  /** a known victim of the cluster: never linked */
  isKnownVictim: z.boolean(),
  /** paid the cluster once and nothing more: never linked */
  isOneOffPayer: z.boolean(),
});
export type LinkEvidence = z.infer<typeof linkEvidenceSchema>;

export const analysisProposalSchema = z.object({
  target: address,
  /** bytes32 from the graph, or null if the wallet is not in a cluster. For a link candidate: the cluster it would join. */
  clusterId: clusterIdSchema.nullable(),
  behaviorScore: z.number(),
  /** passed through unmodified into the evidence bundle */
  signals: z.array(z.looseObject({ name: z.string() })),
  /** the numbers behind the score; the evidence schema (shared/) has an optional `metrics` field (633405d) and null metric values are dropped by the builder (4428e9b) */
  metrics: z.array(z.looseObject({ name: z.string() })).optional(),
  members: z.array(address),
  exitPoints: z.array(address),
  unrelatedReporterCount: z.number().int().nonnegative(),
  dataSource: z.enum(["synthetic", "testnet"]),
  /** present only when the wallet is being judged as a link candidate */
  link: linkEvidenceSchema.optional(),
  /** the graph's own link verdict and its reason; recorded in the decision inputs, never used to decide */
  linked: z.boolean().optional(),
  reason: z.string().optional(),
});
export type AnalysisProposal = z.infer<typeof analysisProposalSchema>;

export const linkCandidatesSchema = z.object({
  clusterId: clusterIdSchema,
  candidates: z.array(address),
});
export type LinkCandidates = z.infer<typeof linkCandidatesSchema>;
