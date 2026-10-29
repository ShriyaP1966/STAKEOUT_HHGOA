"use client";

import { formatEther } from "viem";
import { useAppConfig } from "@/components/AppConfigContext";
import { buttonClass, ErrorPanel, ExplorerLink, Section } from "@/components/ui";
import { combinedAbi, stakeoutAbi } from "@/lib/abi";
import {
  anyoneGate,
  challengeBlocker,
  expireBlocker,
  promoteBlocker,
  reporterGate,
  withdrawBlocker,
  type FlagFacts,
  type Gate,
} from "@/lib/action-rules";
import { NATIVE_CURRENCY } from "@/lib/chain";
import { decodeError } from "@/lib/errors";
import { useContractAction, useCredits, useIsReporter, useMinStake, useWalletState } from "@/lib/hooks";
import { useMounted, useNowSeconds } from "@/lib/now";
import { TransactionRevertedError } from "@/lib/tx";

type Action = ReturnType<typeof useContractAction>;

function TxFeedback({ action }: { action: Action }) {
  if (action.isPending) {
    return (
      <p role="status" className="text-sm text-fg-muted">
        {action.hash ? (
          <>
            Waiting for confirmation of <ExplorerLink kind="tx" value={action.hash} />
          </>
        ) : (
          "Waiting for your wallet to sign…"
        )}
      </p>
    );
  }
  if (action.isSuccess) {
    return (
      <p role="status" className="text-sm text-ok-fg">
        Confirmed in <ExplorerLink kind="tx" value={action.data} />
      </p>
    );
  }
  if (action.isError) {
    const failedHash = action.error instanceof TransactionRevertedError ? action.error.hash : action.hash;
    return (
      <div className="space-y-1">
        <ErrorPanel error={decodeError(action.error, combinedAbi)} />
        {failedHash && (
          <p className="text-sm text-danger-fg">
            Failed transaction <ExplorerLink kind="tx" value={failedHash} />
          </p>
        )}
      </div>
    );
  }
  return null;
}

function GatedButton({ gate, label, action, onClick }: { gate: Gate; label: string; action: Action; onClick: () => void }) {
  const mounted = useMounted();
  if (!mounted) return null;
  return (
    <div className="space-y-2">
      {gate.visible && (
        <button
          type="button"
          disabled={!gate.enabled || action.isPending}
          onClick={onClick}
          className={buttonClass("primary", "sm")}
        >
          {action.isPending ? `${label}…` : label}
        </button>
      )}
      {gate.reason && <p className="text-sm text-fg-muted">{gate.reason}</p>}
      <TxFeedback action={action} />
    </div>
  );
}

function StakeNote({ minStake }: { minStake: bigint | undefined }) {
  if (minStake === undefined) return <p className="text-sm text-fg-muted">Reading the minimum stake from the contract…</p>;
  return (
    <p className="text-sm text-fg-muted">
      Stake: {formatEther(minStake)} {NATIVE_CURRENCY.symbol} (minStake on the contract)
    </p>
  );
}

export function PromoteAction({ reportId, targetStatus }: { reportId: bigint; targetStatus: number | undefined }) {
  const config = useAppConfig();
  const { account, wallet } = useWalletState();
  const isReporter = useIsReporter(account);
  const minStake = useMinStake();
  const action = useContractAction();
  const blocker =
    targetStatus === undefined ? "Reading the target's current status." : minStake.data === undefined ? "Reading the minimum stake." : promoteBlocker(targetStatus);
  const gate = reporterGate(wallet, isReporter.data, blocker);
  return (
    <div className="space-y-2">
      {gate.visible && <StakeNote minStake={minStake.data} />}
      <GatedButton
        gate={gate}
        label="Promote with stake"
        action={action}
        onClick={() =>
          minStake.data !== undefined &&
          action.mutate({
            address: config.deployment.stakeoutAddress,
            abi: stakeoutAbi,
            functionName: "promote",
            args: [reportId],
            value: minStake.data,
          })
        }
      />
    </div>
  );
}

export function ChallengeAction({ flagId, flag }: { flagId: bigint; flag: FlagFacts }) {
  const config = useAppConfig();
  const { account, wallet } = useWalletState();
  const isReporter = useIsReporter(account);
  const minStake = useMinStake();
  const now = useNowSeconds();
  const action = useContractAction();
  const blocker =
    account === undefined || now === 0
      ? null
      : minStake.data === undefined
        ? "Reading the minimum stake."
        : challengeBlocker(flag, account, now);
  const gate = reporterGate(wallet, isReporter.data, blocker);
  return (
    <div className="space-y-2">
      {gate.visible && <StakeNote minStake={minStake.data} />}
      <GatedButton
        gate={gate}
        label="Challenge with stake"
        action={action}
        onClick={() =>
          minStake.data !== undefined &&
          action.mutate({
            address: config.deployment.stakeoutAddress,
            abi: stakeoutAbi,
            functionName: "challenge",
            args: [flagId],
            value: minStake.data,
          })
        }
      />
    </div>
  );
}

export function ExpireAction({ flagId, flag }: { flagId: bigint; flag: FlagFacts }) {
  const config = useAppConfig();
  const { wallet } = useWalletState();
  const now = useNowSeconds();
  const action = useContractAction();
  const gate = anyoneGate(wallet, now === 0 ? "Reading the current time." : expireBlocker(flag, now));
  return (
    <GatedButton
      gate={gate}
      label="Expire flag"
      action={action}
      onClick={() =>
        action.mutate({ address: config.deployment.stakeoutAddress, abi: stakeoutAbi, functionName: "expire", args: [flagId] })
      }
    />
  );
}

export function WithdrawPanel() {
  const config = useAppConfig();
  const mounted = useMounted();
  const { account, wallet } = useWalletState();
  const credits = useCredits(account);
  const action = useContractAction();
  const gate = anyoneGate(wallet, withdrawBlocker(credits.data));
  return (
    <Section title="Your withdrawable credit" description="Returned stakes and rewards wait here until you withdraw them to your wallet.">
      {mounted && account !== undefined && credits.isError && <ErrorPanel error={decodeError(credits.error, combinedAbi)} />}
      {mounted && account !== undefined && credits.isSuccess && (
        <p className="mb-4 font-mono text-3xl font-semibold tabular-nums">
          {formatEther(credits.data)} {NATIVE_CURRENCY.symbol}
        </p>
      )}
      <GatedButton
        gate={gate}
        label="Withdraw"
        action={action}
        onClick={() =>
          action.mutate({ address: config.deployment.stakeoutAddress, abi: stakeoutAbi, functionName: "withdraw", args: [] })
        }
      />
    </Section>
  );
}

