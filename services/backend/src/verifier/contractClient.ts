import { ZeroAddress, type Contract, type EventLog, type Provider } from "ethers";
import { FlagState, Role, Status } from "../../../../shared/enums.js";

export type PromotedEvent = {
  flagId: bigint;
  reportId: bigint;
  target: string;
  flagger: string;
  stake: bigint;
  expiresAt: bigint;
  blockNumber: number;
  blockHash: string;
  txHash: string;
  logIndex: number;
};

export type LiveFlag = { flagId: bigint; expiresAt: bigint; challenged: boolean; live: boolean };

export type WriteResult = { txHash: string | null; dryRun: boolean };

/** The reads the feasibility checks need; lets tests supply a stand-in without a chain. */
export interface ChainReader {
  maxMembersPerCall(): Promise<number>;
  clusterRole(account: string): Promise<Role>;
  clusterExists(clusterId: string): Promise<boolean>;
  liveFlag(account: string): Promise<LiveFlag | null>;
}

export interface ChainWriter {
  confirm(clusterId: string, members: string[], exitPoints: string[], evidenceHash: string): Promise<WriteResult>;
  link(target: string, clusterId: string, evidenceHash: string): Promise<WriteResult>;
  explainRevert(err: unknown): string;
}

export class StakeoutClient implements ChainReader, ChainWriter {
  constructor(
    private readonly contract: Contract,
    private readonly provider: Provider,
    private readonly dryRun: boolean,
  ) {}

  async getStatus(account: string) {
    const r = await this.contract.getStatus(account);
    return {
      status: Status[Number(r.status)] ?? `unknown(${r.status})`,
      clusterId: r.clusterId as string,
      role: Role[Number(r.role)] ?? `unknown(${r.role})`,
      expiresAt: r.expiresAt as bigint,
    };
  }

  async maxMembersPerCall(): Promise<number> {
    return Number(await this.contract.maxMembersPerCall());
  }

  async clusterRole(account: string): Promise<Role> {
    const entry = await this.contract.getClusterEntry(account);
    return Number(entry.role) as Role;
  }

  async clusterExists(clusterId: string): Promise<boolean> {
    return this.contract.clusterExists(clusterId);
  }

  /** The target's active flag, with liveness computed the same way the contract does (state Active and unexpired, or challenged). */
  async liveFlag(account: string): Promise<LiveFlag | null> {
    const slot: bigint = await this.contract.activeFlagOf(account);
    if (slot === 0n) return null;
    const flagId = slot - 1n;
    const flag = await this.contract.getFlag(flagId);
    const latest = await this.provider.getBlock("latest");
    if (!latest) throw new Error("Could not read the latest block to check flag expiry.");
    const challenged = flag.challenger !== ZeroAddress;
    const live = Number(flag.state) === FlagState.Active && (challenged || BigInt(latest.timestamp) < flag.expiresAt);
    return { flagId, expiresAt: flag.expiresAt as bigint, challenged, live };
  }

  async promotedBetween(fromBlock: number, toBlock: number): Promise<PromotedEvent[]> {
    const logs = await this.contract.queryFilter(this.contract.filters.Promoted(), fromBlock, toBlock);
    return logs.map((log) => {
      const l = log as EventLog;
      return {
        flagId: l.args.flagId,
        reportId: l.args.reportId,
        target: l.args.target,
        flagger: l.args.flagger,
        stake: l.args.stake,
        expiresAt: l.args.expiresAt,
        blockNumber: l.blockNumber,
        blockHash: l.blockHash,
        txHash: l.transactionHash,
        logIndex: l.index,
      };
    });
  }

  /** With VERIFIER_DRY_RUN=true the call is only simulated against the node; nothing is sent. */
  async confirm(clusterId: string, members: string[], exitPoints: string[], evidenceHash: string): Promise<WriteResult> {
    if (this.dryRun) {
      await this.contract.confirm.staticCall(clusterId, members, exitPoints, evidenceHash);
      return { txHash: null, dryRun: true };
    }
    const tx = await this.contract.confirm(clusterId, members, exitPoints, evidenceHash);
    await tx.wait();
    return { txHash: tx.hash, dryRun: false };
  }

  async link(target: string, clusterId: string, evidenceHash: string): Promise<WriteResult> {
    if (this.dryRun) {
      await this.contract.link.staticCall(target, clusterId, evidenceHash);
      return { txHash: null, dryRun: true };
    }
    const tx = await this.contract.link(target, clusterId, evidenceHash);
    await tx.wait();
    return { txHash: tx.hash, dryRun: false };
  }

  /** Turns a contract revert into the custom error name from the ABI, e.g. NoLiveFlaggedMember. */
  explainRevert(err: unknown): string {
    const data = (err as { data?: string }).data;
    if (typeof data === "string") {
      const parsed = this.contract.interface.parseError(data);
      if (parsed) return `contract reverted: ${parsed.name}(${parsed.args.join(", ")})`;
    }
    return (err as { shortMessage?: string }).shortMessage ?? (err as Error).message;
  }
}
