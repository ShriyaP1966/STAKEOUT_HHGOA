import { describe, expect, it } from "vitest";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { parseDeployment } from "./deployment";
import { parsePublicEnv, type RawPublicEnv } from "./env";

const valid: RawPublicEnv = {
  NEXT_PUBLIC_RPC_URL: "http://127.0.0.1:8545",
  NEXT_PUBLIC_LOG_CHUNK_SIZE: "500",
  NEXT_PUBLIC_EXPLORER_URL: "https://explorer.invalid/",
  NEXT_PUBLIC_DEPLOYMENT: "target",
  NEXT_PUBLIC_DATA_SOURCE: "testnet",
  NEXT_PUBLIC_BACKEND_URL: "http://127.0.0.1:9/",
  NEXT_PUBLIC_GRAPH_URL: "http://127.0.0.1:10/",
  NEXT_PUBLIC_VOICE_LANG: "en-GB",
};

function problemsOf(raw: RawPublicEnv): string[] {
  const result = parsePublicEnv(raw);
  return result.ok ? [] : result.problems;
}

describe("parsePublicEnv", () => {
  it("accepts a complete configuration and trims the explorer URL", () => {
    const result = parsePublicEnv(valid);
    expect(result).toEqual({
      ok: true,
      value: {
        rpcUrl: valid.NEXT_PUBLIC_RPC_URL,
        logChunkSize: 500,
        explorerUrl: "https://explorer.invalid",
        deployment: "target",
        dataSource: "testnet",
        backendUrl: "http://127.0.0.1:9",
        graphUrl: "http://127.0.0.1:10",
        voiceLang: "en-GB",
      },
    });
  });

  it("names every missing variable", () => {
    const problems = problemsOf({
      NEXT_PUBLIC_RPC_URL: undefined,
      NEXT_PUBLIC_LOG_CHUNK_SIZE: undefined,
      NEXT_PUBLIC_EXPLORER_URL: undefined,
      NEXT_PUBLIC_DEPLOYMENT: undefined,
      NEXT_PUBLIC_DATA_SOURCE: undefined,
      NEXT_PUBLIC_BACKEND_URL: undefined,
      NEXT_PUBLIC_GRAPH_URL: undefined,
      NEXT_PUBLIC_VOICE_LANG: undefined,
    });
    for (const name of [
      "NEXT_PUBLIC_RPC_URL",
      "NEXT_PUBLIC_LOG_CHUNK_SIZE",
      "NEXT_PUBLIC_DEPLOYMENT",
      "NEXT_PUBLIC_DATA_SOURCE",
      "NEXT_PUBLIC_BACKEND_URL",
      "NEXT_PUBLIC_GRAPH_URL",
      "NEXT_PUBLIC_VOICE_LANG",
    ]) {
      expect(problems).toContain(`${name}: is missing`);
    }
  });

  it("treats empty strings as missing", () => {
    expect(problemsOf({ ...valid, NEXT_PUBLIC_RPC_URL: "  " })).toEqual(["NEXT_PUBLIC_RPC_URL: is missing"]);
  });

  it("requires the explorer URL for target but not for localhost", () => {
    expect(problemsOf({ ...valid, NEXT_PUBLIC_EXPLORER_URL: "" })).toEqual([
      "NEXT_PUBLIC_EXPLORER_URL: is missing (required when NEXT_PUBLIC_DEPLOYMENT is target)",
    ]);
    const local = parsePublicEnv({ ...valid, NEXT_PUBLIC_EXPLORER_URL: undefined, NEXT_PUBLIC_DEPLOYMENT: "localhost" });
    expect(local.ok && local.value.explorerUrl).toBeUndefined();
  });

  it("validates the backend URL and the voice language tag", () => {
    expect(problemsOf({ ...valid, NEXT_PUBLIC_BACKEND_URL: "not a url", NEXT_PUBLIC_VOICE_LANG: "en_GB!" })).toEqual([
      "NEXT_PUBLIC_BACKEND_URL: must be an http or https URL",
      "NEXT_PUBLIC_VOICE_LANG: must be a BCP-47 language tag",
    ]);
  });

  it("rejects invalid values without echoing them", () => {
    const problems = problemsOf({
      ...valid,
      NEXT_PUBLIC_RPC_URL: "ftp://example.invalid",
      NEXT_PUBLIC_LOG_CHUNK_SIZE: "0",
      NEXT_PUBLIC_DEPLOYMENT: "mainnet",
      NEXT_PUBLIC_DATA_SOURCE: "real",
    });
    expect(problems).toEqual([
      "NEXT_PUBLIC_RPC_URL: must be an http or https URL",
      "NEXT_PUBLIC_LOG_CHUNK_SIZE: must be at least 1",
      "NEXT_PUBLIC_DEPLOYMENT: must be one of: target, localhost",
      "NEXT_PUBLIC_DATA_SOURCE: must be one of: synthetic, testnet",
    ]);
    expect(problems.join(" ")).not.toContain("ftp://");
  });
});

describe("parseDeployment", () => {
  const address = () => privateKeyToAccount(generatePrivateKey()).address;
  const deployment = {
    chainId: 1234,
    stakeoutAddress: address(),
    guardAddress: address(),
    deploymentBlock: 7,
    reviewer: address(),
    verifier: address(),
    minStake: "1000",
    flagDuration: 60,
    maxMembersPerCall: 3,
    deployedAt: new Date(0).toISOString(),
  };

  it("accepts a valid deployment file", () => {
    expect(parseDeployment(deployment, "deployments/x.json")).toEqual({ ok: true, value: deployment });
  });

  it("names invalid fields with the file they came from", () => {
    const result = parseDeployment({ ...deployment, stakeoutAddress: "0x123", deploymentBlock: -1 }, "deployments/x.json");
    expect(result.ok).toBe(false);
    expect(!result.ok && result.problems).toEqual([
      "deployments/x.json stakeoutAddress: must be a valid address",
      "deployments/x.json deploymentBlock: Too small: expected number to be >=0",
    ]);
  });
});

describe("NEXT_PUBLIC_GRAPH_URL", () => {
  it("must be an http or https URL", () => {
    expect(problemsOf({ ...valid, NEXT_PUBLIC_GRAPH_URL: "ftp://graph.invalid" })).toEqual(["NEXT_PUBLIC_GRAPH_URL: must be an http or https URL"]);
    expect(problemsOf({ ...valid, NEXT_PUBLIC_GRAPH_URL: "  " })).toEqual(["NEXT_PUBLIC_GRAPH_URL: is missing"]);
  });
});
