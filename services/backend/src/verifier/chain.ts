import { Contract, JsonRpcProvider, Wallet, type InterfaceAbi } from "ethers";
import type { z } from "zod";
import type { verifierEnv } from "../config.js";
import type { Deployment } from "./deployment.js";
import { VerifierStartupError } from "./errors.js";

type Env = z.infer<typeof verifierEnv>;

// RPC URLs can carry API keys in the path or query, so only the host is ever printed.
function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "(invalid RPC_URL)";
  }
}

/** Raw eth_chainId call with a timeout, so an unreachable node fails once with a clear message instead of retrying forever. */
export async function rpcChainId(url: string, timeoutMs: number): Promise<number> {
  const host = hostOf(url);
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    const timedOut = (e as Error).name === "TimeoutError";
    throw new VerifierStartupError(
      timedOut
        ? `RPC endpoint ${host} did not answer within ${timeoutMs} ms (RPC_TIMEOUT_MS). Is the node running?`
        : `Cannot reach the RPC endpoint ${host}: ${(e as Error).message}. Is the node running?`,
    );
  }
  if (!res.ok) throw new VerifierStartupError(`RPC endpoint ${host} answered HTTP ${res.status} to eth_chainId.`);
  const body = (await res.json().catch(() => null)) as { result?: string; error?: { message?: string } } | null;
  if (!body || typeof body.result !== "string") {
    throw new VerifierStartupError(`RPC endpoint ${host} did not return a chain id: ${body?.error?.message ?? "unexpected response"}.`);
  }
  return Number(BigInt(body.result));
}

export type Chain = {
  provider: JsonRpcProvider;
  signer: Wallet;
  contract: Contract;
  rpcHost: string;
};

/**
 * Connects and refuses to start unless: the RPC is on CHAIN_ID, the deployment file matches CHAIN_ID,
 * there is contract code at the deployed address, and the signer holds VERIFIER_ROLE.
 */
export async function connectChain(env: Env, deployment: Deployment, abi: InterfaceAbi): Promise<Chain> {
  const rpcHost = hostOf(env.RPC_URL);
  const reported = await rpcChainId(env.RPC_URL, env.RPC_TIMEOUT_MS);
  if (reported !== env.CHAIN_ID) {
    throw new VerifierStartupError(`The RPC endpoint ${rpcHost} reports chain ${reported}, but CHAIN_ID in .env is ${env.CHAIN_ID}.`);
  }
  if (deployment.chainId !== env.CHAIN_ID) {
    throw new VerifierStartupError(
      `The deployment file is for chain ${deployment.chainId}, but CHAIN_ID in .env is ${env.CHAIN_ID}. DEPLOYMENT_PATH points at the wrong file.`,
    );
  }

  const provider = new JsonRpcProvider(env.RPC_URL, env.CHAIN_ID, { staticNetwork: true });
  const code = await provider.getCode(deployment.stakeoutAddress);
  if (code === "0x") {
    throw new VerifierStartupError(
      `No contract code at ${deployment.stakeoutAddress} on chain ${env.CHAIN_ID}. The deployment file is stale or the local node was restarted; ask Person 3 to redeploy.`,
    );
  }

  const signer = new Wallet(env.VERIFIER_PRIVATE_KEY, provider);
  const contract = new Contract(deployment.stakeoutAddress, abi, signer);
  const role = await contract.VERIFIER_ROLE();
  if (!(await contract.hasRole(role, signer.address))) {
    throw new VerifierStartupError(
      `The verifier wallet ${signer.address} does not have VERIFIER_ROLE on ${deployment.stakeoutAddress}. ` +
        "Ask Person 3 to grant it to this address (the public address of VERIFIER_PRIVATE_KEY).",
    );
  }
  return { provider, signer, contract, rpcHost };
}
