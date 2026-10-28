// Prints the PUBLIC address of the verifier wallet (derived from VERIFIER_PRIVATE_KEY in .env). The key itself is never printed.
// Usage: npm run verifier-address
import { Wallet } from "ethers";
import { chainEnv, loadEnv } from "../config.js";

const env = loadEnv(chainEnv.pick({ VERIFIER_PRIVATE_KEY: true }), "verifier key");
console.log(new Wallet(env.VERIFIER_PRIVATE_KEY).address);
