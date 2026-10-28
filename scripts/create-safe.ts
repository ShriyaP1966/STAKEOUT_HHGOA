import { randomBytes } from "node:crypto";
import Safe from "@safe-global/protocol-kit";
import { Contract, Wallet, getAddress } from "ethers";
import { loadSafeSetupEnv, redact } from "./lib/deploy-config";
import { fillEmptyRootEnvValue, hasRootEnvValue, readRootEnv } from "./lib/env-file";
import { connectTestnet } from "./lib/testnet";

const SAFE_READ_ABI = ["function getOwners() view returns (address[])", "function getThreshold() view returns (uint256)"];

const sameOwners = (a: string[], b: string[]) =>
  a.length === b.length && [...a].map(getAddress).sort().join() === [...b].map(getAddress).sort().join();

async function main(): Promise<void> {
  if (hasRootEnvValue("REVIEWER_ADDRESS")) {
    throw new Error("REVIEWER_ADDRESS already has a value in .env, so a Safe exists. Refusing to create a second one.");
  }
  const env = loadSafeSetupEnv();
  const { provider, chainName } = await connectTestnet(env.RPC_URL, env.CHAIN_ID);
  console.log(`Chain ${env.CHAIN_ID} (${chainName}) matches CHAIN_ID and is a testnet.`);

  const deployer = new Wallet(env.DEPLOYER_PRIVATE_KEY, provider);
  if ((await provider.getBalance(deployer.address)) === 0n) {
    throw new Error("The deployer has no funds. Send test ETH to it from a faucet for this testnet, then run this again.");
  }

  const kit = await Safe.init({
    provider: env.RPC_URL,
    predictedSafe: {
      safeAccountConfig: { owners: env.SAFE_OWNERS, threshold: env.SAFE_THRESHOLD },
      safeDeploymentConfig: { saltNonce: BigInt(`0x${randomBytes(32).toString("hex")}`).toString() },
    },
  });
  const safeAddress = getAddress(await kit.getAddress());
  if ((await provider.getCode(safeAddress)) !== "0x") {
    throw new Error("A contract already exists at the predicted Safe address. Run this again to use a new salt.");
  }

  const deployment = await kit.createSafeDeploymentTransaction();
  const sent = await deployer.sendTransaction({ to: deployment.to, value: BigInt(deployment.value), data: deployment.data });
  console.log(`Safe deployment transaction: ${sent.hash}`);
  const receipt = await sent.wait(env.CONFIRMATIONS);
  if (receipt === null || receipt.status !== 1) throw new Error(`Safe deployment transaction ${sent.hash} failed.`);
  if ((await provider.getCode(safeAddress)) === "0x") throw new Error(`No Safe code at ${safeAddress} after the transaction.`);

  fillEmptyRootEnvValue("REVIEWER_ADDRESS", safeAddress);
  console.log("Wrote the Safe address to REVIEWER_ADDRESS in .env.");

  const safe = new Contract(safeAddress, SAFE_READ_ABI, provider);
  const owners = ((await safe.getOwners()) as string[]).map(getAddress);
  const threshold = Number(await safe.getThreshold());
  console.log(`Safe address: ${safeAddress}`);
  console.log(`Transaction hash: ${sent.hash}`);
  console.log("Owners read from the chain:");
  for (const owner of owners) console.log(`  ${owner}`);
  console.log(`Threshold read from the chain: ${threshold}`);
  const ownersMatch = sameOwners(owners, env.SAFE_OWNERS);
  const thresholdMatches = threshold === env.SAFE_THRESHOLD;
  console.log(`Owners match SAFE_OWNERS exactly: ${ownersMatch}`);
  console.log(`Threshold matches SAFE_THRESHOLD: ${thresholdMatches}`);
  if (!ownersMatch || !thresholdMatches) throw new Error("The Safe on chain does not match SAFE_OWNERS and SAFE_THRESHOLD.");
}

main().catch((error: unknown) => {
  const env = readRootEnv();
  console.error(redact(error instanceof Error ? error.message : String(error), [env.DEPLOYER_PRIVATE_KEY, env.EXPLORER_API_KEY]));
  process.exitCode = 1;
});
