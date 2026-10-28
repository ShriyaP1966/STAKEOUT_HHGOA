import { writeFile } from "node:fs/promises";
import path from "node:path";
import { JsonRpcProvider } from "ethers";
import { StakeoutGuard__factory, Stakeout__factory } from "../typechain-types";
import {
  ROOT_DIR,
  deploymentFilePath,
  loadRpcEnv,
  loadVerifierAddress,
  readDeployment,
  requireDeployNetwork,
  type DeployNetworkName,
  type Deployment,
} from "./lib/deploy-config";

const ROTATED_FLAG = "--verifier-rotated";
const USAGE = `Usage: npm run check:deployment -- <network> [${ROTATED_FLAG}]`;

type Check = { label: string; ok: boolean };

function parseArgs(argv: string[]): { networkName: DeployNetworkName; rotated: boolean } {
  const [networkArg, ...rest] = argv;
  if (networkArg === undefined) throw new Error(`Network is required.\n${USAGE}`);
  if (rest.length > 1 || (rest.length === 1 && rest[0] !== ROTATED_FLAG)) throw new Error(USAGE);
  return { networkName: requireDeployNetwork(networkArg), rotated: rest.length === 1 };
}

async function connect(networkName: DeployNetworkName, deployment: Deployment) {
  const env = loadRpcEnv(networkName);
  if (env.CHAIN_ID !== deployment.chainId) {
    throw new Error(`CHAIN_ID is ${env.CHAIN_ID} but the deployment file is for chain ${deployment.chainId}.`);
  }
  const provider = new JsonRpcProvider(env.RPC_URL, env.CHAIN_ID, { staticNetwork: true });
  const connected = Number(await provider.send("eth_chainId", []));
  if (connected !== deployment.chainId) {
    throw new Error(`The node at RPC_URL reports chain ${connected}, but the deployment file is for chain ${deployment.chainId}.`);
  }
  return provider;
}

async function rotateVerifier(networkName: DeployNetworkName, deployment: Deployment, provider: JsonRpcProvider): Promise<Deployment> {
  const previous = deployment.verifier;
  const next = loadVerifierAddress(networkName);
  if (next === previous) {
    throw new Error("The deployment file already records VERIFIER_ADDRESS as the verifier. Nothing to rotate.");
  }
  const stakeout = Stakeout__factory.connect(deployment.stakeoutAddress, provider);
  const role = await stakeout.VERIFIER_ROLE();
  const [nextHasRole, previousHasRole] = await Promise.all([stakeout.hasRole(role, next), stakeout.hasRole(role, previous)]);
  console.log(`VERIFIER_ADDRESS from env has VERIFIER_ROLE: ${nextHasRole}`);
  console.log(`Previous verifier from the deployment file has VERIFIER_ROLE: ${previousHasRole}`);
  if (!nextHasRole || previousHasRole) {
    throw new Error(
      "The on-chain roles do not match a finished rotation. Execute both Safe transactions (grantVerifier, revokeVerifier) first. The deployment file was not changed.",
    );
  }
  const updated = { ...deployment, verifier: next };
  const file = deploymentFilePath(networkName);
  await writeFile(file, `${JSON.stringify(updated, null, 2)}\n`);
  console.log(`Updated the verifier in ${path.relative(ROOT_DIR, file)}`);
  return updated;
}

async function runChecks(networkName: DeployNetworkName, deployment: Deployment, provider: JsonRpcProvider): Promise<Check[]> {
  const [stakeoutCode, guardCode] = await Promise.all([
    provider.getCode(deployment.stakeoutAddress),
    provider.getCode(deployment.guardAddress),
  ]);
  if (stakeoutCode === "0x" || guardCode === "0x") {
    return [
      { label: "Stakeout has contract code", ok: stakeoutCode !== "0x" },
      { label: "StakeoutGuard has contract code", ok: guardCode !== "0x" },
    ];
  }
  const stakeout = Stakeout__factory.connect(deployment.stakeoutAddress, provider);
  const guard = StakeoutGuard__factory.connect(deployment.guardAddress, provider);
  const [reviewerRole, verifierRole] = await Promise.all([stakeout.REVIEWER_ROLE(), stakeout.VERIFIER_ROLE()]);
  const envVerifier = loadVerifierAddress(networkName);
  return [
    { label: "Stakeout has contract code", ok: true },
    { label: "StakeoutGuard has contract code", ok: true },
    { label: "StakeoutGuard points to Stakeout", ok: (await guard.stakeout()) === deployment.stakeoutAddress },
    { label: "Reviewer has REVIEWER_ROLE", ok: await stakeout.hasRole(reviewerRole, deployment.reviewer) },
    { label: "Verifier in the deployment file has VERIFIER_ROLE", ok: await stakeout.hasRole(verifierRole, deployment.verifier) },
    { label: "Verifier in the deployment file equals VERIFIER_ADDRESS from env", ok: deployment.verifier === envVerifier },
    { label: "minStake matches", ok: (await stakeout.minStake()).toString() === deployment.minStake },
    { label: "flagDuration matches", ok: Number(await stakeout.flagDuration()) === deployment.flagDuration },
    { label: "maxMembersPerCall matches", ok: Number(await stakeout.maxMembersPerCall()) === deployment.maxMembersPerCall },
  ];
}

async function main(): Promise<void> {
  const { networkName, rotated } = parseArgs(process.argv.slice(2));
  let deployment = readDeployment(networkName);
  const provider = await connect(networkName, deployment);
  let previousVerifier: string | undefined;
  if (rotated) {
    previousVerifier = deployment.verifier;
    deployment = await rotateVerifier(networkName, deployment, provider);
  }

  const checks = await runChecks(networkName, deployment, provider);
  if (previousVerifier !== undefined) {
    const stakeout = Stakeout__factory.connect(deployment.stakeoutAddress, provider);
    const hasRole = await stakeout.hasRole(await stakeout.VERIFIER_ROLE(), previousVerifier);
    checks.push({ label: "Previous verifier no longer has VERIFIER_ROLE", ok: !hasRole });
  }

  console.log(`Deployment check for ${networkName} (chain ${deployment.chainId})`);
  for (const check of checks) console.log(`  ${check.ok ? "PASS" : "FAIL"}  ${check.label}`);
  const failed = checks.filter((check) => !check.ok).length;
  if (failed > 0) throw new Error(`${failed} check(s) failed.`);
  console.log("All checks passed.");
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
