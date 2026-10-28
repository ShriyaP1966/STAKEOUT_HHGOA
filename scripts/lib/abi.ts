import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Artifacts } from "hardhat/types";
import { ROOT_DIR } from "./deploy-config";

const CONTRACT_NAMES = ["Stakeout", "StakeoutGuard"];

export async function writeAbis(artifacts: Artifacts): Promise<string[]> {
  const outDir = path.join(ROOT_DIR, "shared", "abi");
  await mkdir(outDir, { recursive: true });
  const written: string[] = [];
  for (const name of CONTRACT_NAMES) {
    const artifact = await artifacts.readArtifact(name);
    const file = path.join(outDir, `${name}.json`);
    await writeFile(file, `${JSON.stringify(artifact.abi, null, 2)}\n`);
    written.push(path.relative(ROOT_DIR, file));
  }
  return written;
}
