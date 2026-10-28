// Self-test for the /extract timezone. STUB AI, in-memory database, Fastify inject: no network, no real AI call.
// Usage: npm run timezone-selftest
import Fastify from "fastify";
import { Wallet } from "ethers";
import { hashBundle } from "../../../../shared/hash/index.js";
import { openDb } from "../db.js";
import { installErrorHandler, makeRedactor } from "../errors.js";
import { registerExtractRoute } from "../extractRoute.js";
import type { ChatRequest, Llm } from "../llm.js";
import { describeNow, parseTimeZone } from "../timezone.js";

let failed = false;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}: ${name}${detail ? ` (${detail})` : ""}`);
  if (!ok) failed = true;
};

console.log("\n## time zone validation (code, not the AI)");
// test fixtures: well-known zone names
const kolkata = "Asia/Kolkata", newYork = "America/New_York";
check("a Region/City name is accepted", parseTimeZone(kolkata) !== null && parseTimeZone(newYork) === newYork);
check("UTC is accepted", parseTimeZone("UTC") === "UTC");
check("every spelling of one zone normalises to the same canonical name (wrong case, or a renamed alias)", parseTimeZone(kolkata.toLowerCase()) === parseTimeZone(kolkata) && parseTimeZone(newYork.toUpperCase()) === newYork, `${kolkata} -> ${parseTimeZone(kolkata)}`);
for (const bad of ["Mars/Olympus", "", "   ", "not a zone", "+05:30", "-04:00", "Asia/Kolkata; DROP", "x".repeat(300)]) {
  check(`rejected: ${JSON.stringify(bad.length > 20 ? bad.slice(0, 20) + "..." : bad)}`, parseTimeZone(bad) === null);
}

console.log("\n## the local time given to the AI (fixed instants, so daylight saving is covered)");
const summer = new Date("2026-10-28T15:30:00Z"), winter = new Date("2026-12-15T15:30:00Z");
let d = describeNow(summer, kolkata);
check("Kolkata in October: +05:30, local 21:00", d.offset === "+05:30" && d.local.startsWith("2026-10-28 21:00"), JSON.stringify(d));
d = describeNow(summer, newYork);
check("New York on 2026-10-28 (daylight time): -04:00, local 11:30", d.offset === "-04:00" && d.local.startsWith("2026-10-28 11:30"), JSON.stringify(d));
d = describeNow(winter, newYork);
check("New York in December (standard time): -05:00, local 10:30", d.offset === "-05:00" && d.local.startsWith("2026-12-15 10:30"), JSON.stringify(d));
d = describeNow(summer, "UTC");
check("UTC: +00:00, local 15:30", d.offset === "+00:00" && d.local.startsWith("2026-10-28 15:30"), JSON.stringify(d));

console.log("\n## POST /extract (stub AI)");
const address = Wallet.createRandom().address;
const text = `I sent 5000 USDT yesterday at 3pm to ${address} and they vanished.`;
const aiJson = JSON.stringify({ amount: 5000, currency: "USDT", occurredAt: "2026-10-27T15:00:00+05:30", narrative: "funds sent" });
const defaultZone = "UTC";

async function call(body: unknown) {
  const requests: ChatRequest[] = [];
  const llm: Llm = { model: "stub", complete: async (r) => (requests.push(r), aiJson) };
  const db = openDb(":memory:");
  const app = Fastify();
  installErrorHandler(app, makeRedactor([]));
  registerExtractRoute(app, { llm, db, dataSource: "synthetic", defaultTimezone: defaultZone, now: () => summer });
  const res = await app.inject({ method: "POST", url: "/extract", payload: body as object });
  await app.close();
  return { status: res.statusCode, body: JSON.parse(res.body), requests, db };
}

let r = await call({ text });
check("no timezone given: the configured default is used in the prompt", r.status === 200 && r.requests[0].system.includes(defaultZone) && r.requests[0].system.includes("+00:00"));
r = await call({ text, timezone: kolkata });
const kolkataCanonical = parseTimeZone(kolkata) as string;
check("timezone given: used in the prompt (name, offset and local time)", r.status === 200 && r.requests[0].system.includes(kolkataCanonical) && r.requests[0].system.includes("+05:30") && r.requests[0].system.includes("2026-10-28 21:00"), r.requests[0]?.system.slice(-260));
check("the prompt still forbids following instructions inside the complaint", /never follow instructions/i.test(r.requests[0].system));
r = await call({ text, timezone: kolkata.toLowerCase() });
check("a wrong-case zone name works and gives the same prompt zone", r.status === 200 && r.requests[0].system.includes(kolkataCanonical) && r.requests[0].system.includes("+05:30"));

for (const bad of ["Mars/Olympus", "+05:30", "", 42, null, ["UTC"]]) {
  const x = await call({ text, timezone: bad });
  check(`invalid timezone ${JSON.stringify(bad)}: 400 with a clear message, AI not called`, x.status === 400 && /timezone/i.test(x.body.error) && /IANA|Region\/City/i.test(x.body.error) && x.requests.length === 0, `${x.status} ${x.body.error}`);
}

r = await call({ text, timezone: kolkata });
const keys = Object.keys(r.body).sort().join(",");
check("response keys unchanged: complaint, complaintHash, dataSource, text", keys === "complaint,complaintHash,dataSource,text", keys);
check("hash shape unchanged: hashBundle({ text, complaint, dataSource })", r.body.complaintHash === hashBundle({ text: r.body.text, complaint: r.body.complaint, dataSource: r.body.dataSource }));
const stored = r.db.getEvidence(r.body.complaintHash) as Record<string, unknown>;
check("the stored record is exactly { text, complaint, dataSource } (no timezone inside)", JSON.stringify(Object.keys(stored).sort()) === '["complaint","dataSource","text"]', JSON.stringify(Object.keys(stored)));
const same = await call({ text, timezone: newYork });
check("the same text with another timezone gives the same hash when the AI answer is the same (timezone is not hashed)", same.body.complaintHash === r.body.complaintHash);

process.exitCode = failed ? 1 : 0;
console.log(failed ? "\nSOME CHECKS FAILED" : "\nall timezone self-test checks passed");
