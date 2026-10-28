import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Interface, type InterfaceAbi } from "ethers";
import { VerifierStartupError } from "./errors.js";

const ABI_FILE = fileURLToPath(new URL("../../../../shared/abi/Stakeout.json", import.meta.url));

const REQUIRED_FUNCTIONS = [
  "confirm", "link", "getStatus", "maxMembersPerCall", "hasRole", "VERIFIER_ROLE",
  "activeFlagOf", "getFlag", "getClusterEntry", "clusterExists",
];
const REQUIRED_EVENTS = ["Promoted"];

/** Reads the ABI Person 3 exports to shared/abi at runtime and checks it has what the verifier calls. */
export function loadAbi(): InterfaceAbi {
  let json: unknown;
  try {
    json = JSON.parse(readFileSync(ABI_FILE, "utf8"));
  } catch (e) {
    throw new VerifierStartupError(
      `Cannot read the contract ABI at shared/abi/Stakeout.json (${(e as Error).message}). Person 3 writes it with "npm run export-abi" or the deploy script.`,
    );
  }
  if (!Array.isArray(json)) throw new VerifierStartupError("shared/abi/Stakeout.json is not an ABI array. Ask Person 3 to re-export it.");
  const iface = new Interface(json);
  const missing = [
    ...REQUIRED_FUNCTIONS.filter((n) => iface.getFunction(n) === null).map((n) => `function ${n}`),
    ...REQUIRED_EVENTS.filter((n) => iface.getEvent(n) === null).map((n) => `event ${n}`),
  ];
  if (missing.length) {
    throw new VerifierStartupError(`shared/abi/Stakeout.json is missing: ${missing.join(", ")}. The verifier needs them; ask Person 3 to re-export.`);
  }
  return json;
}
