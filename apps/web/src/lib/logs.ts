import { parseEventLogs, type AbiEvent, type Address, type Log, type PublicClient } from "viem";
import { stakeoutAbi } from "./abi";
import { toStakeoutEvent, type StakeoutEvent } from "./events";

type BlockRange = { fromBlock: bigint; toBlock: bigint };

export function blockRanges(fromBlock: bigint, toBlock: bigint, chunkSize: number): BlockRange[] {
  if (!Number.isSafeInteger(chunkSize) || chunkSize < 1) throw new Error("Log chunk size must be at least 1.");
  const size = BigInt(chunkSize);
  const ranges: BlockRange[] = [];
  for (let start = fromBlock; start <= toBlock; start += size) {
    const end = start + size - 1n;
    ranges.push({ fromBlock: start, toBlock: end < toBlock ? end : toBlock });
  }
  return ranges;
}

type LogQuery = {
  address: Address;
  fromBlock: bigint;
  chunkSize: number;
  event?: AbiEvent;
  args?: Record<string, unknown>;
};

export async function fetchStakeoutEvents(client: PublicClient, query: LogQuery): Promise<StakeoutEvent[]> {
  const latest = await client.getBlockNumber();
  const raw: Log[] = [];
  for (const range of blockRanges(query.fromBlock, latest, query.chunkSize)) {
    const chunk = query.event
      ? await client.getLogs({ address: query.address, event: query.event, args: query.args, ...range })
      : await client.getLogs({ address: query.address, ...range });
    raw.push(...chunk);
  }
  const decoded = parseEventLogs({ abi: stakeoutAbi, logs: raw });
  return decoded.flatMap((log) => {
    const event = toStakeoutEvent(log);
    return event ? [event] : [];
  });
}
