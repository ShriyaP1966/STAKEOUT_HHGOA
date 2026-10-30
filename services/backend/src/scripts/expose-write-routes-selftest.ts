// Self-test for EXPOSE_WRITE_ROUTES: config validation, and which routes exist in each mode.
// Fastify inject only: no network, no real AI call, no .env read. Usage: npm run expose-write-routes-selftest
import Fastify from "fastify";
import { serverEnv } from "../config.js";
import { openDb } from "../db.js";
import { installErrorHandler, makeRedactor, UserError } from "../errors.js";
import type { Llm } from "../llm.js";
import { describeRoutes, READ_ROUTES, registerRoutes, WRITE_ROUTES } from "../routes.js";

let failed = false;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}: ${name}${detail ? ` (${detail})` : ""}`);
  if (!ok) failed = true;
};

console.log('\n## config: exactly "true" or "false", no default');
const setting = serverEnv.pick({ EXPOSE_WRITE_ROUTES: true });
const parse = (value: string | undefined) => setting.safeParse(value === undefined ? {} : { EXPOSE_WRITE_ROUTES: value });
const t = parse("true"), f = parse("false");
check('"true" is accepted as true', t.success && t.data.EXPOSE_WRITE_ROUTES === true);
check('"false" is accepted as false', f.success && f.data.EXPOSE_WRITE_ROUTES === false);
for (const bad of [undefined, "", " ", "TRUE", "False", "1", "0", "yes", "no", " true", "true "]) {
  const r = parse(bad);
  check(`refused: ${bad === undefined ? "(missing)" : JSON.stringify(bad)}, and the message names EXPOSE_WRITE_ROUTES`, !r.success && r.error.issues[0].path.join(".") === "EXPOSE_WRITE_ROUTES");
}

console.log("\n## routes in each mode");
// test fixtures: a stub AI that must never be called here, an in-memory database, a stored bundle under a made-up hash
const llm: Llm = { model: "stub", complete: async () => { throw new Error("the AI must not be called by this test"); } };
const knownHash = "0x" + "ab".repeat(32);

async function build(exposeWriteRoutes: boolean) {
  const db = openDb(":memory:");
  db.saveEvidence(knownHash, { fixture: true });
  const app = Fastify();
  installErrorHandler(app, makeRedactor([]));
  const served = registerRoutes(app, {
    db, llm, dataSource: "synthetic", defaultTimezone: "UTC",
    graph: { baseUrl: "http://127.0.0.1:9", timeoutMs: 100 },
    loadRules: () => { throw new UserError("rules not used by this test", 503); },
    openBlocklist: async () => { throw new UserError("blocklist not used by this test", 503); },
    dodo: { secret: undefined, toleranceSeconds: undefined },
    decisions: { pageSize: 5, maxLimit: 10 },
    exposeWriteRoutes,
  });
  await app.ready();
  return { app, served };
}
type Built = Awaited<ReturnType<typeof build>>;
const call = async (app: Built["app"], method: "GET" | "POST", url: string) => {
  const r = await app.inject({ method, url, ...(method === "POST" ? { payload: {} } : {}) });
  return { code: r.statusCode, body: r.body };
};

const off = await build(false);
check('"false": the served list is exactly the three read routes', JSON.stringify(off.served) === JSON.stringify([...READ_ROUTES]), off.served.join(", "));
for (const [method, url] of [["POST", "/extract"], ["POST", "/evidence/build"], ["POST", "/webhooks/dodo"], ["GET", "/blocklist"]] as const) {
  const r = await call(off.app, method, url);
  check(`"false": ${method} ${url} is 404`, r.code === 404, `${r.code}`);
}
let r = await call(off.app, "GET", "/health");
check('"false": GET /health answers 200', r.code === 200 && JSON.parse(r.body).ok === true, `${r.code}`);
r = await call(off.app, "GET", "/decisions");
check('"false": GET /decisions answers 200', r.code === 200 && Array.isArray(JSON.parse(r.body).decisions), `${r.code}`);
r = await call(off.app, "GET", `/evidence/${knownHash}`);
check('"false": GET /evidence/:hash returns the stored bundle (200)', r.code === 200 && JSON.parse(r.body).hash === knownHash, `${r.code}`);
await off.app.close();

const on = await build(true);
check('"true": the served list is the three read routes plus the four write routes', JSON.stringify(on.served) === JSON.stringify([...READ_ROUTES, ...WRITE_ROUTES]), on.served.join(", "));
// every write route exists: it answers with its own error (400 bad body, 503 not configured), not the "route not found" 404
for (const [method, url, expected] of [["POST", "/extract", 400], ["POST", "/evidence/build", 400], ["POST", "/webhooks/dodo", 503], ["GET", "/blocklist", 503]] as const) {
  const res = await call(on.app, method, url);
  check(`"true": ${method} ${url} exists (${expected}, not 404)`, res.code === expected, `${res.code}`);
}
r = await call(on.app, "GET", "/health");
check('"true": GET /health answers 200', r.code === 200, `${r.code}`);
r = await call(on.app, "GET", "/decisions");
check('"true": GET /decisions answers 200', r.code === 200, `${r.code}`);
r = await call(on.app, "GET", `/evidence/${knownHash}`);
check('"true": GET /evidence/:hash returns the stored bundle (200)', r.code === 200, `${r.code}`);
await on.app.close();

console.log("\n## startup line");
const lineOff = describeRoutes(false, off.served), lineOn = describeRoutes(true, on.served);
check('the "false" line names the mode, the served routes and the routes not served', lineOff.includes("EXPOSE_WRITE_ROUTES=false") && READ_ROUTES.every((x) => lineOff.includes(x)) && WRITE_ROUTES.every((x) => lineOff.includes(x)) && lineOff.includes("Not served"));
check('the "true" line names the mode and every route, with no "Not served" part', lineOn.includes("EXPOSE_WRITE_ROUTES=true") && [...READ_ROUTES, ...WRITE_ROUTES].every((x) => lineOn.includes(x)) && !lineOn.includes("Not served"));

process.exitCode = failed ? 1 : 0;
console.log(failed ? "\nSome expose-write-routes checks FAILED" : "\nall expose-write-routes self-test checks passed");
