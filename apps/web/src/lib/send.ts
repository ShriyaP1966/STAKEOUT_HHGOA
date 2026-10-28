import { parseEther, type Address, type PublicClient } from "viem";
import { guardAbi } from "./abi";

export function parseAmount(input: string): bigint | undefined {
  const trimmed = input.trim();
  if (!/^[0-9]+(\.[0-9]+)?$/.test(trimmed)) return undefined;
  try {
    const value = parseEther(trimmed);
    return value > 0n ? value : undefined;
  } catch {
    return undefined;
  }
}

type GuardedSend = { account: Address; guard: Address; to: Address; value: bigint };

export async function simulateGuardedSend(client: PublicClient, send: GuardedSend) {
  const { request } = await client.simulateContract({
    account: send.account,
    address: send.guard,
    abi: guardAbi,
    functionName: "sendTo",
    args: [send.to],
    value: send.value,
  });
  return request;
}
