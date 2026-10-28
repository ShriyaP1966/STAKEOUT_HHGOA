// Self-test for POST /evidence/build and GET /evidence/:hash against the PROPOSED analysis schema.
// Test-only stand-ins: a local stub Graph Service, a stub AI, an in-memory database, a rules fixture.
// None of them is used at runtime. Usage: npm run evidence-selftest
import { readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import Fastify from "fastify";
import { Wallet, ZeroAddress, hexlify, randomBytes } from "ethers";
import { canonicalize, hashBundle } from "../../../../shared/hash/index.js";
import type { Rules } from "../config.js";
import { openDb } from "../db.js";
import { evidenceBundleSchema } from "../evidence.js";
import { registerEvidenceRoutes } from "../evidenceRoutes.js";
import { installErrorHandler, makeRedactor, UserError } from "../errors.js";
import { LlmBusyError, type ChatRequest, type Llm } from "../llm.js";
import { findUnsupported, templateSummary } from "../summary.js";

let failed = false;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}: ${name}${detail ? ` (${detail})` : ""}`);
  if (!ok) failed = true;
};
const addr = () => Wallet.createRandom().address;
const bytes32 = () => hexlify(randomBytes(32));

// ---- rules fixture: NOT the team's thresholds
const rules: Rules = { behaviorThreshold: 3, minSignals: 2, reportConfidenceBoostPerReporter: 1, confirmationsToWait: 1 };

// ---- stub Graph Service
type Mode = "ok" | "wrong-target" | "bad-shape" | "http-500" | "not-json" | "hang" | "other-datasource";
let mode: Mode = "ok";
let lastAnalysis: Record<string, unknown> = {};
const analysisFor = (target: string, dataSource = "synthetic") => ({
  target, clusterId: bytes32(), behaviorScore: 7.5,
  signals: [{ name: "rapid_split", count: 12 }, { name: "merge", count: 4 }],
  members: [target, addr(), addr()], exitPoints: [addr()], unrelatedReporterCount: 5, dataSource,
});
const graph: Server = createServer((req, res) => {
  const target = decodeURIComponent((req.url ?? "").split("/").pop() ?? "");
  if (mode === "hang") return;
  if (mode === "http-500") { res.statusCode = 500; return res.end("graph exploded"); }
  if (mode === "not-json") return res.end("<html>no</html>");
  let body: Record<string, unknown> = analysisFor(target);
  if (mode === "wrong-target") body = analysisFor(addr());
  if (mode === "bad-shape") body = { ...analysisFor(target), behaviorScore: "high" };
  if (mode === "other-datasource") body = analysisFor(target, "testnet");
  lastAnalysis = body;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(body));
});
await new Promise<void>((r) => graph.listen(0, "127.0.0.1", r));
const graphUrl = `http://127.0.0.1:${(graph.address() as AddressInfo).port}`;

// ---- stub AI: writes a summary from the facts it is given
function ai(kind: "good" | "bad-number" | "busy") {
  const requests: ChatRequest[] = [];
  const llm: Llm = {
    model: "stub",
    complete: async (r) => {
      requests.push(r);
      if (kind === "busy") throw new LlmBusyError(5);
      const facts = JSON.parse(r.user);
      if (kind === "bad-number") return `The wallet scored 99.9 across ${facts.members.length} members.`;
      return `Wallet ${facts.target} scored ${facts.behaviorScore} with ${facts.members.length} members and ${facts.exitPoints.length} exit point.`;
    },
  };
  return { llm, requests };
}

async function build(opts: { llmKind?: "good" | "bad-number" | "busy"; body?: unknown; rulesLoader?: () => Rules; timeoutMs?: number; url?: string } = {}) {
  const db = openDb(":memory:");
  const a = ai(opts.llmKind ?? "good");
  const app = Fastify();
  installErrorHandler(app, makeRedactor([]));
  registerEvidenceRoutes(app, {
    db, llm: a.llm, graph: { baseUrl: opts.url ?? graphUrl, timeoutMs: opts.timeoutMs ?? 400 }, dataSource: "synthetic",
    loadRules: opts.rulesLoader ?? (() => rules), now: () => new Date("2026-10-28T10:00:00.000Z"),
  });
  const res = await app.inject({ method: "POST", url: "/evidence/build", payload: (opts.body ?? { target: addr() }) as object });
  return { app, db, ai: a, status: res.statusCode, body: JSON.parse(res.body) };
}

console.log("\n## the bundle matches shared/schemas/evidence.json (read only)");
const jsonSchema = JSON.parse(readFileSync(new URL("../../../../shared/schemas/evidence.json", import.meta.url), "utf8"));
const zodKeys = Object.keys(evidenceBundleSchema.shape).sort();
check("the zod mirror has exactly the schema's properties", JSON.stringify(zodKeys) === JSON.stringify(Object.keys(jsonSchema.properties).sort()), zodKeys.join(","));
check("every required property of the schema is required in the mirror", (jsonSchema.required as string[]).every((k) => k in evidenceBundleSchema.shape));
check("additionalProperties false in the schema is strict in the mirror", jsonSchema.additionalProperties === false && evidenceBundleSchema.safeParse({ extra: 1 }).success === false);
check("aiSummary.source values match the schema", JSON.stringify(jsonSchema.properties.aiSummary.properties.source.enum) === '["llm","template"]');

console.log("\n## POST /evidence/build, happy path");
mode = "ok";
const target = addr();
const lower = target.toLowerCase();
let r = await build({ body: { target: lower } });
check("200 with { hash, bundle }", r.status === 200 && typeof r.body.hash === "string" && typeof r.body.bundle === "object", `status ${r.status}`);
check("the bundle passes the strict schema mirror", evidenceBundleSchema.safeParse(r.body.bundle).success);
check("the target is the checksummed form of the request", r.body.bundle.target === target);
check("hash = hashBundle(bundle), from shared/hash", r.body.hash === hashBundle(r.body.bundle), `${r.body.hash.slice(0, 8)}... length ${r.body.hash.length}`);
check("the bundle values come from the graph response, unmodified", r.body.bundle.behaviorScore === (lastAnalysis.behaviorScore as number) && canonicalize(r.body.bundle.signals) === canonicalize(lastAnalysis.signals) && canonicalize(r.body.bundle.members) === canonicalize(lastAnalysis.members) && r.body.bundle.clusterId === lastAnalysis.clusterId && r.body.bundle.unrelatedReporterCount === 5);
check("thresholdsUsed is a copy of the rules applied", canonicalize(r.body.bundle.thresholdsUsed) === canonicalize(rules));
check("dataSource comes from config", r.body.bundle.dataSource === "synthetic");
check("createdAt is the build time", r.body.bundle.createdAt === "2026-10-28T10:00:00.000Z");
check("AI summary used and it passes the guard", r.body.bundle.aiSummary.source === "llm" && findUnsupported(r.body.bundle.aiSummary.text, lastAnalysis as never).length === 0, r.body.bundle.aiSummary.text.slice(0, 70));
check("the bundle has no status, verdict or confirmation field (the AI never decides)", !/status|verdict|confirm/i.test(Object.keys(r.body.bundle).join(",")));
const facts = JSON.parse(r.ai.requests[0].user);
check("the AI was given the graph facts only: no thresholds, no summary, no timestamps", JSON.stringify(Object.keys(facts).sort()) === '["behaviorScore","clusterId","dataSource","exitPoints","members","signals","target","unrelatedReporterCount"]', Object.keys(facts).join(","));
check("the AI prompt forbids a verdict", /do not state a verdict/i.test(r.ai.requests[0].system));
check("stored in SQLite under the hash", canonicalize(r.db.getEvidence(r.body.hash)) === canonicalize(r.body.bundle));
const get = await r.app.inject({ method: "GET", url: `/evidence/${r.body.hash}` });
check("GET /evidence/:hash returns the stored bundle", get.statusCode === 200 && JSON.parse(get.body).hash === r.body.hash && canonicalize(JSON.parse(get.body).bundle) === canonicalize(r.body.bundle));
const stored = JSON.parse(get.body).bundle;
stored.aiSummary.text = stored.aiSummary.text.replace(/.$/, (c: string) => (c === "x" ? "y" : "x"));
check("tamper test: one changed character in the stored bundle changes the hash", hashBundle(stored) !== r.body.hash);
check("GET with a malformed hash: 400", (await r.app.inject({ method: "GET", url: "/evidence/0x1234" })).statusCode === 400);
check("GET with an unknown hash: 404", (await r.app.inject({ method: "GET", url: `/evidence/${bytes32()}` })).statusCode === 404);

console.log("\n## summary guard in the build");
r = await build({ llmKind: "bad-number" });
check("an unsupported number twice: plain template, after exactly 2 AI requests", r.status === 200 && r.body.bundle.aiSummary.source === "template" && r.ai.requests.length === 2, `source ${r.body.bundle?.aiSummary?.source}, requests ${r.ai.requests.length}`);
check("the template text uses only the graph facts", r.body.bundle.aiSummary.text === templateSummary(lastAnalysis as never));
r = await build({ llmKind: "busy" });
check("AI rate limited: 429 with Retry-After, nothing stored", r.status === 429 && r.db.getEvidence("0x" + "0".repeat(64)) === null, `status ${r.status}`);

console.log("\n## input and failure handling (clear errors, nothing swallowed)");
for (const [label, body] of [["no target", {}], ["not an address", { target: "0x1234" }], ["the zero address", { target: ZeroAddress }], ["a number", { target: 7 }]] as const) {
  const x = await build({ body });
  check(`${label}: 400`, x.status === 400 && typeof x.body.error === "string", `${x.status} ${x.body.error}`);
}
mode = "http-500"; r = await build(); check("graph HTTP 500: 502 naming the status", r.status === 502 && /HTTP 500/.test(r.body.error), r.body.error);
mode = "not-json"; r = await build(); check("graph returns non-JSON: 502", r.status === 502 && /not JSON/i.test(r.body.error), r.body.error);
mode = "bad-shape"; r = await build(); check("graph response with the wrong shape: 502 naming the field", r.status === 502 && /behaviorScore/.test(r.body.error), r.body.error);
mode = "wrong-target"; r = await build(); check("graph answers for a different wallet: 502, nothing built", r.status === 502 && /different wallet|does not match the requested/i.test(r.body.error), r.body.error);
mode = "other-datasource"; r = await build(); check("graph data source differs from the configured one: 502 naming both", r.status === 502 && /synthetic/.test(r.body.error) && /testnet/.test(r.body.error), r.body.error);
mode = "hang"; r = await build({ timeoutMs: 300 }); check("graph does not answer in time: 504 naming the setting", r.status === 504 && /GRAPH_TIMEOUT_MS/.test(r.body.error), r.body.error);
mode = "ok"; r = await build({ url: "http://127.0.0.1:9" }); check("graph unreachable: 502", r.status === 502 && /Cannot reach the Graph Service/.test(r.body.error), r.body.error);
r = await build({ rulesLoader: () => { throw new UserError("Rules file missing at RULES_PATH. Person 1 and Person 3 agree it.", 503); } });
check("rules file missing: 503 with the message (the server itself still runs)", r.status === 503 && /Rules file missing/.test(r.body.error), r.body.error);

await new Promise<void>((res) => graph.close(() => res()));
process.exitCode = failed ? 1 : 0;
console.log(failed ? "\nSOME CHECKS FAILED" : "\nall evidence self-test checks passed");
