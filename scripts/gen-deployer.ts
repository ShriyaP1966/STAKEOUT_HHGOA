import { Wallet } from "ethers";
import { fillEmptyRootEnvValue, hasRootEnvValue } from "./lib/env-file";

const KEY_NAME = "DEPLOYER_PRIVATE_KEY";

function main(): void {
  if (hasRootEnvValue(KEY_NAME)) throw new Error(`${KEY_NAME} already has a value in .env. Refusing to replace it.`);
  const wallet = Wallet.createRandom();
  fillEmptyRootEnvValue(KEY_NAME, wallet.privateKey);
  console.log(`Deployer address: ${wallet.address}`);
  console.log(`${KEY_NAME} was written to .env only.`);
}

try {
  main();
} catch (error: unknown) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
