import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { createPublicClient, getAddress, http, parseEther, type Address, type Hex, type PublicClient } from "viem";
import { Role, Status } from "@shared/enums";
import { abiEvent, combinedAbi } from "./abi";
import { readStatus } from "./contract";
import { parseDeployment, type Deployment } from "./deployment";
import { decodeError } from "./errors";
import { buildIndex, latestClusterEntryFor, latestReportFor } from "./events";
import { fetchStakeoutEvents } from "./logs";
import { simulateGuardedSend } from "./send";
import { warningFor } from "./warning";

const rpcUrl = process.env.STAKEOUT_LOCAL_RPC_URL;
const deploymentsDir = path.resolve(import.meta.dirname, "..", "..", "..", "..", "deployments");
const readJson = (file: string): unknown => JSON.parse(readFileSync(path.join(deploymentsDir, file), "utf8"));

type Seed = {
  dataSource: string;
  clusterId: Hex;
  targets: Record<"fresh" | "reported" | "flagged" | "challenged" | "member" | "exitPoint" | "linked", Address>;
  evidence: Record<string, Hex>;
};

describe.skipIf(!rpcUrl)("local node with seeded synthetic data", () => {
  let deployment: Deployment;
  let seed: Seed;
  let client: PublicClient;
  let base: { address: Address; fromBlock: bigint; chunkSize: number };

  beforeAll(() => {
    const parsed = parseDeployment(readJson("localhost.json"), "deployments/localhost.json");
    if (!parsed.ok) throw new Error(parsed.problems.join("; "));
    deployment = parsed.value;
    seed = readJson("localhost-seed.json") as Seed;
    client = createPublicClient({ transport: http(rpcUrl) }) as PublicClient;
    base = { address: deployment.stakeoutAddress, fromBlock: BigInt(deployment.deploymentBlock), chunkSize: 2 };
  });

  it("is labeled synthetic", () => {
    expect(seed.dataSource).toBe("synthetic");
  });

  it("shows None for a fresh address", async () => {
    const status = await readStatus(client, deployment.stakeoutAddress, seed.targets.fresh);
    expect(status.status).toBe(Status.None);
    expect(warningFor(status.status).level).toBe("none");
  });

  it("shows Flagged with a future deadline and the report evidence hash", async () => {
    const status = await readStatus(client, deployment.stakeoutAddress, seed.targets.flagged);
    expect(status.status).toBe(Status.Flagged);
    expect(warningFor(status.status).level).toBe("soft");
    const block = await client.getBlock();
    expect(status.expiresAt > block.timestamp).toBe(true);
    const events = await fetchStakeoutEvents(client, { ...base, event: abiEvent("ReportSubmitted"), args: { target: seed.targets.flagged } });
    expect(latestReportFor(events, seed.targets.flagged)?.evidenceHash).toBe(seed.evidence[seed.targets.flagged]);
  });

  it("shows Confirmed with the cluster id and confirm evidence hash", async () => {
    for (const [target, role] of [
      [seed.targets.member, Role.Member],
      [seed.targets.exitPoint, Role.ExitPoint],
    ] as const) {
      const status = await readStatus(client, deployment.stakeoutAddress, target);
      expect(status.status).toBe(Status.Confirmed);
      expect(status.role).toBe(role);
      expect(status.clusterId).toBe(seed.clusterId);
      expect(warningFor(status.status).level).toBe("strong");
      const events = await fetchStakeoutEvents(client, { ...base, event: abiEvent("Confirmed"), args: { clusterId: status.clusterId } });
      expect(latestClusterEntryFor(events, target, status.clusterId)?.evidenceHash).toBe(seed.evidence[target]);
    }
  });

  it("shows Linked for the linked address", async () => {
    const status = await readStatus(client, deployment.stakeoutAddress, seed.targets.linked);
    expect(status.status).toBe(Status.Linked);
    expect(status.role).toBe(Role.Linked);
  });

  it("decodes Blocked for a guarded send to Confirmed and Linked addresses, and allows the rest", async () => {
    const accounts = (await client.request({ method: "eth_accounts" } as never)) as string[];
    const [sender] = accounts.map((account) => getAddress(account));
    const value = parseEther("0.001");
    const send = (to: Address) => simulateGuardedSend(client, { account: sender, guard: deployment.guardAddress, to, value });
    for (const [to, label] of [
      [seed.targets.member, "Confirmed"],
      [seed.targets.linked, "Linked"],
    ] as const) {
      const error = await send(to).then(
        () => undefined,
        (reason: unknown) => reason,
      );
      expect(error).toBeDefined();
      const decoded = decodeError(error, combinedAbi);
      expect(decoded.title).toBe(`Blocked: recipient is ${label}`);
      expect(decoded.detail).toContain(to);
    }
    for (const to of [seed.targets.fresh, seed.targets.reported, seed.targets.flagged]) {
      await expect(send(to)).resolves.toBeDefined();
    }
  });

  it("builds the dashboard index from chunked events", async () => {
    const reporterRole = (await client.readContract({
      address: deployment.stakeoutAddress,
      abi: combinedAbi,
      functionName: "REPORTER_ROLE",
    })) as Hex;
    const index = buildIndex(await fetchStakeoutEvents(client, base), reporterRole);
    const reportedTargets = index.reports.map((report) => report.target);
    for (const target of [seed.targets.reported, seed.targets.flagged, seed.targets.challenged, seed.targets.member]) {
      expect(reportedTargets).toContain(target);
    }
    const cluster = index.clusters.find((candidate) => candidate.clusterId === seed.clusterId);
    expect(cluster?.entries.map((entry) => [entry.address, entry.role])).toEqual([
      [seed.targets.member, Role.Member],
      [seed.targets.exitPoint, Role.ExitPoint],
      [seed.targets.linked, Role.Linked],
    ]);
  });
});
