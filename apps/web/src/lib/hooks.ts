"use client";

import { useQuery } from "@tanstack/react-query";
import type { PublicClient } from "viem";
import { usePublicClient } from "wagmi";
import { useAppConfig } from "@/components/AppConfigContext";
import { readBigint, readFlag, readRole, type FlagData } from "./contract";
import { buildIndex, type FlagRow } from "./events";
import { fetchStakeoutEvents } from "./logs";

export function useStakeoutClient(): PublicClient {
  const config = useAppConfig();
  const client = usePublicClient({ chainId: config.deployment.chainId });
  if (!client) throw new Error(`No RPC client is configured for chain ${config.deployment.chainId}.`);
  return client as PublicClient;
}

export function useStakeoutIndex() {
  const config = useAppConfig();
  const client = useStakeoutClient();
  const { stakeoutAddress, deploymentBlock } = config.deployment;
  return useQuery({
    queryKey: ["index", stakeoutAddress],
    queryFn: async () => {
      const [reporterRole, events] = await Promise.all([
        readRole(client, stakeoutAddress, "REPORTER_ROLE"),
        fetchStakeoutEvents(client, {
          address: stakeoutAddress,
          fromBlock: BigInt(deploymentBlock),
          chunkSize: config.logChunkSize,
        }),
      ]);
      return buildIndex(events, reporterRole);
    },
  });
}

export function useFlagStates(flags: FlagRow[] | undefined) {
  const config = useAppConfig();
  const client = useStakeoutClient();
  const ids = (flags ?? []).map((flag) => flag.flagId.toString());
  return useQuery({
    queryKey: ["flags", config.deployment.stakeoutAddress, ids.join(",")],
    enabled: flags !== undefined,
    queryFn: async () => {
      const entries = await Promise.all(
        (flags ?? []).map(async (flag) => [flag.flagId.toString(), await readFlag(client, config.deployment.stakeoutAddress, flag.flagId)] as const),
      );
      return new Map<string, FlagData>(entries);
    },
  });
}

export function useRewardPool() {
  const config = useAppConfig();
  const client = useStakeoutClient();
  return useQuery({
    queryKey: ["rewardPool", config.deployment.stakeoutAddress],
    queryFn: () => readBigint(client, config.deployment.stakeoutAddress, "rewardPool"),
  });
}
