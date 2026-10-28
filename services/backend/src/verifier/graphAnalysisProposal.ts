// PROPOSAL, NOT AGREED WITH PERSON 1. This file and docs/graph-analysis-proposal.md describe what the verifier
// would like the Graph Service to return. Do not treat it as the real contract until Person 1's
// shared/schemas/analysis.json exists and replaces it.
import { z } from "zod";
import { getAddress, isAddress } from "ethers";
import { clusterIdSchema } from "../clusterId.js";

const address = z.string().refine((v) => isAddress(v), "must be a valid address").transform((v) => getAddress(v));

/** Proposed route on the Graph Service for one wallet. */
export const proposedAnalysisPath = (target: string) => `/analysis/${target}`;

export const analysisProposalSchema = z.object({
  target: address,
  /** bytes32 from the graph, or null if the wallet is not in a cluster */
  clusterId: clusterIdSchema.nullable(),
  behaviorScore: z.number(),
  /** passed through unmodified into the evidence bundle */
  signals: z.array(z.looseObject({ name: z.string() })),
  members: z.array(address),
  exitPoints: z.array(address),
  unrelatedReporterCount: z.number().int().nonnegative(),
  dataSource: z.enum(["synthetic", "testnet"]),
});
export type AnalysisProposal = z.infer<typeof analysisProposalSchema>;
