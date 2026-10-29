"use client";

import { formatEther, zeroAddress } from "viem";
import { FlagState } from "@shared/enums";
import { useAppConfig } from "@/components/AppConfigContext";
import { Empty, ErrorPanel, ExplorerLink, Loading, Notice, PageHeader, RefreshButton, Section } from "@/components/ui";
import { combinedAbi } from "@/lib/abi";
import { NATIVE_CURRENCY } from "@/lib/chain";
import { decodeError } from "@/lib/errors";
import type { FlagRow } from "@/lib/events";
import { useFlagStates, useRewardPool, useStakeoutIndex } from "@/lib/hooks";

const SAFE_ACTIONS = [
  { label: "Whitelist a verified reporter", args: "addVerifiedReporter <account>" },
  { label: "Resolve a challenge", args: "resolve <flagId> <true|false>" },
  { label: "Remove a cluster member", args: "removeMember <target>" },
  { label: "Pay a reward from the reward pool", args: "payReward <recipient> <amountWei>" },
  { label: "Grant the verifier role", args: "grantVerifier <account>" },
  { label: "Revoke the verifier role", args: "revokeVerifier <account>" },
];

function Command({ text }: { text: string }) {
  return <code className="block rounded-md border border-line bg-sunken px-3 py-2 font-mono text-[13px] break-all text-fg">{text}</code>;
}

function SafeCommands() {
  const config = useAppConfig();
  return (
    <ul className="space-y-4">
      {SAFE_ACTIONS.map((action) => (
        <li key={action.args} className="space-y-1.5">
          <p className="text-sm font-semibold text-fg">{action.label}</p>
          <Command text={`npm run safe:calldata -- ${config.deploymentName} ${action.args}`} />
        </li>
      ))}
    </ul>
  );
}

function OpenChallenges({ flags }: { flags: FlagRow[] }) {
  const config = useAppConfig();
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
    <ul className="divide-y divide-line">
      {open.map(({ flag, state }) => (
        <li key={flag.flagId.toString()} className="space-y-1.5 py-4 first:pt-0 last:pb-0">
          <p className="font-semibold text-fg">Flag #{flag.flagId.toString()}</p>
          <p className="text-sm text-fg-muted">
            Target <ExplorerLink kind="address" value={flag.target} />
          </p>
          <p className="text-sm text-fg-muted">
            Flagger <ExplorerLink kind="address" value={state.flagger} /> staked {formatEther(state.stake)}{" "}
            {NATIVE_CURRENCY.symbol}
          </p>
          <p className="text-sm text-fg-muted">
            Challenger <ExplorerLink kind="address" value={state.challenger} /> staked{" "}
            {formatEther(state.challengeStake)} {NATIVE_CURRENCY.symbol}
          </p>
          <p className="text-sm text-fg-muted">
            Promoted in tx <ExplorerLink kind="tx" value={flag.ref.transactionHash} />
          </p>
          <p className="text-sm text-fg-muted">Safe calldata to resolve it (true upholds the flag, false overturns it):</p>
          <Command text={`npm run safe:calldata -- ${config.deploymentName} resolve ${flag.flagId.toString()} <true|false>`} />
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
      <PageHeader
        title="Reviewer"
        description="A read-only view for the reviewer multisig: open challenges, verified reporters and the reward pool."
        action={refresh}
      />
      <Notice tone="info" title="This page never sends transactions">
        Every reviewer action (adding or removing reporters, resolving challenges, removing cluster members, rotating the
        verifier) is a transaction from the reviewer Safe <ExplorerLink kind="address" value={config.deployment.reviewer} />.
        Prepare calldata with <code className="font-mono text-[13px]">npm run safe:calldata</code> and submit it through the Safe.
      </Notice>
      <div className="grid gap-6 lg:grid-cols-[1fr_1.4fr]">
        <Section title="Reward pool" description="Slashed stakes that the Safe can pay out as rewards.">
          {pool.isPending && <Loading label="Reading rewardPool…" />}
          {pool.isError && <ErrorPanel error={decodeError(pool.error, combinedAbi)} />}
          {pool.isSuccess && (
            <p className="font-mono text-3xl font-semibold tabular-nums">
              {formatEther(pool.data)} {NATIVE_CURRENCY.symbol}
            </p>
          )}
        </Section>
        <Section
          title="Reviewer actions through the Safe"
          description="Run a command from the repository root. It prints the target address, value and calldata to paste into the Safe transaction builder. It never sends anything."
        >
          <SafeCommands />
        </Section>
      </div>
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
