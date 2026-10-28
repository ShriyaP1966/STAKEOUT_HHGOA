// Verifier service entry point. Run with `npm run verifier` (separate process from the API server).
import { loadEnv, loadRules, verifierEnv } from "../config.js";
import { openDb } from "../db.js";
import { loadAbi } from "./abi.js";
import { connectChain } from "./chain.js";
import { StakeoutClient } from "./contractClient.js";
import { loadDeployment } from "./deployment.js";
import { VerifierStartupError } from "./errors.js";
import { makeRedactor } from "../redact.js";
import { log, redactText, setLogRedactor } from "./log.js";
import { startWatcher } from "./watcher.js";

async function main() {
  const env = loadEnv(verifierEnv, "verifier");
  const rules = loadRules(env.RULES_PATH);
  setLogRedactor(makeRedactor([env.RPC_URL, env.VERIFIER_PRIVATE_KEY, env.GRAPH_SERVICE_URL]));

  let chain, deployment;
  try {
    deployment = loadDeployment(env.DEPLOYMENT_PATH);
    chain = await connectChain(env, deployment, loadAbi());
  } catch (e) {
    if (!(e instanceof VerifierStartupError)) throw e;
    console.error(`Verifier cannot start: ${redactText(e.message)}`);
    process.exitCode = 1;
    return;
  }

  const db = openDb(env.DB_PATH);
  const client = new StakeoutClient(chain.contract, chain.provider, env.VERIFIER_DRY_RUN);
  const maxMembers = await client.maxMembersPerCall();
  const resumeFrom = db.getKv("verifier.nextBlock") ?? `${deployment.deploymentBlock} (deployment block)`;
  log.info(
    `Verifier started. contract ${deployment.stakeoutAddress} on chain ${env.CHAIN_ID} via ${chain.rpcHost}; signer ${chain.signer.address} ` +
      `has VERIFIER_ROLE; maxMembersPerCall ${maxMembers}; dry run: ${env.VERIFIER_DRY_RUN}; resuming from block ${resumeFrom}.`,
  );

  const watcher = startWatcher({
    client, provider: chain.provider, db, rules, deployment, chainId: env.CHAIN_ID,
    pollMs: env.VERIFIER_POLL_INTERVAL_MS, chunkBlocks: env.VERIFIER_LOG_CHUNK_BLOCKS,
    graphServiceUrl: env.GRAPH_SERVICE_URL, graphTimeoutMs: env.GRAPH_TIMEOUT_MS,
  });

  const shutdown = async () => {
    log.info("Stopping verifier.");
    await watcher.stop();
    chain.provider.destroy();
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

try {
  await main();
} catch (e) {
  // an unexpected error (for example from the node) may contain the RPC URL, so it is redacted before it is printed
  console.error(`Verifier stopped by an unexpected error: ${redactText((e as Error).message)}`);
  process.exitCode = 1;
}
