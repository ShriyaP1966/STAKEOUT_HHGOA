import type { Abi, AbiEvent } from "viem";
import guardJson from "@shared/abi/StakeoutGuard.json";
import stakeoutJson from "@shared/abi/Stakeout.json";

export const stakeoutAbi = stakeoutJson as Abi;
export const guardAbi = guardJson as Abi;
export const combinedAbi: Abi = [...stakeoutAbi, ...guardAbi];

export function abiEvent(name: string): AbiEvent {
  const event = stakeoutAbi.find((item): item is AbiEvent => item.type === "event" && item.name === name);
  if (!event) throw new Error(`Event ${name} is missing from shared/abi/Stakeout.json.`);
  return event;
}
