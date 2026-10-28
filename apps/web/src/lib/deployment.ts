import { getAddress, isAddress, zeroAddress, type Address } from "viem";
import { z } from "zod";
import type { DeploymentName, ParseResult } from "./env";

export const DEPLOYMENT_FILES: Record<DeploymentName, string> = {
  target: "network.json",
  localhost: "localhost.json",
};

export type Deployment = {
  chainId: number;
  stakeoutAddress: Address;
  guardAddress: Address;
  deploymentBlock: number;
  reviewer: Address;
  verifier: Address;
  minStake: string;
  flagDuration: number;
  maxMembersPerCall: number;
  deployedAt: string;
};

const address = z
  .string()
  .refine((value) => isAddress(value), "must be a valid address")
  .transform((value) => getAddress(value))
  .refine((value) => value !== zeroAddress, "must not be the zero address");

const schema = z.object({
  chainId: z.number().int().positive(),
  stakeoutAddress: address,
  guardAddress: address,
  deploymentBlock: z.number().int().nonnegative(),
  reviewer: address,
  verifier: address,
  minStake: z.string().regex(/^[0-9]+$/, "must be a decimal string"),
  flagDuration: z.number().int().positive(),
  maxMembersPerCall: z.number().int().positive(),
  deployedAt: z.iso.datetime(),
});

export function parseDeployment(raw: unknown, source: string): ParseResult<Deployment> {
  const result = schema.safeParse(raw);
  if (result.success) return { ok: true, value: result.data };
  return {
    ok: false,
    problems: result.error.issues.map((issue) => `${source} ${issue.path.join(".")}: ${issue.message}`),
  };
}
