// Generates the verifier wallet. The private key goes straight into .env and is never printed.
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { Wallet } from "ethers";

const envPath = ".env";
const text = existsSync(envPath) ? readFileSync(envPath, "utf8") : "";
if (/^VERIFIER_PRIVATE_KEY=\S+/m.test(text)) {
  console.error("VERIFIER_PRIVATE_KEY already set in .env. Refusing to overwrite; delete the line yourself if you really want a new wallet.");
  process.exit(1);
}
const wallet = Wallet.createRandom();
appendFileSync(envPath, `${text && !text.endsWith("\n") ? "\n" : ""}VERIFIER_PRIVATE_KEY=${wallet.privateKey}\n`);
console.log(`Verifier wallet created. Private key saved to .env only.\nPublic address (send this to Person 3): ${wallet.address}`);
