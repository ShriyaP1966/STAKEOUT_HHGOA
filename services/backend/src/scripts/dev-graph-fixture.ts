// DEV ONLY: generates the fixture file for the stand-in Graph Service from the git-ignored synthetic seed file.
// Usage: npm run dev:graph-fixture -- <path to localhost-seed.json>
// Thresholds come from the rules file (RULES_PATH); the output goes to GRAPH_FIXTURE_PATH. No address is typed in source.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { buildFixture, seedSchema } from "../devGraph/fixture.js";
import { graphFixtureEnv, loadEnv, loadRules } from "../config.js";

function fail(message: string): never {
  console.error(`Fixture not written: ${message}`);
  process.exit(1);
}

const seedPath = process.argv[2];
if (!seedPath) fail("give the path of the seed file, for example: npm run dev:graph-fixture -- <path to localhost-seed.json>");

const env = loadEnv(graphFixtureEnv, "graph fixture");
if (env.DATA_SOURCE !== "synthetic") fail("DATA_SOURCE must be synthetic.");
const rules = loadRules(env.RULES_PATH);

let seedJson: unknown;
try {
  seedJson = JSON.parse(readFileSync(seedPath, "utf8"));
} catch (e) {
  fail(`cannot read the seed file as JSON (${(e as Error).message}). Run npm run seed:local first.`);
}
const seed = seedSchema.safeParse(seedJson);
if (!seed.success) fail(`the seed file is missing what the generator needs:\n${seed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n")}`);
if (seed.data.dataSource !== "synthetic") fail("the seed file is not labelled synthetic.");
if (seed.data.chainId !== env.CHAIN_ID) fail("the seed file is for a different chain than CHAIN_ID in the environment.");

const fixture = buildFixture(seed.data, rules, new Date());
mkdirSync(dirname(env.GRAPH_FIXTURE_PATH), { recursive: true });
writeFileSync(env.GRAPH_FIXTURE_PATH, JSON.stringify(fixture, null, 2) + "\n");
console.log(`Fixture written: ${fixture.analyses.length} analyses, ${fixture.linkCandidates.length} cluster(s) of link candidates (synthetic, chain ${fixture.chainId}).`);
console.log(`Thresholds used from the rules file: behaviorThreshold ${rules.behaviorThreshold}, minSignals ${rules.minSignals}. Flagged target scores above them, challenged target below.`);
