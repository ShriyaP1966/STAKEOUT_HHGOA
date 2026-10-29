// The verifier's decisions. PROPOSED rules: the fields of config/rules.json and the shape of the Graph Service
// analysis are not agreed yet (docs/rules-proposal.md, docs/graph-analysis-proposal.md). Everything numeric comes
// from the rules file or the analysis; no threshold, score or address is written in this file.
//
// The AI plays no part here. It only writes the summary inside the evidence bundle, which no decision reads.
import { getAddress } from "ethers";
import type { Rules } from "../config.js";
import { GraphServiceError } from "./graphClient.js";
import type { PromotedEvent } from "./contractClient.js";
import type { AnalysisProposal } from "./graphAnalysisProposal.js";

/** Labels written to the decision log so a judge can see which rule decided. */
export const RULE = {
  behaviorPassed: "B:behavior-passed",
  behaviorThreshold: "B:behaviorThreshold",
  minSignals: "B:minSignals",
  graphNoData: "graph:no-data",
  noCluster: "cluster:none",
  targetNotMember: "cluster:target-not-member",
  linkStructuredOutflow: "link:structured-outflow",
  linkFundedAndForwards: "link:funded-and-forwards",
  linkInsufficient: "link:inbound-only-or-insufficient",
  linkKnownVictim: "link:known-victim",
  linkOneOffPayer: "link:one-off-payer",
  linkOtherCluster: "link:other-cluster",
  linkNoEvidence: "link:no-evidence",
} as const;

/** What the decision logic hands to the chain layer. */
export type DecisionPlan =
  | { action: "confirm"; clusterId: string; members: string[]; exitPoints: string[]; evidenceHash: string; rule: string; reason: string; inputs: unknown }
  | { action: "link"; target: string; clusterId: string; evidenceHash: string; rule: string; reason: string; inputs: unknown }
  | { action: "refuse"; kind: "confirm" | "link"; rule: string; reason: string; inputs: unknown; evidenceHash: string | null };

export type DecideDeps = {
  rules: Rules;
  fetchAnalysis: (target: string) => Promise<AnalysisProposal>;
  /** Builds, hashes and stores the evidence bundle; only called when a confirm or link is about to be proposed. */
  createEvidence: (analysis: AnalysisProposal) => Promise<{ hash: string }>;
};

function inputsOf(a: AnalysisProposal, rules: Rules) {
  return {
    behaviorScore: a.behaviorScore,
    signalCount: a.signals.length,
    unrelatedReporterCount: a.unrelatedReporterCount,
    // Reports only add confidence. This number is recorded for the judges; it is never compared with the threshold.
    confidenceWithReports: a.behaviorScore + rules.reportConfidenceBoostPerReporter * a.unrelatedReporterCount,
    thresholdsUsed: { ...rules },
    clusterId: a.clusterId,
    dataSource: a.dataSource,
  };
}

/** The graph answered 404 (no data for this wallet): a recorded refusal, not a failure to retry. Other errors are rethrown. */
async function fetchOrNoData(deps: DecideDeps, target: string): Promise<AnalysisProposal | { noData: string }> {
  try {
    return await deps.fetchAnalysis(target);
  } catch (e) {
    if (e instanceof GraphServiceError && e.kind === "not-found") return { noData: e.message };
    throw e;
  }
}

function noDataPlan(kind: "confirm" | "link", target: string, detail: string): DecisionPlan {
  return {
    action: "refuse", kind, rule: RULE.graphNoData, evidenceHash: null, inputs: { target },
    reason: `the graph has no data for this wallet, so there is no behavior to judge and nothing is ${kind === "confirm" ? "confirmed" : "linked"} (${detail})`,
  };
}

function sameWallet(a: string, b: string) {
  return getAddress(a) === getAddress(b);
}

/**
 * Should the flagged wallet be confirmed as part of a scam cluster?
 * Rule B (required): the wallet's OWN behavior must reach behaviorThreshold with at least minSignals signals.
 * Rule A (reports) can only add confidence, so no number of reports can confirm a wallet whose behavior fails.
 */
export async function decideConfirm(deps: DecideDeps, target: string): Promise<DecisionPlan> {
  const { rules } = deps;
  const fetched = await fetchOrNoData(deps, target);
  if ("noData" in fetched) return noDataPlan("confirm", target, fetched.noData);
  const analysis = fetched;
  if (!sameWallet(analysis.target, target)) throw new Error("The Graph Service answered for a different wallet than the one asked about.");
  const inputs = inputsOf(analysis, rules);
  const refuse = (rule: string, reason: string): DecisionPlan => ({ action: "refuse", kind: "confirm", rule, reason, inputs, evidenceHash: null });

  if (!(analysis.behaviorScore >= rules.behaviorThreshold)) {
    return refuse(
      RULE.behaviorThreshold,
      `behavior score ${analysis.behaviorScore} is below the threshold ${rules.behaviorThreshold}; ${analysis.unrelatedReporterCount} unrelated reporter(s) can only add confidence, they cannot replace behavior`,
    );
  }
  if (analysis.signals.length < rules.minSignals) {
    return refuse(RULE.minSignals, `${analysis.signals.length} behavior signal(s) is fewer than the required minimum ${rules.minSignals}`);
  }
  if (analysis.clusterId === null) return refuse(RULE.noCluster, "behavior passes but the graph reports no cluster for this wallet, so there is nothing to confirm");
  if (!analysis.members.some((m) => sameWallet(m, target))) {
    return refuse(RULE.targetNotMember, "the graph's cluster member list does not include the flagged wallet, so the data is inconsistent and nothing is confirmed");
  }

  const { hash } = await deps.createEvidence(analysis);
  return {
    action: "confirm",
    clusterId: analysis.clusterId,
    members: analysis.members,
    exitPoints: analysis.exitPoints,
    evidenceHash: hash,
    rule: RULE.behaviorPassed,
    reason:
      `behavior score ${analysis.behaviorScore} meets the threshold ${rules.behaviorThreshold} and ${analysis.signals.length} signal(s) meet the minimum ${rules.minSignals}; ` +
      `${analysis.unrelatedReporterCount} unrelated reporter(s) added confidence only`,
    inputs,
  };
}

/** The watcher's entry point for a Promoted flag. */
export function decide(deps: DecideDeps, event: PromotedEvent): Promise<DecisionPlan> {
  return decideConfirm(deps, event.target);
}

/**
 * Should this wallet be Linked to a confirmed cluster? The linking rule (AGENTS.md section 4):
 * inbound funding alone is ignored (dusting). Linked only if the wallet sends funds into the cluster or its exit points in a
 * repeated, structured way, OR is funded by the cluster AND then forwards onward like a member. Known victims and one-off
 * payers are never linked. The graph supplies these facts; the confirm thresholds play no part.
 */
export async function decideLink(deps: DecideDeps, target: string, clusterId: string): Promise<DecisionPlan> {
  const fetched = await fetchOrNoData(deps, target);
  if ("noData" in fetched) return noDataPlan("link", target, fetched.noData);
  const analysis = fetched;
  if (!sameWallet(analysis.target, target)) throw new Error("The Graph Service answered for a different wallet than the one asked about.");
  const inputs = { ...inputsOf(analysis, deps.rules), link: analysis.link ?? null, graphLinked: analysis.linked ?? null, graphReason: analysis.reason ?? null };
  const refuse = (rule: string, reason: string): DecisionPlan => ({ action: "refuse", kind: "link", rule, reason, inputs, evidenceHash: null });

  const link = analysis.link;
  if (!link) return refuse(RULE.linkNoEvidence, "the graph gave no link evidence for this wallet");
  if (analysis.clusterId === null || analysis.clusterId.toLowerCase() !== clusterId.toLowerCase()) {
    return refuse(RULE.linkOtherCluster, "the graph's analysis is for a different cluster than the one being extended");
  }
  if (link.isKnownVictim) return refuse(RULE.linkKnownVictim, "a known victim of the cluster is never linked, whatever its transfers look like");
  if (link.isOneOffPayer) return refuse(RULE.linkOneOffPayer, "a one-off payer is never linked");

  const structured = link.repeatedStructuredOutflowToCluster;
  const fundedAndForwards = link.fundedByCluster && link.forwardsOnwardLikeMember;
  if (!structured && !fundedAndForwards) {
    return refuse(RULE.linkInsufficient, "inbound funding alone is ignored; the wallet neither sends funds into the cluster in a repeated, structured way nor is funded by it and forwards onward like a member");
  }

  const { hash } = await deps.createEvidence(analysis);
  return {
    action: "link",
    target,
    clusterId,
    evidenceHash: hash,
    rule: structured ? RULE.linkStructuredOutflow : RULE.linkFundedAndForwards,
    reason: structured
      ? "the wallet sends funds into the cluster or its exit points in a repeated, structured way"
      : "the wallet is funded by the cluster and then forwards onward like a member",
    inputs,
  };
}
