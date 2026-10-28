// Self-test for the verifier's decision logic (decide / decideLink), the decision log, and the watcher's link flow.
// Test-only stand-ins: a rules fixture (NOT the team's thresholds), generated analyses, a stub AI, a stub chain,
// an in-memory database. None is used at runtime. Usage: npm run decide-selftest
import { Wallet, hexlify, randomBytes } from "ethers";
import { Role } from "../../../../shared/enums.js";
import { hashBundle } from "../../../../shared/hash/index.js";
import type { Rules } from "../config.js";
import { openDb, type Db } from "../db.js";
import { createEvidence } from "../evidence.js";
import type { ChatRequest, Llm } from "../llm.js";
import { applyPlan } from "../verifier/actions.js";
import type { ConfirmedEvent, LiveFlag, PromotedEvent, StakeoutClient, WriteResult } from "../verifier/contractClient.js";
import { decide, decideLink, RULE, type DecideDeps, type DecisionPlan } from "../verifier/decide.js";
import type { AnalysisProposal } from "../verifier/graphAnalysisProposal.js";
import { startWatcher } from "../verifier/watcher.js";

let failed = false;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}: ${name}${detail ? ` (${detail})` : ""}`);
  if (!ok) failed = true;
};
const addr = () => Wallet.createRandom().address;
const bytes32 = () => hexlify(randomBytes(32));

// ---- rules fixture: arbitrary numbers, only here
const baseRules: Rules = { behaviorThreshold: 3, minSignals: 2, reportConfidenceBoostPerReporter: 1, confirmationsToWait: 1 };

type LinkFlags = NonNullable<AnalysisProposal["link"]>;
const noLink: LinkFlags = { repeatedStructuredOutflowToCluster: false, fundedByCluster: false, forwardsOnwardLikeMember: false, isKnownVictim: false, isOneOffPayer: false };

function analysis(target: string, over: Partial<AnalysisProposal> = {}): AnalysisProposal {
  return {
    target, clusterId: bytes32(), behaviorScore: 7.5,
    signals: [{ name: "rapid_split", count: 12 }, { name: "merge", count: 4 }, { name: "forward", count: 3 }],
    members: [target, addr(), addr()], exitPoints: [addr()], unrelatedReporterCount: 5, dataSource: "synthetic", ...over,
  };
}

function harness(rules: Rules, analyses: Map<string, AnalysisProposal>) {
  const db = openDb(":memory:");
  const llmRequests: ChatRequest[] = [];
  const llm: Llm = {
    model: "stub",
    complete: async (r) => {
      llmRequests.push(r);
      const f = JSON.parse(r.user);
      return `Wallet ${f.target} scored ${f.behaviorScore} with ${f.members.length} members.`;
    },
  };
  const graphCalls: string[] = [];
  const deps: DecideDeps = {
    rules,
    fetchAnalysis: async (t) => {
      graphCalls.push(t);
      const a = analyses.get(t);
      if (!a) throw new Error(`stub graph has no analysis for ${t}`);
      return a;
    },
    createEvidence: (a) => createEvidence({ llm, rules, dataSource: "synthetic", db }, a),
  };
  return { db, deps, llmRequests, graphCalls };
}

const promoted = (target: string): PromotedEvent => ({
  flagId: 1n, reportId: 1n, target, flagger: addr(), stake: 1n, expiresAt: 0n, blockNumber: 10, blockHash: bytes32(), txHash: bytes32(), logIndex: 0,
});

const plan = async (p: Promise<DecisionPlan>) => p;

async function confirmCases() {
  console.log("\n## confirm: the wallet's own behavior decides; reports only add confidence");
  const scam = addr();
  const h = harness(baseRules, new Map([[scam, analysis(scam)]]));
  let p = await plan(decide(h.deps, promoted(scam)));
  check("a scam-cluster wallet whose behavior passes is confirmed", p.action === "confirm");
  if (p.action === "confirm") {
    const a = analysis(scam);
    check("the plan carries the graph's cluster, members and exit points", p.clusterId.length === 66 && p.members.length === 3 && p.exitPoints.length === 1 && p.members.includes(scam));
    const stored = h.db.getEvidence(p.evidenceHash);
    check("evidenceHash is the hash of the stored evidence bundle (so it will equal the hash on-chain)", stored !== null && hashBundle(stored) === p.evidenceHash, `${p.evidenceHash.slice(0, 8)}...`);
    check("the stored bundle is for this wallet and records the rules applied", (stored as { target: string; thresholdsUsed: Rules }).target === scam && JSON.stringify((stored as { thresholdsUsed: Rules }).thresholdsUsed) === JSON.stringify(baseRules));
    const inputs = p.inputs as Record<string, unknown>;
    check("the log inputs show the score, signal count, reporters and the thresholds used", inputs.behaviorScore === a.behaviorScore && inputs.signalCount === 3 && inputs.unrelatedReporterCount === 5 && JSON.stringify(inputs.thresholdsUsed) === JSON.stringify(baseRules), JSON.stringify(Object.keys(inputs)));
    check("reports only add confidence: confidence = score + boost x reporters, recorded separately", inputs.confidenceWithReports === a.behaviorScore + baseRules.reportConfidenceBoostPerReporter * 5);
    check("the reason names the rule and the numbers", p.rule === RULE.behaviorPassed && /7\.5/.test(p.reason) && /3/.test(p.reason), p.reason);
  }

  // framed wallet: many unrelated reports, weak behavior
  const framed = addr();
  const hf = harness(baseRules, new Map([[framed, analysis(framed, { behaviorScore: 0.4, unrelatedReporterCount: 30 })]]));
  p = await decide(hf.deps, promoted(framed));
  check("FRAMED wallet (30 reports, weak behavior): refused, rule B:behaviorThreshold", p.action === "refuse" && p.rule === RULE.behaviorThreshold);
  check("the refusal reason says behavior is below the threshold, with both numbers", p.action === "refuse" && /below/i.test(p.reason) && /0\.4/.test(p.reason) && /3/.test(p.reason), p.action === "refuse" ? p.reason : "");
  check("a refusal builds no evidence and spends no AI call", hf.llmRequests.length === 0);

  // reports alone never confirm, whatever the boost
  const reportsOnly = addr();
  const huge: Rules = { ...baseRules, reportConfidenceBoostPerReporter: 1e9 };
  const hr = harness(huge, new Map([[reportsOnly, analysis(reportsOnly, { behaviorScore: 0, unrelatedReporterCount: 1000 })]]));
  p = await decide(hr.deps, promoted(reportsOnly));
  check("REPORTS ALONE never confirm (score 0, 1000 reporters, enormous boost)", p.action === "refuse" && p.rule === RULE.behaviorThreshold);
  check("...even though the reports would make the confidence huge", p.action === "refuse" && (p.inputs as { confidenceWithReports: number }).confidenceWithReports >= 1e12);

  const thin = addr();
  p = await decide(harness(baseRules, new Map([[thin, analysis(thin, { signals: [{ name: "one" }] })]])).deps, promoted(thin));
  check("enough score but too few signals: refused, rule B:minSignals", p.action === "refuse" && p.rule === RULE.minSignals);

  const orphan = addr();
  p = await decide(harness(baseRules, new Map([[orphan, analysis(orphan, { clusterId: null })]])).deps, promoted(orphan));
  check("behavior passes but the graph reports no cluster: refused, rule cluster:none", p.action === "refuse" && p.rule === RULE.noCluster);
  const stranger = addr();
  p = await decide(harness(baseRules, new Map([[stranger, analysis(stranger, { members: [addr(), addr()] })]])).deps, promoted(stranger));
  check("the target is not among the cluster members: refused, rule cluster:target-not-member", p.action === "refuse" && p.rule === RULE.targetNotMember);

  let threw = "";
  try { await decide(harness(baseRules, new Map()).deps, promoted(addr())); } catch (e) { threw = (e as Error).message; }
  check("a graph failure is thrown, not turned into a decision", /stub graph has no analysis/.test(threw));

  console.log("\n## changing a threshold in the rules changes the decision (nothing is hardcoded)");
  const edge = addr();
  const score = 5;
  const analysesEdge = new Map([[edge, analysis(edge, { behaviorScore: score })]]);
  const at = async (rules: Rules) => (await decide(harness(rules, analysesEdge).deps, promoted(edge))).action;
  check("threshold below the score: confirm", (await at({ ...baseRules, behaviorThreshold: score - 1 })) === "confirm");
  check("threshold equal to the score: confirm (the score must be at least the threshold)", (await at({ ...baseRules, behaviorThreshold: score })) === "confirm");
  check("threshold just above the score: refuse", (await at({ ...baseRules, behaviorThreshold: score + 0.001 })) === "refuse");
  check("minSignals raised above the signal count: refuse", (await at({ ...baseRules, minSignals: 4 })) === "refuse");
  check("minSignals equal to the signal count: confirm", (await at({ ...baseRules, minSignals: 3 })) === "confirm");
}

async function linkCases() {
  console.log("\n## link: the linking rule from AGENTS.md section 4");
  const cluster = bytes32();
  const run = async (flags: Partial<LinkFlags> | null, over: Partial<AnalysisProposal> = {}, rules = baseRules) => {
    const t = addr();
    const a = analysis(t, { clusterId: cluster, behaviorScore: 0.1, link: flags === null ? undefined : { ...noLink, ...flags }, ...over });
    const h = harness(rules, new Map([[t, a]]));
    return { p: await decideLink(h.deps, t, cluster), h, t };
  };

  let r = await run({ repeatedStructuredOutflowToCluster: true });
  check("ROTATED wallet (repeated, structured outflow into the cluster): linked", r.p.action === "link" && r.p.rule === RULE.linkStructuredOutflow);
  if (r.p.action === "link") {
    check("the link plan names the cluster and the evidence hash of the stored bundle", r.p.clusterId === cluster && hashBundle(r.h.db.getEvidence(r.p.evidenceHash)) === r.p.evidenceHash);
  }
  r = await run({ fundedByCluster: true, forwardsOnwardLikeMember: true });
  check("funded by the cluster AND forwards onward like a member: linked", r.p.action === "link" && r.p.rule === RULE.linkFundedAndForwards);
  r = await run({ fundedByCluster: true });
  check("DUSTED critic (inbound funding only): NOT linked, rule link:inbound-only", r.p.action === "refuse" && r.p.rule === RULE.linkInsufficient);
  check("...and the reason says inbound funding alone is ignored", r.p.action === "refuse" && /inbound/i.test(r.p.reason), r.p.action === "refuse" ? r.p.reason : "");
  check("a refusal builds no evidence and spends no AI call", r.h.llmRequests.length === 0);
  r = await run({ forwardsOnwardLikeMember: true });
  check("forwards onward but was never funded by the cluster: NOT linked", r.p.action === "refuse" && r.p.rule === RULE.linkInsufficient);
  r = await run({});
  check("no linking behavior at all: NOT linked", r.p.action === "refuse" && r.p.rule === RULE.linkInsufficient);
  r = await run({ isKnownVictim: true, repeatedStructuredOutflowToCluster: true, fundedByCluster: true, forwardsOnwardLikeMember: true });
  check("VICTIM wallet: NEVER linked, even if its flows look like a member's", r.p.action === "refuse" && r.p.rule === RULE.linkKnownVictim);
  r = await run({ isOneOffPayer: true, repeatedStructuredOutflowToCluster: true });
  check("one-off payer: NEVER linked", r.p.action === "refuse" && r.p.rule === RULE.linkOneOffPayer);
  r = await run({ repeatedStructuredOutflowToCluster: true }, { clusterId: bytes32() });
  check("the analysis is for a different cluster: refused, rule link:other-cluster", r.p.action === "refuse" && r.p.rule === RULE.linkOtherCluster);
  r = await run(null);
  check("the graph gave no link evidence: refused, rule link:no-evidence", r.p.action === "refuse" && r.p.rule === RULE.linkNoEvidence);

  const strict: Rules = { ...baseRules, behaviorThreshold: 1e6, minSignals: 99 };
  const a1 = await run({ repeatedStructuredOutflowToCluster: true });
  const a2 = await run({ repeatedStructuredOutflowToCluster: true }, {}, strict);
  check("linking is decided by flows, not by the confirm thresholds (changing them does not change a link)", a1.p.action === "link" && a2.p.action === "link");
  check("the log inputs for a link show the graph's flags", a1.p.action === "link" && (a1.p.inputs as { link: LinkFlags }).link.repeatedStructuredOutflowToCluster === true);
}

async function logging() {
  console.log("\n## decisions are logged through the existing decision log (dry run, sent, refused)");
  const scam = addr();
  const h = harness(baseRules, new Map([[scam, analysis(scam)]]));
  const confirmPlan = await decide(h.deps, promoted(scam));
  const refusePlan = await decide(harness(baseRules, new Map([[scam, analysis(scam, { behaviorScore: 0.1 })]])).deps, promoted(scam));
  const liveFlag: LiveFlag = { flagId: 1n, expiresAt: 0n, challenged: false, live: true };
  const reader = {
    maxMembersPerCall: async () => 10, clusterRole: async () => Role.None, clusterExists: async () => true,
    liveFlag: async () => liveFlag,
  };
  const writer = (dry: boolean) => ({
    confirm: async (): Promise<WriteResult> => ({ txHash: dry ? null : bytes32(), dryRun: dry }),
    link: async (): Promise<WriteResult> => ({ txHash: dry ? null : bytes32(), dryRun: dry }),
    explainRevert: (e: unknown) => String(e),
  });
  const rows = async (p: DecisionPlan, dry: boolean) => {
    const db: Db = openDb(":memory:");
    await applyPlan({ reader, writer: writer(dry), db }, scam, p);
    return db.listDecisions(5)[0] as Record<string, unknown>;
  };
  let row = await rows(confirmPlan, true);
  check("dry run: skipped, no tx hash, reason says dry run and carries the decision reason", row.outcome === "skipped" && row.tx_hash === null && /dry run/.test(String(row.reason)) && /behavior score/.test(String(row.reason)), String(row.reason).slice(0, 80));
  row = await rows(confirmPlan, false);
  check("sent: outcome sent, a tx hash, kind confirm, the rule and the evidence hash", row.outcome === "sent" && row.kind === "confirm" && typeof row.tx_hash === "string" && row.rule === RULE.behaviorPassed && typeof row.evidence_hash === "string");
  row = await rows(refusePlan, true);
  check("refused: outcome refused with the rule, the reason and the inputs", row.outcome === "refused" && row.rule === RULE.behaviorThreshold && /below/.test(String(row.reason)) && typeof row.inputs === "object");
  check("kind and outcome are only the agreed values", ["confirm", "link"].includes(String(row.kind)) && ["sent", "refused", "skipped"].includes(String(row.outcome)));
}

function fakeConfirmed(clusterId: string, members: string[], exitPoints: string[], block: number): ConfirmedEvent {
  return { clusterId, members, exitPoints, evidenceHash: bytes32(), blockNumber: block, blockHash: bytes32(), txHash: bytes32(), logIndex: 0 };
}

async function watcherLinks() {
  console.log("\n## watcher: a Confirmed event triggers link decisions for the graph's candidates (stand-in chain)");
  const cluster = bytes32();
  const [m1, rotated, dusted, victim, inCluster] = [addr(), addr(), addr(), addr(), addr()];
  const flagsOf: Record<string, Partial<LinkFlags>> = {
    [rotated]: { repeatedStructuredOutflowToCluster: true },
    [dusted]: { fundedByCluster: true },
    [victim]: { isKnownVictim: true, repeatedStructuredOutflowToCluster: true },
  };
  const confirmedEvent = fakeConfirmed(cluster, [m1], [inCluster], 5);

  const run = async (db: Db, opts: { failFor?: string; sendForReal?: boolean; stopAfterMs?: number } = {}) => {
    const roles = new Map<string, Role>([[inCluster, Role.ExitPoint], [m1, Role.Member]]);
    const linkCalls: string[] = [];
    const client = {
      promotedBetween: async () => [],
      confirmedBetween: async (from: number, to: number) => (confirmedEvent.blockNumber >= from && confirmedEvent.blockNumber <= to ? [confirmedEvent] : []),
      liveFlag: async () => null,
      clusterRole: async (a: string) => roles.get(a) ?? Role.None,
      maxMembersPerCall: async () => 10, clusterExists: async () => true,
      confirm: async () => ({ txHash: null, dryRun: true }),
      link: async (t: string): Promise<WriteResult> => { linkCalls.push(t); return opts.sendForReal ? { txHash: bytes32(), dryRun: false } : { txHash: null, dryRun: true }; },
      explainRevert: (e: unknown) => String(e),
    } as unknown as StakeoutClient;
    const decideDeps = (t: string) => harness(baseRules, new Map([[t, analysis(t, { clusterId: cluster, behaviorScore: 0.1, link: { ...noLink, ...(flagsOf[t] ?? {}) } })]])).deps;
    const w = startWatcher({
      client, provider: { getBlockNumber: async () => 20 } as never, db, rules: baseRules,
      deployment: { chainId: 7, stakeoutAddress: addr(), deploymentBlock: 0 }, chainId: 7, pollMs: 20, chunkBlocks: 50,
      decidePromoted: async () => { throw new Error("no Promoted events expected in this test"); },
      linkCandidates: async () => [m1, inCluster, rotated, dusted, victim],
      decideLinkFor: async (t, c) => {
        if (t === opts.failFor) throw new Error("graph is down for one candidate");
        return decideLink(decideDeps(t), t, c);
      },
    });
    await new Promise((r) => setTimeout(r, opts.stopAfterMs ?? 250));
    await w.stop();
    return linkCalls;
  };

  const db = openDb(":memory:");
  const calls = await run(db);
  const rows = db.listDecisions(20) as Array<Record<string, unknown>>;
  const byTarget = (t: string) => rows.filter((r) => r.target === t);
  check("the rotated wallet is evaluated and linked (dry run: logged skipped, link simulated once)", byTarget(rotated).length === 1 && byTarget(rotated)[0].kind === "link" && byTarget(rotated)[0].outcome === "skipped" && /dry run/.test(String(byTarget(rotated)[0].reason)) && calls.filter((c) => c === rotated).length === 1);
  check("the dusted critic wallet is refused and never linked", byTarget(dusted).length === 1 && byTarget(dusted)[0].outcome === "refused" && !calls.includes(dusted));
  check("the victim wallet is refused and never linked", byTarget(victim).length === 1 && byTarget(victim)[0].outcome === "refused" && byTarget(victim)[0].rule === RULE.linkKnownVictim && !calls.includes(victim));
  check("addresses already in the cluster are not judged at all", byTarget(m1).length === 0 && byTarget(inCluster).length === 0);
  check("exactly three decisions were logged, all kind link", rows.length === 3 && rows.every((r) => r.kind === "link"), `rows ${rows.length}`);

  db.setKv("verifier.nextBlock", "0");
  await run(db);
  check("after a restart with the position reset, nothing is decided twice", db.listDecisions(20).length === 3);

  const db2 = openDb(":memory:");
  const w = console.error;
  const errors: string[] = [];
  console.error = (m: string) => errors.push(m);
  await run(db2, { failFor: dusted });
  console.error = w;
  const afterFail = db2.listDecisions(20) as Array<Record<string, unknown>>;
  check("one candidate failing blocks the event: it is retried, not marked handled", errors.some((m) => /graph is down/.test(m)) && !db2.isEventHandled(`7:${confirmedEvent.blockHash}:${confirmedEvent.logIndex}`));
  check("candidates decided before the failure are logged once, even though the event was retried many times", afterFail.filter((r) => r.target === rotated).length === 1, `rotated rows ${afterFail.filter((r) => r.target === rotated).length}`);
  check("the failing candidate has no decision row (no guess was logged)", afterFail.filter((r) => r.target === dusted).length === 0);
}

await confirmCases();
await linkCases();
await logging();
await watcherLinks();
process.exitCode = failed ? 1 : 0;
console.log(failed ? "\nSOME CHECKS FAILED" : "\nall decide self-test checks passed");
