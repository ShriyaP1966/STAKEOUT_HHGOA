import { Interface, JsonRpcProvider, getAddress, isAddress } from "ethers";
import { Stakeout__factory } from "../typechain-types";
import { loadRpcEnv, readDeployment, requireDeployNetwork } from "./lib/deploy-config";

const ACTIONS = {
  addVerifiedReporter: "<account>",
  resolve: "<flagId> <true|false>",
  removeMember: "<target>",
  grantVerifier: "<account>",
  revokeVerifier: "<account>",
} as const;

type Action = keyof typeof ACTIONS;

function usage(): string {
  const lines = Object.entries(ACTIONS).map(([action, args]) => `  npm run safe:calldata -- <network> ${action} ${args}`);
  return `Usage:\n${lines.join("\n")}`;
}

function requireAction(value: string | undefined): Action {
  if (value === undefined || !Object.hasOwn(ACTIONS, value)) {
    throw new Error(`Unknown action "${value ?? ""}".\n${usage()}`);
  }
  return value as Action;
}

function parseAddressArg(value: string | undefined, label: string): string {
  if (value === undefined || !isAddress(value)) throw new Error(`${label} must be a valid address.`);
  return getAddress(value);
}

function parseFlagId(value: string | undefined): bigint {
  if (value === undefined || !/^[0-9]+$/.test(value)) throw new Error("flagId must be a whole number.");
  return BigInt(value);
}

function parseBool(value: string | undefined): boolean {
  if (value !== "true" && value !== "false") throw new Error("flagUpheld must be true or false.");
  return value === "true";
}

async function main(): Promise<void> {
  const [networkArg, actionArg, ...params] = process.argv.slice(2);
  if (networkArg === undefined) throw new Error(`Network is required.\n${usage()}`);
  const networkName = requireDeployNetwork(networkArg);
  const action = requireAction(actionArg);
  const expectedParams = ACTIONS[action].split(" ").length;
  if (params.length !== expectedParams) {
    throw new Error(`${action} takes ${expectedParams} argument(s): ${ACTIONS[action]}`);
  }

  const deployment = readDeployment(networkName);
  const env = loadRpcEnv(networkName);
  if (env.CHAIN_ID !== deployment.chainId) {
    throw new Error(`CHAIN_ID is ${env.CHAIN_ID} but the deployment file is for chain ${deployment.chainId}.`);
  }
  const provider = new JsonRpcProvider(env.RPC_URL, env.CHAIN_ID, { staticNetwork: true });
  if ((await provider.getCode(deployment.stakeoutAddress)) === "0x") {
    throw new Error(`No contract code at ${deployment.stakeoutAddress} on chain ${env.CHAIN_ID}.`);
  }
  const stakeout = Stakeout__factory.connect(deployment.stakeoutAddress, provider);

  let method: string;
  let args: unknown[];
  switch (action) {
    case "addVerifiedReporter":
      method = "addVerifiedReporter";
      args = [parseAddressArg(params[0], "account")];
      break;
    case "resolve":
      method = "resolve";
      args = [parseFlagId(params[0]), parseBool(params[1])];
      break;
    case "removeMember":
      method = "removeMember";
      args = [parseAddressArg(params[0], "target")];
      break;
    case "grantVerifier":
      method = "grantRole";
      args = [await stakeout.VERIFIER_ROLE(), parseAddressArg(params[0], "account")];
      break;
    case "revokeVerifier":
      method = "revokeRole";
      args = [await stakeout.VERIFIER_ROLE(), parseAddressArg(params[0], "account")];
      break;
  }

  const abi: Interface = stakeout.interface;
  const fragment = abi.getFunction(method);
  if (!fragment) throw new Error(`Stakeout ABI has no function ${method}.`);
  const data = abi.encodeFunctionData(fragment, args);
  const output = {
    network: networkName,
    chainId: deployment.chainId,
    to: deployment.stakeoutAddress,
    value: "0",
    data,
    function: fragment.format("sighash"),
    args: args.map((arg) => (typeof arg === "bigint" ? arg.toString() : arg)),
  };
  console.log(JSON.stringify(output, null, 2));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
