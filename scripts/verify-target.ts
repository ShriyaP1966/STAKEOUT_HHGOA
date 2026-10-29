import hre, { ethers, network } from "hardhat";
import { Stakeout__factory } from "../typechain-types";
import { DEPLOY_NETWORKS, loadVerifyEnv, readDeployment, redact, requireDeployNetwork } from "./lib/deploy-config";
import { requireTestnetChainId } from "./lib/testnet";

type Stakeout = ReturnType<typeof Stakeout__factory.connect>;

async function grantedAtDeployment(stakeout: Stakeout, role: string, block: number): Promise<string> {
  const events = await stakeout.queryFilter(stakeout.filters.RoleGranted(role), block, block);
  if (events.length !== 1) {
    throw new Error(`Expected exactly one RoleGranted event for role ${role} in deployment block ${block}, found ${events.length}.`);
  }
  return events[0].args.account;
}

async function verify(contract: string, address: string, constructorArguments: string[], secret: string): Promise<void> {
  console.log(`Verifying ${contract} at ${address} with constructor arguments: ${constructorArguments.join(" ")}`);
  try {
    await hre.run("verify:verify", { address, constructorArguments, contract });
  } catch (error: unknown) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Verification failed for ${contract} at ${address}: ${redact(reason, [secret])}`);
  }
}

async function main(): Promise<void> {
  const networkName = requireDeployNetwork(network.name);
  if (!DEPLOY_NETWORKS[networkName].verifyOnExplorer) {
    throw new Error(`Explorer verification is skipped on ${networkName} because it is a local chain.`);
  }
  const env = loadVerifyEnv();
  const deployment = readDeployment(networkName);
  if (env.CHAIN_ID !== deployment.chainId) {
    throw new Error(`CHAIN_ID is ${env.CHAIN_ID} but the deployment file is for chain ${deployment.chainId}.`);
  }
  requireTestnetChainId(deployment.chainId);
  const { chainId } = await ethers.provider.getNetwork();
  if (Number(chainId) !== deployment.chainId) {
    throw new Error(`The RPC endpoint reports chain ${chainId}, but the deployment file is for chain ${deployment.chainId}.`);
  }

  const stakeout = Stakeout__factory.connect(deployment.stakeoutAddress, ethers.provider);
  const [minStake, flagDuration, maxMembersPerCall, reviewerRole, verifierRole] = await Promise.all([
    stakeout.minStake(),
    stakeout.flagDuration(),
    stakeout.maxMembersPerCall(),
    stakeout.REVIEWER_ROLE(),
    stakeout.VERIFIER_ROLE(),
  ]);
  const [reviewer, verifier] = await Promise.all([
    grantedAtDeployment(stakeout, reviewerRole, deployment.deploymentBlock),
    grantedAtDeployment(stakeout, verifierRole, deployment.deploymentBlock),
  ]);

  await verify(
    "contracts/Stakeout.sol:Stakeout",
    deployment.stakeoutAddress,
    [minStake.toString(), flagDuration.toString(), maxMembersPerCall.toString(), reviewer, verifier],
    env.EXPLORER_API_KEY,
  );
  await verify("contracts/StakeoutGuard.sol:StakeoutGuard", deployment.guardAddress, [deployment.stakeoutAddress], env.EXPLORER_API_KEY);
  console.log("Both contracts are verified on the explorer.");
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
