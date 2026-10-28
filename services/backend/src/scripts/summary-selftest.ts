// Self-test for the summary guard (src/summary.ts). Uses a STUB LLM: no network, no real LLM calls.
// Not wired to any endpoint. Usage: npm run summary-selftest
import { Wallet } from "ethers";
import type { ChatRequest, Llm } from "../llm.js";
import { buildSummary, findUnsupported, templateSummary } from "../summary.js";

let failed = false;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}: ${name}${detail ? ` (${detail})` : ""}`);
  if (!ok) failed = true;
};
const addr = () => Wallet.createRandom().address;

/** An LLM that answers from a queue and records every request it receives. */
function stub(answers: Array<string | null>) {
  const requests: ChatRequest[] = [];
  const llm: Llm = { model: "stub", complete: async (req) => (requests.push(req), answers[requests.length - 1] ?? null) };
  return { llm, requests };
}

const members = [addr(), addr(), addr()];
const exitPoints = [addr()];
const facts = {
  target: members[0],
  clusterId: "0x" + "ab12".repeat(16),
  behaviorScore: 0.83,
  signals: [{ name: "rapid_split", count: 12 }, { name: "merge", count: 4 }],
  members,
  exitPoints,
  unrelatedReporterCount: 5,
  dataSource: "synthetic",
  createdAt: "2026-10-28T10:00:00.000Z",
};

async function guard() {
  console.log("\n## findUnsupported (the guard)");
  const ok = `Wallet ${facts.target} scored 0.83 with 3 members, 1 exit point, 12 rapid splits and 5 reporters.`;
  check("a correct summary passes", findUnsupported(ok, facts).length === 0, JSON.stringify(findUnsupported(ok, facts)));
  check("an unsupported number is found", JSON.stringify(findUnsupported("The score is 0.91.", facts)) === '["0.91"]');
  check("a number is not accepted just because it is a prefix or a rounding (0.8, 83)", findUnsupported("Score 0.8 or 83.", facts).length === 2, JSON.stringify(findUnsupported("Score 0.8 or 83.", facts)));
  check("decimals are compared whole (0.83 passes, 0.830 does not)", findUnsupported("0.83", facts).length === 0 && findUnsupported("0.830", facts).length === 1);

  const stranger = addr();
  check("an address that is not in the facts is found", findUnsupported(`Funds went to ${stranger}.`, facts).length === 1);
  const lower = members[1].toLowerCase(), upper = "0x" + members[1].slice(2).toUpperCase();
  check("the same address in lowercase is accepted", findUnsupported(`See ${lower}.`, facts).length === 0);
  check("the same address in UPPERCASE hex is accepted", findUnsupported(`See ${upper}.`, facts).length === 0);
  // change the last hex digit to a different digit (case-insensitively), so the result is always another address
  const lastDigit = members[1].slice(-1).toLowerCase();
  const one = members[1].slice(0, -1) + (lastDigit === "a" ? "b" : "a");
  check("an address differing by one character is found, whatever its case", findUnsupported(`See ${one.toLowerCase()}.`, facts).length === 1);

  const digitsOnlyInAddress = { ...facts, target: "0x" + "1234567890".repeat(4) };
  check("digits inside an address are not counted as numbers", findUnsupported(`Target ${digitsOnlyInAddress.target}.`, digitsOnlyInAddress).length === 0);
  check("a bare number that only exists inside an address is NOT allowed", findUnsupported("There were 1234567890 events.", digitsOnlyInAddress).length === 1);

  // A 64-hex id (cluster id or hash) must be compared whole, not by its first 40 characters.
  const realId = facts.clusterId;
  const forgedId = realId.slice(0, 42) + "fedcba".repeat(4);
  check("the real 64-hex cluster id is accepted", findUnsupported(`Cluster ${realId}.`, facts).length === 0);
  check("a forged 64-hex id that shares the first 40 hex characters is found", forgedId !== realId && findUnsupported(`Cluster ${forgedId}.`, facts).length === 1, JSON.stringify(findUnsupported(`Cluster ${forgedId}.`, facts)));
  check("a truncated prefix of the cluster id is found", findUnsupported(`Cluster ${realId.slice(0, 42)}.`, facts).length === 1);

  const lengths = { ...facts, unrelatedReporterCount: 0, signals: [] as unknown[], members: [addr(), addr(), addr(), addr(), addr(), addr(), addr()], exitPoints: [addr(), addr()] };
  check("list lengths are allowed as counts (7 members, 2 exit points)", findUnsupported("7 members and 2 exit points.", lengths).length === 0);
  check("a count that is not a list length or a fact is found (8 members)", findUnsupported("8 members.", lengths).length === 1);
}

async function build() {
  console.log("\n## buildSummary (stub LLM)");
  const good = `Wallet ${facts.target} scored 0.83 across 3 members.`;
  let s = stub([good]);
  let r = await buildSummary(s.llm, facts);
  check("correct answer: used as is, one request", r.source === "llm" && r.text === good && s.requests.length === 1);

  s = stub(["The score is 0.91 across 3 members.", good]);
  r = await buildSummary(s.llm, facts);
  check("unsupported number: exactly one retry, then the good answer is used", r.source === "llm" && r.text === good && s.requests.length === 2);
  check("the retry tells the model which value was not allowed", s.requests[1].system.includes("0.91"), s.requests[1].system.slice(-90));

  s = stub(["The score is 0.91.", "Still 0.92."]);
  r = await buildSummary(s.llm, facts);
  check("unsupported twice: falls back to the template after exactly two requests", r.source === "template" && s.requests.length === 2);
  check("the template text is returned", r.text === templateSummary(facts));

  s = stub([`It went to ${addr()}.`, `Also ${addr()}.`]);
  r = await buildSummary(s.llm, facts);
  check("unsupported address twice: template fallback", r.source === "template" && s.requests.length === 2);

  s = stub([null, ""]);
  r = await buildSummary(s.llm, facts);
  check("empty answers twice: template fallback", r.source === "template" && s.requests.length === 2);

  s = stub(["   ", good]);
  r = await buildSummary(s.llm, facts);
  check("a blank first answer then a good one: the good one is used", r.source === "llm" && r.text === good);

  s = stub([`  ${good}\n`]);
  r = await buildSummary(s.llm, facts);
  check("surrounding whitespace is trimmed", r.text === good);
}

async function template() {
  console.log("\n## template and prompt");
  const t = templateSummary(facts);
  check("the template passes the guard (uses only values from the facts)", findUnsupported(t, facts).length === 0, t);
  const empty = { ...facts, members: [] as unknown[], exitPoints: [] as unknown[], signals: [] as unknown[] };
  check("the template passes the guard when the lists are empty", findUnsupported(templateSummary(empty), empty).length === 0);
  const noReporters = { ...facts, unrelatedReporterCount: 0 };
  check("the template passes the guard with zero reporters", findUnsupported(templateSummary(noReporters), noReporters).length === 0);
  check("the template states no verdict", !/confirm|scam|guilty|fraud/i.test(t), t);

  const s = stub([`Wallet ${facts.target} scored 0.83.`]);
  await buildSummary(s.llm, facts);
  const system = s.requests[0].system;
  check("the prompt forbids a verdict", /do not state a verdict/i.test(system) && /not say whether the wallet is confirmed/i.test(system));
  check("the prompt limits numbers and addresses to the facts", /only numbers and addresses that appear in the facts/i.test(system));
  check("the facts are passed as the user message and contain no AI-written text", s.requests[0].user.includes(facts.target) && !("aiSummary" in JSON.parse(s.requests[0].user)));
}

await guard();
await build();
await template();
process.exitCode = failed ? 1 : 0;
console.log(failed ? "\nSOME CHECKS FAILED" : "\nall summary self-test checks passed");
