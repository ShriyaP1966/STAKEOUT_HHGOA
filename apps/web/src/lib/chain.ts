import { defineChain, type Chain } from "viem";
import type { AppConfig } from "./app-config";

export const NATIVE_CURRENCY = { name: "Ether", symbol: "ETH", decimals: 18 } as const;

export function appChain(config: AppConfig): Chain {
  const id = config.deployment.chainId;
  return defineChain({
    id,
    name: `Chain ${id}`,
    nativeCurrency: NATIVE_CURRENCY,
    rpcUrls: { default: { http: [config.rpcUrl] } },
    blockExplorers: config.explorerUrl ? { default: { name: "Explorer", url: config.explorerUrl } } : undefined,
  });
}
