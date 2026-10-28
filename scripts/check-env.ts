import { Wallet, formatEther } from "ethers";
import { loadSafeSetupEnv, redact } from "./lib/deploy-config";
import { readRootEnv } from "./lib/env-file";
import { connectTestnet } from "./lib/testnet";

async function main(): Promise<void> {
  const env = loadSafeSetupEnv();
  console.log("Every variable in .env is valid.");
  const { provider, chainName } = await connectTestnet(env.RPC_URL, env.CHAIN_ID);
  console.log(`RPC_URL is on chain ${env.CHAIN_ID} (${chainName}), which matches CHAIN_ID and is a testnet.`);
  const balance = await provider.getBalance(new Wallet(env.DEPLOYER_PRIVATE_KEY).address);
  console.log(`Deployer balance: ${formatEther(balance)} ETH`);
  if (balance === 0n) throw new Error("The deployer has no funds. Send test ETH to it from a faucet for this testnet, then run this again.");
}

main().catch((error: unknown) => {
  const env = readRootEnv();
  console.error(redact(error instanceof Error ? error.message : String(error), [env.DEPLOYER_PRIVATE_KEY, env.EXPLORER_API_KEY]));
  process.exitCode = 1;
});
