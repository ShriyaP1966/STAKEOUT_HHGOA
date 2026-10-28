// Offline self-test for `npm run verifier-status`. It runs the REAL script as a child process against a MOCK JSON-RPC node
// (test-only, built from the real ABI; not a chain) and records every JSON-RPC method the script calls, to prove it only reads.
// Usage: npm run verifier-status-selftest
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { AbiCoder, Interface, Wallet, id, parseEther } from "ethers";
import { loadAbi } from "../verifier/abi.js";

let failed = false;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}: ${name}${detail ? ` (${detail})` : ""}`);
  if (!ok) failed = true;
};

const backend = fileURLToPath(new URL("../../", import.meta.url));
const iface = new Interface(loadAbi() as never);
const coder = AbiCoder.defaultAbiCoder();

// the wallet the script must derive its address from (a generated key: it is never the real one)
const wallet = Wallet.createRandom();
const someoneElse = Wallet.createRandom().address;
const contract = Wallet.createRandom().address;
const fixtureChain = 7;

// ---- mock node, configured per scenario
type Mock = { chainId: number; hasCode: boolean; roleHolder: string | null; balanceWei: bigint };
let mock: Mock = { chainId: fixtureChain, hasCode: true, roleHolder: wallet.address, balanceWei: parseEther("1.5") };
const methodsSeen: string[] = [];
const server: Server = createServer((req, res) => {
  let body = "";
  req.on("data", (d) => (body += d));
  req.on("end", () => {
    const handle = (m: { id: number; method: string; params: Array<{ data?: string } | string> }) => {
      methodsSeen.push(m.method);
      const r = (result: unknown) => ({ jsonrpc: "2.0", id: m.id, result });
      switch (m.method) {
        case "eth_chainId": return r("0x" + mock.chainId.toString(16));
        case "eth_getCode": return r(mock.hasCode ? "0x6080" : "0x");
        case "eth_getBalance": return r("0x" + mock.balanceWei.toString(16));
        case "eth_call": {
          const parsed = iface.parseTransaction({ data: (m.params[0] as { data: string }).data });
          if (parsed?.name === "VERIFIER_ROLE") return r(id("VERIFIER_ROLE"));
          if (parsed?.name === "hasRole") {
            // true only for the configured holder, so the test proves the script asks about the address derived from its key
            const asked = String(parsed.args[1]).toLowerCase();
            return r(coder.encode(["bool"], [mock.roleHolder !== null && asked === mock.roleHolder.toLowerCase()]));
          }
          return { jsonrpc: "2.0", id: m.id, error: { code: -32000, message: "mock: unexpected call" } };
        }
        default: return { jsonrpc: "2.0", id: m.id, error: { code: -32601, message: "mock: " + m.method } };
      }
    };
    const parsed = JSON.parse(body);
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify(Array.isArray(parsed) ? parsed.map(handle) : handle(parsed)));
  });
});
await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
const secretPath = "SECRETPATH" + Wallet.createRandom().address.slice(2, 10);
const secretQuery = "SECRETQUERY" + Wallet.createRandom().address.slice(2, 10);
const mockUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v3/${secretPath}?apikey=${secretQuery}`;

const dir = mkdtempSync(join(tmpdir(), "vstatus-"));
const deployFile = (chainId: number) => {
  const f = join(dir, `deployment-${chainId}.json`);
  writeFileSync(f, JSON.stringify({ chainId, stakeoutAddress: contract, deploymentBlock: 0 }));
  return f;
};

type Run = { code: number | null; out: string; methods: string[] };
async function run(env: Record<string, string>, scenario: Partial<Mock> = {}): Promise<Run> {
  mock = { chainId: fixtureChain, hasCode: true, roleHolder: wallet.address, balanceWei: parseEther("1.5"), ...scenario };
  methodsSeen.length = 0;
  const child = spawn(process.execPath, ["node_modules/tsx/dist/cli.mjs", "src/scripts/verifier-status.ts"], {
    cwd: backend,
    env: {
      ...process.env,
      RPC_URL: mockUrl, CHAIN_ID: String(fixtureChain), VERIFIER_PRIVATE_KEY: wallet.privateKey, DEPLOYMENT_PATH: deployFile(fixtureChain), RPC_TIMEOUT_MS: "3000",
      ...env,
    },
  });
  let out = "";
  child.stdout.on("data", (d) => (out += d));
  child.stderr.on("data", (d) => (out += d));
  const code: number | null = await new Promise((resolve) => child.on("close", resolve));
  return { code, out, methods: [...methodsSeen] };
}

const allRuns: Run[] = [];
const leaks = (r: Run) =>
  [secretPath, secretQuery, wallet.privateKey, wallet.privateKey.slice(2), mockUrl].filter((s) => r.out.includes(s));

console.log("\n## healthy: matching chain, role held, balance");
let r = await run({}); allRuns.push(r);
check("exit code 0", r.code === 0, `exit ${r.code}`);
check("prints the chain id the RPC reports", r.out.includes(`chain id reported by the RPC: ${fixtureChain}`));
check("says it equals CHAIN_ID", /equals CHAIN_ID: yes/.test(r.out));
check("prints the PUBLIC address derived from the key", r.out.includes(`verifier public address: ${wallet.address}`));
check("role held: yes", /holds VERIFIER_ROLE on that contract: yes/.test(r.out));
check("balance in ETH", /balance: 1\.5 ETH/.test(r.out) && !/zero/.test(r.out), r.out.split("\n").find((l) => /balance/.test(l)) ?? "");
check("says nothing was sent", /Nothing was sent/.test(r.out));
check("it asked the node about the derived address (the mock only answers yes for it)", r.methods.includes("eth_call") && r.methods.includes("eth_getBalance"));

console.log("\n## zero balance");
r = await run({}, { balanceWei: 0n }); allRuns.push(r);
check("exit code 0 (a dry run needs no gas) and the balance reads 0.0 ETH with the explanation", r.code === 0 && /balance: 0\.0 ETH \(zero: fine for a dry run/.test(r.out), r.out.split("\n").find((l) => /balance/.test(l)) ?? "");

console.log("\n## wrong chain");
r = await run({}, { chainId: 99 }); allRuns.push(r);
check("exit code 1", r.code === 1);
check("reports the node's chain and that it does NOT equal CHAIN_ID", /chain id reported by the RPC: 99/.test(r.out) && /equals CHAIN_ID: NO: CHAIN_ID is 7/.test(r.out));
check("stops before the contract and balance checks, and says why", /Stopping here/.test(r.out) && !/holds VERIFIER_ROLE/.test(r.out) && !r.methods.includes("eth_getBalance") && !r.methods.includes("eth_call"));

console.log("\n## role missing");
r = await run({}, { roleHolder: null }); allRuns.push(r);
check("exit code 1 and the line says NO with what to do", r.code === 1 && /holds VERIFIER_ROLE on that contract: NO\. Ask Person 3/.test(r.out));
r = await run({}, { roleHolder: someoneElse }); allRuns.push(r);
check("the role held by a DIFFERENT address does not count: still NO", r.code === 1 && /holds VERIFIER_ROLE on that contract: NO/.test(r.out));

console.log("\n## contract and deployment problems");
r = await run({}, { hasCode: false }); allRuns.push(r);
check("no contract code: exit 1, says redeploy, and no role call is made", r.code === 1 && /No contract code/.test(r.out) && !r.methods.includes("eth_call"));
r = await run({ DEPLOYMENT_PATH: deployFile(99) }); allRuns.push(r);
check("deployment file for another chain: flagged as a PROBLEM", r.code === 1 && /PROBLEM\s+deployment file chain id: 99/.test(r.out));
r = await run({ DEPLOYMENT_PATH: join(dir, "missing.json") }); allRuns.push(r);
check("deployment file missing: exit 1 and it says Person 3 owns it", r.code === 1 && /Person 3 owns it/.test(r.out));

console.log("\n## unreachable RPC and missing settings");
const deadUrl = `http://127.0.0.1:9/v3/${secretPath}?apikey=${secretQuery}`;
r = await run({ RPC_URL: deadUrl }); allRuns.push(r);
check("unreachable RPC: exit 1 and a clear message with the host only", r.code === 1 && /Cannot reach the RPC endpoint 127\.0\.0\.1:9/.test(r.out) && /Nothing was sent/.test(r.out), r.out.split("\n")[0]);
check("...and the secret path and query token from the URL are NOT in the output", !r.out.includes(secretPath) && !r.out.includes(secretQuery) && !r.out.includes(deadUrl));
r = await run({ RPC_URL: "" }); allRuns.push(r);
check("RPC_URL empty: exit 1 naming RPC_URL", r.code === 1 && /RPC_URL/.test(r.out));
r = await run({ VERIFIER_PRIVATE_KEY: "" }); allRuns.push(r);
check("VERIFIER_PRIVATE_KEY empty: exit 1 naming it", r.code === 1 && /VERIFIER_PRIVATE_KEY/.test(r.out));
r = await run({ CHAIN_ID: "" }); allRuns.push(r);
check("CHAIN_ID empty: exit 1 naming it", r.code === 1 && /CHAIN_ID/.test(r.out));

console.log("\n## it never sends a transaction and never prints a secret");
const methods = new Set(allRuns.flatMap((x) => x.methods));
const allowed = new Set(["eth_chainId", "eth_getCode", "eth_call", "eth_getBalance"]);
check("the only JSON-RPC methods ever called are read-only ones", [...methods].every((m) => allowed.has(m)), [...methods].join(", "));
check("no eth_send*, eth_sign* or personal_* method was ever called", ![...methods].some((m) => /^(eth_send|eth_sign|personal_)/.test(m)));
const source = readFileSync(join(backend, "src/scripts/verifier-status.ts"), "utf8");
check("the script source has no sendTransaction, signer or write call", !/sendTransaction|signTransaction|getSigner|\.confirm\(|\.link\(|connect\(/.test(source));
check("the private key and the RPC URL never appear in the output of ANY scenario above", allRuns.every((x) => leaks(x).length === 0), allRuns.flatMap(leaks).join(",") || `${allRuns.length} runs checked`);

server.close();
rmSync(dir, { recursive: true, force: true });
process.exitCode = failed ? 1 : 0;
console.log(failed ? "\nSOME CHECKS FAILED" : "\nall verifier-status self-test checks passed");
