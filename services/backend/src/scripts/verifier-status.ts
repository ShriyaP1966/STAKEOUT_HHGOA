// Read-only status of the verifier wallet on the deployed contract. Sends NO transaction: the provider has no signer.
// Prints the chain id the RPC reports, the verifier's PUBLIC address, whether it holds VERIFIER_ROLE, and its balance.
// The key is used only to derive the address and is never printed. Usage: npm run verifier-status
import { Contract, JsonRpcProvider, Wallet, formatEther } from "ethers";
import { z } from "zod";
import { blocklistEnv, chainEnv, loadEnv } from "../config.js";
import { makeRedactor } from "../redact.js";
import { loadAbi } from "../verifier/abi.js";
import { rpcChainId } from "../verifier/chain.js";
import { loadDeployment } from "../verifier/deployment.js";
import { VerifierStartupError } from "../verifier/errors.js";

// Existing settings only: nothing new is read.
const env = loadEnv(
  z.object({
    ...chainEnv.pick({ RPC_URL: true, CHAIN_ID: true, VERIFIER_PRIVATE_KEY: true, DEPLOYMENT_PATH: true }).shape,
    ...blocklistEnv.pick({ RPC_TIMEOUT_MS: true }).shape,
  }),
  "verifier status",
);
const redact = makeRedactor([env.RPC_URL, env.VERIFIER_PRIVATE_KEY]);

async function main(): Promise<boolean> {
  let healthy = true;
  const line = (label: string, value: string, problem = false) => {
    console.log(`${problem ? "PROBLEM" : "OK     "}  ${label}: ${value}`);
    if (problem) healthy = false;
  };

  // 1. chain id (a plain eth_chainId call: unreachable nodes fail once, with the host only)
  const reported = await rpcChainId(env.RPC_URL, env.RPC_TIMEOUT_MS);
  const sameChain = reported === env.CHAIN_ID;
  line("chain id reported by the RPC", String(reported));
  line("equals CHAIN_ID", sameChain ? `yes (${env.CHAIN_ID})` : `NO: CHAIN_ID is ${env.CHAIN_ID}`, !sameChain);

  // 2. the verifier's public address, derived from the key (the key is never printed)
  const address = new Wallet(env.VERIFIER_PRIVATE_KEY).address;
  line("verifier public address", address);
  if (!sameChain) {
    console.log("Stopping here: the node is on a different chain than CHAIN_ID, so the contract and balance checks would be meaningless.");
    return false;
  }

  // 3. the deployed contract and VERIFIER_ROLE (read-only calls on a provider with no signer)
  const deployment = loadDeployment(env.DEPLOYMENT_PATH);
  line("deployment file chain id", String(deployment.chainId), deployment.chainId !== env.CHAIN_ID);
  const provider = new JsonRpcProvider(env.RPC_URL, env.CHAIN_ID, { staticNetwork: true });
  try {
    const code = await provider.getCode(deployment.stakeoutAddress);
    line("contract", deployment.stakeoutAddress, code === "0x");
    if (code === "0x") {
      console.log("No contract code at that address on this chain: the deployment file is stale or the node was restarted. Ask Person 3 to redeploy.");
      return false;
    }
    const contract = new Contract(deployment.stakeoutAddress, loadAbi(), provider);
    const role = await contract.VERIFIER_ROLE();
    const holdsRole: boolean = await contract.hasRole(role, address);
    line("holds VERIFIER_ROLE on that contract", holdsRole ? "yes" : "NO. Ask Person 3 to grant it to the address above", !holdsRole);

    // 4. balance
    const balance = await provider.getBalance(address);
    line("balance", `${formatEther(balance)} ETH${balance === 0n ? " (zero: fine for a dry run, but a real confirm or link needs gas)" : ""}`);
  } finally {
    provider.destroy();
  }
  return healthy;
}

try {
  const ok = await main();
  console.log(ok ? "\nStatus: everything checked is in order. Nothing was sent." : "\nStatus: PROBLEMS found (see above). Nothing was sent.");
  process.exitCode = ok ? 0 : 1;
} catch (e) {
  // startup errors are already worded for a human; anything else may contain the RPC URL, so it is redacted
  const message = e instanceof VerifierStartupError ? e.message : `Unexpected error: ${(e as Error).message}`;
  console.error(`Cannot read the verifier status: ${redact(message)}\nNothing was sent.`);
  process.exitCode = 1;
}
