import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import hre, { artifacts, ethers, network } from "hardhat";
import type { BaseContract, ContractTransactionReceipt } from "ethers";
import { writeAbis } from "./lib/abi";
import {
  DEPLOY_NETWORKS,
  Deployment,
  DeployEnv,
  DeployNetworkName,
  ROOT_DIR,
  deploymentFilePath,
  loadDeployEnv,
  redact,
  requireDeployNetwork,
} from "./lib/deploy-config";
import { requireTestnetChainId } from "./lib/testnet";

async function waitForDeployment(contract: BaseContract, confirmations: number): Promise<ContractTransactionReceipt> {
  const tx = contract.deploymentTransaction();
  if (!tx) throw new Error("Deployment transaction is missing.");
  const receipt = await tx.wait(confirmations);
  if (!receipt) throw new Error(`No receipt for deployment transaction ${tx.hash}.`);
  return receipt;
}

async function verifyOnExplorer(
  networkName: DeployNetworkName,
  contract: string,
  address: string,
  constructorArguments: string[],
  env: DeployEnv,
): Promise<void> {
  try {
    await hre.run("verify:verify", { address, constructorArguments, contract });
    console.log(`Verified ${contract} at ${address}.`);
  } catch (error: unknown) {
    const reason = error instanceof Error ? error.message : String(error);
    console.warn(`Verification failed for ${contract} at ${address}:`);
    console.warn(redact(reason, [env.EXPLORER_API_KEY, env.DEPLOYER_PRIVATE_KEY]));
    console.warn(`Retry manually with: npx hardhat verify --network ${networkName} ${address} ${constructorArguments.join(" ")}`);
  }
}

async function main(): Promise<void> {
  const networkName = requireDeployNetwork(network.name);
  const env = loadDeployEnv(networkName);

  const { chainId } = await ethers.provider.getNetwork();
  if (chainId !== BigInt(env.CHAIN_ID)) {
    throw new Error(`CHAIN_ID is ${env.CHAIN_ID} but the RPC endpoint reports chain ${chainId}.`);
  }
  if (networkName === "target") requireTestnetChainId(env.CHAIN_ID);

  const [deployer] = await ethers.getSigners();
  const balance = await ethers.provider.getBalance(deployer.address);
  console.log(`Network: ${networkName} (chain ${chainId})`);
  console.log(`Deployer: ${deployer.address} (balance ${ethers.formatEther(balance)} ETH)`);
  if (balance === 0n) throw new Error("The deployer account has no funds.");

  if ((await ethers.provider.getCode(env.REVIEWER_ADDRESS)) === "0x") {
    console.warn(`Warning: REVIEWER_ADDRESS ${env.REVIEWER_ADDRESS} has no contract code, so it is not a Safe on this chain.`);
  }

  const stakeoutArgs = [
    env.MIN_STAKE_WEI.toString(),
    env.FLAG_DURATION_SECONDS.toString(),
    env.MAX_MEMBERS_PER_CALL.toString(),
    env.REVIEWER_ADDRESS,
    env.VERIFIER_ADDRESS,
  ];
  const stakeout = await ethers.deployContract("Stakeout", stakeoutArgs, deployer);
  const stakeoutReceipt = await waitForDeployment(stakeout, env.CONFIRMATIONS);
  const stakeoutAddress = await stakeout.getAddress();
  console.log(`Stakeout: ${stakeoutAddress} (block ${stakeoutReceipt.blockNumber})`);

  const guardArgs = [stakeoutAddress];
  const guard = await ethers.deployContract("StakeoutGuard", guardArgs, deployer);
  const guardReceipt = await waitForDeployment(guard, env.CONFIRMATIONS);
  const guardAddress = await guard.getAddress();
  console.log(`StakeoutGuard: ${guardAddress} (block ${guardReceipt.blockNumber})`);

  const [reviewerRole, verifierRole] = await Promise.all([stakeout.REVIEWER_ROLE(), stakeout.VERIFIER_ROLE()]);
  if (!(await stakeout.hasRole(reviewerRole, env.REVIEWER_ADDRESS))) {
    throw new Error("Deployed Stakeout does not grant REVIEWER_ROLE to REVIEWER_ADDRESS.");
  }
  if (!(await stakeout.hasRole(verifierRole, env.VERIFIER_ADDRESS))) {
    throw new Error("Deployed Stakeout does not grant VERIFIER_ROLE to VERIFIER_ADDRESS.");
  }
  if ((await guard.stakeout()) !== stakeoutAddress) {
    throw new Error("Deployed StakeoutGuard points to a different Stakeout address.");
  }

  const block = await ethers.provider.getBlock(stakeoutReceipt.blockNumber);
  if (!block) throw new Error(`Block ${stakeoutReceipt.blockNumber} not found.`);

  const deployment: Deployment = {
    chainId: Number(chainId),
    stakeoutAddress,
    guardAddress,
    deploymentBlock: stakeoutReceipt.blockNumber,
    reviewer: env.REVIEWER_ADDRESS,
    verifier: env.VERIFIER_ADDRESS,
    minStake: (await stakeout.minStake()).toString(),
    flagDuration: Number(await stakeout.flagDuration()),
    maxMembersPerCall: Number(await stakeout.maxMembersPerCall()),
    deployedAt: new Date(block.timestamp * 1000).toISOString(),
  };
  const deploymentFile = deploymentFilePath(networkName);
  await mkdir(path.dirname(deploymentFile), { recursive: true });
  await writeFile(deploymentFile, `${JSON.stringify(deployment, null, 2)}\n`);
  console.log(`Wrote ${path.relative(ROOT_DIR, deploymentFile)}`);

  const abiFiles = await writeAbis(artifacts);
  console.log(`Wrote ${abiFiles.join(", ")}`);

  if (DEPLOY_NETWORKS[networkName].verifyOnExplorer) {
    await verifyOnExplorer(networkName, "contracts/Stakeout.sol:Stakeout", stakeoutAddress, stakeoutArgs, env);
    await verifyOnExplorer(networkName, "contracts/StakeoutGuard.sol:StakeoutGuard", guardAddress, guardArgs, env);
  } else {
    console.log(`Explorer verification is skipped on ${networkName} because it is a local chain. EXPLORER_API_KEY is not needed here.`);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
