import { JsonRpcProvider } from "ethers";
import * as chains from "viem/chains";

type KnownChain = { id: number; name: string; testnet?: boolean };

function findChain(chainId: number): KnownChain | undefined {
  return Object.values(chains as Record<string, unknown>).find(
    (chain): chain is KnownChain =>
      typeof chain === "object" && chain !== null && (chain as { id?: unknown }).id === chainId,
  );
}

export function requireTestnetChainId(chainId: number): string {
  const chain = findChain(chainId);
  if (!chain) throw new Error(`CHAIN_ID ${chainId} is not a known chain. Refusing to run.`);
  if (chain.testnet !== true) throw new Error(`CHAIN_ID ${chainId} (${chain.name}) is not a testnet. Refusing to run.`);
  return chain.name;
}

export async function connectTestnet(rpcUrl: string, chainId: number): Promise<{ provider: JsonRpcProvider; chainName: string }> {
  const chainName = requireTestnetChainId(chainId);
  const provider = new JsonRpcProvider(rpcUrl, chainId, { staticNetwork: true });
  const connected = Number(await provider.send("eth_chainId", []));
  if (connected !== chainId) {
    throw new Error(`The RPC endpoint reports chain ${connected}, but CHAIN_ID is ${chainId}. Refusing to run.`);
  }
  return { provider, chainName };
}
