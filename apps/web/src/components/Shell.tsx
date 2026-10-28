"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { useAccount, useConnect, useDisconnect, useSwitchChain } from "wagmi";
import { combinedAbi } from "@/lib/abi";
import { decodeError, type DecodedError } from "@/lib/errors";
import { useMounted } from "@/lib/now";
import { useAppConfig } from "./AppConfigContext";
import { ErrorPanel } from "./ui";

const NAV = [
  { href: "/wallet", label: "Wallet" },
  { href: "/report", label: "Report" },
  { href: "/verify", label: "Verify" },
  { href: "/dashboard", label: "Dashboard" },
  { href: "/decisions", label: "Decisions" },
  { href: "/reviewer", label: "Reviewer" },
];

function walletError(error: Error): DecodedError {
  if (error.name === "ProviderNotFoundError") {
    return { title: "No browser wallet found", detail: "Install or enable a browser wallet extension, then reload." };
  }
  return decodeError(error, combinedAbi);
}

function WalletButton() {
  const mounted = useMounted();
  const { address, isConnected } = useAccount();
  const { connectors, connect, isPending, error } = useConnect();
  const { disconnect } = useDisconnect();
  if (!mounted) return <div className="h-9 w-32" />;
  if (isConnected && address) {
    return (
      <div className="flex items-center gap-2">
        <span className="max-w-[9rem] truncate font-mono text-xs text-slate-600" title={address}>
          {address}
        </span>
        <button
          type="button"
          onClick={() => disconnect()}
          className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
        >
          Disconnect
        </button>
      </div>
    );
  }
  return (
    <div className="flex flex-col items-end gap-2">
      {connectors.map((connector) => (
        <button
          key={connector.uid}
          type="button"
          disabled={isPending}
          onClick={() => connect({ connector })}
          className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          {isPending ? "Connecting…" : "Connect wallet"}
        </button>
      ))}
      {error && <ErrorPanel error={walletError(error)} />}
    </div>
  );
}

function NetworkPrompt() {
  const mounted = useMounted();
  const config = useAppConfig();
  const { isConnected, chainId } = useAccount();
  const { switchChain, isPending, error } = useSwitchChain();
  const expected = config.deployment.chainId;
  if (!mounted) return null;
  if (!isConnected) {
    return (
      <div className="border-b border-sky-200 bg-sky-50 px-4 py-2 text-sm text-sky-900">
        <p className="mx-auto max-w-5xl">
          No wallet connected. You can look up any address without one; connect a wallet to send through
          StakeoutGuard.
        </p>
      </div>
    );
  }
  if (chainId === expected) return null;
  return (
    <div className="border-b border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-900">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-3">
        <span>
          Wrong network: your wallet is on chain {chainId}, this app uses chain {expected}.
        </span>
        <button
          type="button"
          disabled={isPending}
          onClick={() => switchChain({ chainId: expected })}
          className="rounded-md bg-amber-600 px-3 py-1 text-white hover:bg-amber-700 disabled:opacity-50"
        >
          {isPending ? "Switching…" : `Switch to chain ${expected}`}
        </button>
        {error && <ErrorPanel error={walletError(error)} />}
      </div>
    </div>
  );
}

export function Shell({ children }: { children: ReactNode }) {
  const config = useAppConfig();
  const pathname = usePathname();
  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <Link href="/wallet" className="text-lg font-bold text-slate-900">
              Stakeout
            </Link>
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-700">
              Data: {config.dataSource}
            </span>
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-700">
              Chain {config.deployment.chainId}
            </span>
          </div>
          <WalletButton />
        </div>
        <nav className="mx-auto flex max-w-5xl gap-1 overflow-x-auto px-4 pb-2" aria-label="Main">
          {NAV.map((item) => {
            const active = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={`rounded-md px-3 py-1.5 text-sm ${active ? "bg-indigo-50 font-semibold text-indigo-700" : "text-slate-600 hover:bg-slate-100"}`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
      </header>
      <NetworkPrompt />
      <main className="mx-auto max-w-5xl space-y-4 px-4 py-6">{children}</main>
      <footer className="mx-auto max-w-5xl px-4 pb-6 text-xs text-slate-500">
        Data source: {config.dataSource}. Contracts from {config.deploymentFile}, deployed {config.deployment.deployedAt}.
      </footer>
    </div>
  );
}
