import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { parse } from "dotenv";
import { MaxUint256, ZeroAddress, getAddress, isAddress, isHexString } from "ethers";
import { z } from "zod";

export const ROOT_DIR = path.resolve(__dirname, "..", "..");

export const DEPLOY_NETWORKS = {
  target: { envFile: ".env", deploymentFile: "network.json", verifyOnExplorer: true },
  localhost: { envFile: ".env.localhost", deploymentFile: "localhost.json", verifyOnExplorer: false },
} as const;

export type DeployNetworkName = keyof typeof DEPLOY_NETWORKS;

function isDeployNetwork(name: string): name is DeployNetworkName {
  return Object.hasOwn(DEPLOY_NETWORKS, name);
}

export function requireDeployNetwork(name: string): DeployNetworkName {
  if (!isDeployNetwork(name)) {
    throw new Error(`Unsupported network "${name}". Use one of: ${Object.keys(DEPLOY_NETWORKS).join(", ")}.`);
  }
  return name;
}

function envFilePath(network: DeployNetworkName): string {
  return path.join(ROOT_DIR, DEPLOY_NETWORKS[network].envFile);
}

export function deploymentFilePath(network: DeployNetworkName): string {
  return path.join(ROOT_DIR, "deployments", DEPLOY_NETWORKS[network].deploymentFile);
}

function readEnvFile(network: DeployNetworkName): Record<string, string> {
  const file = envFilePath(network);
  return existsSync(file) ? parse(readFileSync(file)) : {};
}

const text = z
  .string({ error: (issue) => (issue.input === undefined ? "is missing" : "must be text") })
  .trim()
  .min(1, { error: "is missing", abort: true });

const httpUrl = text.refine((value) => {
  try {
    const { protocol } = new URL(value);
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}, "must be an http or https URL");

const wholeNumber = (max: bigint) =>
  text
    .regex(/^[0-9]+$/, "must be a whole number")
    .transform((value) => BigInt(value))
    .refine((value) => value > 0n && value <= max, `must be between 1 and ${max}`);

const safeNumber = wholeNumber(BigInt(Number.MAX_SAFE_INTEGER)).transform((value) => Number(value));

const address = text
  .refine((value) => isAddress(value), "must be a valid checksummed or lowercase address")
  .transform((value) => getAddress(value))
  .refine((value) => value !== ZeroAddress, "must not be the zero address");

const privateKey = text.refine((value) => isHexString(value, 32), "must be a 0x-prefixed 32-byte hex string");

const rpcShape = {
  RPC_URL: httpUrl,
  CHAIN_ID: safeNumber,
};

const deployShape = {
  ...rpcShape,
  DEPLOYER_PRIVATE_KEY: privateKey,
  REVIEWER_ADDRESS: address,
  VERIFIER_ADDRESS: address,
  MIN_STAKE_WEI: wholeNumber(MaxUint256),
  FLAG_DURATION_SECONDS: safeNumber,
  MAX_MEMBERS_PER_CALL: safeNumber,
  CONFIRMATIONS: safeNumber,
};

const deploySchemas = {
  target: z.object({ ...deployShape, EXPLORER_API_KEY: text }),
  localhost: z.object({ ...deployShape, EXPLORER_API_KEY: text.optional() }),
};

const rpcSchema = z.object(rpcShape);

export type DeployEnv = z.infer<(typeof deploySchemas)["localhost"]>;
type RpcEnv = z.infer<typeof rpcSchema>;

function formatIssues(source: string, error: z.ZodError): string {
  const lines = error.issues.map((issue) => `  ${issue.path.join(".")}: ${issue.message}`);
  return `Invalid configuration in ${source}:\n${lines.join("\n")}`;
}

function parseOrThrow<T>(schema: z.ZodType<T>, raw: unknown, source: string): T {
  const result = schema.safeParse(raw);
  if (!result.success) throw new Error(formatIssues(source, result.error));
  return result.data;
}

export function safeParseDeployEnv(network: DeployNetworkName): DeployEnv | undefined {
  const result = deploySchemas[network].safeParse(readEnvFile(network));
  return result.success ? result.data : undefined;
}

export function loadDeployEnv(network: DeployNetworkName): DeployEnv {
  return parseOrThrow(deploySchemas[network], readEnvFile(network), DEPLOY_NETWORKS[network].envFile);
}

export function loadRpcEnv(network: DeployNetworkName): RpcEnv {
  return parseOrThrow(rpcSchema, readEnvFile(network), DEPLOY_NETWORKS[network].envFile);
}

const deploymentSchema = z.object({
  chainId: z.number().int().positive(),
  stakeoutAddress: address,
  guardAddress: address,
  deploymentBlock: z.number().int().nonnegative(),
  reviewer: address,
  verifier: address,
  minStake: z.string().regex(/^[0-9]+$/),
  flagDuration: z.number().int().positive(),
  maxMembersPerCall: z.number().int().positive(),
  deployedAt: z.iso.datetime(),
});

export type Deployment = z.infer<typeof deploymentSchema>;

export function readDeployment(network: DeployNetworkName): Deployment {
  const file = deploymentFilePath(network);
  if (!existsSync(file)) {
    throw new Error(`No deployment file at ${path.relative(ROOT_DIR, file)}. Deploy to "${network}" first.`);
  }
  const raw: unknown = JSON.parse(readFileSync(file, "utf8"));
  return parseOrThrow(deploymentSchema, raw, path.relative(ROOT_DIR, file));
}

export function redact(message: string, secrets: Array<string | undefined>): string {
  return secrets.reduce<string>(
    (current, secret) => (secret ? current.split(secret).join("[redacted]") : current),
    message,
  );
}
