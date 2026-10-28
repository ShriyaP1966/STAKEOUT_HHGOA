"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { Address, Hash, PublicClient } from "viem";
import { useAccount, usePublicClient, useWriteContract } from "wagmi";
import { z } from "zod";
import { useAppConfig } from "@/components/AppConfigContext";
import { stakeoutAbi } from "./abi";
import { readBigint, readFlag, readRole, readStatus, type FlagData, type StatusResult } from "./contract";
import { buildIndex, type FlagRow } from "./events";
import { fetchStakeoutEvents } from "./logs";
import { sendContractCall, type ContractCall } from "./tx";

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

export function useMinStake() {
  const config = useAppConfig();
  const client = useStakeoutClient();
  return useQuery({
    queryKey: ["minStake", config.deployment.stakeoutAddress],
    queryFn: () => readBigint(client, config.deployment.stakeoutAddress, "minStake"),
  });
}

export function useIsReporter(account: Address | undefined) {
  const config = useAppConfig();
  const client = useStakeoutClient();
  return useQuery({
    queryKey: ["isReporter", config.deployment.stakeoutAddress, account],
    enabled: account !== undefined,
    queryFn: async () => {
      const role = await readRole(client, config.deployment.stakeoutAddress, "REPORTER_ROLE");
      const raw = await client.readContract({
        address: config.deployment.stakeoutAddress,
        abi: stakeoutAbi,
        functionName: "hasRole",
        args: [role, account as Address],
      });
      return z.boolean().parse(raw);
    },
  });
}

export function useCredits(account: Address | undefined) {
  const config = useAppConfig();
  const client = useStakeoutClient();
  return useQuery({
    queryKey: ["credits", config.deployment.stakeoutAddress, account],
    enabled: account !== undefined,
    queryFn: async () => {
      const raw = await client.readContract({
        address: config.deployment.stakeoutAddress,
        abi: stakeoutAbi,
        functionName: "credits",
        args: [account as Address],
      });
      return z.bigint().parse(raw);
    },
  });
}

export function useStatuses(accounts: Address[]) {
  const config = useAppConfig();
  const client = useStakeoutClient();
  const unique = [...new Set(accounts)];
  return useQuery({
    queryKey: ["statuses", config.deployment.stakeoutAddress, unique.join(",")],
    enabled: unique.length > 0,
    queryFn: async () => {
      const entries = await Promise.all(
        unique.map(async (account) => [account, await readStatus(client, config.deployment.stakeoutAddress, account)] as const),
      );
      return new Map<Address, StatusResult>(entries);
    },
  });
}

export function useWalletState() {
  const config = useAppConfig();
  const { address, isConnected, chainId } = useAccount();
  return {
    account: address,
    wallet: { connected: isConnected && address !== undefined, onExpectedChain: chainId === config.deployment.chainId },
  };
}

export function useContractAction() {
  const client = useStakeoutClient();
  const queryClient = useQueryClient();
  const { address } = useAccount();
  const { writeContractAsync } = useWriteContract();
  const [hash, setHash] = useState<Hash | undefined>(undefined);
  const mutation = useMutation({
    mutationFn: async (call: ContractCall) => {
      if (!address) throw new Error("Connect a wallet first.");
      setHash(undefined);
      return sendContractCall(
        client,
        async (request) => {
          const sent = await writeContractAsync(request as Parameters<typeof writeContractAsync>[0]);
          setHash(sent);
          return sent;
        },
        address,
        call,
      );
    },
    onSuccess: () => queryClient.invalidateQueries(),
  });
  return { ...mutation, hash };
}
