import { z } from "zod";

/**
 * Cluster ids are bytes32 values (0x + 64 hex), matching the contract.
 * Person 1's graph service generates them from data. The backend only validates and passes them through.
 */
export const clusterIdSchema = z
  .string()
  .regex(/^0x[0-9a-fA-F]{64}$/, "clusterId must be 0x followed by exactly 64 hex characters (bytes32)");

export function parseClusterId(value: unknown): string {
  const parsed = clusterIdSchema.safeParse(value);
  if (!parsed.success) throw new Error(parsed.error.issues[0].message);
  return parsed.data;
}
