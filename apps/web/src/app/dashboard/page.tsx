"use client";

import { formatEther, zeroAddress, type Address } from "viem";
import { FlagState, Role } from "@shared/enums";
import { ChallengeAction, ExpireAction, PromoteAction, WithdrawPanel } from "@/components/actions";
import { Countdown, Empty, ErrorPanel, ExplorerLink, Loading, Mono, PageHeader, RefreshButton, Section, Tag } from "@/components/ui";
import { combinedAbi } from "@/lib/abi";
import { isLive } from "@/lib/action-rules";
import { NATIVE_CURRENCY } from "@/lib/chain";
import type { StatusResult } from "@/lib/contract";
import { decodeError } from "@/lib/errors";
import type { ClusterRow, FlagRow, ReportRow, RewardRow } from "@/lib/events";
import { useFlagStates, useRewardPool, useStakeoutIndex, useStatuses } from "@/lib/hooks";
import { useNowSeconds } from "@/lib/now";

function Reports({ reports, statuses }: { reports: ReportRow[]; statuses: Map<Address, StatusResult> | undefined }) {
  if (reports.length === 0) return <Empty label="No reports yet." />;
  return (
    <ul className="divide-y divide-line">
      {[...reports].reverse().map((report) => (
        <li key={report.reportId.toString()} className="space-y-1.5 py-4 first:pt-0 last:pb-0">
          <p className="font-semibold text-fg">Report #{report.reportId.toString()}</p>
          <p className="text-sm text-fg-muted">
            Target <ExplorerLink kind="address" value={report.target} />
          </p>
          <p className="text-sm text-fg-muted">
            Reporter <ExplorerLink kind="address" value={report.reporter} />
          </p>
          <p className="text-sm text-fg-muted">
            Evidence hash <Mono>{report.evidenceHash}</Mono>
          </p>
          <p className="text-sm text-fg-muted">
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
    <ul className="divide-y divide-line">
      {[...flags].reverse().map((flag) => {
        const state = states.data.get(flag.flagId.toString());
        if (!state) return null;
        const live = now !== 0 && isLive(state, now);
        const challenged = state.state === FlagState.Active && state.challenger !== zeroAddress;
        return (
          <li key={flag.flagId.toString()} className="space-y-1.5 py-4 first:pt-0 last:pb-0">
            <p className="flex flex-wrap items-center gap-2 font-semibold text-fg">
              Flag #{flag.flagId.toString()}
              <Tag>{FlagState[state.state]}</Tag>
              {live && <Tag tone="warn">Live</Tag>}
              {challenged && <Tag tone="info">Challenged</Tag>}
            </p>
            <p className="text-sm text-fg-muted">
              Target <ExplorerLink kind="address" value={flag.target} />
            </p>
            <p className="text-sm text-fg-muted">
              Flagger <ExplorerLink kind="address" value={flag.flagger} /> staked {formatEther(state.stake)}{" "}
              {NATIVE_CURRENCY.symbol} on report #{flag.reportId.toString()}
            </p>
            {state.state === FlagState.Active && !challenged && (
              <p className="text-sm text-fg-muted">
                Lapses in <Countdown expiresAt={state.expiresAt} />
              </p>
            )}
            <p className="text-sm text-fg-muted">
              Promoted in block {flag.ref.blockNumber.toString()}, tx{" "}
              <ExplorerLink kind="tx" value={flag.ref.transactionHash} />
            </p>
            <div className="flex flex-col gap-4 pt-2 sm:flex-row">
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
        <li key={cluster.clusterId} className="rounded-md border border-line bg-surface-2 p-4">
          <p className="flex flex-wrap items-center gap-2 font-semibold text-fg">
            <Tag tone="danger">Confirmed</Tag>
            Cluster <Mono>{cluster.clusterId}</Mono>
          </p>
          <p className="text-sm text-fg-muted">
            First confirmed in block {cluster.ref.blockNumber.toString()}, tx{" "}
            <ExplorerLink kind="tx" value={cluster.ref.transactionHash} />
          </p>
          <ul className="mt-3 divide-y divide-line">
            {cluster.entries.map((entry) => (
              <li key={`${entry.address}-${entry.ref.transactionHash}-${entry.ref.logIndex}`} className="space-y-1 py-3">
                <p className="flex flex-wrap items-center gap-2 text-sm">
                  <Tag>{Role[entry.role]}</Tag>
                  {entry.removed && <Tag tone="info">Removed</Tag>}
                  <ExplorerLink kind="address" value={entry.address} />
                </p>
                <p className="text-sm text-fg-muted">
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
    <ul className="divide-y divide-line">
      {[...rewards].reverse().map((reward) => (
        <li key={`${reward.ref.transactionHash}-${reward.ref.logIndex}`} className="space-y-1.5 py-4 first:pt-0 last:pb-0">
          <p className="font-semibold text-fg">
            Reward paid: {formatEther(reward.amount)} {NATIVE_CURRENCY.symbol}
          </p>
          <p className="text-sm text-fg-muted">
            Recipient <ExplorerLink kind="address" value={reward.recipient} />
          </p>
          <p className="text-sm text-fg-muted">
            Block {reward.ref.blockNumber.toString()}, tx <ExplorerLink kind="tx" value={reward.ref.transactionHash} />
          </p>
        </li>
      ))}
    </ul>
  );
}

function Tile({ label, value, emphasis }: { label: string; value: string; emphasis?: boolean }) {
  return (
    <div className={`space-y-1 p-5 ${emphasis ? "bg-header text-header-fg" : "bg-surface text-fg"}`}>
      <p className={`text-sm ${emphasis ? "text-header-muted" : "text-fg-muted"}`}>{label}</p>
      <p className={`font-mono text-3xl font-semibold tabular-nums ${emphasis ? "text-accent" : ""}`}>{value}</p>
    </div>
  );
}

function Summary({ reports, flags, clusters }: { reports: number; flags: number; clusters: number }) {
  const pool = useRewardPool();
  const poolValue = pool.isSuccess ? `${formatEther(pool.data)} ${NATIVE_CURRENCY.symbol}` : pool.isError ? "Unavailable" : "…";
  return (
    <div className="grid gap-px overflow-hidden rounded-lg border border-line bg-line sm:grid-cols-2 lg:grid-cols-4">
      <Tile label="Reports" value={reports.toString()} />
      <Tile label="Flags" value={flags.toString()} />
      <Tile label="Confirmed clusters" value={clusters.toString()} />
      <Tile label="Reward pool" value={poolValue} emphasis />
    </div>
  );
}

export default function DashboardPage() {
  const index = useStakeoutIndex();
  const statuses = useStatuses(index.data?.reports.map((report) => report.target) ?? []);
  const refresh = <RefreshButton onClick={() => index.refetch()} busy={index.isFetching} />;
  const header = (
    <PageHeader
      title="Dashboard"
      description="Everything on this page is read from Stakeout contract events, starting at the deployment block."
      action={index.isPending ? undefined : refresh}
    />
  );
  if (index.isPending) {
    return (
      <>
        {header}
        <Section title="Loading">
          <Loading label="Reading contract events…" />
        </Section>
      </>
    );
  }
  if (index.isError) {
    return (
      <>
        {header}
        <ErrorPanel error={decodeError(index.error, combinedAbi)} />
      </>
    );
  }
  return (
    <>
      {header}
      <Summary reports={index.data.reports.length} flags={index.data.flags.length} clusters={index.data.clusters.length} />
      <WithdrawPanel />
      <Section title={`Reports (${index.data.reports.length})`} description="Free reports. A verified reporter can promote one into a flag with a stake.">
        {statuses.isError && <ErrorPanel error={decodeError(statuses.error, combinedAbi)} />}
        <Reports reports={index.data.reports} statuses={statuses.data} />
      </Section>
      <Section title={`Flags (${index.data.flags.length})`} description="Staked flags. A flag lapses and returns its stake unless it is confirmed or challenged first.">
        <Flags flags={index.data.flags} />
      </Section>
      <Section title={`Clusters (${index.data.clusters.length})`} description="Confirmed scam clusters with their members, exit points and linked wallets.">
        <Clusters clusters={index.data.clusters} />
      </Section>
      <Section title={`Reward payouts (${index.data.rewards.length})`} description="Rewards paid from slashed stakes by the reviewer multisig.">
        <Activity rewards={index.data.rewards} />
      </Section>
    </>
  );
}
