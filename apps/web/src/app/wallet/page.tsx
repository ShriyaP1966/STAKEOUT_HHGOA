"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { getAddress, isAddress, type Address, type Hex } from "viem";
import { useAccount, useWriteContract } from "wagmi";
import { PromoteAction } from "@/components/actions";
import { useAppConfig } from "@/components/AppConfigContext";
import { AlertIcon, CheckIcon, InfoIcon, SearchIcon } from "@/components/icons";
import { LEVEL_PANEL } from "@/components/status";
import { buttonClass, Countdown, Empty, ErrorPanel, ExplorerLink, Field, inputClass, Loading, Mono, Notice, PageHeader, Section } from "@/components/ui";
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

const LEVEL_ICON: Record<WarningLevel, typeof AlertIcon> = {
  none: CheckIcon,
  note: InfoIcon,
  soft: AlertIcon,
  strong: AlertIcon,
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
  if (summary.data === null) return <p className="text-sm text-fg-muted">The backend has no evidence bundle for this hash.</p>;
  return (
    <div className="space-y-3 text-sm">
      <p className="leading-relaxed whitespace-pre-line text-fg">{summary.data.aiSummary.text}</p>
      <p className="text-fg-muted">
        Summary source: {summary.data.aiSummary.source}. Data source: {summary.data.dataSource}. The summary explains the
        evidence. It does not confirm anything.
      </p>
    </div>
  );
}

function StatusCard({ account, status }: { account: Address; status: StatusResult }) {
  const warning = warningFor(status.status);
  const evidence = useEvidence(account, status);
  const Icon = LEVEL_ICON[warning.level];
  return (
    <div className="overflow-hidden rounded-lg border border-line bg-surface">
      <div className={`flex gap-4 border-b p-5 sm:p-6 ${LEVEL_PANEL[warning.level]}`} role={warning.level === "strong" ? "alert" : "status"}>
        <Icon size={28} className="mt-0.5 shrink-0" />
        <div className="space-y-1">
          <p className="text-xs font-semibold tracking-wide uppercase">Status: {Status[status.status]}</p>
          <p className="text-2xl font-bold tracking-tight">{warning.label}</p>
          <p className="text-[15px] leading-relaxed">{warning.message}</p>
        </div>
      </div>
      <dl className="p-5 sm:p-6">
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
                <p className="text-sm text-fg-muted">
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
    <Section
      title="Send through StakeoutGuard"
      description={
        <>
          Funds go through the guard contract at <ExplorerLink kind="address" value={config.deployment.guardAddress} />, which
          refuses to forward to Confirmed or Linked addresses.
        </>
      }
    >
      <form
        className="flex flex-col gap-3 sm:flex-row sm:items-end"
        onSubmit={(event) => {
          event.preventDefault();
          send.mutate();
        }}
      >
        <div className="w-full space-y-1.5 sm:max-w-xs">
          <label className="block text-sm font-semibold text-fg" htmlFor="amount">
            Amount in {NATIVE_CURRENCY.symbol}
          </label>
          <input
            id="amount"
            inputMode="decimal"
            placeholder="0.01"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            className={`${inputClass} font-mono`}
          />
        </div>
        <button
          type="submit"
          disabled={blockedReason !== undefined || value === undefined || send.isPending}
          className={buttonClass("accent")}
        >
          {send.isPending ? "Sending…" : "Send safely"}
        </button>
      </form>
      {blockedReason && <p className="mt-3 text-sm text-fg-muted">{blockedReason}</p>}
      <div className="mt-4 space-y-3" aria-live="polite">
        {send.isError && <ErrorPanel error={decodeError(send.error, combinedAbi)} />}
        {send.isSuccess && (
          <Notice tone="ok" title="Sent">
            Transaction <ExplorerLink kind="tx" value={send.data} />
          </Notice>
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
      <PageHeader
        title="Check an address"
        description="Paste any wallet address. The status comes straight from the Stakeout contract, so no wallet connection is needed to look it up."
      />
      <form className="rounded-lg border border-line bg-surface p-5 sm:p-6" onSubmit={onSubmit} noValidate>
        <label className="mb-1.5 block text-sm font-semibold text-fg" htmlFor="address">
          Recipient address
        </label>
        <div className="flex flex-col gap-3 sm:flex-row">
          <input
            id="address"
            placeholder="0x followed by 40 hex characters"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            autoComplete="off"
            spellCheck={false}
            aria-invalid={inputError !== null}
            aria-describedby={inputError ? "address-error" : undefined}
            className={`${inputClass} font-mono`}
          />
          <button type="submit" className={buttonClass("primary")}>
            <SearchIcon size={17} />
            Check status
          </button>
        </div>
        {inputError && (
          <p id="address-error" className="mt-2 text-sm text-danger-fg">
            {inputError}
          </p>
        )}
      </form>
      <div aria-live="polite" className="space-y-6">
        {account === undefined && !inputError && <Empty label="Enter an address to see its status." />}
        {account !== undefined && status.isPending && <Loading label="Calling getStatus on the contract…" />}
        {status.isError && <ErrorPanel error={decodeError(status.error, combinedAbi)} />}
        {account !== undefined && status.isSuccess && <StatusCard account={account} status={status.data} />}
      </div>
      {account !== undefined && status.isSuccess && <SendPanel key={account} to={account} />}
    </>
  );
}
