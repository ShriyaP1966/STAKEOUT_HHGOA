// One command for every check that needs no server, no network and no real LLM call.
// Usage: npm run check   (exits non-zero if any check fails)
import { spawnSync } from "node:child_process";

const checks = [
  "typecheck", "verifier-selftest", "llm-selftest", "summary-selftest", "timezone-selftest", "evidence-selftest", "decide-selftest", "blocklist-selftest", "notify-selftest", "notify-test-selftest", "dev-graph-selftest", "dodo-selftest", "verifier-status-selftest", "env-parity",
];

let failures = 0;
for (const name of checks) {
  const started = Date.now();
  // Run npm's own script through this node binary, so no shell is involved (npm sets npm_execpath).
  const npmCli = process.env.npm_execpath;
  const run = npmCli
    ? spawnSync(process.execPath, [npmCli, "run", "-s", name], { encoding: "utf8" })
    : spawnSync("npm", ["run", "-s", name], { shell: true, encoding: "utf8" });
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  const passed = run.status === 0;
  console.log(`${passed ? "PASS" : "FAIL"}  ${name}  (${seconds}s)`);
  if (!passed) {
    failures++;
    const output = `${run.stdout ?? ""}${run.stderr ?? ""}`.trim().split(/\r?\n/);
    // show the failing lines if there are any, otherwise the tail of the output
    const interesting = output.filter((l) => /FAIL|MISMATCH|error/i.test(l));
    console.log((interesting.length ? interesting : output.slice(-8)).slice(0, 12).map((l) => `      ${l}`).join("\n"));
  }
}
console.log(`\n${checks.length - failures} of ${checks.length} checks passed${failures ? `; ${failures} FAILED` : ""}`);
process.exitCode = failures ? 1 : 0;
