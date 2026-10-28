import { getAddress, isAddress, type Address, type Hex } from "viem";
import { z } from "zod";
import { Role } from "@shared/enums";

export type LogRef = { blockNumber: bigint; logIndex: number; transactionHash: Hex };

const address = z
  .string()
  .refine((value) => isAddress(value), "invalid address")
  .transform((value) => getAddress(value));
const bytes32 = z.string().regex(/^0x[0-9a-fA-F]{64}$/, "invalid bytes32") as unknown as z.ZodType<Hex>;
const uint = z.bigint();

const argSchemas = {
  ReportSubmitted: z.object({ reportId: uint, target: address, reporter: address, evidenceHash: bytes32 }),
  Promoted: z.object({
    flagId: uint,
    reportId: uint,
    target: address,
    flagger: address,
    stake: uint,
    expiresAt: uint,
  }),
  Expired: z.object({ flagId: uint, target: address }),
  Confirmed: z.object({
    clusterId: bytes32,
    members: z.array(address),
    exitPoints: z.array(address),
    evidenceHash: bytes32,
  }),
  Linked: z.object({ target: address, clusterId: bytes32, evidenceHash: bytes32 }),
  Challenged: z.object({ flagId: uint, challenger: address, stake: uint }),
  Resolved: z.object({ flagId: uint, flagUpheld: z.boolean() }),
  MemberRemoved: z.object({ target: address, clusterId: bytes32 }),
  Withdrawn: z.object({ account: address, amount: uint }),
  RewardPaid: z.object({ recipient: address, amount: uint }),
  RoleGranted: z.object({ role: bytes32, account: address, sender: address }),
  RoleRevoked: z.object({ role: bytes32, account: address, sender: address }),
};

type ArgSchemas = typeof argSchemas;

export type StakeoutEvent = {
  [K in keyof ArgSchemas]: { name: K; args: z.infer<ArgSchemas[K]>; ref: LogRef };
}[keyof ArgSchemas];

type DecodedLog = {
  eventName: string;
  args: unknown;
  blockNumber: bigint | null;
  logIndex: number | null;
  transactionHash: Hex | null;
};

function isKnownEvent(name: string): name is keyof ArgSchemas {
  return Object.hasOwn(argSchemas, name);
}

export function toStakeoutEvent(log: DecodedLog): StakeoutEvent | undefined {
  if (!isKnownEvent(log.eventName)) return undefined;
  if (log.blockNumber === null || log.logIndex === null || log.transactionHash === null) {
    throw new Error(`${log.eventName} log is pending and has no block position.`);
  }
  const parsed = argSchemas[log.eventName].safeParse(log.args);
  if (!parsed.success) {
    throw new Error(`${log.eventName} log has unexpected arguments: ${parsed.error.issues.map((i) => i.path.join(".")).join(", ")}`);
  }
  const ref = { blockNumber: log.blockNumber, logIndex: log.logIndex, transactionHash: log.transactionHash };
  return { name: log.eventName, args: parsed.data, ref } as StakeoutEvent;
}

export type ReportRow = { reportId: bigint; target: Address; reporter: Address; evidenceHash: Hex; ref: LogRef };

export type FlagRow = {
  flagId: bigint;
  reportId: bigint;
  target: Address;
  flagger: Address;
  stake: bigint;
  expiresAt: bigint;
  ref: LogRef;
};

type ClusterEntryRow = { address: Address; role: Role; evidenceHash: Hex; removed: boolean; ref: LogRef };

export type ClusterRow = { clusterId: Hex; entries: ClusterEntryRow[]; ref: LogRef };

export type RewardRow = { recipient: Address; amount: bigint; ref: LogRef };

type StakeoutIndex = {
  reports: ReportRow[];
  flags: FlagRow[];
  clusters: ClusterRow[];
  reporters: Address[];
  rewards: RewardRow[];
};

function compareRefs(a: LogRef, b: LogRef): number {
  if (a.blockNumber !== b.blockNumber) return a.blockNumber < b.blockNumber ? -1 : 1;
  return a.logIndex - b.logIndex;
}

export function buildIndex(events: StakeoutEvent[], reporterRole: Hex): StakeoutIndex {
  const ordered = [...events].sort((a, b) => compareRefs(a.ref, b.ref));
  const reports: ReportRow[] = [];
  const flags: FlagRow[] = [];
  const clusters = new Map<Hex, ClusterRow>();
  const reporters = new Set<Address>();
  const rewards: RewardRow[] = [];

  const clusterFor = (clusterId: Hex, ref: LogRef): ClusterRow => {
    const existing = clusters.get(clusterId);
    if (existing) return existing;
    const created: ClusterRow = { clusterId, entries: [], ref };
    clusters.set(clusterId, created);
    return created;
  };

  for (const event of ordered) {
    switch (event.name) {
      case "ReportSubmitted":
        reports.push({ ...event.args, ref: event.ref });
        break;
      case "Promoted":
        flags.push({ ...event.args, ref: event.ref });
        break;
      case "Confirmed": {
        const cluster = clusterFor(event.args.clusterId, event.ref);
        const add = (list: Address[], role: Role) =>
          list.forEach((member) =>
            cluster.entries.push({ address: member, role, evidenceHash: event.args.evidenceHash, removed: false, ref: event.ref }),
          );
        add(event.args.members, Role.Member);
        add(event.args.exitPoints, Role.ExitPoint);
        break;
      }
      case "Linked":
        clusterFor(event.args.clusterId, event.ref).entries.push({
          address: event.args.target,
          role: Role.Linked,
          evidenceHash: event.args.evidenceHash,
          removed: false,
          ref: event.ref,
        });
        break;
      case "MemberRemoved": {
        const entry = clusters
          .get(event.args.clusterId)
          ?.entries.findLast((candidate) => candidate.address === event.args.target && !candidate.removed);
        if (entry) entry.removed = true;
        break;
      }
      case "RewardPaid":
        rewards.push({ ...event.args, ref: event.ref });
        break;
      case "RoleGranted":
        if (event.args.role === reporterRole) reporters.add(event.args.account);
        break;
      case "RoleRevoked":
        if (event.args.role === reporterRole) reporters.delete(event.args.account);
        break;
      default:
        break;
    }
  }

  return { reports, flags, clusters: [...clusters.values()], reporters: [...reporters], rewards };
}

export function latestReportFor(events: StakeoutEvent[], target: Address): ReportRow | undefined {
  return buildIndex(events, "0x")
    .reports.filter((report) => report.target === target)
    .at(-1);
}

export function latestClusterEntryFor(
  events: StakeoutEvent[],
  target: Address,
  clusterId: Hex,
): ClusterEntryRow | undefined {
  return buildIndex(events, "0x")
    .clusters.find((cluster) => cluster.clusterId.toLowerCase() === clusterId.toLowerCase())
    ?.entries.filter((entry) => entry.address === target && !entry.removed)
    .at(-1);
}
