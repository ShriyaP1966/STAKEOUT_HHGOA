// DEV ONLY. Shared by the stand-in Graph Service (`npm run dev:graph-stub`) and the fixture generator (`npm run dev:graph-fixture`).
// This is NOT Person 1's Graph Service. It answers only the PROPOSED routes and shapes in graphAnalysisProposal.ts and
// docs/graph-analysis-proposal.md, from a fixture file. Every address and cluster id comes from the seed file at run time.
import { createServer, type Server } from "node:http";
import { getAddress, isAddress, solidityPackedKeccak256 } from "ethers";
import { z } from "zod";
import { clusterIdSchema } from "../clusterId.js";
import type { Rules } from "../config.js";
import {
  analysisProposalSchema, linkCandidatesSchema, proposedAnalysisPath, proposedLinkCandidatesPath,
  type AnalysisProposal, type LinkCandidates,
} from "../verifier/graphAnalysisProposal.js";

const address = z.string().refine((v) => isAddress(v), "must be a valid address");

/** The parts of deployments/localhost-seed.json the generator needs (other keys are ignored). */
export const seedSchema = z.object({
  dataSource: z.enum(["synthetic", "testnet"]),
  chainId: z.number().int().positive(),
  clusterId: clusterIdSchema,
  targets: z.object({ flagged: address, challenged: address, member: address, exitPoint: address, linked: address }),
  actors: z.record(z.string(), z.string()),
});
export type Seed = z.infer<typeof seedSchema>;

export const fixtureSchema = z.object({
  dataSource: z.enum(["synthetic", "testnet"]),
  chainId: z.number().int().positive(),
  generatedAt: z.string(),
  analyses: z.array(analysisProposalSchema),
  linkCandidates: z.array(linkCandidatesSchema),
});
export type Fixture = z.infer<typeof fixtureSchema>;

const signals = (count: number) => Array.from({ length: count }, (_, i) => ({ name: `synthetic-signal-${i + 1}`, synthetic: true }));

/**
 * Builds the fixture from the seed and the rules file. Strong behavior for the flagged target (just above the rules'
 * threshold and minimum signals), weak behavior for the challenged one (just below), and link facts for the three
 * addresses that are already in a cluster on chain. Nothing is typed here: every value is derived from the two inputs.
 */
export function buildFixture(seed: Seed, rules: Rules, now: Date): Fixture {
  const t = Object.fromEntries(Object.entries(seed.targets).map(([k, v]) => [k, getAddress(v)])) as Seed["targets"];
  const reporters = Object.keys(seed.actors).filter((k) => k.startsWith("reporter")).length;
  // The seed's cluster already holds member and exit point on chain, so the flagged wallet gets its own new cluster id
  // (derived from the seed's id and its address) or a live confirm would collide with the existing cluster.
  const flaggedCluster = solidityPackedKeccak256(["bytes32", "address"], [seed.clusterId, t.flagged]);

  const base = { unrelatedReporterCount: reporters, dataSource: seed.dataSource };
  const linkBase = { isKnownVictim: false, isOneOffPayer: false };
  const inSeedCluster = (target: string, link: NonNullable<AnalysisProposal["link"]>) => ({
    target, clusterId: seed.clusterId, behaviorScore: rules.behaviorThreshold + 1, signals: signals(rules.minSignals + 1),
    members: [t.member], exitPoints: [t.exitPoint], ...base, link,
  });

  const analyses = [
    {
      target: t.flagged, clusterId: flaggedCluster, behaviorScore: rules.behaviorThreshold + 1, signals: signals(rules.minSignals + 1),
      members: [t.flagged], exitPoints: [], ...base,
    },
    {
      target: t.challenged, clusterId: null, behaviorScore: rules.behaviorThreshold - 1, signals: signals(Math.max(rules.minSignals - 1, 0)),
      members: [], exitPoints: [], ...base,
    },
    inSeedCluster(t.member, { ...linkBase, repeatedStructuredOutflowToCluster: false, fundedByCluster: true, forwardsOnwardLikeMember: true }),
    inSeedCluster(t.exitPoint, { ...linkBase, repeatedStructuredOutflowToCluster: false, fundedByCluster: true, forwardsOnwardLikeMember: true }),
    inSeedCluster(t.linked, { ...linkBase, repeatedStructuredOutflowToCluster: true, fundedByCluster: false, forwardsOnwardLikeMember: false }),
  ];
  const candidates = [t.member, t.exitPoint, t.linked];
  return fixtureSchema.parse({
    dataSource: seed.dataSource, chainId: seed.chainId, generatedAt: now.toISOString(), analyses,
    linkCandidates: [{ clusterId: seed.clusterId, candidates }, { clusterId: flaggedCluster, candidates }],
  });
}

const sameId = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** An HTTP server answering only the two PROPOSED GET routes from the fixture. Not started; the caller listens. */
export function createStubServer(fixture: Fixture): Server {
  const analysisPrefix = proposedAnalysisPath("");
  return createServer((req, res) => {
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    if (req.method !== "GET") return send(405, { error: "only GET is supported" });
    const path = new URL(req.url ?? "/", "http://stub.invalid").pathname;

    if (path.startsWith(analysisPrefix)) {
      const wanted = decodeURIComponent(path.slice(analysisPrefix.length));
      if (!isAddress(wanted)) return send(400, { error: "not a valid address" });
      const found = fixture.analyses.find((a) => sameId(a.target, wanted));
      return found ? send(200, found) : send(404, { error: "no analysis in the fixture for this address (dev stand-in)" });
    }
    const cluster = fixture.linkCandidates.find((c) => sameId(proposedLinkCandidatesPath(c.clusterId), path));
    if (cluster) return send(200, cluster satisfies LinkCandidates);
    return send(404, { error: "unknown route (dev stand-in)" });
  });
}
