"use client";

import { formatEther, zeroAddress } from "viem";
import { FlagState } from "@shared/enums";
import { useAppConfig } from "@/components/AppConfigContext";
import { Empty, ErrorPanel, ExplorerLink, Loading, RefreshButton, Section } from "@/components/ui";
import { combinedAbi } from "@/lib/abi";
import { NATIVE_CURRENCY } from "@/lib/chain";
import { decodeError } from "@/lib/errors";
import type { FlagRow } from "@/lib/events";
import { useFlagStates, useRewardPool, useStakeoutIndex } from "@/lib/hooks";

function OpenChallenges({ flags }: { flags: FlagRow[] }) {
  const states = useFlagStates(flags);
  if (flags.length === 0) return <Empty label="No flags, so no challenges." />;
  if (states.isPending) return <Loading label="Reading flag states…" />;
  if (states.isError) return <ErrorPanel error={decodeError(states.error, combinedAbi)} />;
  const open = flags.flatMap((flag) => {
    const state = states.data.get(flag.flagId.toString());
    return state && state.state === FlagState.Active && state.challenger !== zeroAddress ? [{ flag, state }] : [];
  });
  if (open.length === 0) return <Empty label="No open challenges." />;
  return (
    <ul className="divide-y divide-slate-100">
      {open.map(({ flag, state }) => (
        <li key={flag.flagId.toString()} className="space-y-1 py-3">
          <p className="text-sm font-medium">Flag #{flag.flagId.toString()}</p>
          <p className="text-xs text-slate-600">
            Target <ExplorerLink kind="address" value={flag.target} />
          </p>
          <p className="text-xs text-slate-600">
            Flagger <ExplorerLink kind="address" value={state.flagger} /> staked {formatEther(state.stake)}{" "}
            {NATIVE_CURRENCY.symbol}
          </p>
          <p className="text-xs text-slate-600">
            Challenger <ExplorerLink kind="address" value={state.challenger} /> staked{" "}
            {formatEther(state.challengeStake)} {NATIVE_CURRENCY.symbol}
          </p>
          <p className="text-xs text-slate-600">
            Promoted in tx <ExplorerLink kind="tx" value={flag.ref.transactionHash} />
          </p>
        </li>
      ))}
    </ul>
  );
}

export default function ReviewerPage() {
  const config = useAppConfig();
  const index = useStakeoutIndex();
  const pool = useRewardPool();
  const refresh = (
    <RefreshButton
      onClick={() => {
        index.refetch();
        pool.refetch();
      }}
      busy={index.isFetching || pool.isFetching}
    />
  );
  return (
    <>
      <Section title="Reviewer overview" action={refresh}>
        <div className="rounded-md border border-sky-200 bg-sky-50 p-3 text-sm text-sky-900">
          This page is read-only. Every reviewer action (adding or removing reporters, resolving challenges, removing
          cluster members, rotating the verifier) is a transaction from the reviewer Safe{" "}
          <ExplorerLink kind="address" value={config.deployment.reviewer} />. Prepare calldata with{" "}
          <code className="font-mono text-xs">npm run safe:calldata</code> and submit it through the Safe.
        </div>
      </Section>
      <Section title="Reward pool">
        {pool.isPending && <Loading label="Reading rewardPool…" />}
        {pool.isError && <ErrorPanel error={decodeError(pool.error, combinedAbi)} />}
        {pool.isSuccess && (
          <p className="text-2xl font-semibold">
            {formatEther(pool.data)} {NATIVE_CURRENCY.symbol}
          </p>
        )}
      </Section>
      <Section title="Open challenges">
        {index.isPending && <Loading label="Reading contract events…" />}
        {index.isError && <ErrorPanel error={decodeError(index.error, combinedAbi)} />}
        {index.isSuccess && <OpenChallenges flags={index.data.flags} />}
      </Section>
      <Section title="Verified reporters">
        {index.isPending && <Loading label="Reading role events…" />}
        {index.isError && <ErrorPanel error={decodeError(index.error, combinedAbi)} />}
        {index.isSuccess && index.data.reporters.length === 0 && <Empty label="No verified reporters." />}
        {index.isSuccess && index.data.reporters.length > 0 && (
          <ul className="space-y-1">
            {index.data.reporters.map((reporter) => (
              <li key={reporter}>
                <ExplorerLink kind="address" value={reporter} />
              </li>
            ))}
          </ul>
        )}
      </Section>
    </>
  );
}
