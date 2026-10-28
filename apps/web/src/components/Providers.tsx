"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { createConfig, http, WagmiProvider } from "wagmi";
import { injected } from "wagmi/connectors";
import type { AppConfig } from "@/lib/app-config";
import { appChain } from "@/lib/chain";
import { AppConfigProvider } from "./AppConfigContext";

function createWagmiConfig(config: AppConfig) {
  const chain = appChain(config);
  return createConfig({
    chains: [chain],
    connectors: [injected()],
    transports: { [chain.id]: http(config.rpcUrl, { batch: true }) },
    ssr: true,
  });
}

export function Providers({ config, children }: { config: AppConfig; children: ReactNode }) {
  const [queryClient] = useState(
    () => new QueryClient({ defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } } }),
  );
  const [wagmiConfig] = useState(() => createWagmiConfig(config));
  return (
    <AppConfigProvider value={config}>
      <WagmiProvider config={wagmiConfig}>
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      </WagmiProvider>
    </AppConfigProvider>
  );
}
