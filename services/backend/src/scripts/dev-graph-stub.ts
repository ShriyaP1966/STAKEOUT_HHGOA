// DEV ONLY stand-in for Person 1's Graph Service, for rehearsing the verifier on a local chain. Usage: npm run dev:graph-stub
// It answers only the PROPOSED routes in docs/graph-analysis-proposal.md, from the fixture file in GRAPH_FIXTURE_PATH
// (make one with `npm run dev:graph-fixture`). It refuses to start unless DATA_SOURCE is synthetic and CHAIN_ID is the local
// Hardhat chain, and it listens on the loopback address only. The port comes from GRAPH_SERVICE_URL.
import { readFileSync } from "node:fs";
import { createStubServer, fixtureSchema } from "../devGraph/fixture.js";
import { graphStubEnv, loadEnv } from "../config.js";

/** The chain id of a local Hardhat node. The only chain this stand-in is allowed to describe. */
const HARDHAT_LOCAL_CHAIN_ID = 31337;
const LOOPBACK = "127.0.0.1";

function refuse(message: string): never {
  console.error(`Graph stand-in refuses to start: ${message}`);
  process.exit(1);
}

const env = loadEnv(graphStubEnv, "graph stand-in");
if (env.DATA_SOURCE !== "synthetic") refuse("DATA_SOURCE must be synthetic.");
if (env.CHAIN_ID !== HARDHAT_LOCAL_CHAIN_ID) refuse(`CHAIN_ID must be ${HARDHAT_LOCAL_CHAIN_ID} (the local Hardhat chain); this stand-in is for local rehearsal only.`);

const url = new URL(env.GRAPH_SERVICE_URL);
if (url.hostname !== LOOPBACK && url.hostname !== "localhost") refuse("GRAPH_SERVICE_URL must point at this machine (127.0.0.1 or localhost), because the stand-in only listens on loopback.");
if (!url.port) refuse("GRAPH_SERVICE_URL must include an explicit port; the stand-in listens on that port.");

let raw: string;
try {
  raw = readFileSync(env.GRAPH_FIXTURE_PATH, "utf8");
} catch {
  refuse(`fixture file not found at GRAPH_FIXTURE_PATH. Create it with: npm run dev:graph-fixture`);
}
let json: unknown;
try {
  json = JSON.parse(raw);
} catch {
  refuse("the fixture file is not valid JSON. Regenerate it with: npm run dev:graph-fixture");
}
const parsed = fixtureSchema.safeParse(json);
if (!parsed.success) {
  refuse(`the fixture file does not match the proposed schema:\n${parsed.error.issues.map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`).join("\n")}`);
}
const fixture = parsed.data;
if (fixture.dataSource !== "synthetic") refuse("the fixture file is not labelled synthetic.");
if (fixture.chainId !== env.CHAIN_ID) refuse("the fixture was generated for a different chain than CHAIN_ID. Regenerate it with: npm run dev:graph-fixture");

const server = createStubServer(fixture);
server.on("error", (e) => refuse(`cannot listen on ${LOOPBACK}:${url.port}: ${(e as Error).message}`));
server.listen(Number(url.port), LOOPBACK, () => {
  console.log("==============================================================================");
  console.log("DEV STAND-IN, NOT Person 1's Graph Service, synthetic data only");
  console.log("==============================================================================");
  console.log(`Listening on ${LOOPBACK}:${url.port} only. Fixture generated ${fixture.generatedAt}: ${fixture.analyses.length} analyses, ${fixture.linkCandidates.length} cluster(s) of link candidates.`);
  console.log("Stop with Ctrl+C.");
});
const stop = () => server.close(() => process.exit(0));
process.once("SIGINT", stop);
process.once("SIGTERM", stop);
