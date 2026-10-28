import { describe, expect, it } from "vitest";
import {
  encodeAbiParameters,
  encodeEventTopics,
  keccak256,
  parseEventLogs,
  toHex,
  type Address,
  type Hex,
  type Log,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { Role } from "@shared/enums";
import { abiEvent, stakeoutAbi } from "./abi";
import { buildIndex, latestClusterEntryFor, latestReportFor, toStakeoutEvent, type StakeoutEvent } from "./events";
import { blockRanges } from "./logs";

const randomAddress = (): Address => privateKeyToAccount(generatePrivateKey()).address;
const randomHash = (): Hex => keccak256(toHex(crypto.getRandomValues(new Uint8Array(32))));
const contract = randomAddress();

function makeLog(eventName: string, args: Record<string, unknown>, blockNumber: bigint, logIndex: number): Log {
  const event = stakeoutAbi.find((item) => item.type === "event" && item.name === eventName);
  if (!event || event.type !== "event") throw new Error(`missing ${eventName}`);
  const topics = encodeEventTopics({ abi: [event], eventName, args } as Parameters<typeof encodeEventTopics>[0]);
  const nonIndexed = event.inputs.filter((input) => !input.indexed);
  const data = encodeAbiParameters(nonIndexed, nonIndexed.map((input) => args[input.name ?? ""]));
  return {
    address: contract,
    topics: topics as [Hex, ...Hex[]],
    data,
    blockNumber,
    logIndex,
    transactionHash: randomHash(),
    transactionIndex: 0,
    blockHash: randomHash(),
    removed: false,
  };
}

function decode(logs: Log[]): StakeoutEvent[] {
  return parseEventLogs({ abi: stakeoutAbi, logs }).flatMap((log) => {
    const event = toStakeoutEvent(log);
    return event ? [event] : [];
  });
}

describe("toStakeoutEvent", () => {
  it("decodes an encoded ReportSubmitted log into typed arguments", () => {
    const target = randomAddress();
    const reporter = randomAddress();
    const evidenceHash = randomHash();
    const [event] = decode([makeLog("ReportSubmitted", { reportId: 4n, target, reporter, evidenceHash }, 10n, 2)]);
    expect(event.name).toBe("ReportSubmitted");
    expect(event.args).toEqual({ reportId: 4n, target, reporter, evidenceHash });
    expect(event.ref.blockNumber).toBe(10n);
    expect(event.ref.logIndex).toBe(2);
  });

  it("ignores events the app does not use", () => {
    const log = makeLog("RoleAdminChanged", { role: randomHash(), previousAdminRole: randomHash(), newAdminRole: randomHash() }, 1n, 0);
    expect(decode([log])).toEqual([]);
  });

  it("throws on malformed arguments and on pending logs", () => {
    const base = { blockNumber: 1n, logIndex: 0, transactionHash: randomHash() };
    expect(() => toStakeoutEvent({ ...base, eventName: "Expired", args: { flagId: "1", target: randomAddress() } })).toThrow(
      /Expired log has unexpected arguments: flagId/,
    );
    expect(() => toStakeoutEvent({ ...base, blockNumber: null, eventName: "Expired", args: {} })).toThrow(/pending/);
  });

  it("checks that every event the app reads exists in the shared ABI", () => {
    expect(abiEvent("Confirmed").inputs.map((input) => input.name)).toEqual(["clusterId", "members", "exitPoints", "evidenceHash"]);
    expect(() => abiEvent("NotAnEvent")).toThrow(/missing/);
  });
});

describe("buildIndex", () => {
  const reporterRole = randomHash();
  const otherRole = randomHash();
  const [target, reporter, flagger, member, exitPoint, linked, reporterA, reporterB] = Array.from({ length: 8 }, randomAddress);
  const clusterId = randomHash();
  const confirmHash = randomHash();
  const linkHash = randomHash();
  const reportHashes = [randomHash(), randomHash()];

  const logs = [
    makeLog("MemberRemoved", { target: member, clusterId }, 9n, 0),
    makeLog("ReportSubmitted", { reportId: 1n, target, reporter, evidenceHash: reportHashes[1] }, 3n, 0),
    makeLog("ReportSubmitted", { reportId: 0n, target, reporter, evidenceHash: reportHashes[0] }, 2n, 5),
    makeLog("Promoted", { flagId: 0n, reportId: 0n, target, flagger, stake: 7n, expiresAt: 1000n }, 4n, 0),
    makeLog("Confirmed", { clusterId, members: [member], exitPoints: [exitPoint], evidenceHash: confirmHash }, 5n, 1),
    makeLog("Linked", { target: linked, clusterId, evidenceHash: linkHash }, 6n, 0),
    makeLog("RoleGranted", { role: reporterRole, account: reporterA, sender: reporter }, 1n, 0),
    makeLog("RoleGranted", { role: reporterRole, account: reporterB, sender: reporter }, 1n, 1),
    makeLog("RoleGranted", { role: otherRole, account: target, sender: reporter }, 1n, 2),
    makeLog("RoleRevoked", { role: reporterRole, account: reporterA, sender: reporter }, 8n, 0),
  ];
  const events = decode(logs);
  const index = buildIndex(events, reporterRole);

  it("orders reports by block and log index", () => {
    expect(index.reports.map((report) => report.reportId)).toEqual([0n, 1n]);
    expect(latestReportFor(events, target)?.evidenceHash).toBe(reportHashes[1]);
  });

  it("collects flags from Promoted events", () => {
    expect(index.flags).toHaveLength(1);
    expect(index.flags[0]).toMatchObject({ flagId: 0n, target, flagger, stake: 7n, expiresAt: 1000n });
  });

  it("groups members, exit points, and linked addresses and marks removals", () => {
    expect(index.clusters).toHaveLength(1);
    const entries = index.clusters[0].entries.map((entry) => [entry.address, entry.role, entry.removed, entry.evidenceHash]);
    expect(entries).toEqual([
      [member, Role.Member, true, confirmHash],
      [exitPoint, Role.ExitPoint, false, confirmHash],
      [linked, Role.Linked, false, linkHash],
    ]);
    expect(latestClusterEntryFor(events, linked, clusterId)?.evidenceHash).toBe(linkHash);
    expect(latestClusterEntryFor(events, member, clusterId)).toBeUndefined();
  });

  it("tracks the current reporter set for the reporter role only", () => {
    expect(index.reporters).toEqual([reporterB]);
  });
});

describe("blockRanges", () => {
  it("splits a block span into chunks of the configured size", () => {
    expect(blockRanges(10n, 21n, 5)).toEqual([
      { fromBlock: 10n, toBlock: 14n },
      { fromBlock: 15n, toBlock: 19n },
      { fromBlock: 20n, toBlock: 21n },
    ]);
    expect(blockRanges(7n, 7n, 100)).toEqual([{ fromBlock: 7n, toBlock: 7n }]);
    expect(blockRanges(8n, 7n, 3)).toEqual([]);
  });

  it("rejects a chunk size below 1", () => {
    expect(() => blockRanges(0n, 10n, 0)).toThrow(/at least 1/);
  });
});
