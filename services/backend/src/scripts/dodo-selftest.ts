// Self-test for POST /webhooks/dodo (Dodo Payments, Standard Webhooks). Payloads are signed LOCALLY with a generated secret.
// The real Dodo account and a live delivery are NOT RUN. Usage: npm run dodo-selftest
import { createHmac, randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Writable } from "node:stream";
import rateLimit from "@fastify/rate-limit";
import Database from "better-sqlite3";
import Fastify, { type FastifyInstance } from "fastify";
import { dodoEnv } from "../config.js";
import { openDb } from "../db.js";
import { parseWebhookSecret, registerDodoRoute, verifyStandardWebhook } from "../dodo.js";
import { installErrorHandler, makeRedactor } from "../errors.js";

let failed = false;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}: ${name}${detail ? ` (${detail})` : ""}`);
  if (!ok) failed = true;
};

// ---- local signing, written independently of the code under test
const makeSecret = () => "whsec_" + randomBytes(24).toString("base64");
const sign = (secret: string, id: string, ts: string | number, body: string) =>
  "v1," + createHmac("sha256", Buffer.from(secret.replace(/^whsec_/, ""), "base64")).update(`${id}.${ts}.${body}`).digest("base64");

const NOW = 1_800_000_000; // fixed instant in Unix seconds (test fixture)
const TOLERANCE = 300;
const secret = makeSecret();
const marker = `victim-${randomBytes(6).toString("hex")}@example.test`; // planted customer data that must never be stored or logged
const payload = (type = "payment.succeeded") => `{"business_id":"b","type":"${type}" ,  "timestamp":"2026-10-29T10:00:00Z","data":{"payload_type":"Payment","customer":{"email":"${marker}"}}}`;
const eventId = () => "msg_" + randomBytes(8).toString("hex");

const dir = mkdtempSync(join(tmpdir(), "dodo-"));
const dbPath = join(dir, "dodo.db");
const logLines: string[] = [];
const openDbs: Array<ReturnType<typeof openDb>> = [];
const logStream = new Writable({ write(chunk, _enc, cb) { logLines.push(String(chunk)); cb(); } });

async function build(opts: { secret?: string | undefined; rate?: number; path?: string } = {}): Promise<{ app: FastifyInstance; db: ReturnType<typeof openDb> }> {
  const db = openDb(opts.path ?? dbPath);
  openDbs.push(db);
  const app = Fastify({ logger: { level: "info", stream: logStream } });
  if (opts.rate) await app.register(rateLimit, { max: opts.rate, timeWindow: "1 minute" });
  installErrorHandler(app, makeRedactor([]));
  app.get("/health", async () => ({ ok: true }));
  app.post("/echo", async (req) => ({ bodyType: typeof req.body, isObject: typeof req.body === "object" }));
  registerDodoRoute(app, { db, config: { secret: "secret" in opts ? opts.secret : secret, toleranceSeconds: TOLERANCE }, nowSeconds: () => NOW });
  return { app, db };
}

async function post(app: FastifyInstance, body: string, headers: Record<string, string | undefined>) {
  const h: Record<string, string> = { "content-type": "application/json" };
  for (const [k, v] of Object.entries(headers)) if (v !== undefined) h[k] = v;
  const res = await app.inject({ method: "POST", url: "/webhooks/dodo", headers: h, payload: body });
  return { status: res.statusCode, text: res.body };
}
const good = (id: string, body: string, ts: number = NOW) => ({ "webhook-id": id, "webhook-timestamp": String(ts), "webhook-signature": sign(secret, id, ts, body) });
const rows = () => { const d = new Database(dbPath, { readonly: true }); const r = d.prepare("select * from webhook_events").all() as Array<Record<string, unknown>>; d.close(); return r; };

console.log("\n## the secret");
const key = parseWebhookSecret(secret);
check("a whsec_ secret is stripped and base64-decoded (24 bytes)", key.length === 24);
check("the prefix is optional (as the Dodo page says: 'if it starts with whsec_')", parseWebhookSecret(secret.replace(/^whsec_/, "")).equals(key));
for (const bad of ["", "whsec_", "whsec_%%%not base64!!", "whsec_abc", "has space"]) {
  let threw = false;
  try { parseWebhookSecret(bad); } catch { threw = true; }
  check(`an invalid secret is refused: ${JSON.stringify(bad)}`, threw);
}

console.log("\n## configuration (dodoEnv)");
let cfg = dodoEnv.safeParse({ DODO_WEBHOOK_SECRET: "", DODO_WEBHOOK_TOLERANCE_SECONDS: "" });
check("both empty: valid, webhook off", cfg.success && cfg.data.DODO_WEBHOOK_SECRET === undefined);
cfg = dodoEnv.safeParse({});
check("both absent: valid, webhook off", cfg.success);
cfg = dodoEnv.safeParse({ DODO_WEBHOOK_SECRET: secret, DODO_WEBHOOK_TOLERANCE_SECONDS: "" });
check("secret set without a tolerance: refused, naming DODO_WEBHOOK_TOLERANCE_SECONDS", !cfg.success && cfg.error.issues.some((i) => i.path.join(".") === "DODO_WEBHOOK_TOLERANCE_SECONDS"));
cfg = dodoEnv.safeParse({ DODO_WEBHOOK_SECRET: "whsec_%%%not base64!!", DODO_WEBHOOK_TOLERANCE_SECONDS: "300" });
check("an invalid secret: refused, naming DODO_WEBHOOK_SECRET, and the message does not repeat it", !cfg.success && cfg.error.issues.some((i) => i.path.join(".") === "DODO_WEBHOOK_SECRET" && !i.message.includes("%%%")), cfg.success ? "" : cfg.error.issues.map((i) => i.message).join("; "));
cfg = dodoEnv.safeParse({ DODO_WEBHOOK_SECRET: secret, DODO_WEBHOOK_TOLERANCE_SECONDS: "0" });
check("a tolerance of 0 or less: refused", !cfg.success);
cfg = dodoEnv.safeParse({ DODO_WEBHOOK_SECRET: secret, DODO_WEBHOOK_TOLERANCE_SECONDS: "300" });
check("secret and tolerance: valid", cfg.success && cfg.data.DODO_WEBHOOK_TOLERANCE_SECONDS === 300);

console.log("\n## verification function");
const v = (over: Partial<Parameters<typeof verifyStandardWebhook>[0]> = {}) => {
  const id = "msg_unit", body = "{}";
  return verifyStandardWebhook({ key, id, timestamp: String(NOW), signatureHeader: sign(secret, id, NOW, body), body, toleranceSeconds: TOLERANCE, nowSeconds: NOW, ...over });
};
check("a correct signature verifies", v());
check("two signatures in the header, the second correct: verifies (any v1 may match)", v({ signatureHeader: "v1," + randomBytes(32).toString("base64") + " " + sign(secret, "msg_unit", NOW, "{}") }));
check("two signatures, the first correct: verifies", v({ signatureHeader: sign(secret, "msg_unit", NOW, "{}") + " v1," + randomBytes(32).toString("base64") }));
check("only a v2 signature: rejected", !v({ signatureHeader: sign(secret, "msg_unit", NOW, "{}").replace("v1,", "v2,") }));
check("a signature of the wrong length does not throw and is rejected", !v({ signatureHeader: "v1,AAAA" }));
check("a signature that is not base64 is rejected", !v({ signatureHeader: "v1,!!!!" }));
check("an empty signature is rejected", !v({ signatureHeader: "v1," }) && !v({ signatureHeader: "" }));
check("an enormous header is rejected without work", !v({ signatureHeader: "v1," + "A".repeat(100_000) }));
check("a different id is rejected (the id is part of the signed content)", !v({ id: "msg_other" }));
check("a different timestamp is rejected (it is part of the signed content)", !v({ timestamp: String(NOW + 1), nowSeconds: NOW + 1 }));
check("timestamp exactly at the tolerance: accepted", v({ timestamp: String(NOW - TOLERANCE), signatureHeader: sign(secret, "msg_unit", NOW - TOLERANCE, "{}") }));
check("one second beyond the tolerance (past): rejected", !v({ timestamp: String(NOW - TOLERANCE - 1), signatureHeader: sign(secret, "msg_unit", NOW - TOLERANCE - 1, "{}") }));
check("one second beyond the tolerance (future): rejected", !v({ timestamp: String(NOW + TOLERANCE + 1), signatureHeader: sign(secret, "msg_unit", NOW + TOLERANCE + 1, "{}") }));
for (const bad of ["abc", "", "-5", "1.5", "1e9", " 1800000000", "9".repeat(30)]) check(`a non-integer timestamp is rejected: ${JSON.stringify(bad.length > 12 ? bad.slice(0, 12) + "..." : bad)}`, !v({ timestamp: bad }));

console.log("\n## POST /webhooks/dodo");
let { app } = await build();
let id = eventId();
let body = payload();
let r = await post(app, body, good(id, body));
check("valid signature: 200", r.status === 200, `${r.status} ${r.text}`);
check("...and exactly one row is stored, with only webhook_id, event_type, received_at", rows().length === 1 && JSON.stringify(Object.keys(rows()[0]).sort()) === '["event_type","received_at","webhook_id"]');
check("...the row holds the id, the event type from the payload and the receive time", rows()[0].webhook_id === id && rows()[0].event_type === "payment.succeeded" && rows()[0].received_at === new Date(NOW * 1000).toISOString(), JSON.stringify(rows()[0]));
check("the raw body is what is verified (odd spacing in the signed body still verifies)", r.status === 200 && body.includes(' ,  "timestamp"'));

const wrongSecretBody = payload();
const before = rows().length;
const failures: Array<[string, { status: number; text: string }]> = [];
failures.push(["wrong secret", await post(app, wrongSecretBody, { "webhook-id": eventId(), "webhook-timestamp": String(NOW), "webhook-signature": sign(makeSecret(), "x", NOW, wrongSecretBody) })]);
id = eventId(); body = payload();
failures.push(["tampered body (one character)", await post(app, body.replace("payment", "paymenT"), good(id, body))]);
id = eventId(); body = payload();
failures.push(["stale timestamp", await post(app, body, good(id, body, NOW - TOLERANCE - 1))]);
failures.push(["timestamp too far in the future", await post(app, body, good(id, body, NOW + TOLERANCE + 1))]);
const g = good(eventId(), body);
failures.push(["missing webhook-id", await post(app, body, { ...g, "webhook-id": undefined })]);
failures.push(["missing webhook-timestamp", await post(app, body, { ...g, "webhook-timestamp": undefined })]);
failures.push(["missing webhook-signature", await post(app, body, { ...g, "webhook-signature": undefined })]);
failures.push(["no headers at all", await post(app, body, {})]);
failures.push(["id changed after signing", await post(app, body, { ...g, "webhook-id": "msg_other" })]);
for (const [label, res] of failures) check(`${label}: 401`, res.status === 401, `${res.status}`);
check("every failure has the SAME body, with no detail about the reason", new Set(failures.map(([, res]) => res.text)).size === 1 && JSON.parse(failures[0][1].text).error === "unauthorized", failures[0][1].text);
check("no failed request stored anything", rows().length === before);

id = eventId(); body = payload("payment.failed");
const first = await post(app, body, good(id, body));
const second = await post(app, body, good(id, body));
const third = await post(app, payload("subscription.active"), good(id, payload("subscription.active")));
check("a new event is stored once; the same id again is 200 and is not stored twice", first.status === 200 && second.status === 200 && third.status === 200 && rows().filter((x) => x.webhook_id === id).length === 1);
check("a duplicate id with a different event type does not overwrite the first (first wins)", rows().find((x) => x.webhook_id === id)?.event_type === "payment.failed");
check("the duplicate response says it was a duplicate", JSON.parse(second.text).duplicate === true && JSON.parse(first.text).duplicate !== true);

id = eventId();
const odd = `{"type": ${JSON.stringify("bad type with spaces")}}`;
r = await post(app, odd, good(id, odd));
check("a verified event with an unusable type: 200 (so Dodo does not retry), stored with event_type unknown", r.status === 200 && rows().find((x) => x.webhook_id === id)?.event_type === "unknown");
id = eventId();
const notJson = "this is not json";
r = await post(app, notJson, good(id, notJson));
check("a verified event that is not JSON: 200, stored with event_type unknown, nothing else kept", r.status === 200 && rows().find((x) => x.webhook_id === id)?.event_type === "unknown");

console.log("\n## nothing from the payload is stored or logged");
const dbBytes = readdirSync(dir).filter((f) => f.startsWith("dodo.db")).map((f) => readFileSync(join(dir, f)).toString("latin1")).join("");
check("positive control: the stored webhook id IS found in the database files", dbBytes.includes(rows()[0].webhook_id as string));
check("the customer data planted in the payload is NOT in any database file", !dbBytes.includes(marker));
const logs = logLines.join("");
check("the log has request lines (the capture works)", logs.includes("/webhooks/dodo"));
check("the log never contains the payload, the planted customer data, the secret or a signature", !logs.includes(marker) && !logs.includes(secret) && !logs.includes(secret.replace(/^whsec_/, "")) && !/v1,[A-Za-z0-9+/=]{20,}/.test(logs) && !logs.includes("business_id"));

console.log("\n## the rest of the server is unaffected");
const echo = await app.inject({ method: "POST", url: "/echo", headers: { "content-type": "application/json" }, payload: '{"a":1}' });
check("another JSON route still receives a PARSED object (the raw-body parser is local to the webhook route)", JSON.parse(echo.body).isObject === true && JSON.parse(echo.body).bodyType === "object", echo.body);
check("GET /health still works", (await app.inject({ method: "GET", url: "/health" })).statusCode === 200);
await app.close();

console.log("\n## secret not configured");
({ app } = await build({ secret: undefined, path: join(dir, "unset.db") }));
body = payload();
r = await post(app, body, good(eventId(), body));
check("DODO_WEBHOOK_SECRET unset: 503 naming the variable", r.status === 503 && /DODO_WEBHOOK_SECRET/.test(r.text), `${r.status} ${r.text}`);
check("...the rest of the server keeps running", (await app.inject({ method: "GET", url: "/health" })).statusCode === 200);
r = await post(app, body, {});
check("...even a request with no headers gets the same clear 503, not a verification error", r.status === 503);
await app.close();

console.log("\n## rate limiting still applies");
({ app } = await build({ rate: 3, path: join(dir, "rate.db") }));
const statuses: number[] = [];
for (let i = 0; i < 5; i++) statuses.push((await post(app, "{}", {})).status);
check("after 3 requests the limit answers 429", statuses.slice(0, 3).every((s) => s === 401) && statuses.slice(3).every((s) => s === 429), JSON.stringify(statuses));
await app.close();

for (const d of openDbs) d.close(); // Windows cannot delete files that are still open
rmSync(dir, { recursive: true, force: true });
process.exitCode = failed ? 1 : 0;
console.log(failed ? "\nSOME CHECKS FAILED" : "\nall dodo self-test checks passed");
