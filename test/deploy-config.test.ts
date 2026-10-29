import { expect } from "chai";
import { Wallet } from "ethers";
import { DeployNetworkName, parseDeployEnv } from "../scripts/lib/deploy-config";

function fixtureEnv(): Record<string, string> {
  return {
    RPC_URL: "http://127.0.0.1:8545",
    CHAIN_ID: "1",
    DEPLOYER_PRIVATE_KEY: Wallet.createRandom().privateKey,
    REVIEWER_ADDRESS: Wallet.createRandom().address,
    VERIFIER_ADDRESS: Wallet.createRandom().address,
    MIN_STAKE_WEI: "1",
    FLAG_DURATION_SECONDS: "1",
    MAX_MEMBERS_PER_CALL: "1",
    CONFIRMATIONS: "1",
  };
}

function parseError(network: DeployNetworkName, raw: Record<string, string>): string {
  try {
    parseDeployEnv(network, raw);
  } catch (error: unknown) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error("Expected the configuration to be rejected.");
}

describe("deploy config EXPLORER_API_KEY", function () {
  it("accepts an unset key on localhost", function () {
    expect(parseDeployEnv("localhost", fixtureEnv()).EXPLORER_API_KEY).to.equal(undefined);
  });

  it("treats an empty key on localhost exactly like an unset one", function () {
    expect(parseDeployEnv("localhost", { ...fixtureEnv(), EXPLORER_API_KEY: "" }).EXPLORER_API_KEY).to.equal(undefined);
    expect(parseDeployEnv("localhost", { ...fixtureEnv(), EXPLORER_API_KEY: "   " }).EXPLORER_API_KEY).to.equal(undefined);
  });

  it("keeps a key that is set on localhost", function () {
    const key = Wallet.createRandom().address;
    expect(parseDeployEnv("localhost", { ...fixtureEnv(), EXPLORER_API_KEY: key }).EXPLORER_API_KEY).to.equal(key);
  });

  it("rejects an empty key on testnet with a clear message", function () {
    const message = parseError("target", { ...fixtureEnv(), EXPLORER_API_KEY: "" });
    expect(message).to.contain("Invalid configuration in .env");
    expect(message).to.contain("EXPLORER_API_KEY: is missing");
    expect(message).to.contain("required to verify contracts on the explorer when deploying to a non-local chain");
  });

  it("rejects an unset key on testnet with the same message", function () {
    expect(parseError("target", fixtureEnv())).to.equal(parseError("target", { ...fixtureEnv(), EXPLORER_API_KEY: "" }));
  });

  it("accepts a key that is set on testnet", function () {
    const key = Wallet.createRandom().address;
    expect(parseDeployEnv("target", { ...fixtureEnv(), EXPLORER_API_KEY: key }).EXPLORER_API_KEY).to.equal(key);
  });
});
