// Offline self-test for `npm run notify-test`. It runs the REAL script as a child process against a LOCAL stub webhook
// (test-only) and checks exactly what it sends and prints. It never contacts a real webhook such as viaSocket.
// Usage: npm run notify-test-selftest
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { createServer, type IncomingHttpHeaders, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Wallet } from "ethers";

let failed = false;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}: ${name}${detail ? ` (${detail})` : ""}`);
  if (!ok) failed = true;
};

const backend = fileURLToPath(new URL("../../", import.meta.url));

// ---- local stub webhook
type Mode = "ok" | "http-500" | "hang";
let mode: Mode = "ok";
const bodyMarker = "RESPONSE_BODY_" + Wallet.createRandom().address.slice(2, 12); // must never be printed
const received: Array<{ method?: string; headers: IncomingHttpHeaders; body: string }> = [];
const hook: Server = createServer((req, res) => {
  let body = "";
  req.on("data", (d) => (body += d));
  req.on("end", () => {
    received.push({ method: req.method, headers: req.headers, body });
    if (mode === "hang") return;
    res.statusCode = mode === "http-500" ? 500 : 200;
    res.end(`{"detail":"${bodyMarker}"}`);
  });
});
await new Promise<void>((r) => hook.listen(0, "127.0.0.1", r));
const secretPath = "SECRETPATH" + Wallet.createRandom().address.slice(2, 10);
const secretQuery = "SECRETQUERY" + Wallet.createRandom().address.slice(2, 10);
const port = (hook.address() as AddressInfo).port;
const hookUrl = `http://127.0.0.1:${port}/hooks/${secretPath}?token=${secretQuery}`;

type Run = { code: number | null; out: string; ms: number };
async function run(env: Record<string, string>): Promise<Run> {
  const started = Date.now();
  const child = spawn(process.execPath, ["node_modules/tsx/dist/cli.mjs", "src/scripts/notify-test.ts"], { cwd: backend, env: { ...process.env, ...env } });
  let out = "";
  child.stdout.on("data", (d) => (out += d));
  child.stderr.on("data", (d) => (out += d));
  const code: number | null = await new Promise((resolve) => child.on("close", resolve));
  return { code, out, ms: Date.now() - started };
}
const lines = (r: Run) => r.out.split(/\r?\n/).filter((l) => l.trim() !== "");
const leaks = (r: Run) => [secretPath, secretQuery, hookUrl, bodyMarker, "127.0.0.1", String(port), "http://"].filter((s) => r.out.includes(s));
const allRuns: Run[] = [];
const sampleTarget = "0x" + "1".repeat(40);

console.log("\n## success");
mode = "ok"; received.length = 0;
let r = await run({ NOTIFY_WEBHOOK_URL: hookUrl, NOTIFY_TIMEOUT_MS: "3000" }); allRuns.push(r);
check("exit code 0", r.code === 0, `exit ${r.code}`);
check("prints exactly three lines", lines(r).length === 3, JSON.stringify(lines(r)));
check("line 1 says success", /^SUCCESS/.test(lines(r)[0] ?? ""));
check("line 2 is the HTTP status", lines(r)[1] === "HTTP status: 200", lines(r)[1]);
check("line 3 is the elapsed milliseconds", /^Elapsed: \d+ ms$/.test(lines(r)[2] ?? ""), lines(r)[2]);
check("it never prints the URL, any part of it, or the response body", leaks(r).length === 0, leaks(r).join(","));
check("exactly ONE request reached the webhook, a POST with a JSON body", received.length === 1 && received[0].method === "POST" && String(received[0].headers["content-type"]).includes("application/json"), `${received.length} request(s)`);
const payload = JSON.parse(received[0]?.body ?? "{}");
check("the payload is the clearly labelled sample: id notify-test, outcome skipped, rule notify-test", payload.id === "notify-test" && payload.outcome === "skipped" && payload.rule === "notify-test", JSON.stringify(payload));
check("the target is the all-ones sample address and there is no tx hash", payload.target === sampleTarget && payload.txHash === null, String(payload.target));
check("the payload has exactly the notifier's public fields: id, kind, outcome, target, txHash, rule", JSON.stringify(Object.keys(payload).sort()) === '["id","kind","outcome","rule","target","txHash"]', Object.keys(payload).join(","));

console.log("\n## failures");
mode = "http-500"; received.length = 0;
r = await run({ NOTIFY_WEBHOOK_URL: hookUrl, NOTIFY_TIMEOUT_MS: "3000" }); allRuns.push(r);
check("webhook answers 500: exit 1, FAILURE, HTTP status 500", r.code === 1 && /^FAILURE/.test(lines(r)[0] ?? "") && lines(r)[1] === "HTTP status: 500", JSON.stringify(lines(r)));
check("...still three lines, and no URL or body", lines(r).length === 3 && leaks(r).length === 0, leaks(r).join(","));
mode = "hang"; received.length = 0;
r = await run({ NOTIFY_WEBHOOK_URL: hookUrl, NOTIFY_TIMEOUT_MS: "500" }); allRuns.push(r);
check("webhook never answers: exit 1, FAILURE, no HTTP status", r.code === 1 && /^FAILURE/.test(lines(r)[0] ?? "") && /^HTTP status: none/.test(lines(r)[1] ?? ""), JSON.stringify(lines(r)));
const elapsed = Number((lines(r)[2] ?? "").match(/(\d+) ms/)?.[1]);
check("...the elapsed time is about the configured timeout (500 ms)", elapsed >= 450 && elapsed < 3000, `${elapsed} ms`);
check("...no URL or body", leaks(r).length === 0, leaks(r).join(","));
mode = "ok";
r = await run({ NOTIFY_WEBHOOK_URL: `http://127.0.0.1:9/hooks/${secretPath}?token=${secretQuery}`, NOTIFY_TIMEOUT_MS: "3000" }); allRuns.push(r);
check("webhook unreachable: exit 1, FAILURE, no HTTP status", r.code === 1 && /^FAILURE/.test(lines(r)[0] ?? "") && /^HTTP status: none/.test(lines(r)[1] ?? ""), JSON.stringify(lines(r)));
check("...and the secret path and query token are not printed", !r.out.includes(secretPath) && !r.out.includes(secretQuery));

console.log("\n## configuration problems: nothing is sent");
received.length = 0;
r = await run({ NOTIFY_WEBHOOK_URL: "", NOTIFY_TIMEOUT_MS: "3000" }); allRuns.push(r);
check("NOTIFY_WEBHOOK_URL empty: exit 1 with a clear message naming it", r.code === 1 && /NOTIFY_WEBHOOK_URL is empty/.test(r.out) && /nothing to test/i.test(r.out), lines(r)[0]);
r = await run({ NOTIFY_WEBHOOK_URL: hookUrl, NOTIFY_TIMEOUT_MS: "" }); allRuns.push(r);
check("URL set but no timeout: exit 1 naming NOTIFY_TIMEOUT_MS", r.code === 1 && /NOTIFY_TIMEOUT_MS/.test(r.out), lines(r).join(" | "));
const badValue = "this is not a url " + secretPath;
r = await run({ NOTIFY_WEBHOOK_URL: badValue, NOTIFY_TIMEOUT_MS: "3000" }); allRuns.push(r);
check("a value that is not a URL: exit 1 naming NOTIFY_WEBHOOK_URL, without printing the value", r.code === 1 && /NOTIFY_WEBHOOK_URL/.test(r.out) && !r.out.includes(secretPath), lines(r).join(" | "));
check("none of the configuration problems sent a request", received.length === 0, `${received.length} request(s)`);

console.log("\n## it uses the real notifier code and never prints a secret");
const source = readFileSync(join(backend, "src/scripts/notify-test.ts"), "utf8");
check("the script imports makeNotifier from src/verifier/notify.ts", /makeNotifier/.test(source) && /verifier\/notify/.test(source));
check("the script does not call fetch itself (so it cannot behave differently from the verifier)", !/fetch\(/.test(source));
check("the script has no all-ones address literal (it is built from a repeat)", !/0x1{40}/.test(source));
check("the URL, its parts and the response body appear in the output of none of the runs", allRuns.every((x) => !x.out.includes(secretPath) && !x.out.includes(secretQuery) && !x.out.includes(bodyMarker)), `${allRuns.length} runs checked`);
check("every run ended on its own with a normal exit code (0 or 1), none crashed", allRuns.every((x) => x.code === 0 || x.code === 1), allRuns.map((x) => x.code).join(","));

hook.closeAllConnections();
await new Promise<void>((resolve) => hook.close(() => resolve()));
process.exitCode = failed ? 1 : 0;
console.log(failed ? "\nSOME CHECKS FAILED" : "\nall notify-test self-test checks passed");
