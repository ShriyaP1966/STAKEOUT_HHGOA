"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { getAddress, isAddress, type Address, type Hex } from "viem";
import { useAccount, useWriteContract } from "wagmi";
import { PromoteAction } from "@/components/actions";
import { useAppConfig } from "@/components/AppConfigContext";
import { Countdown, Empty, ErrorPanel, ExplorerLink, Field, Loading, Mono, Section } from "@/components/ui";
import { Role, Status } from "@shared/enums";
import { abiEvent, combinedAbi } from "@/lib/abi";
import { readStatus, type StatusResult } from "@/lib/contract";
import { backend, BackendError, bundleSummarySchema } from "@/lib/backend";
import { decodeError } from "@/lib/errors";
import { latestClusterEntryFor, latestReportFor, type LogRef } from "@/lib/events";
import { useStakeoutClient } from "@/lib/hooks";
import { fetchStakeoutEvents } from "@/lib/logs";
import { parseAmount, simulateGuardedSend } from "@/lib/send";
import { warningFor, type WarningLevel } from "@/lib/warning";
import { NATIVE_CURRENCY } from "@/lib/chain";

const LEVEL_STYLES: Record<WarningLevel, string> = {
  none: "border-emerald-300 bg-emerald-50 text-emerald-900",
  note: "border-sky-300 bg-sky-50 text-sky-900",
  soft: "border-amber-300 bg-amber-50 text-amber-900",
  strong: "border-red-400 bg-red-50 text-red-900",
};

type Evidence = { hash: Hex; ref: LogRef; source: string; reportId?: bigint } | null;

function useEvidence(account: Address | undefined, status: StatusResult | undefined) {
  const config = useAppConfig();
  const client = useStakeoutClient();
  const { stakeoutAddress, deploymentBlock } = config.deployment;
  return useQuery({
    queryKey: ["evidence", stakeoutAddress, account, status?.status, status?.clusterId],
    enabled: account !== undefined && status !== undefined && status.status !== Status.None,
    queryFn: async (): Promise<Evidence> => {
      if (!account || !status) return null;
      const base = { address: stakeoutAddress, fromBlock: BigInt(deploymentBlock), chunkSize: config.logChunkSize };
      if (status.status === Status.Confirmed || status.status === Status.Linked) {
        const linked = status.role === Role.Linked;
        const events = await fetchStakeoutEvents(client, {
          ...base,
          event: abiEvent(linked ? "Linked" : "Confirmed"),
          args: linked ? { target: account, clusterId: status.clusterId } : { clusterId: status.clusterId },
        });
        const entry = latestClusterEntryFor(events, account, status.clusterId);
        return entry ? { hash: entry.evidenceHash, ref: entry.ref, source: linked ? "Linked event" : "Confirmed event" } : null;
      }
      const events = await fetchStakeoutEvents(client, { ...base, event: abiEvent("ReportSubmitted"), args: { target: account } });
      const report = latestReportFor(events, account);
      return report
        ? { hash: report.evidenceHash, ref: report.ref, source: `ReportSubmitted event, report #${report.reportId}`, reportId: report.reportId }
        : null;
    },
  });
}

function AiSummary({ hash }: { hash: Hex }) {
  const summary = useQuery({
    queryKey: ["bundle-summary", hash],
    queryFn: async () => {
      try {
        const { bundle } = await backend.evidence(hash);
        const parsed = bundleSummarySchema.safeParse(bundle);
        if (!parsed.success) throw new Error("The evidence bundle for this hash has no valid aiSummary or dataSource.");
        return parsed.data;
      } catch (error) {
        if (error instanceof BackendError && error.status === 404) return null;
        throw error;
      }
    },
  });
  if (summary.isPending) return <Loading label="Fetching the evidence bundle from the backend…" />;
  if (summary.isError) {
    return (
      <ErrorPanel error={summary.error instanceof BackendError ? summary.error.decoded : decodeError(summary.error, combinedAbi)} />
    );
  }
  if (summary.data === null) return <p className="text-sm">The backend has no evidence bundle for this hash.</p>;
  return (
    <div className="space-y-1 text-sm">
      <p className="whitespace-pre-line">{summary.data.aiSummary.text}</p>
      <p className="text-xs opacity-80">
        Summary source: {summary.data.aiSummary.source}. Data source: {summary.data.dataSource}. The summary explains the
        evidence; it does not confirm anything.
      </p>
    </div>
  );
}

function StatusCard({ account, status }: { account: Address; status: StatusResult }) {
  const warning = warningFor(status.status);
  const evidence = useEvidence(account, status);
  return (
    <div className={`rounded-lg border-2 p-4 ${LEVEL_STYLES[warning.level]}`} role={warning.level === "strong" ? "alert" : "status"}>
      <p className="text-xs font-semibold tracking-wide uppercase">Status: {Status[status.status]}</p>
      <p className="mt-1 text-xl font-bold">{warning.label}</p>
      <p className="mt-1 text-sm">{warning.message}</p>
      <dl className="mt-4 space-y-2">
        <Field label="Address">
          <ExplorerLink kind="address" value={account} />
        </Field>
        {warning.showCountdown && (
          <Field label="Flag lapses in">
            <Countdown expiresAt={status.expiresAt} />
          </Field>
        )}
        {warning.showCluster && (
          <>
            <Field label="Cluster id">
              <Mono>{status.clusterId}</Mono>
            </Field>
            <Field label="Role">{Role[status.role]}</Field>
          </>
        )}
        {status.status !== Status.None && (
          <Field label="Evidence hash">
            {evidence.isPending && <Loading label="Reading events…" />}
            {evidence.isError && <ErrorPanel error={decodeError(evidence.error, combinedAbi)} />}
            {evidence.isSuccess && evidence.data === null && <Empty label="No matching event found." />}
            {evidence.isSuccess && evidence.data && (
              <div className="space-y-1">
                <Mono>{evidence.data.hash}</Mono>
                <p className="text-xs opacity-80">
                  This is a hash of off-chain evidence, not the evidence itself. Source: {evidence.data.source}, tx{" "}
                  <ExplorerLink kind="tx" value={evidence.data.ref.transactionHash} />
                </p>
              </div>
            )}
          </Field>
        )}
        {status.status === Status.Reported && evidence.isSuccess && evidence.data?.reportId !== undefined && (
          <Field label="Promote">
            <PromoteAction reportId={evidence.data.reportId} targetStatus={status.status} />
          </Field>
        )}
        {warning.showCluster && evidence.isSuccess && evidence.data && (
          <Field label="Evidence summary">
            <AiSummary hash={evidence.data.hash} />
          </Field>
        )}
      </dl>
    </div>
  );
}

function SendPanel({ to }: { to: Address }) {
  const config = useAppConfig();
  const client = useStakeoutClient();
  const { address, isConnected, chainId } = useAccount();
  const { writeContractAsync } = useWriteContract();
  const [amount, setAmount] = useState("");
  const value = parseAmount(amount);
  const onChain = chainId === config.deployment.chainId;

  const send = useMutation({
    mutationFn: async () => {
      if (!address || value === undefined) throw new Error("Connect a wallet and enter an amount first.");
      const request = await simulateGuardedSend(client, {
        account: address,
        guard: config.deployment.guardAddress,
        to,
        value,
      });
      const hash = await writeContractAsync(request as Parameters<typeof writeContractAsync>[0]);
      const receipt = await client.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") throw new Error(`Transaction ${hash} reverted.`);
      return hash;
    },
  });

  const blockedReason = !isConnected
    ? "Connect a wallet to send."
    : !onChain
      ? `Switch your wallet to chain ${config.deployment.chainId} to send.`
      : value === undefined && amount.trim() !== ""
        ? `Enter a positive amount in ${NATIVE_CURRENCY.symbol}.`
        : undefined;

  return (
    <Section title="Send through StakeoutGuard">
      <p className="mb-3 text-sm text-slate-600">
        Funds go through StakeoutGuard at <ExplorerLink kind="address" value={config.deployment.guardAddress} />, which
        refuses to forward to Confirmed or Linked addresses.
      </p>
      <form
        className="flex flex-col gap-2 sm:flex-row"
        onSubmit={(event) => {
          event.preventDefault();
          send.mutate();
        }}
      >
        <label className="sr-only" htmlFor="amount">
          Amount in {NATIVE_CURRENCY.symbol}
        </label>
        <input
          id="amount"
          inputMode="decimal"
          placeholder={`Amount in ${NATIVE_CURRENCY.symbol}`}
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm sm:max-w-xs"
        />
        <button
          type="submit"
          disabled={blockedReason !== undefined || value === undefined || send.isPending}
          className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          {send.isPending ? "Sending…" : "Send"}
        </button>
      </form>
      {blockedReason && <p className="mt-2 text-sm text-slate-600">{blockedReason}</p>}
      <div className="mt-3">
        {send.isError && <ErrorPanel error={decodeError(send.error, combinedAbi)} />}
        {send.isSuccess && (
          <p role="status" className="text-sm text-emerald-800">
            Sent. Transaction <ExplorerLink kind="tx" value={send.data} />
          </p>
        )}
      </div>
    </Section>
  );
}

export default function WalletPage() {
  const config = useAppConfig();
  const client = useStakeoutClient();
  const [input, setInput] = useState("");
  const [inputError, setInputError] = useState<string | null>(null);
  const [account, setAccount] = useState<Address | undefined>(undefined);

  const status = useQuery({
    queryKey: ["status", config.deployment.stakeoutAddress, account],
    enabled: account !== undefined,
    queryFn: () => readStatus(client, config.deployment.stakeoutAddress, account as Address),
  });

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    const candidate = input.trim();
    if (!isAddress(candidate)) {
      setInputError("Enter a valid address: 0x followed by 40 hex characters. Mixed case must match the checksum.");
      setAccount(undefined);
      return;
    }
    setInputError(null);
    setAccount(getAddress(candidate));
  };

  return (
    <>
      <Section title="Check an address before sending">
        <form className="flex flex-col gap-2 sm:flex-row" onSubmit={onSubmit}>
          <label className="sr-only" htmlFor="address">
            Recipient address
          </label>
          <input
            id="address"
            placeholder="Recipient address (0x…)"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            autoComplete="off"
            spellCheck={false}
            className="w-full rounded-md border border-slate-300 px-3 py-2 font-mono text-sm"
          />
          <button
            type="submit"
            className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700"
          >
            Check
          </button>
        </form>
        {inputError && <p className="mt-2 text-sm text-red-700">{inputError}</p>}
        <div className="mt-4">
          {account === undefined && !inputError && <Empty label="Enter an address to see its status." />}
          {account !== undefined && status.isPending && <Loading label="Calling getStatus…" />}
          {status.isError && <ErrorPanel error={decodeError(status.error, combinedAbi)} />}
          {account !== undefined && status.isSuccess && <StatusCard account={account} status={status.data} />}
        </div>
      </Section>
      {account !== undefined && status.isSuccess && <SendPanel key={account} to={account} />}
    </>
  );
}
