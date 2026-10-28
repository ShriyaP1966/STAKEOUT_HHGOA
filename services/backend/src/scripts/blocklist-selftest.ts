// Self-test for GET /blocklist (PROPOSED hash rule) against a MOCK JSON-RPC node built from the real ABI.
// The mock is test-only: it is not a chain and is never used at runtime. Usage: npm run blocklist-selftest
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify from "fastify";
import { Interface, Wallet, getBytes, hexlify, keccak256, randomBytes } from "ethers";
import { Status } from "../../../../shared/enums.js";
import { BLOCKLIST_HASH_RULE, BlocklistIndex, hashAddress, liveChainReader, openBlocklist, registerBlocklistRoute } from "../blocklist.js";
import { installErrorHandler, makeRedactor } from "../errors.js";
import { loadAbi } from "../verifier/abi.js";

let failed = false;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}: ${name}${detail ? ` (${detail})` : ""}`);
  if (!ok) failed = true;
};
const addr = () => Wallet.createRandom().address;
const bytes32 = () => hexlify(randomBytes(32));

const abi = loadAbi();
const iface = new Interface(abi as never);
const contract = addr();
const other = addr();
const chainId = 7; // test fixture

// ---- mock node
type MockLog = { address: string; blockNumber: number; topics: string[]; data: string };
const logs: MockLog[] = [];
let latestBlock = 20;
const ranges: Array<[number, number]> = [];
let hasCode = true;
let reportedChain = chainId;

function emit(name: string, values: unknown[], block: number, address = contract) {
  const frag = iface.getEvent(name)!;
  const { data, topics } = iface.encodeEventLog(frag, values);
  logs.push({ address, blockNumber: block, topics, data });
}

const mock: Server = createServer((req, res) => {
  let body = "";
  req.on("data", (d) => (body += d));
  req.on("end", () => {
    const handle = (m: { id: number; method: string; params: unknown[] }) => {
      const r = (result: unknown) => ({ jsonrpc: "2.0", id: m.id, result });
      if (m.method === "eth_chainId") return r("0x" + reportedChain.toString(16));
      if (m.method === "eth_blockNumber") return r("0x" + latestBlock.toString(16));
      if (m.method === "eth_getCode") return r(hasCode ? "0x6080" : "0x");
      if (m.method === "eth_getLogs") {
        const f = m.params[0] as { fromBlock: string; toBlock: string; address: string; topics: Array<string | string[] | null> };
        const from = Number(BigInt(f.fromBlock)), to = Number(BigInt(f.toBlock));
        ranges.push([from, to]);
        const first = f.topics?.[0];
        const wanted = Array.isArray(first) ? first : first ? [first] : null;
        const hits = logs
          .filter((l) => l.address.toLowerCase() === f.address.toLowerCase() && l.blockNumber >= from && l.blockNumber <= to && (!wanted || wanted.includes(l.topics[0])))
          .map((l, i) => ({
            address: l.address, topics: l.topics, data: l.data, blockNumber: "0x" + l.blockNumber.toString(16),
            blockHash: "0x" + l.blockNumber.toString(16).padStart(64, "0"), transactionHash: "0x" + (i + 1).toString(16).padStart(64, "0"),
            transactionIndex: "0x0", logIndex: "0x" + i.toString(16), removed: false,
          }));
        return r(hits);
      }
      return { jsonrpc: "2.0", id: m.id, error: { code: -32601, message: "mock: " + m.method } };
    };
    const parsed = JSON.parse(body);
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify(Array.isArray(parsed) ? parsed.map(handle) : handle(parsed)));
  });
});
await new Promise<void>((r) => mock.listen(0, "127.0.0.1", r));
const rpcBase = `http://127.0.0.1:${(mock.address() as AddressInfo).port}`;

// ---- a small history: two clusters, one link, one removal, plus noise that must be ignored
const [m1, m2, e1, l1, m3, e3] = [addr(), addr(), addr(), addr(), addr(), addr()];
const clusterA = bytes32(), clusterB = bytes32(), ev = bytes32();
emit("Confirmed", [clusterA, [m1, m2], [e1], ev], 5);
emit("Linked", [l1, clusterA, ev], 8);
emit("Confirmed", [clusterB, [m3], [e3], ev], 9);
emit("MemberRemoved", [m2, clusterA], 12);
emit("Promoted", [1n, 1n, addr(), addr(), 1n, 0n], 6); // not a blocklist event
emit("Confirmed", [bytes32(), [addr()], [], ev], 7, other); // another contract: ignored

console.log("\n## the PROPOSED hash rule");
check("rule text is exported for the docs", typeof BLOCKLIST_HASH_RULE === "string" && /keccak256/.test(BLOCKLIST_HASH_RULE) && /PROPOSED/.test(BLOCKLIST_HASH_RULE), BLOCKLIST_HASH_RULE);
const sample = addr();
check("hashAddress = keccak256 of the 20 address bytes (independent computation)", hashAddress(sample) === keccak256(getBytes(sample)));
check("case does not matter: lowercase, checksummed and UPPERCASE hex give the same hash", hashAddress(sample.toLowerCase()) === hashAddress(sample) && hashAddress("0x" + sample.slice(2).toUpperCase()) === hashAddress(sample));
check("a hash is 0x + 64 hex", /^0x[0-9a-f]{64}$/.test(hashAddress(sample)));
check("different addresses give different hashes", hashAddress(addr()) !== hashAddress(addr()));
let threw = "";
try { hashAddress("not an address"); } catch (e) { threw = (e as Error).message; }
check("an invalid address is rejected, not hashed", threw.length > 0);

console.log("\n## the index (mock node)");
const { JsonRpcProvider } = await import("ethers");
const rpcProvider = new JsonRpcProvider(rpcBase, chainId, { staticNetwork: true });
const index = new BlocklistIndex(liveChainReader(rpcProvider), abi, contract, 0, 3);
await index.refresh();
let snap = index.snapshot();
const expectedIn = [m1, e1, l1, m3, e3].map(hashAddress);
check("Confirmed members and exit points and Linked wallets are listed", expectedIn.every((h) => snap.hashes.includes(h)), `${snap.hashes.length} hashes`);
check("a wallet removed by MemberRemoved is NOT listed", !snap.hashes.includes(hashAddress(m2)));
check("exactly the expected wallets (noise from another contract and Promoted events ignored)", snap.hashes.length === expectedIn.length);
check("hashes are sorted and unique", JSON.stringify(snap.hashes) === JSON.stringify([...new Set(snap.hashes)].sort()));
check("scan range reported: from the first block to the latest", snap.scannedFromBlock === 0 && snap.scannedToBlock === latestBlock, `${snap.scannedFromBlock}..${snap.scannedToBlock}`);
check("log requests are chunked (each at most 3 blocks) and cover every block exactly once", ranges.every(([a, b]) => b - a + 1 <= 3) && ranges[0][0] === 0 && ranges.at(-1)![1] === latestBlock && ranges.every((r, i) => i === 0 || r[0] === ranges[i - 1][1] + 1), JSON.stringify(ranges.slice(0, 4)) + "...");

ranges.length = 0;
latestBlock = 25;
emit("Linked", [m2, clusterB, ev], 22); // m2 comes back as a Linked wallet
await index.refresh();
snap = index.snapshot();
check("a second refresh scans only the new blocks (starts right after the last scan)", ranges.length > 0 && ranges[0][0] === 21, JSON.stringify(ranges));
check("the new Linked wallet appears, nothing else changes", snap.hashes.includes(hashAddress(m2)) && snap.hashes.length === expectedIn.length + 1);
ranges.length = 0;
await index.refresh();
check("a refresh with no new blocks makes no log request", ranges.length === 0);

console.log("\n## event names come from the ABI; a missing event is a loud error");
const without = (name: string) => (abi as Array<{ type: string; name?: string }>).filter((x) => !(x.type === "event" && x.name === name));
for (const [label, name] of [["Confirmed", Status[Status.Confirmed]], ["Linked", Status[Status.Linked]], ["MemberRemoved", "MemberRemoved"]] as const) {
  let msg = "";
  try { new BlocklistIndex(liveChainReader(rpcProvider), without(name) as never, contract, 0, 3); } catch (e) { msg = (e as Error).message; }
  check(`an ABI without ${label}: constructor refuses and names the event`, msg.includes(name), msg);
}
check("the Confirmed and Linked event names are the Status enum's names", Status[Status.Confirmed] === "Confirmed" && Status[Status.Linked] === "Linked");

console.log("\n## GET /blocklist (route, lazy configuration)");
const dir = mkdtempSync(join(tmpdir(), "blocklist-"));
const deployFile = join(dir, "deployment.json");
writeFileSync(deployFile, JSON.stringify({ chainId, stakeoutAddress: contract, deploymentBlock: 0 }));
const secretPath = "SECRETPATH" + Wallet.createRandom().address.slice(2, 10);
const goodEnv = { RPC_URL: `${rpcBase}/${secretPath}`, CHAIN_ID: String(chainId), DEPLOYMENT_PATH: deployFile, RPC_TIMEOUT_MS: "2000", BLOCKLIST_LOG_CHUNK_BLOCKS: "10" };

async function get(env: Record<string, string | undefined>, repeat = 1) {
  const app = Fastify();
  installErrorHandler(app, makeRedactor([env.RPC_URL]));
  registerBlocklistRoute(app, { open: () => openBlocklist(env), dataSource: "synthetic", now: () => new Date("2026-10-29T10:00:00.000Z") });
  let res = await app.inject({ method: "GET", url: "/blocklist" });
  for (let i = 1; i < repeat; i++) res = await app.inject({ method: "GET", url: "/blocklist" });
  await app.close();
  return { status: res.statusCode, text: res.body, body: JSON.parse(res.body) };
}

ranges.length = 0; latestBlock = 25;
let r = await get(goodEnv);
check("200 with the PROPOSED shape: rule, count, hashes, scan range, dataSource, generatedAt", r.status === 200 && r.body.rule === BLOCKLIST_HASH_RULE && r.body.count === r.body.hashes.length && r.body.dataSource === "synthetic" && r.body.generatedAt === "2026-10-29T10:00:00.000Z" && typeof r.body.scannedToBlock === "number", `status ${r.status}`);
check("it lists the Confirmed and Linked wallets (hashed) and not the removed one", [m1, e1, l1, m3, e3, m2].every((a) => r.body.hashes.includes(hashAddress(a))), `${r.body.count} hashes`);
const raw = r.text.toLowerCase();
check("no raw address appears anywhere in the response", [m1, m2, e1, l1, m3, e3].every((a) => !raw.includes(a.toLowerCase().slice(2))));
check("it only returns hashes, a count and metadata (no cluster ids, no evidence hashes)", !raw.includes(clusterA.toLowerCase().slice(2)) && !raw.includes(clusterB.toLowerCase().slice(2)) && !raw.includes(ev.toLowerCase().slice(2)));

for (const name of ["RPC_URL", "CHAIN_ID", "DEPLOYMENT_PATH", "RPC_TIMEOUT_MS", "BLOCKLIST_LOG_CHUNK_BLOCKS"]) {
  const x = await get({ ...goodEnv, [name]: undefined });
  check(`${name} missing: 503 naming it (the rest of the API keeps running)`, x.status === 503 && x.body.error.includes(name), `${x.status} ${x.body.error?.slice(0, 90)}`);
}
r = await get({ ...goodEnv, DEPLOYMENT_PATH: join(dir, "missing.json") });
check("deployment file missing: 503, says Person 3 owns it", r.status === 503 && /Person 3/.test(r.body.error), r.body.error);
reportedChain = 99; r = await get(goodEnv); reportedChain = chainId;
check("node on a different chain: 503 naming both chain ids", r.status === 503 && /99/.test(r.body.error) && new RegExp(String(chainId)).test(r.body.error), r.body.error);
hasCode = false; r = await get(goodEnv); hasCode = true;
check("no contract code at the deployed address: 503", r.status === 503 && /No contract code/.test(r.body.error), r.body.error);
r = await get({ ...goodEnv, RPC_URL: `http://127.0.0.1:9/${secretPath}` });
check("node unreachable: 503 and the secret part of the RPC URL is NOT in the response", r.status === 503 && !r.text.includes(secretPath), r.body.error);

mock.close();
rpcProvider.destroy();
rmSync(dir, { recursive: true, force: true });
process.exitCode = failed ? 1 : 0;
console.log(failed ? "\nSOME CHECKS FAILED" : "\nall blocklist self-test checks passed");
