// Self-test for the verifier's own logic. It uses STAND-INS for the chain (no node needed) and a local HTTP
// server for the Graph Service, so it proves our code paths, NOT the real contract. Addresses are generated.
// Usage: npm run verifier-selftest
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { Wallet, ZeroAddress, hexlify, randomBytes } from "ethers";
import { Role } from "../../../../shared/enums.js";
import { openDb } from "../db.js";
import { applyPlan, checkConfirmFeasible, checkLinkFeasible } from "../verifier/actions.js";
import type { ChainReader, ChainWriter, LiveFlag, PromotedEvent, StakeoutClient } from "../verifier/contractClient.js";
import { fetchAnalysis, GraphServiceError } from "../verifier/graphClient.js";
import { startWatcher, type WatcherDeps } from "../verifier/watcher.js";

let failed = false;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}: ${name}${detail ? ` (${detail})` : ""}`);
  if (!ok) failed = true;
};
const addr = () => Wallet.createRandom().address;
const bytes32 = () => hexlify(randomBytes(32));
const live = (challenged = false): LiveFlag => ({ flagId: 1n, expiresAt: 0n, challenged, live: true });

type Reader = {
  max?: number;
  roles?: Map<string, Role>;
  flags?: Map<string, LiveFlag | null>;
  clusters?: Set<string>;
};
function reader(r: Reader = {}): ChainReader {
  return {
    maxMembersPerCall: async () => r.max ?? 10,
    clusterRole: async (a) => r.roles?.get(a) ?? Role.None,
    clusterExists: async (c) => r.clusters?.has(c) ?? false,
    liveFlag: async (a) => r.flags?.get(a) ?? null,
  };
}

async function feasibility() {
  console.log("\n## feasibility checks (stand-in chain)");
  const [m1, m2, e1] = [addr(), addr(), addr()];
  const cluster = bytes32();
  const flags = new Map([[m1, live()]]);

  let f = await checkConfirmFeasible(reader({ flags }), { clusterId: cluster, members: [m1, m2], exitPoints: [e1] });
  check("confirm ok when a member has a live flag", f.ok);
  f = await checkConfirmFeasible(reader({ max: 2, flags }), { clusterId: cluster, members: [m1, m2], exitPoints: [e1] });
  check("members + exit points over the limit are refused with the limit named", !f.ok && f.rule === "feasibility:member-limit" && f.reason.includes("(2)"), !f.ok ? f.reason : "");
  f = await checkConfirmFeasible(reader(), { clusterId: cluster, members: [m1], exitPoints: [] });
  check("no live flag", !f.ok && f.rule === "feasibility:no-live-flag");
  f = await checkConfirmFeasible(reader({ flags: new Map([[m1, live(true)]]) }), { clusterId: cluster, members: [m1], exitPoints: [] });
  check("challenged member flag", !f.ok && f.rule === "feasibility:member-flag-challenged");
  f = await checkConfirmFeasible(reader({ flags, roles: new Map([[e1, Role.ExitPoint]]) }), { clusterId: cluster, members: [m1], exitPoints: [e1] });
  check("address already in a cluster", !f.ok && f.rule === "feasibility:already-in-cluster");
  f = await checkConfirmFeasible(reader({ flags }), { clusterId: cluster, members: [m1], exitPoints: [m1] });
  check("duplicate address", !f.ok && f.rule === "feasibility:duplicate-address");
  f = await checkConfirmFeasible(reader({ flags }), { clusterId: cluster, members: [m1, ZeroAddress], exitPoints: [] });
  check("zero address", !f.ok && f.rule === "feasibility:invalid-address");
  f = await checkConfirmFeasible(reader(), { clusterId: cluster, members: [], exitPoints: [] });
  check("empty request", !f.ok && f.rule === "feasibility:no-addresses");

  f = await checkLinkFeasible(reader(), { target: m2, clusterId: cluster });
  check("link refused when the cluster does not exist", !f.ok && f.rule === "feasibility:cluster-not-found");
  f = await checkLinkFeasible(reader({ clusters: new Set([cluster]) }), { target: m2, clusterId: cluster });
  check("link ok when the cluster exists and target is free", f.ok);
  f = await checkLinkFeasible(reader({ clusters: new Set([cluster]), roles: new Map([[m2, Role.Member]]) }), { target: m2, clusterId: cluster });
  check("link refused when target already in a cluster", !f.ok && f.rule === "feasibility:already-in-cluster");
}

async function logging() {
  console.log("\n## decision log (in-memory database, stand-in writer)");
  const target = addr(), member = addr(), cluster = bytes32(), evidence = bytes32();
  const reads = reader({ flags: new Map([[member, live()]]), clusters: new Set([cluster]) });
  const writer = (behaviour: "dry" | "send" | "revert"): ChainWriter => ({
    confirm: async () => {
      if (behaviour === "revert") throw new Error("boom");
      return behaviour === "dry" ? { txHash: null, dryRun: true } : { txHash: bytes32(), dryRun: false };
    },
    link: async () => ({ txHash: bytes32(), dryRun: false }),
    explainRevert: (e) => `contract reverted: ${(e as Error).message}`,
  });
  const confirmPlan = { action: "confirm" as const, clusterId: cluster, members: [member], exitPoints: [], evidenceHash: evidence, rule: "test-rule", reason: "test reason", inputs: { n: 1 } };

  const dbs = Array.from({ length: 5 }, () => openDb(":memory:"));
  await applyPlan({ reader: reads, writer: writer("send"), db: dbs[0] }, target, confirmPlan);
  await applyPlan({ reader: reads, writer: writer("dry"), db: dbs[1] }, target, confirmPlan);
  await applyPlan({ reader: reads, writer: writer("revert"), db: dbs[2] }, target, confirmPlan);
  await applyPlan({ reader: reader(), writer: writer("send"), db: dbs[3] }, target, confirmPlan);
  await applyPlan({ reader: reads, writer: writer("send"), db: dbs[4] }, target, { action: "refuse", kind: "confirm", rule: "test-rule", reason: "below threshold", inputs: {}, evidenceHash: evidence });
  const [sent, dry, revert, infeasible, refused] = dbs.map((d) => d.listDecisions(5)[0] as Record<string, unknown>);
  check("sent: outcome sent with a tx hash", sent.outcome === "sent" && sent.kind === "confirm" && typeof sent.tx_hash === "string");
  check("dry run: outcome skipped, no tx hash, reason says dry run", dry.outcome === "skipped" && dry.tx_hash === null && String(dry.reason).includes("dry run"));
  check("revert: outcome skipped with the reason", revert.outcome === "skipped" && String(revert.reason).includes("boom"));
  check("infeasible: outcome skipped with the feasibility rule", infeasible.outcome === "skipped" && infeasible.rule === "feasibility:no-live-flag");
  check("refuse: outcome refused with the reason", refused.outcome === "refused" && refused.reason === "below threshold");
  const allowedKinds = new Set(["confirm", "link"]), allowedOutcomes = new Set(["sent", "refused", "skipped"]);
  check("only the agreed kind/outcome values appear", [sent, dry, revert, infeasible, refused].every((r) => allowedKinds.has(r.kind as string) && allowedOutcomes.has(r.outcome as string)));
}

function fakeEvent(block: number): PromotedEvent {
  return { flagId: 1n, reportId: 1n, target: addr(), flagger: addr(), stake: 1n, expiresAt: 0n, blockNumber: block, blockHash: bytes32(), txHash: bytes32(), logIndex: 0 };
}

async function watcher() {
  console.log("\n## watcher (stand-in chain)");
  const rules = { behaviorThreshold: 0, minSignals: 0, reportConfidenceBoostPerReporter: 0, confirmationsToWait: 2 };
  const deployment = { chainId: 7, stakeoutAddress: addr(), deploymentBlock: 3 };
  const latest = 20;
  const run = async (db: ReturnType<typeof openDb>, events: PromotedEvent[], flag: LiveFlag | null, decidePromoted: WatcherDeps["decidePromoted"] = async () => { throw new Error("the graph is unreachable (stub)"); }) => {
    const ranges: Array<[number, number]> = [];
    const client = {
      confirmedBetween: async () => [],
      promotedBetween: async (from: number, to: number) => { ranges.push([from, to]); return events.filter((e) => e.blockNumber >= from && e.blockNumber <= to); },
      liveFlag: async () => flag,
      clusterRole: async () => Role.None,
    } as unknown as StakeoutClient;
    const w = startWatcher({
      client, provider: { getBlockNumber: async () => latest } as never, db, rules, deployment, chainId: 7,
      pollMs: 20, chunkBlocks: 5, decidePromoted,
      linkCandidates: async () => [], decideLinkFor: async () => { throw new Error("no link flow in this test"); },
    });
    await new Promise((r) => setTimeout(r, 150));
    await w.stop();
    return ranges;
  };

  // 1. no events: scans in chunks up to latest - confirmationsToWait, remembers the position
  const db1 = openDb(":memory:");
  const ranges = await run(db1, [], null);
  check("scans from the deployment block in chunks up to latest minus confirmationsToWait", ranges[0]?.[0] === 3 && ranges.at(-1)?.[1] === 18 && ranges.every(([a, b]) => b - a < 5), JSON.stringify(ranges.slice(0, 4)));
  check("stores the next block to scan", db1.getKv("verifier.nextBlock") === "19");
  const again = await run(db1, [], null);
  check("a restart resumes from the stored position, not from the deployment block", again.length === 0 || again[0][0] >= 19, JSON.stringify(again.slice(0, 2)));

  // 2. event whose flag is no longer live: logged once as skipped and marked handled, even if the position is reset
  const db2 = openDb(":memory:");
  const ev = fakeEvent(10);
  await run(db2, [ev], null);
  check("flag no longer live -> one skipped decision", db2.listDecisions(10).length === 1 && (db2.listDecisions(1)[0] as Record<string, unknown>).outcome === "skipped");
  db2.setKv("verifier.nextBlock", "0");
  await run(db2, [ev], null);
  check("same event after a restart with the position reset is NOT handled twice", db2.listDecisions(10).length === 1);

  // 3. live flag but the decision cannot be made (here: the graph is down) -> nothing logged, nothing marked handled, position stays at the event
  const db3 = openDb(":memory:");
  const live1 = fakeEvent(12);
  const w = console.error;
  const warnings: string[] = [];
  console.error = (m: string) => warnings.push(m);
  await run(db3, [live1], live());
  console.error = w;
  check("live flag: verifier decides nothing (no decision rows)", db3.listDecisions(10).length === 0);
  check("live flag: event left unhandled so it is retried on the next poll", !db3.isEventHandled(`7:${live1.blockHash}:${live1.logIndex}`));
  check("live flag: position stays at the event's block", db3.getKv("verifier.nextBlock") === "12");
  check("live flag: reports the failure once, naming the cause", warnings.length === 1 && warnings[0].includes("could not handle the event: the graph is unreachable (stub)"), `${warnings.length} message(s)`);

  // 4. live flag and the decision logic answers: the outcome is logged, the event is handled once
  const db4 = openDb(":memory:");
  const live2 = fakeEvent(12);
  await run(db4, [live2], live(), async (ev) => ({ action: "refuse", kind: "confirm", rule: "stub-rule", reason: "stub refusal", inputs: { target: ev.target }, evidenceHash: null }));
  const rows4 = db4.listDecisions(10) as Array<Record<string, unknown>>;
  check("live flag with an answer: one refused decision with the rule and reason", rows4.length === 1 && rows4[0].outcome === "refused" && rows4[0].rule === "stub-rule" && rows4[0].reason === "stub refusal");
  check("...the event is marked handled and the position moves past it", db4.isEventHandled(`7:${live2.blockHash}:${live2.logIndex}`) && Number(db4.getKv("verifier.nextBlock")) > 12);
}

async function graph() {
  console.log("\n## Graph Service client (local HTTP stand-in)");
  const target = addr();
  // TEST FIXTURE: the exact shape services/graph returns for GET /analyze/{address} (lowercase addresses, metrics, no link on a scam wallet)
  const good = {
    target: target.toLowerCase(), clusterId: bytes32(), behaviorScore: 0.5, signals: [{ name: "x", value: 1 }], metrics: [{ name: "m", value: 2 }],
    members: [addr().toLowerCase()], exitPoints: [addr().toLowerCase()], unrelatedReporterCount: 2, dataSource: "synthetic",
  };
  // TEST FIXTURE: a link candidate that is not yet a member: clusterId of the cluster it would join, members [], link + linked + reason
  const candidate = {
    ...good, members: [], exitPoints: [],
    link: { repeatedStructuredOutflowToCluster: true, fundedByCluster: false, forwardsOnwardLikeMember: false, isKnownVictim: false, isOneOffPayer: false },
    linked: true, reason: "stub reason",
  };
  // TEST FIXTURE: a wallet in no cluster and no candidate: clusterId null
  const loner = { ...good, clusterId: null, members: [], exitPoints: [] };
  const server = createServer();
  type Mode = "ok" | "candidate" | "loner" | "bad-shape" | "http-500" | "http-502" | "http-400" | "no-data-404" | "wallet-404" | "route-404" | "not-json" | "hang";
  let mode: Mode = "ok";
  const sendJson = (res: import("node:http").ServerResponse, status: number, body: unknown) => { res.statusCode = status; res.setHeader("content-type", "application/json"); res.end(JSON.stringify(body)); };
  server.on("request", (_req, res) => {
    if (mode === "hang") return; // never answers
    if (mode === "http-500") { res.statusCode = 500; return res.end("internal problem"); }
    if (mode === "http-502") return sendJson(res, 502, { detail: "TigerGraph is down" });
    if (mode === "http-400") return sendJson(res, 400, { detail: "Invalid address. Expected 0x followed by 40 hex characters." });
    if (mode === "no-data-404") return sendJson(res, 404, { detail: "No graph data for this address." });
    if (mode === "wallet-404") return sendJson(res, 404, { detail: "Wallet not found in the graph." });
    if (mode === "route-404") return sendJson(res, 404, { detail: "Not Found" });
    if (mode === "not-json") return res.end("<html>nope</html>");
    sendJson(res, 200, mode === "bad-shape" ? { ...good, behaviorScore: "high" } : mode === "candidate" ? candidate : mode === "loner" ? loner : good);
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const kindOf = async (m: Mode, timeout = 300) => {
    mode = m;
    try { await fetchAnalysis(base, target, timeout); return "no error"; } catch (e) { return e instanceof GraphServiceError ? `${e.kind}: ${e.message}` : `other: ${(e as Error).message}`; }
  };
  mode = "ok";
  const a = await fetchAnalysis(base, target, 300);
  check("valid response parses (and addresses are checksummed)", a.behaviorScore === 0.5 && a.target === target);
  check("metrics are accepted", a.metrics?.length === 1);
  mode = "candidate";
  const c = await fetchAnalysis(base, target, 300);
  check("candidate: members [] and link, linked, reason are accepted", c.members.length === 0 && c.link?.repeatedStructuredOutflowToCluster === true && c.linked === true && c.reason === "stub reason");
  mode = "loner";
  check("clusterId null is accepted", (await fetchAnalysis(base, target, 300)).clusterId === null);
  for (const [m, kind] of [["bad-shape", "invalid-shape"], ["http-500", "http"], ["http-502", "http"], ["http-400", "http"], ["route-404", "http"], ["no-data-404", "not-found"], ["wallet-404", "not-found"], ["not-json", "invalid-json"], ["hang", "timeout"]] as const) {
    const r = await kindOf(m);
    check(`${m} -> ${kind}`, r.startsWith(kind + ":"), r.slice(0, 110));
  }
  await new Promise<void>((r) => server.close(() => r()));
  const dead = await (async () => { try { await fetchAnalysis(base, target, 300); return "no error"; } catch (e) { return e instanceof GraphServiceError ? `${e.kind}: ${e.message}` : "other"; } })();
  check("nothing listening -> unreachable", dead.startsWith("unreachable"), dead.slice(0, 110));
}

await feasibility();
await logging();
await watcher();
await graph();
process.exitCode = failed ? 1 : 0;
console.log(failed ? "\nSOME CHECKS FAILED" : "\nall self-test checks passed");
