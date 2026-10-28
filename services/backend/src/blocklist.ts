// GET /blocklist: hashed addresses of Confirmed and Linked wallets, built from the contract's events.
// PROPOSED, not agreed with Person 3: the hash rule and the response shape below are for the demo wallet's private lookup.
import { Interface, JsonRpcProvider, getAddress, keccak256, type InterfaceAbi, type Provider } from "ethers";
import type { FastifyInstance } from "fastify";
import { Status } from "../../../shared/enums.js";
import { blocklistEnv } from "./config.js";
import { UserError } from "./errors.js";
import { loadAbi } from "./verifier/abi.js";
import { rpcChainId } from "./verifier/chain.js";
import { loadDeployment } from "./verifier/deployment.js";
import { VerifierStartupError } from "./verifier/errors.js";

/**
 * PROPOSED hash rule. A lookup computes the same hash locally and checks membership, so the list never needs to be shown in the clear.
 * This hides the list from casual reading only: anyone who already has a candidate address can hash it and check too.
 */
export const BLOCKLIST_HASH_RULE = "PROPOSED: keccak256 of the 20 address bytes (case-insensitive), as 0x-prefixed lowercase hex";

export function hashAddress(address: string): string {
  return keccak256(getAddress(address)); // a hex string is hashed as bytes, so this is the hash of the 20 address bytes
}

// The event names are the contract's own. The first two are the Status enum's names; the third is the removal event.
const CONFIRMED = Status[Status.Confirmed];
const LINKED = Status[Status.Linked];
const REMOVED = "MemberRemoved";

/**
 * ethers caches getBlockNumber() for a few seconds, which would make a polling endpoint miss new blocks.
 * This reader asks the node for the block number directly every time.
 */
export function liveChainReader(provider: JsonRpcProvider): Pick<Provider, "getBlockNumber" | "getLogs"> {
  return {
    getBlockNumber: async () => Number(BigInt(await provider.send("eth_blockNumber", []))),
    getLogs: (filter) => provider.getLogs(filter),
  };
}

export type BlocklistSnapshot = { hashes: string[]; scannedFromBlock: number; scannedToBlock: number | null };

/** Follows Confirmed, Linked and MemberRemoved events and keeps the current set of listed wallets. Refreshes are incremental. */
export class BlocklistIndex {
  private readonly iface: Interface;
  private readonly topics: string[];
  private nextBlock: number;
  private readonly firstBlock: number;
  private readonly listed = new Map<string, string>(); // lowercase address -> hash
  private queue: Promise<void> = Promise.resolve();

  constructor(
    private readonly provider: Pick<Provider, "getBlockNumber" | "getLogs">,
    abi: InterfaceAbi,
    private readonly contractAddress: string,
    firstBlock: number,
    private readonly chunkBlocks: number,
  ) {
    this.iface = new Interface(abi);
    this.topics = [CONFIRMED, LINKED, REMOVED].map((name) => {
      const event = this.iface.getEvent(name);
      if (!event) throw new Error(`The contract ABI has no ${name} event, so the blocklist cannot be built. Ask Person 3 to re-export shared/abi/Stakeout.json.`);
      return event.topicHash;
    });
    this.firstBlock = firstBlock;
    this.nextBlock = firstBlock;
  }

  /** Scans every block not yet scanned, in chunks. Calls are serialised. */
  refresh(): Promise<void> {
    this.queue = this.queue.catch(() => undefined).then(() => this.scan());
    return this.queue;
  }

  private async scan() {
    const latest = await this.provider.getBlockNumber();
    while (this.nextBlock <= latest) {
      const to = Math.min(this.nextBlock + this.chunkBlocks - 1, latest);
      const logs = await this.provider.getLogs({ address: this.contractAddress, fromBlock: this.nextBlock, toBlock: to, topics: [this.topics] });
      for (const log of [...logs].sort((a, b) => a.blockNumber - b.blockNumber || a.index - b.index)) this.apply(log);
      this.nextBlock = to + 1;
    }
  }

  private add(address: string) {
    this.listed.set(address.toLowerCase(), hashAddress(address));
  }

  private apply(log: { topics: readonly string[]; data: string }) {
    const parsed = this.iface.parseLog({ topics: [...log.topics], data: log.data });
    if (!parsed) return;
    if (parsed.name === CONFIRMED) {
      for (const a of [...parsed.args.members, ...parsed.args.exitPoints] as string[]) this.add(a);
    } else if (parsed.name === LINKED) {
      this.add(parsed.args.target as string);
    } else if (parsed.name === REMOVED) {
      this.listed.delete((parsed.args.target as string).toLowerCase());
    }
  }

  snapshot(): BlocklistSnapshot {
    return {
      hashes: [...new Set(this.listed.values())].sort(),
      scannedFromBlock: this.firstBlock,
      scannedToBlock: this.nextBlock > this.firstBlock ? this.nextBlock - 1 : null,
    };
  }
}

/**
 * Checks the configuration and the chain, then builds the index. Called when the endpoint is first used, so a missing deployment
 * or node never stops the rest of the API: it only makes this endpoint answer 503 with what is missing.
 */
export async function openBlocklist(env: Record<string, string | undefined>): Promise<BlocklistIndex> {
  const parsed = blocklistEnv.safeParse(env);
  if (!parsed.success) {
    const names = [...new Set(parsed.error.issues.map((i) => String(i.path[0])))].join(", ");
    throw new UserError(`GET /blocklist is not configured. Set these in .env: ${names}.`, 503);
  }
  const cfg = parsed.data;
  try {
    const deployment = loadDeployment(cfg.DEPLOYMENT_PATH);
    const abi = loadAbi();
    const host = new URL(cfg.RPC_URL).host;
    const reported = await rpcChainId(cfg.RPC_URL, cfg.RPC_TIMEOUT_MS);
    if (reported !== cfg.CHAIN_ID) throw new VerifierStartupError(`The RPC endpoint ${host} reports chain ${reported}, but CHAIN_ID is ${cfg.CHAIN_ID}.`);
    if (deployment.chainId !== cfg.CHAIN_ID) throw new VerifierStartupError(`The deployment file is for chain ${deployment.chainId}, but CHAIN_ID is ${cfg.CHAIN_ID}.`);
    const provider = new JsonRpcProvider(cfg.RPC_URL, cfg.CHAIN_ID, { staticNetwork: true });
    if ((await provider.getCode(deployment.stakeoutAddress)) === "0x") {
      throw new VerifierStartupError(`No contract code at ${deployment.stakeoutAddress} on chain ${cfg.CHAIN_ID}. The deployment file is stale; ask Person 3 to redeploy.`);
    }
    return new BlocklistIndex(liveChainReader(provider), abi, deployment.stakeoutAddress, deployment.deploymentBlock, cfg.BLOCKLIST_LOG_CHUNK_BLOCKS);
  } catch (e) {
    // the error handler also removes the RPC URL from this message
    throw new UserError(`GET /blocklist cannot start: ${(e as Error).message}`, 503);
  }
}

export type BlocklistRouteDeps = {
  open: () => Promise<BlocklistIndex>;
  dataSource: "synthetic" | "testnet";
  now?: () => Date;
};

/** PROPOSED response: { rule, count, hashes, scannedFromBlock, scannedToBlock, dataSource, generatedAt }. */
export function registerBlocklistRoute(app: FastifyInstance, deps: BlocklistRouteDeps) {
  let opened: Promise<BlocklistIndex> | null = null;
  app.get("/blocklist", async () => {
    // a failed open is not remembered, so fixing the configuration works without a restart
    opened ??= deps.open().catch((e) => {
      opened = null;
      throw e;
    });
    const index = await opened;
    try {
      await index.refresh();
    } catch (e) {
      throw new UserError(`Could not read the contract events: ${(e as Error).message}`, 503);
    }
    const s = index.snapshot();
    return {
      rule: BLOCKLIST_HASH_RULE,
      count: s.hashes.length,
      hashes: s.hashes,
      scannedFromBlock: s.scannedFromBlock,
      scannedToBlock: s.scannedToBlock,
      dataSource: deps.dataSource,
      generatedAt: (deps.now?.() ?? new Date()).toISOString(),
    };
  });
}
