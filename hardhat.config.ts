import { HardhatUserConfig } from "hardhat/config";
import type { HttpNetworkUserConfig } from "hardhat/types";
import "@nomicfoundation/hardhat-ethers";
import "@nomicfoundation/hardhat-chai-matchers";
import "@nomicfoundation/hardhat-verify";
import "@typechain/hardhat";
import "solidity-coverage";
import { DeployNetworkName, safeParseDeployEnv, safeParseRpcEnv, safeParseVerifyEnv } from "./scripts/lib/deploy-config";

function networkFromEnv(network: DeployNetworkName): HttpNetworkUserConfig {
  const env = safeParseDeployEnv(network);
  if (env) return { url: env.RPC_URL, chainId: env.CHAIN_ID, accounts: [env.DEPLOYER_PRIVATE_KEY] };
  const rpc = safeParseRpcEnv(network);
  if (rpc) return { url: rpc.RPC_URL, chainId: rpc.CHAIN_ID, accounts: [] };
  return { url: "", accounts: [] };
}

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.24",
    settings: {
      evmVersion: "cancun",
      optimizer: { enabled: true, runs: 200 },
    },
  },
  networks: {
    target: networkFromEnv("target"),
    localhost: networkFromEnv("localhost"),
  },
  etherscan: {
    apiKey: safeParseVerifyEnv()?.EXPLORER_API_KEY ?? "",
  },
  sourcify: {
    enabled: false,
  },
  typechain: {
    outDir: "typechain-types",
    target: "ethers-v6",
  },
};

export default config;
