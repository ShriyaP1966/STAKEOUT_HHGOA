import { Contract, Wallet, formatEther, getAddress } from "ethers";
import { loadDeployEnv, loadSafeSetupEnv, redact } from "./lib/deploy-config";
import { readRootEnv } from "./lib/env-file";
import { connectTestnet } from "./lib/testnet";

const SAFE_READ_ABI = ["function getOwners() view returns (address[])", "function getThreshold() view returns (uint256)"];

async function main(): Promise<void> {
  const env = loadDeployEnv("target");
  const setup = loadSafeSetupEnv();
  console.log("Every deploy variable in .env is valid.");
  const { provider, chainName } = await connectTestnet(env.RPC_URL, env.CHAIN_ID);

  const balance = await provider.getBalance(new Wallet(env.DEPLOYER_PRIVATE_KEY).address);
  const reviewerCode = await provider.getCode(env.REVIEWER_ADDRESS);
  const checks: Array<{ label: string; ok: boolean }> = [
    { label: `Chain ${env.CHAIN_ID} (${chainName}) matches CHAIN_ID and is a testnet`, ok: true },
    { label: `Deployer has funds (${formatEther(balance)} ETH)`, ok: balance > 0n },
    { label: "REVIEWER_ADDRESS has contract code", ok: reviewerCode !== "0x" },
  ];
  if (reviewerCode !== "0x") {
    const safe = new Contract(env.REVIEWER_ADDRESS, SAFE_READ_ABI, provider);
    const owners = ((await safe.getOwners()) as string[]).map(getAddress).sort().join();
    checks.push(
      { label: "Safe owners on chain match SAFE_OWNERS", ok: owners === [...setup.SAFE_OWNERS].sort().join() },
      { label: "Safe threshold on chain matches SAFE_THRESHOLD", ok: Number(await safe.getThreshold()) === setup.SAFE_THRESHOLD },
    );
  }

  console.log("Deploy check (nothing is deployed):");
  for (const check of checks) console.log(`  ${check.ok ? "PASS" : "FAIL"}  ${check.label}`);
  const failed = checks.filter((check) => !check.ok).length;
  if (failed > 0) throw new Error(`${failed} check(s) failed.`);
  console.log("Ready for npm run deploy:target.");
}

main().catch((error: unknown) => {
  const env = readRootEnv();
  console.error(redact(error instanceof Error ? error.message : String(error), [env.DEPLOYER_PRIVATE_KEY, env.EXPLORER_API_KEY]));
  process.exitCode = 1;
});
