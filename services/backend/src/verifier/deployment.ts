import { readFileSync } from "node:fs";
import { getAddress, isAddress } from "ethers";
import { z } from "zod";
import { VerifierStartupError } from "./errors.js";

const address = z.string().refine((v) => isAddress(v), "must be a valid address").transform((v) => getAddress(v));

/** Subset of the file written by Person 3's deploy script (scripts/lib/deploy-config.ts, deploymentSchema). */
export const deploymentSchema = z.object({
  chainId: z.number().int().positive(),
  stakeoutAddress: address,
  deploymentBlock: z.number().int().nonnegative(),
});
export type Deployment = z.infer<typeof deploymentSchema>;

export function loadDeployment(path: string): Deployment {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    throw new VerifierStartupError(
      `Deployment file not found at DEPLOYMENT_PATH=${path}. Person 3 owns it: their deploy script writes deployments/network.json ` +
        "(testnet) or the git-ignored deployments/localhost.json (local node). Nothing is assumed in its absence.",
    );
  }
  if (raw.trim() === "") throw new VerifierStartupError(`Deployment file ${path} is empty. Ask Person 3 to re-run their deploy script.`);
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (e) {
    throw new VerifierStartupError(`Deployment file ${path} is not valid JSON: ${(e as Error).message}`);
  }
  const parsed = deploymentSchema.safeParse(json);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`).join("\n");
    throw new VerifierStartupError(`Invalid deployment file ${path} (needs chainId, stakeoutAddress, deploymentBlock):\n${problems}`);
  }
  return parsed.data;
}
