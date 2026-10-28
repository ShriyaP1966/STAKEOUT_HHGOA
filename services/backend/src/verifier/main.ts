// Verifier service entry point. Run with `npm run verifier` (separate process from the API server).
import { llmEnv, loadEnv, loadRules, verifierEnv } from "../config.js";
import { openDb } from "../db.js";
import { createEvidence } from "../evidence.js";
import { makeLlm } from "../llm.js";
import { makeRedactor } from "../redact.js";
import { loadAbi } from "./abi.js";
import { connectChain } from "./chain.js";
import { StakeoutClient } from "./contractClient.js";
import { decide, decideLink, type DecideDeps } from "./decide.js";
import { loadDeployment } from "./deployment.js";
import { VerifierStartupError } from "./errors.js";
import { fetchAnalysis, fetchLinkCandidates } from "./graphClient.js";
import { log, redactText, setLogRedactor } from "./log.js";
import { makeNotifier } from "./notify.js";
import { startWatcher } from "./watcher.js";

async function main() {
  const env = loadEnv(verifierEnv, "verifier");
  const llmConfig = loadEnv(llmEnv, "llm");
  const rules = loadRules(env.RULES_PATH);
  setLogRedactor(makeRedactor([env.RPC_URL, env.VERIFIER_PRIVATE_KEY, env.GRAPH_SERVICE_URL, llmConfig.LLM_API_KEY, env.NOTIFY_WEBHOOK_URL]));

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

  // The AI only writes the summary inside the evidence; no decision reads it.
  const llm = makeLlm(llmConfig, (e) => log.warn(`AI provider call failed, retrying (attempt ${e.attempt}, ${e.reason}, wait ${e.waitSeconds}s)`));
  const decideDeps: DecideDeps = {
    rules,
    fetchAnalysis: (target) => fetchAnalysis(env.GRAPH_SERVICE_URL, target, env.GRAPH_TIMEOUT_MS),
    createEvidence: (analysis) => createEvidence({ llm, rules, dataSource: env.DATA_SOURCE, db }, analysis),
  };

  // Off unless NOTIFY_WEBHOOK_URL is set. Public facts only; a failure is logged (redacted) and never affects a decision.
  const notifier = makeNotifier({ url: env.NOTIFY_WEBHOOK_URL, timeoutMs: env.NOTIFY_TIMEOUT_MS }, redactText, (m) => log.warn(m));
  log.info(`Decision notifications: ${env.NOTIFY_WEBHOOK_URL ? "on" : "off"}.`);

  const watcher = startWatcher({
    client, provider: chain.provider, db, rules, deployment, chainId: env.CHAIN_ID,
    pollMs: env.VERIFIER_POLL_INTERVAL_MS, chunkBlocks: env.VERIFIER_LOG_CHUNK_BLOCKS,
    decidePromoted: (event) => decide(decideDeps, event),
    linkCandidates: async (clusterId) => (await fetchLinkCandidates(env.GRAPH_SERVICE_URL, clusterId, env.GRAPH_TIMEOUT_MS)).candidates,
    decideLinkFor: (target, clusterId) => decideLink(decideDeps, target, clusterId),
    notifier,
  });

  const shutdown = async () => {
    log.info("Stopping verifier.");
    await watcher.stop();
    await notifier.flush();
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
