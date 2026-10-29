// Offline self-test for the DEV-ONLY stand-in Graph Service and its fixture generator. Uses generated random addresses only.
// It runs the REAL scripts as child processes and talks to the stub with the verifier's own graph client and decision code.
// Usage: npm run dev-graph-selftest
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { networkInterfaces, tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Wallet, getAddress, hexlify, randomBytes } from "ethers";
import type { Rules } from "../config.js";
import { RULE, decideConfirm, decideLink } from "../verifier/decide.js";
import { fetchAnalysis, fetchLinkCandidates } from "../verifier/graphClient.js";

let failed = false;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}: ${name}${detail ? ` (${detail})` : ""}`);
  if (!ok) failed = true;
};

const backend = fileURLToPath(new URL("../../", import.meta.url));
const dir = mkdtempSync(join(tmpdir(), "dev-graph-"));
const localChain = 31337; // the local Hardhat chain id the stub insists on
const rules: Rules = { behaviorThreshold: 5, minSignals: 2, reportConfidenceBoostPerReporter: 1, confirmationsToWait: 1 };
const rulesPath = join(dir, "rules.json");
writeFileSync(rulesPath, JSON.stringify(rules));

function makeSeed(overrides: Record<string, unknown> = {}) {
  const a = () => Wallet.createRandom().address;
  const seed = {
    dataSource: "synthetic", chainId: localChain, stakeoutAddress: a(), clusterId: hexlify(randomBytes(32)),
    targets: { fresh: a(), reported: a(), flagged: a(), challenged: a(), member: a(), exitPoint: a(), linked: a() },
    evidence: {}, actors: { reporterA: a(), reporterB: a(), victim: a() }, ...overrides,
  };
  return seed;
}

type Run = { code: number | null; out: string };
function run(script: string, env: Record<string, string>, args: string[] = []): Promise<Run> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ["node_modules/tsx/dist/cli.mjs", `src/scripts/${script}`, ...args], { cwd: backend, env: { ...process.env, ...env } });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    child.on("close", (code) => resolve({ code, out }));
  });
}

const freePort = () => new Promise<number>((resolve) => {
  const s = createServer();
  s.listen(0, "127.0.0.1", () => { const p = (s.address() as { port: number }).port; s.close(() => resolve(p)); });
});

const fixtureEnv = (fixturePath: string, extra: Record<string, string> = {}) => ({ GRAPH_FIXTURE_PATH: fixturePath, DATA_SOURCE: "synthetic", CHAIN_ID: String(localChain), RULES_PATH: rulesPath, ...extra });

// ---- 1. generator
const seed = makeSeed();
const seedPath = join(dir, "seed.json");
writeFileSync(seedPath, JSON.stringify(seed));
const fixturePath = join(dir, "fixture.json");
const gen = await run("dev-graph-fixture.ts", fixtureEnv(fixturePath), [seedPath]);
check("generator succeeds on a generated seed", gen.code === 0, gen.out.trim().split("\n")[0]);
const fixture = JSON.parse(readFileSync(fixturePath, "utf8"));
const byTarget = (t: string) => fixture.analyses.find((a: { target: string }) => a.target === getAddress(t));
const flagged = byTarget(seed.targets.flagged), challenged = byTarget(seed.targets.challenged);
check("flagged target is above the threshold and the minimum signals", flagged.behaviorScore >= rules.behaviorThreshold && flagged.signals.length >= rules.minSignals);
check("challenged target is below the threshold", challenged.behaviorScore < rules.behaviorThreshold);
check("flagged target gets its own new cluster id, different from the seed's", flagged.clusterId !== null && flagged.clusterId !== seed.clusterId);
check("member, exit point and linked address carry link facts for the seed's cluster", [seed.targets.member, seed.targets.exitPoint, seed.targets.linked].every((t) => { const a = byTarget(t); return a?.link && a.clusterId === seed.clusterId; }));
check("link candidates list those three for the seed's cluster", (() => { const c = fixture.linkCandidates.find((x: { clusterId: string }) => x.clusterId === seed.clusterId); return c?.candidates.length === 3; })());
check("fixture is labelled synthetic with the seed's chain id", fixture.dataSource === "synthetic" && fixture.chainId === localChain);

// a different seed and different thresholds give different output (nothing is typed in the source)
const otherRules = { ...rules, behaviorThreshold: 40, minSignals: 4 };
writeFileSync(rulesPath, JSON.stringify(otherRules));
const seed2 = makeSeed();
const seed2Path = join(dir, "seed2.json");
writeFileSync(seed2Path, JSON.stringify(seed2));
const fixture2Path = join(dir, "fixture2.json");
const gen2 = await run("dev-graph-fixture.ts", fixtureEnv(fixture2Path), [seed2Path]);
const text2 = readFileSync(fixture2Path, "utf8");
const f2 = JSON.parse(text2);
check("a new seed and new thresholds regenerate cleanly", gen2.code === 0 && f2.analyses.find((a: { target: string }) => a.target === getAddress(seed2.targets.flagged)).behaviorScore >= 40);
check("nothing from the first seed leaks into the second fixture", !text2.toLowerCase().includes(seed.targets.flagged.toLowerCase()) && !text2.includes(seed.clusterId));
writeFileSync(rulesPath, JSON.stringify(rules));

// generator refusals
const badSeedPath = join(dir, "seed-testnet.json");
writeFileSync(badSeedPath, JSON.stringify(makeSeed({ dataSource: "testnet" })));
const r1 = await run("dev-graph-fixture.ts", fixtureEnv(join(dir, "x1.json")), [badSeedPath]);
check("generator refuses a seed not labelled synthetic", r1.code === 1 && /synthetic/.test(r1.out));
const r2 = await run("dev-graph-fixture.ts", fixtureEnv(join(dir, "x2.json"), { DATA_SOURCE: "testnet" }), [seedPath]);
check("generator refuses DATA_SOURCE=testnet", r2.code === 1 && /synthetic/.test(r2.out));
const r3 = await run("dev-graph-fixture.ts", fixtureEnv(join(dir, "x3.json"), { CHAIN_ID: "84532" }), [seedPath]);
check("generator refuses a seed for a different chain", r3.code === 1 && /different chain/.test(r3.out));
const r4 = await run("dev-graph-fixture.ts", fixtureEnv(join(dir, "x4.json")), []);
check("generator without a seed path says what to pass", r4.code === 1 && /path of the seed file/.test(r4.out));
const r5 = await run("dev-graph-fixture.ts", fixtureEnv(join(dir, "x5.json")), [join(dir, "missing.json")]);
check("generator with a missing seed file says so", r5.code === 1 && /cannot read the seed file/.test(r5.out));
const r6 = await run("dev-graph-fixture.ts", fixtureEnv(join(dir, "x6.json"), { RULES_PATH: join(dir, "nope.json") }), [seedPath]);
check("generator with a missing rules file stops", r6.code === 1 && /Rules file not found/.test(r6.out));

// ---- 2. the stub, started as the real script
const port = await freePort();
const base = `http://127.0.0.1:${port}`;
const stubEnv = (extra: Record<string, string> = {}) => ({ GRAPH_FIXTURE_PATH: fixturePath, DATA_SOURCE: "synthetic", CHAIN_ID: String(localChain), GRAPH_SERVICE_URL: base, ...extra });

const child = spawn(process.execPath, ["node_modules/tsx/dist/cli.mjs", "src/scripts/dev-graph-stub.ts"], { cwd: backend, env: { ...process.env, ...stubEnv() } });
let stubOut = "";
child.stdout.on("data", (d) => (stubOut += d));
child.stderr.on("data", (d) => (stubOut += d));
const up = async () => { for (let i = 0; i < 80; i++) { if (/Listening on/.test(stubOut)) return true; await new Promise((r) => setTimeout(r, 250)); } return false; };

try {
  check("stub starts and prints the banner", (await up()) && stubOut.includes("DEV STAND-IN, NOT Person 1's Graph Service, synthetic data only"));
  check("stub says it listens on loopback only", stubOut.includes(`Listening on 127.0.0.1:${port} only`));

  // with the verifier's own client: the proposed shapes parse
  const timeout = 5000;
  const gotFlagged = await fetchAnalysis(base, seed.targets.flagged, timeout);
  const gotCandidates = await fetchLinkCandidates(base, seed.clusterId, timeout);
  check("the verifier's graph client parses the analysis", gotFlagged.target === getAddress(seed.targets.flagged) && gotFlagged.dataSource === "synthetic");
  check("the verifier's graph client parses the link candidates", gotCandidates.candidates.length === 3);
  check("lookup is case-insensitive", (await fetchAnalysis(base, seed.targets.flagged.toLowerCase(), timeout)).target === getAddress(seed.targets.flagged));

  // with the verifier's own decision code: the flagged target confirms, the challenged one is refused, link facts link
  const deps = {
    rules,
    fetchAnalysis: (t: string) => fetchAnalysis(base, t, timeout),
    createEvidence: async () => ({ hash: hexlify(randomBytes(32)) }),
  } as unknown as Parameters<typeof decideConfirm>[0];
  const confirmPlan = await decideConfirm(deps, seed.targets.flagged);
  check("decideConfirm confirms the flagged target from the stub's answer", confirmPlan.action === "confirm");
  const refusePlan = await decideConfirm(deps, seed.targets.challenged);
  check("decideConfirm refuses the challenged target (weak behavior)", refusePlan.action === "refuse" && refusePlan.rule === RULE.behaviorThreshold);
  const linkPlan = await decideLink(deps, seed.targets.linked, seed.clusterId);
  check("decideLink links the structured-outflow address", linkPlan.action === "link" && linkPlan.rule === "link:structured-outflow");
  const memberPlan = await decideLink(deps, seed.targets.member, seed.clusterId);
  check("decideLink links the funded-and-forwards address", memberPlan.action === "link" && memberPlan.rule === "link:funded-and-forwards");

  // errors and limits
  const get = (path: string, method = "GET") => fetch(base + path, { method });
  const unknown = await get(`/analysis/${Wallet.createRandom().address}`);
  check("an address not in the fixture answers 404", unknown.status === 404);
  check("a malformed address answers 400", (await get("/analysis/not-an-address")).status === 400);
  check("an unknown cluster answers 404", (await get(`/clusters/${hexlify(randomBytes(32))}/link-candidates`)).status === 404);
  check("an unknown route answers 404", (await get("/health")).status === 404);
  check("a POST answers 405", (await get(`/analysis/${seed.targets.flagged}`, "POST")).status === 405);

  // bound to loopback only: the same port is not reachable through this machine's other IPv4 address, if it has one
  const external = Object.values(networkInterfaces()).flat().find((i) => i && i.family === "IPv4" && !i.internal);
  if (external) {
    const reachable = await fetch(`http://${external.address}:${port}/health`, { signal: AbortSignal.timeout(2000) }).then(() => true, () => false);
    check("the stub is not reachable on the machine's non-loopback address", !reachable);
  } else {
    console.log("SKIP: no non-loopback IPv4 address on this machine to test binding against");
  }
} finally {
  child.kill();
}

// ---- 3. refusals to start
const stubRefusal = async (name: string, extra: Record<string, string>, pattern: RegExp, fixtureFile = fixturePath) => {
  const r = await run("dev-graph-stub.ts", stubEnv({ GRAPH_FIXTURE_PATH: fixtureFile, GRAPH_SERVICE_URL: `http://127.0.0.1:${await freePort()}`, ...extra }));
  check(name, r.code === 1 && pattern.test(r.out) && !r.out.includes("DEV STAND-IN"), r.out.trim().split("\n")[0].slice(0, 100));
};
await stubRefusal("refuses DATA_SOURCE=testnet", { DATA_SOURCE: "testnet" }, /DATA_SOURCE must be synthetic/);
await stubRefusal("refuses a CHAIN_ID that is not the local chain", { CHAIN_ID: "84532" }, /CHAIN_ID must be 31337/);
await stubRefusal("refuses a GRAPH_SERVICE_URL that is not this machine", { GRAPH_SERVICE_URL: "http://graph.example.com:8001" }, /must point at this machine/);
await stubRefusal("refuses a GRAPH_SERVICE_URL without a port", { GRAPH_SERVICE_URL: "http://127.0.0.1" }, /explicit port/);
await stubRefusal("refuses a missing fixture file", {}, /fixture file not found/, join(dir, "nope.json"));
writeFileSync(join(dir, "garbage.json"), "{ not json");
await stubRefusal("refuses a fixture that is not JSON", {}, /not valid JSON/, join(dir, "garbage.json"));
writeFileSync(join(dir, "wrongshape.json"), JSON.stringify({ dataSource: "synthetic", chainId: localChain, generatedAt: "x", analyses: [{ target: "nope" }], linkCandidates: [] }));
await stubRefusal("refuses a fixture that does not match the proposed schema", {}, /does not match the proposed schema/, join(dir, "wrongshape.json"));
writeFileSync(join(dir, "testnet-fixture.json"), JSON.stringify({ ...fixture, dataSource: "testnet" }));
await stubRefusal("refuses a fixture not labelled synthetic", {}, /not labelled synthetic|does not match/, join(dir, "testnet-fixture.json"));
writeFileSync(join(dir, "otherchain-fixture.json"), JSON.stringify({ ...fixture, chainId: 5 }));
await stubRefusal("refuses a fixture generated for a different chain", {}, /different chain/, join(dir, "otherchain-fixture.json"));
await stubRefusal("refuses when GRAPH_FIXTURE_PATH is empty", { GRAPH_FIXTURE_PATH: "" }, /GRAPH_FIXTURE_PATH/);

// ---- 4. source hygiene: no address literals in the stand-in's source
const files = ["src/devGraph/fixture.ts", "src/scripts/dev-graph-stub.ts", "src/scripts/dev-graph-fixture.ts"];
check("no address-like literal in the stand-in's source", files.every((f) => !/0x[0-9a-fA-F]{40}/.test(readFileSync(join(backend, f), "utf8"))));
check("the stub only calls listen on the loopback constant", /listen\(Number\(url\.port\), LOOPBACK/.test(readFileSync(join(backend, "src/scripts/dev-graph-stub.ts"), "utf8")));

rmSync(dir, { recursive: true, force: true });
if (failed) { console.log("\nSome checks FAILED."); process.exitCode = 1; } else console.log("\nAll dev-graph stand-in checks passed.");
