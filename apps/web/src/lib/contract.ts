import { getAddress, isAddress, type Address, type Hex, type PublicClient } from "viem";
import { z } from "zod";
import { stakeoutAbi } from "./abi";

const address = z
  .string()
  .refine((value) => isAddress(value), "invalid address")
  .transform((value) => getAddress(value));
const bytes32 = z.string().regex(/^0x[0-9a-fA-F]{64}$/) as unknown as z.ZodType<Hex>;

const statusSchema = z.tuple([z.number().int(), bytes32, z.number().int(), z.bigint()]);

const flagSchema = z.object({
  reportId: z.bigint(),
  target: address,
  flagger: address,
  stake: z.bigint(),
  expiresAt: z.bigint(),
  challenger: address,
  challengeStake: z.bigint(),
  state: z.number().int(),
});

export type StatusResult = { status: number; clusterId: Hex; role: number; expiresAt: bigint };
export type FlagData = z.infer<typeof flagSchema>;

export async function readStatus(client: PublicClient, stakeout: Address, account: Address): Promise<StatusResult> {
  const raw = await client.readContract({ address: stakeout, abi: stakeoutAbi, functionName: "getStatus", args: [account] });
  const [status, clusterId, role, expiresAt] = statusSchema.parse(raw);
  return { status, clusterId, role, expiresAt };
}

export async function readFlag(client: PublicClient, stakeout: Address, flagId: bigint): Promise<FlagData> {
  const raw = await client.readContract({ address: stakeout, abi: stakeoutAbi, functionName: "getFlag", args: [flagId] });
  return flagSchema.parse(raw);
}

export async function readBigint(client: PublicClient, stakeout: Address, functionName: string): Promise<bigint> {
  const raw = await client.readContract({ address: stakeout, abi: stakeoutAbi, functionName });
  return z.bigint().parse(raw);
}

export async function readRole(client: PublicClient, stakeout: Address, functionName: string): Promise<Hex> {
  const raw = await client.readContract({ address: stakeout, abi: stakeoutAbi, functionName });
  return bytes32.parse(raw);
}
