import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { DEPLOYMENT_FILES, parseDeployment } from "./deployment";
import { parsePublicEnv, type ParseResult } from "./env";
import type { AppConfig } from "./app-config";

const DEPLOYMENTS_DIR = path.resolve(process.cwd(), "..", "..", "deployments");

export function loadAppConfig(): ParseResult<AppConfig> {
  const env = parsePublicEnv({
    NEXT_PUBLIC_RPC_URL: process.env.NEXT_PUBLIC_RPC_URL,
    NEXT_PUBLIC_LOG_CHUNK_SIZE: process.env.NEXT_PUBLIC_LOG_CHUNK_SIZE,
    NEXT_PUBLIC_EXPLORER_URL: process.env.NEXT_PUBLIC_EXPLORER_URL,
    NEXT_PUBLIC_DEPLOYMENT: process.env.NEXT_PUBLIC_DEPLOYMENT,
    NEXT_PUBLIC_DATA_SOURCE: process.env.NEXT_PUBLIC_DATA_SOURCE,
    NEXT_PUBLIC_BACKEND_URL: process.env.NEXT_PUBLIC_BACKEND_URL,
    NEXT_PUBLIC_VOICE_LANG: process.env.NEXT_PUBLIC_VOICE_LANG,
  });
  if (!env.ok) return env;

  const fileName = DEPLOYMENT_FILES[env.value.deployment];
  const source = `deployments/${fileName}`;
  const file = path.join(DEPLOYMENTS_DIR, fileName);
  if (!existsSync(file)) {
    return { ok: false, problems: [`${source}: not found. Deploy to "${env.value.deployment}" first.`] };
  }

  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    return { ok: false, problems: [`${source}: ${error instanceof Error ? error.message : "unreadable"}`] };
  }

  const deployment = parseDeployment(raw, source);
  if (!deployment.ok) return deployment;
  const { deployment: deploymentName, ...rest } = env.value;
  return { ok: true, value: { ...rest, deploymentName, deploymentFile: source, deployment: deployment.value } };
}
