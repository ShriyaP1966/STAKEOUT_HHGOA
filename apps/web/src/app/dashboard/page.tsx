"use client";

import { formatEther, zeroAddress, type Address } from "viem";
import { FlagState, Role } from "@shared/enums";
import { ChallengeAction, ExpireAction, PromoteAction, WithdrawPanel } from "@/components/actions";
import { Countdown, Empty, ErrorPanel, ExplorerLink, Loading, Mono, RefreshButton, Section } from "@/components/ui";
import { combinedAbi } from "@/lib/abi";
import { isLive } from "@/lib/action-rules";
import { NATIVE_CURRENCY } from "@/lib/chain";
import type { StatusResult } from "@/lib/contract";
import { decodeError } from "@/lib/errors";
import type { ClusterRow, FlagRow, ReportRow, RewardRow } from "@/lib/events";
import { useFlagStates, useStakeoutIndex, useStatuses } from "@/lib/hooks";
import { useNowSeconds } from "@/lib/now";

function Reports({ reports, statuses }: { reports: ReportRow[]; statuses: Map<Address, StatusResult> | undefined }) {
  if (reports.length === 0) return <Empty label="No reports yet." />;
  return (
    <ul className="divide-y divide-slate-100">
      {[...reports].reverse().map((report) => (
        <li key={report.reportId.toString()} className="space-y-1 py-3">
          <p className="text-sm font-medium">Report #{report.reportId.toString()}</p>
          <p className="text-xs text-slate-600">
            Target <ExplorerLink kind="address" value={report.target} />
          </p>
          <p className="text-xs text-slate-600">
            Reporter <ExplorerLink kind="address" value={report.reporter} />
          </p>
          <p className="text-xs text-slate-600">
            Evidence hash <Mono>{report.evidenceHash}</Mono>
          </p>
          <p className="text-xs text-slate-600">
            Block {report.ref.blockNumber.toString()}, tx <ExplorerLink kind="tx" value={report.ref.transactionHash} />
          </p>
          <PromoteAction reportId={report.reportId} targetStatus={statuses?.get(report.target)?.status} />
        </li>
      ))}
    </ul>
  );
}

function Flags({ flags }: { flags: FlagRow[] }) {
  const states = useFlagStates(flags);
  const now = useNowSeconds();
  if (flags.length === 0) return <Empty label="No flags yet." />;
  if (states.isPending) return <Loading label="Reading flag states…" />;
  if (states.isError) return <ErrorPanel error={decodeError(states.error, combinedAbi)} />;
  return (
    <ul className="divide-y divide-slate-100">
      {[...flags].reverse().map((flag) => {
        const state = states.data.get(flag.flagId.toString());
        if (!state) return null;
        const live = now !== 0 && isLive(state, now);
        const challenged = state.state === FlagState.Active && state.challenger !== zeroAddress;
        return (
          <li key={flag.flagId.toString()} className="space-y-1 py-3">
            <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
              Flag #{flag.flagId.toString()}
              <span className="rounded bg-slate-100 px-2 py-0.5 text-xs">{FlagState[state.state]}</span>
              {live && <span className="rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-900">Live</span>}
              {challenged && <span className="rounded bg-violet-100 px-2 py-0.5 text-xs text-violet-900">Challenged</span>}
            </p>
            <p className="text-xs text-slate-600">
              Target <ExplorerLink kind="address" value={flag.target} />
            </p>
            <p className="text-xs text-slate-600">
              Flagger <ExplorerLink kind="address" value={flag.flagger} /> staked {formatEther(state.stake)}{" "}
              {NATIVE_CURRENCY.symbol} on report #{flag.reportId.toString()}
            </p>
            {state.state === FlagState.Active && !challenged && (
              <p className="text-xs text-slate-600">
                Lapses in <Countdown expiresAt={state.expiresAt} />
              </p>
            )}
            <p className="text-xs text-slate-600">
              Promoted in block {flag.ref.blockNumber.toString()}, tx{" "}
              <ExplorerLink kind="tx" value={flag.ref.transactionHash} />
            </p>
            <div className="flex flex-col gap-3 pt-1 sm:flex-row">
              <ChallengeAction flagId={flag.flagId} flag={state} />
              <ExpireAction flagId={flag.flagId} flag={state} />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function Clusters({ clusters }: { clusters: ClusterRow[] }) {
  if (clusters.length === 0) return <Empty label="No confirmed clusters yet." />;
  return (
    <ul className="space-y-4">
      {clusters.map((cluster) => (
        <li key={cluster.clusterId} className="rounded-md border border-slate-200 p-3">
          <p className="text-sm font-medium">
            Cluster <Mono>{cluster.clusterId}</Mono>
          </p>
          <p className="text-xs text-slate-600">
            First confirmed in block {cluster.ref.blockNumber.toString()}, tx{" "}
            <ExplorerLink kind="tx" value={cluster.ref.transactionHash} />
          </p>
          <ul className="mt-2 divide-y divide-slate-100">
            {cluster.entries.map((entry) => (
              <li key={`${entry.address}-${entry.ref.transactionHash}-${entry.ref.logIndex}`} className="space-y-1 py-2">
                <p className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="rounded bg-slate-100 px-2 py-0.5">{Role[entry.role]}</span>
                  {entry.removed && <span className="rounded bg-slate-200 px-2 py-0.5">Removed</span>}
                  <ExplorerLink kind="address" value={entry.address} />
                </p>
                <p className="text-xs text-slate-600">
                  Evidence hash <Mono>{entry.evidenceHash}</Mono>, tx{" "}
                  <ExplorerLink kind="tx" value={entry.ref.transactionHash} />
                </p>
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ul>
  );
}

function Activity({ rewards }: { rewards: RewardRow[] }) {
  if (rewards.length === 0) return <Empty label="No reward payouts yet." />;
  return (
    <ul className="divide-y divide-slate-100">
      {[...rewards].reverse().map((reward) => (
        <li key={`${reward.ref.transactionHash}-${reward.ref.logIndex}`} className="space-y-1 py-3">
          <p className="text-sm font-medium">
            Reward paid: {formatEther(reward.amount)} {NATIVE_CURRENCY.symbol}
          </p>
          <p className="text-xs text-slate-600">
            Recipient <ExplorerLink kind="address" value={reward.recipient} />
          </p>
          <p className="text-xs text-slate-600">
            Block {reward.ref.blockNumber.toString()}, tx <ExplorerLink kind="tx" value={reward.ref.transactionHash} />
          </p>
        </li>
      ))}
    </ul>
  );
}

export default function DashboardPage() {
  const index = useStakeoutIndex();
  const statuses = useStatuses(index.data?.reports.map((report) => report.target) ?? []);
  const refresh = <RefreshButton onClick={() => index.refetch()} busy={index.isFetching} />;
  if (index.isPending) {
    return (
      <Section title="Dashboard">
        <Loading label="Reading contract events…" />
      </Section>
    );
  }
  if (index.isError) {
    return (
      <Section title="Dashboard" action={refresh}>
        <ErrorPanel error={decodeError(index.error, combinedAbi)} />
      </Section>
    );
  }
  return (
    <>
      <WithdrawPanel />
      <Section title={`Reports (${index.data.reports.length})`} action={refresh}>
        {statuses.isError && <ErrorPanel error={decodeError(statuses.error, combinedAbi)} />}
        <Reports reports={index.data.reports} statuses={statuses.data} />
      </Section>
      <Section title={`Flags (${index.data.flags.length})`}>
        <Flags flags={index.data.flags} />
      </Section>
      <Section title={`Clusters (${index.data.clusters.length})`}>
        <Clusters clusters={index.data.clusters} />
      </Section>
      <Section title={`Activity: reward payouts (${index.data.rewards.length})`}>
        <Activity rewards={index.data.rewards} />
      </Section>
    </>
  );
}
