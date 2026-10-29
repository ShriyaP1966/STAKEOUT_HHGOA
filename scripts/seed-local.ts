import { writeFile } from "node:fs/promises";
import path from "node:path";
import { JsonRpcProvider, JsonRpcSigner } from "ethers";
import hre, { ethers, network } from "hardhat";
import type { HardhatNetworkAccountsConfig, HttpNetworkConfig } from "hardhat/types";
import { Stakeout__factory } from "../typechain-types";
import { Deployment, ROOT_DIR, readDeployment } from "./lib/deploy-config";

const SEED_FILE = path.join(ROOT_DIR, "deployments", "localhost-seed.json");

const randomAddress = (): string => ethers.Wallet.createRandom().address;
const randomHash = (): string => ethers.hexlify(ethers.randomBytes(32));

function localAccountBalance(accounts: HardhatNetworkAccountsConfig): bigint {
  if (Array.isArray(accounts)) {
    if (accounts.length === 0) throw new Error("The Hardhat network config lists no accounts, so there is no local balance to copy.");
    return BigInt(accounts[0].balance);
  }
  return BigInt(accounts.accountsBalance);
}

async function requireLocalHardhatChain(node: JsonRpcProvider): Promise<void> {
  const localChainId = hre.config.networks.hardhat.chainId;
  const { chainId } = await node.getNetwork();
  if (Number(chainId) !== localChainId) {
    throw new Error(`seed-local only runs on the local Hardhat chain (chain ${localChainId}), but the node reports chain ${chainId}. Refusing to run.`);
  }
  const client = String(await node.send("web3_clientVersion", []));
  if (!client.toLowerCase().includes("hardhat")) {
    throw new Error(`seed-local only runs on a local Hardhat node, but the node reports "${client}". Refusing to run.`);
  }
}

async function verifierSigner(node: JsonRpcProvider, verifier: string, unlocked: string[]): Promise<{ signer: JsonRpcSigner; release: () => Promise<void> }> {
  if (unlocked.includes(verifier)) return { signer: await node.getSigner(verifier), release: async () => undefined };
  await node.send("hardhat_impersonateAccount", [verifier]);
  const release = async () => {
    await node.send("hardhat_stopImpersonatingAccount", [verifier]);
    console.log(`Stopped impersonating the verifier ${verifier}.`);
  };
  try {
    const wanted = localAccountBalance(hre.config.networks.hardhat.accounts);
    if ((await node.getBalance(verifier)) < wanted) {
      await node.send("hardhat_setBalance", [verifier, ethers.toQuantity(wanted)]);
      console.log(`Set the verifier ${verifier} balance to ${ethers.formatEther(wanted)} ETH on the local chain for gas.`);
    }
  } catch (error: unknown) {
    await release();
    throw error;
  }
  console.log(`Impersonating the verifier ${verifier} on the local chain to call confirm and link.`);
  return { signer: new JsonRpcSigner(node, verifier), release };
}

async function main(): Promise<void> {
  if (network.name !== "localhost") {
    throw new Error(`seed-local only runs on the localhost network, not "${network.name}".`);
  }
  const deployment = readDeployment("localhost");
  const node = new JsonRpcProvider((network.config as HttpNetworkConfig).url);
  await requireLocalHardhatChain(node);
  const { chainId } = await node.getNetwork();
  if (Number(chainId) !== deployment.chainId) {
    throw new Error(`deployments/localhost.json is for chain ${deployment.chainId}, but the node reports chain ${chainId}.`);
  }
  if ((await ethers.provider.getCode(deployment.stakeoutAddress)) === "0x") {
    throw new Error("No Stakeout code at the address in deployments/localhost.json. Run npm run deploy:local first.");
  }

  const unlocked = ((await node.send("eth_accounts", [])) as string[]).map((account) => ethers.getAddress(account));
  if (!unlocked.includes(deployment.reviewer)) {
    throw new Error(`The reviewer ${deployment.reviewer} is not an unlocked account on the local node.`);
  }
  const [deployer] = await ethers.getSigners();
  const pool = unlocked.filter((account) => ![deployer.address, deployment.reviewer, deployment.verifier].includes(account));
  if (pool.length < 3) throw new Error("The local node needs at least three spare unlocked accounts.");
  const [reporterA, reporterB, victim] = await Promise.all(pool.slice(0, 3).map((account) => node.getSigner(account)));
  const reviewer = await node.getSigner(deployment.reviewer);
  const { signer: verifier, release } = await verifierSigner(node, deployment.verifier, unlocked);
  try {
    await seed(node, deployment, { reporterA, reporterB, victim, reviewer, verifier });
  } finally {
    await release();
  }
}

type Actors = Record<"reporterA" | "reporterB" | "victim" | "reviewer" | "verifier", JsonRpcSigner>;

async function seed(node: JsonRpcProvider, deployment: Deployment, { reporterA, reporterB, victim, reviewer, verifier }: Actors): Promise<void> {
  const stakeout = Stakeout__factory.connect(deployment.stakeoutAddress, node);
  const minStake = await stakeout.minStake();
  const send = async (tx: Promise<{ wait: () => Promise<unknown> }>) => (await tx).wait();

  const targets = {
    fresh: randomAddress(),
    reported: randomAddress(),
    flagged: randomAddress(),
    challenged: randomAddress(),
    member: randomAddress(),
    exitPoint: randomAddress(),
    linked: randomAddress(),
  };
  const evidence: Record<string, string> = {};

  await send(stakeout.connect(reviewer).addVerifiedReporter(reporterA.address));
  await send(stakeout.connect(reviewer).addVerifiedReporter(reporterB.address));

  const fileReport = async (target: string): Promise<bigint> => {
    const evidenceHash = randomHash();
    evidence[target] = evidenceHash;
    const reportId = await stakeout.connect(victim).report.staticCall(target, evidenceHash);
    await send(stakeout.connect(victim).report(target, evidenceHash));
    return reportId;
  };
  const promote = async (target: string): Promise<bigint> => {
    const reportId = await fileReport(target);
    await send(stakeout.connect(reporterA).promote(reportId, { value: minStake }));
    return (await stakeout.activeFlagOf(target)) - 1n;
  };

  await fileReport(targets.reported);
  await promote(targets.flagged);
  const challengedFlag = await promote(targets.challenged);
  await send(stakeout.connect(reporterB).challenge(challengedFlag, { value: minStake }));
  await promote(targets.member);

  const clusterId = randomHash();
  const confirmHash = randomHash();
  await send(stakeout.connect(verifier).confirm(clusterId, [targets.member], [targets.exitPoint], confirmHash));
  evidence[targets.member] = confirmHash;
  evidence[targets.exitPoint] = confirmHash;
  const linkHash = randomHash();
  await send(stakeout.connect(verifier).link(targets.linked, clusterId, linkHash));
  evidence[targets.linked] = linkHash;

  const statuses: Record<string, string> = {};
  for (const [label, target] of Object.entries(targets)) {
    const [status, , role] = await stakeout.getStatus(target);
    statuses[label] = `status=${status} role=${role}`;
  }

  const block = await node.getBlock("latest");
  if (!block) throw new Error("Latest block not found.");
  const seed = {
    dataSource: "synthetic",
    chainId: deployment.chainId,
    stakeoutAddress: deployment.stakeoutAddress,
    seededAt: new Date(block.timestamp * 1000).toISOString(),
    clusterId,
    targets,
    evidence,
    actors: { reporterA: reporterA.address, reporterB: reporterB.address, victim: victim.address },
  };
  await writeFile(SEED_FILE, `${JSON.stringify(seed, null, 2)}\n`);
  console.log(`Seeded synthetic data on chain ${deployment.chainId}. On-chain getStatus per target:`);
  console.table(statuses);
  console.log(`Wrote ${path.relative(ROOT_DIR, SEED_FILE)}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
