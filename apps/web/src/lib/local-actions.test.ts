import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  getAddress,
  http,
  type Address,
  type Hash,
  type PublicClient,
  type WalletClient,
} from "viem";
import { Status } from "@shared/enums";
import { stakeoutAbi } from "./abi";
import { NATIVE_CURRENCY } from "./chain";
import { challengeBlocker, expireBlocker, promoteBlocker, reporterGate, withdrawBlocker } from "./action-rules";
import { readFlag, readStatus } from "./contract";
import { parseDeployment, type Deployment } from "./deployment";
import { latestReportFor } from "./events";
import { fetchStakeoutEvents } from "./logs";
import { sendContractCall } from "./tx";

const rpcUrl = process.env.STAKEOUT_LOCAL_RPC_URL;
const deploymentsDir = path.resolve(import.meta.dirname, "..", "..", "..", "..", "deployments");
const readJson = (file: string): unknown => JSON.parse(readFileSync(path.join(deploymentsDir, file), "utf8"));
const ready = { connected: true, onExpectedChain: true };

type Seed = {
  targets: Record<"reported" | "flagged", Address>;
  actors: Record<"reporterA" | "reporterB" | "victim", Address>;
};

describe.skipIf(!rpcUrl)("action buttons against a seeded local node", () => {
  let deployment: Deployment;
  let seed: Seed;
  let client: PublicClient;
  let wallet: WalletClient;
  let write: (request: unknown) => Promise<Hash>;
  let minStake: bigint;
  let promotedFlagId: bigint;

  const read = async (functionName: string, args: readonly unknown[] = []) =>
    client.readContract({ address: deployment.stakeoutAddress, abi: stakeoutAbi, functionName, args });
  const isReporter = async (account: Address) =>
    (await read("hasRole", [await read("REPORTER_ROLE"), account])) as boolean;
  const credits = async (account: Address) => (await read("credits", [account])) as bigint;
  const now = async () => Number((await client.getBlock()).timestamp);
  const call = (account: Address, functionName: string, args: readonly unknown[], value?: bigint) =>
    sendContractCall(client, write, account, { address: deployment.stakeoutAddress, abi: stakeoutAbi, functionName, args, value });

  beforeAll(async () => {
    const parsed = parseDeployment(readJson("localhost.json"), "deployments/localhost.json");
    if (!parsed.ok) throw new Error(parsed.problems.join("; "));
    deployment = parsed.value;
    seed = readJson("localhost-seed.json") as Seed;
    client = createPublicClient({ transport: http(rpcUrl) }) as PublicClient;
    const chain = defineChain({
      id: deployment.chainId,
      name: `Chain ${deployment.chainId}`,
      nativeCurrency: NATIVE_CURRENCY,
      rpcUrls: { default: { http: [rpcUrl as string] } },
    });
    wallet = createWalletClient({ chain, transport: http(rpcUrl) });
    write = (request) => wallet.writeContract(request as Parameters<WalletClient["writeContract"]>[0]);
    minStake = (await read("minStake")) as bigint;
  });

  it("shows promote and challenge only to verified reporters", async () => {
    const outsider = getAddress(seed.actors.victim);
    expect(reporterGate(ready, await isReporter(seed.actors.reporterA), null).visible).toBe(true);
    expect(reporterGate(ready, await isReporter(outsider), null)).toMatchObject({ visible: false, enabled: false });
  });

  it("promotes a Reported address from a reporter account", async () => {
    const target = seed.targets.reported;
    const before = await readStatus(client, deployment.stakeoutAddress, target);
    expect(promoteBlocker(before.status)).toBeNull();
    const events = await fetchStakeoutEvents(client, {
      address: deployment.stakeoutAddress,
      fromBlock: BigInt(deployment.deploymentBlock),
      chunkSize: 2,
    });
    const report = latestReportFor(events, target);
    expect(report).toBeDefined();
    await call(seed.actors.reporterA, "promote", [report!.reportId], minStake);
    expect((await readStatus(client, deployment.stakeoutAddress, target)).status).toBe(Status.Flagged);
    promotedFlagId = ((await read("activeFlagOf", [target])) as bigint) - 1n;
  });

  it("challenges that flag from a second reporter, and blocks the flagger from challenging", async () => {
    const flag = await readFlag(client, deployment.stakeoutAddress, promotedFlagId);
    expect(challengeBlocker(flag, seed.actors.reporterA, await now())).toMatch(/You raised this flag/);
    expect(challengeBlocker(flag, seed.actors.reporterB, await now())).toBeNull();
    await call(seed.actors.reporterB, "challenge", [promotedFlagId], minStake);
    const after = await readFlag(client, deployment.stakeoutAddress, promotedFlagId);
    expect(after.challenger).toBe(getAddress(seed.actors.reporterB));
  });

  it("expires a separate unchallenged flag once its time has passed, and withdraws the refund", async () => {
    const target = seed.targets.flagged;
    const flagId = ((await read("activeFlagOf", [target])) as bigint) - 1n;
    const flag = await readFlag(client, deployment.stakeoutAddress, flagId);
    expect(expireBlocker(flag, await now())).toMatch(/countdown/);

    const wait = Number(flag.expiresAt) - (await now()) + 1;
    await client.request({ method: "evm_increaseTime", params: [wait] } as never);
    await client.request({ method: "evm_mine", params: [] } as never);
    expect(expireBlocker(flag, await now())).toBeNull();

    const challenged = await readFlag(client, deployment.stakeoutAddress, promotedFlagId);
    expect(expireBlocker(challenged, await now())).toMatch(/challenge pauses/);

    const creditBefore = await credits(flag.flagger);
    await call(seed.actors.victim, "expire", [flagId]);
    expect((await readStatus(client, deployment.stakeoutAddress, target)).status).toBe(Status.Reported);
    expect(await credits(flag.flagger)).toBe(creditBefore + flag.stake);
    expect((await readStatus(client, deployment.stakeoutAddress, seed.targets.reported)).status).toBe(Status.Flagged);

    expect(withdrawBlocker(await credits(flag.flagger))).toBeNull();
    await call(flag.flagger, "withdraw", []);
    expect(await credits(flag.flagger)).toBe(0n);
    expect(withdrawBlocker(0n)).toBe("You have nothing to withdraw.");
  });
});
