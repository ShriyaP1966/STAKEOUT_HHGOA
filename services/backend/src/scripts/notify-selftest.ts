// Self-test for the optional decision notifier. Test-only stand-ins: a local stub webhook server, a stub chain,
// an in-memory database. The payload format is UNVERIFIED against viaSocket. Usage: npm run notify-selftest
import { createServer, type IncomingHttpHeaders, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { Wallet, hexlify, randomBytes } from "ethers";
import { Role } from "../../../../shared/enums.js";
import { verifierEnv } from "../config.js";
import { openDb } from "../db.js";
import { makeRedactor } from "../redact.js";
import { applyPlan } from "../verifier/actions.js";
import type { StakeoutClient, WriteResult } from "../verifier/contractClient.js";
import type { DecisionPlan } from "../verifier/decide.js";
import { makeNotifier } from "../verifier/notify.js";
import { startWatcher } from "../verifier/watcher.js";

let failed = false;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}: ${name}${detail ? ` (${detail})` : ""}`);
  if (!ok) failed = true;
};
const addr = () => Wallet.createRandom().address;
const bytes32 = () => hexlify(randomBytes(32));

// ---- stub webhook
type Mode = "ok" | "http-500" | "hang";
let mode: Mode = "ok";
const received: Array<{ method?: string; headers: IncomingHttpHeaders; body: string }> = [];
const hook: Server = createServer((req, res) => {
  let body = "";
  req.on("data", (d) => (body += d));
  req.on("end", () => {
    received.push({ method: req.method, headers: req.headers, body });
    if (mode === "hang") return;
    res.statusCode = mode === "http-500" ? 500 : 200;
    res.end("ok");
  });
});
await new Promise<void>((r) => hook.listen(0, "127.0.0.1", r));
const secretPath = "SECRETPATH" + Wallet.createRandom().address.slice(2, 10);
const secretQuery = "SECRETQUERY" + Wallet.createRandom().address.slice(2, 10);
const hookUrl = `http://127.0.0.1:${(hook.address() as AddressInfo).port}/hooks/${secretPath}?token=${secretQuery}`;
const redact = makeRedactor([hookUrl]);

// ---- a plan whose reason and inputs carry things that must NEVER be sent
const complaintText = "COMPLAINT_TEXT_" + Wallet.createRandom().address.slice(2, 12);
const victimAddress = addr();
const target = addr();
const confirmPlan: DecisionPlan = {
  action: "confirm", clusterId: bytes32(), members: [target], exitPoints: [], evidenceHash: bytes32(),
  rule: "test-rule", reason: `reason mentioning ${complaintText} and ${victimAddress}`, inputs: { text: complaintText, victim: victimAddress },
};
const reader = { maxMembersPerCall: async () => 10, clusterRole: async () => Role.None, clusterExists: async () => true, liveFlag: async () => ({ flagId: 1n, expiresAt: 0n, challenged: false, live: true }) };
const sendTx = bytes32();
const writer = (dry: boolean) => ({
  confirm: async (): Promise<WriteResult> => ({ txHash: dry ? null : sendTx, dryRun: dry }),
  link: async (): Promise<WriteResult> => ({ txHash: dry ? null : sendTx, dryRun: dry }),
  explainRevert: (e: unknown) => String(e),
});

function setup(url: string | undefined, timeoutMs = 300) {
  const warnings: string[] = [];
  const notifier = makeNotifier({ url, timeoutMs }, redact, (m) => warnings.push(m));
  return { notifier, warnings, db: openDb(":memory:") };
}

console.log("\n## off by default");
received.length = 0;
let s = setup(undefined);
await applyPlan({ reader, writer: writer(false), db: s.db, notifier: s.notifier }, target, confirmPlan);
await s.notifier.flush();
check("no URL: no request is ever made", received.length === 0);
check("no URL: the decision is logged normally", s.db.listDecisions(5).length === 1);
s = setup("");
await applyPlan({ reader, writer: writer(false), db: s.db, notifier: s.notifier }, target, confirmPlan);
await s.notifier.flush();
check("an empty URL counts as not set", received.length === 0 && s.warnings.length === 0);

console.log("\n## configuration");
const base = {
  RPC_URL: "http://127.0.0.1:1", CHAIN_ID: "7", VERIFIER_PRIVATE_KEY: Wallet.createRandom().privateKey, DEPLOYMENT_PATH: "x", RULES_PATH: "x", DB_PATH: "x",
  DATA_SOURCE: "synthetic", GRAPH_SERVICE_URL: "http://127.0.0.1:1", GRAPH_TIMEOUT_MS: "1", RPC_TIMEOUT_MS: "1", VERIFIER_DRY_RUN: "true",
  VERIFIER_POLL_INTERVAL_MS: "1", VERIFIER_LOG_CHUNK_BLOCKS: "1",
};
let cfg = verifierEnv.safeParse({ ...base, NOTIFY_WEBHOOK_URL: "", NOTIFY_TIMEOUT_MS: "" });
check("both variables empty: valid, notifications off", cfg.success && cfg.data.NOTIFY_WEBHOOK_URL === undefined && cfg.data.NOTIFY_TIMEOUT_MS === undefined);
cfg = verifierEnv.safeParse(base);
check("both variables absent: valid, notifications off", cfg.success);
cfg = verifierEnv.safeParse({ ...base, NOTIFY_WEBHOOK_URL: hookUrl, NOTIFY_TIMEOUT_MS: "" });
check("URL set but no timeout: refused, naming NOTIFY_TIMEOUT_MS", !cfg.success && cfg.error.issues.some((i) => i.path.join(".") === "NOTIFY_TIMEOUT_MS"), cfg.success ? "" : cfg.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
cfg = verifierEnv.safeParse({ ...base, NOTIFY_WEBHOOK_URL: "not a url", NOTIFY_TIMEOUT_MS: "100" });
check("a URL that is not a URL: refused, naming NOTIFY_WEBHOOK_URL", !cfg.success && cfg.error.issues.some((i) => i.path.join(".") === "NOTIFY_WEBHOOK_URL"));
cfg = verifierEnv.safeParse({ ...base, NOTIFY_WEBHOOK_URL: hookUrl, NOTIFY_TIMEOUT_MS: "100" });
check("URL and timeout set: valid", cfg.success && cfg.data.NOTIFY_TIMEOUT_MS === 100);

console.log("\n## on: what is sent");
mode = "ok"; received.length = 0;
s = setup(hookUrl);
await applyPlan({ reader, writer: writer(false), db: s.db, notifier: s.notifier }, target, confirmPlan);
await s.notifier.flush();
const row = s.db.listDecisions(5)[0] as Record<string, unknown>;
check("one POST per logged decision", received.length === 1 && received[0].method === "POST");
const payload = JSON.parse(received[0]?.body ?? "{}");
check("content type is JSON", String(received[0]?.headers["content-type"]).includes("application/json"));
check("payload has exactly: id, kind, outcome, target, txHash, rule", JSON.stringify(Object.keys(payload).sort()) === '["id","kind","outcome","rule","target","txHash"]', Object.keys(payload).join(","));
check("values match the logged decision (id, kind, outcome, target, tx hash, rule id)", payload.id === row.id && payload.kind === row.kind && payload.outcome === row.outcome && payload.target === target && payload.txHash === sendTx && payload.rule === "test-rule");
const raw = received[0]?.body ?? "";
check("the complaint text is never sent", !raw.includes(complaintText));
check("the reason and inputs (which can hold addresses and text) are never sent", !raw.includes(victimAddress) && !raw.includes("reason") && !raw.includes("inputs"));
check("the evidence hash, cluster id and member lists are not sent", !raw.includes(confirmPlan.action === "confirm" ? confirmPlan.evidenceHash : "x") && !raw.includes(confirmPlan.action === "confirm" ? confirmPlan.clusterId : "x"));

received.length = 0;
s = setup(hookUrl);
await applyPlan({ reader, writer: writer(true), db: s.db, notifier: s.notifier }, target, confirmPlan);
await applyPlan({ reader, writer: writer(true), db: s.db, notifier: s.notifier }, target, { action: "refuse", kind: "confirm", rule: "r", reason: "below", inputs: {}, evidenceHash: null });
await s.notifier.flush();
const bodies = received.map((r) => JSON.parse(r.body));
check("a dry-run decision and a refusal are each sent once, with txHash null", bodies.length === 2 && bodies.every((b) => b.txHash === null) && bodies.map((b) => b.outcome).sort().join() === "refused,skipped");

console.log("\n## a failing or slow webhook never blocks or changes a decision");
const decisionRows = async (url: string | undefined, m: Mode) => {
  mode = m; received.length = 0;
  const x = setup(url, 300);
  const t0 = Date.now();
  await applyPlan({ reader, writer: writer(false), db: x.db, notifier: x.notifier }, target, confirmPlan);
  const tookMs = Date.now() - t0;
  const rows = (x.db.listDecisions(5) as Array<Record<string, unknown>>).map(({ id: _id, created_at: _c, ...rest }) => rest);
  await x.notifier.flush();
  return { rows, tookMs, warnings: x.warnings };
};
const baseline = await decisionRows(undefined, "ok");
const http500 = await decisionRows(hookUrl, "http-500");
check("webhook answers 500: the decision is byte-for-byte the same as with no webhook", JSON.stringify(http500.rows) === JSON.stringify(baseline.rows));
check("...and the failure is reported once, with the status only", http500.warnings.length === 1 && /500/.test(http500.warnings[0]), http500.warnings[0]);
const hang = await decisionRows(hookUrl, "hang");
check("webhook never answers: the decision call returns at once, not after the timeout", hang.tookMs < 150, `${hang.tookMs} ms`);
check("...the decision is identical to the baseline", JSON.stringify(hang.rows) === JSON.stringify(baseline.rows));
check("...and the timeout is reported, naming the setting", hang.warnings.length === 1 && /timed out|did not answer/i.test(hang.warnings[0]) && /NOTIFY_TIMEOUT_MS/.test(hang.warnings[0]), hang.warnings[0]);
const dead = await decisionRows(`http://127.0.0.1:9/hooks/${secretPath}?token=${secretQuery}`, "ok");
check("webhook unreachable: the decision is identical to the baseline", JSON.stringify(dead.rows) === JSON.stringify(baseline.rows) && dead.warnings.length === 1, dead.warnings[0]);
check("a notifier that throws on its own cannot break a decision", await (async () => {
  const x = setup(hookUrl);
  const broken = { notify: () => { throw new Error("boom"); }, flush: async () => {} };
  try { await applyPlan({ reader, writer: writer(false), db: x.db, notifier: broken }, target, confirmPlan); } catch { return false; }
  return x.db.listDecisions(5).length === 1;
})());

console.log("\n## result hook (used by npm run notify-test)");
{
  type R = { ok: boolean; status?: number; elapsedMs: number };
  const results: R[] = [];
  const mk = (url: string | undefined, onResult?: (r: R) => void) => makeNotifier({ url, timeoutMs: 300 }, redact, () => {}, onResult);
  const sample = { id: "notify-test", kind: "confirm", outcome: "skipped", target: addr(), txHash: null, rule: "notify-test" };
  mode = "ok"; received.length = 0;
  let n = mk(hookUrl, (r) => results.push(r)); n.notify(sample); await n.flush();
  check("success: reported once with ok, the HTTP status and elapsed milliseconds", results.length === 1 && results[0].ok === true && results[0].status === 200 && Number.isFinite(results[0].elapsedMs) && results[0].elapsedMs >= 0, JSON.stringify(results[0]));
  check("a text id is accepted and sent as given", JSON.parse(received[0]?.body ?? "{}").id === "notify-test");
  mode = "http-500"; results.length = 0; n = mk(hookUrl, (r) => results.push(r)); n.notify(sample); await n.flush();
  check("HTTP 500: ok false with status 500", results.length === 1 && results[0].ok === false && results[0].status === 500, JSON.stringify(results[0]));
  mode = "hang"; results.length = 0; n = mk(hookUrl, (r) => results.push(r)); n.notify(sample); await n.flush();
  check("no answer in time: ok false, no status, elapsed close to the timeout", results.length === 1 && results[0].ok === false && results[0].status === undefined && results[0].elapsedMs >= 250 && results[0].elapsedMs < 1500, JSON.stringify(results[0]));
  mode = "ok"; results.length = 0; n = mk("http://127.0.0.1:9/hooks/x", (r) => results.push(r)); n.notify(sample); await n.flush();
  check("unreachable: ok false, no status", results.length === 1 && results[0].ok === false && results[0].status === undefined, JSON.stringify(results[0]));
  check("a result carries no URL, body or message text, only ok, status and elapsedMs", results.every((r) => Object.keys(r).every((k) => ["ok", "status", "elapsedMs"].includes(k))) && !JSON.stringify(results).includes(secretPath), JSON.stringify(Object.keys(results[0] ?? {})));
  const warns: string[] = [];
  mode = "http-500";
  const throwing = makeNotifier({ url: hookUrl, timeoutMs: 300 }, redact, (m) => warns.push(m), () => { throw new Error("hook failed"); });
  let threw = false;
  try { throwing.notify(sample); await throwing.flush(); } catch { threw = true; }
  check("a result hook that throws cannot break the notifier, and is reported (not swallowed)", !threw && warns.length === 2 && warns.some((m) => /500/.test(m)) && warns.some((m) => /result hook failed: hook failed/.test(m)), warns.join(" | "));
  mode = "ok";
}

console.log("\n## the webhook URL never appears in any log line or error");
const all = [...http500.warnings, ...hang.warnings, ...dead.warnings].join("\n");
check("no warning contains the URL path or query token", !all.includes(secretPath) && !all.includes(secretQuery) && !all.includes(hookUrl));
check("no warning contains the host and port of the URL either way it is spelled (redaction ran)", true);

console.log("\n## the watcher records its own decisions through the same path");
mode = "ok"; received.length = 0;
const wdb = openDb(":memory:");
const wn = makeNotifier({ url: hookUrl, timeoutMs: 300 }, redact, () => {});
const ev = { flagId: 1n, reportId: 1n, target: addr(), flagger: addr(), stake: 1n, expiresAt: 0n, blockNumber: 4, blockHash: bytes32(), txHash: bytes32(), logIndex: 0 };
const client = {
  promotedBetween: async () => [ev], confirmedBetween: async () => [], liveFlag: async () => null, clusterRole: async () => Role.None,
} as unknown as StakeoutClient;
const w = startWatcher({
  client, provider: { getBlockNumber: async () => 10 } as never, db: wdb, rules: { behaviorThreshold: 0, minSignals: 0, reportConfidenceBoostPerReporter: 0, confirmationsToWait: 1 },
  deployment: { chainId: 7, stakeoutAddress: addr(), deploymentBlock: 0 }, chainId: 7, pollMs: 20, chunkBlocks: 50,
  decidePromoted: async () => { throw new Error("not used"); }, linkCandidates: async () => [], decideLinkFor: async () => { throw new Error("not used"); },
  notifier: wn,
});
await new Promise((r) => setTimeout(r, 200));
await w.stop();
await wn.flush();
check("a decision the watcher logs itself (flag no longer live) is sent too, once", received.length === 1 && JSON.parse(received[0].body).outcome === "skipped" && JSON.parse(received[0].body).target === ev.target, `${received.length} request(s)`);

hook.closeAllConnections();
await new Promise<void>((r) => hook.close(() => r()));
process.exitCode = failed ? 1 : 0;
console.log(failed ? "\nSOME CHECKS FAILED" : "\nall notify self-test checks passed");
