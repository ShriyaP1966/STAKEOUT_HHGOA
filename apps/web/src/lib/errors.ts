import {
  BaseError,
  ChainMismatchError,
  ContractFunctionRevertedError,
  HttpRequestError,
  TimeoutError,
  UserRejectedRequestError,
  decodeErrorResult,
  type Abi,
  type Hex,
} from "viem";
import { statusName } from "./warning";

export type DecodedError = {
  title: string;
  detail: string;
};

const DESCRIPTIONS: Record<string, string> = {
  Blocked: "StakeoutGuard refused to forward the funds because of the recipient's status.",
  ForwardFailed: "The recipient rejected the transfer.",
  ZeroAddress: "The zero address is not allowed.",
  ZeroHash: "The evidence hash must not be zero.",
  StakeTooLow: "The stake is below the minimum.",
  ReportNotFound: "No report exists with that id.",
  FlagNotFound: "No flag exists with that id.",
  TargetHasLiveFlag: "The target already has a live flag.",
  AlreadyInCluster: "The address is already in a cluster.",
  NotInCluster: "The address is not in a cluster.",
  FlagNotLive: "The flag is not live.",
  NoCredit: "There is nothing to withdraw.",
  AccessControlUnauthorizedAccount: "The account does not hold the required role.",
  ReentrancyGuardReentrantCall: "Re-entrant call rejected.",
};

function formatArg(value: unknown): string {
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return `[${value.map(formatArg).join(", ")}]`;
  return String(value);
}

function formatDecodedError(errorName: string, args: readonly unknown[] | undefined): DecodedError {
  const list = args ?? [];
  if (errorName === "Blocked" && list.length === 2) {
    const status = statusName(Number(list[1]));
    return {
      title: `Blocked: recipient is ${status}`,
      detail: `${DESCRIPTIONS.Blocked} Recipient ${formatArg(list[0])} has status ${status}.`,
    };
  }
  const signature = `${errorName}(${list.map(formatArg).join(", ")})`;
  return { title: errorName, detail: DESCRIPTIONS[errorName] ? `${DESCRIPTIONS[errorName]} ${signature}` : signature };
}

function decodeRaw(abi: Abi, data: Hex | undefined): DecodedError | undefined {
  if (!data || data === "0x") return undefined;
  try {
    const decoded = decodeErrorResult({ abi, data });
    return formatDecodedError(decoded.errorName, decoded.args);
  } catch {
    return undefined;
  }
}

export function decodeError(error: unknown, abi: Abi): DecodedError {
  if (error instanceof BaseError) {
    const reverted = error.walk((cause) => cause instanceof ContractFunctionRevertedError);
    if (reverted instanceof ContractFunctionRevertedError) {
      if (reverted.data?.errorName) return formatDecodedError(reverted.data.errorName, reverted.data.args);
      const fromRaw = decodeRaw(abi, reverted.raw);
      if (fromRaw) return fromRaw;
      if (reverted.reason) return { title: "Transaction reverted", detail: reverted.reason };
      return { title: "Transaction reverted", detail: "The contract reverted with an error this app does not recognise." };
    }
    if (error.walk((cause) => cause instanceof UserRejectedRequestError)) {
      return { title: "Request rejected", detail: "You rejected the request in your wallet." };
    }
    if (error.walk((cause) => cause instanceof ChainMismatchError)) {
      return { title: "Wrong network", detail: "Your wallet is connected to a different network than this app." };
    }
    if (error.walk((cause) => cause instanceof HttpRequestError || cause instanceof TimeoutError)) {
      return {
        title: "RPC unavailable",
        detail: "The configured RPC endpoint (NEXT_PUBLIC_RPC_URL) did not respond. Check that it is running and reachable.",
      };
    }
    return { title: "Request failed", detail: error.shortMessage };
  }
  const provider = providerError(error);
  if (provider) return provider;
  if (error instanceof Error) return { title: "Error", detail: error.message };
  const message = typeof error === "object" && error !== null ? (error as { message?: unknown }).message : undefined;
  if (typeof message === "string" && message.trim() !== "") return { title: "Wallet error", detail: message };
  return { title: "Error", detail: "An unknown error occurred." };
}

function providerError(error: unknown): DecodedError | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const code = (error as { code?: unknown }).code;
  if (code === 4001) return { title: "Request rejected", detail: "You rejected the request in your wallet." };
  if (code === -32002) {
    return {
      title: "Wallet request already open",
      detail: "Your wallet is already showing a request from this site. Open the wallet, finish or cancel that request, then try again.",
    };
  }
  return undefined;
}
