import { zeroAddress, type Address } from "viem";
import { FlagState, Status } from "@shared/enums";

export type Gate = { visible: boolean; enabled: boolean; reason: string | null };
export type WalletState = { connected: boolean; onExpectedChain: boolean };

const hidden = (reason: string): Gate => ({ visible: false, enabled: false, reason });
const disabled = (reason: string): Gate => ({ visible: true, enabled: false, reason });
const ready: Gate = { visible: true, enabled: true, reason: null };

function walletGate(wallet: WalletState): Gate | null {
  if (!wallet.connected) return hidden("Connect a wallet to use this action.");
  if (!wallet.onExpectedChain) return hidden("Switch your wallet to this app's network to use this action.");
  return null;
}

export function reporterGate(wallet: WalletState, isReporter: boolean | undefined, blocker: string | null): Gate {
  const walletProblem = walletGate(wallet);
  if (walletProblem) return walletProblem;
  if (isReporter === undefined) return hidden("Checking whether your account is a verified reporter.");
  if (!isReporter) return hidden("Only verified reporters can do this. Ask the reviewer Safe to whitelist you.");
  return blocker ? disabled(blocker) : ready;
}

export function anyoneGate(wallet: WalletState, blocker: string | null): Gate {
  const walletProblem = walletGate(wallet);
  if (walletProblem) return walletProblem;
  return blocker ? disabled(blocker) : ready;
}

export function promoteBlocker(status: number): string | null {
  if (status === Status.Reported) return null;
  if (status === Status.Flagged) return "This address already has a live flag.";
  if (status === Status.Confirmed || status === Status.Linked) return "This address is already in a cluster.";
  return "There is no report to promote for this address.";
}

export type FlagFacts = { state: number; challenger: Address; flagger: Address; expiresAt: bigint };

export function isLive(flag: FlagFacts, nowSeconds: number): boolean {
  return flag.state === FlagState.Active && (flag.challenger !== zeroAddress || BigInt(nowSeconds) < flag.expiresAt);
}

export function challengeBlocker(flag: FlagFacts, account: Address, nowSeconds: number): string | null {
  if (!isLive(flag, nowSeconds)) return "This flag is no longer live.";
  if (flag.challenger !== zeroAddress) return "This flag is already challenged.";
  if (flag.flagger === account) return "You raised this flag, so you cannot challenge it.";
  return null;
}

export function expireBlocker(flag: FlagFacts, nowSeconds: number): string | null {
  if (flag.state !== FlagState.Active) return "Only active flags can expire.";
  if (flag.challenger !== zeroAddress) return "An open challenge pauses expiry until the reviewers resolve it.";
  if (BigInt(nowSeconds) < flag.expiresAt) return "Expire becomes available when the countdown ends.";
  return null;
}

export function withdrawBlocker(credits: bigint | undefined): string | null {
  if (credits === undefined) return "Reading your credits from the contract.";
  if (credits === 0n) return "You have nothing to withdraw.";
  return null;
}
