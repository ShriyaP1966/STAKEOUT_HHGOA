"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";
import { useAccount, useConnect, useDisconnect, useSwitchChain } from "wagmi";
import { combinedAbi } from "@/lib/abi";
import { decodeError, type DecodedError } from "@/lib/errors";
import { useMounted } from "@/lib/now";
import { useAppConfig } from "./AppConfigContext";
import { CrossIcon, MenuIcon, TrailLensMark, WalletIcon } from "./icons";
import { ThemeSwitch } from "./ThemeSwitch";
import { buttonClass, ErrorPanel } from "./ui";

const NAV = [
  { href: "/wallet", label: "Check address" },
  { href: "/report", label: "Report" },
  { href: "/verify", label: "Verify" },
  { href: "/dashboard", label: "Dashboard" },
  { href: "/decisions", label: "Decisions" },
  { href: "/reviewer", label: "Reviewer" },
];

const FOOTER_LINKS = [
  { href: "/faq", label: "FAQ" },
  { href: "/support", label: "Help and contact" },
  { href: "/privacy", label: "Privacy" },
  { href: "/terms", label: "Terms" },
];

function walletError(error: Error): DecodedError {
  if (error.name === "ProviderNotFoundError") {
    return { title: "No browser wallet found", detail: "Install or enable a browser wallet extension, then reload." };
  }
  return decodeError(error, combinedAbi);
}

function shortAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export function Logo({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2.5 text-xl font-bold tracking-tight ${className}`}>
      <TrailLensMark size={28} hole="var(--header)" />
      stakeout
    </span>
  );
}

function WalletButton() {
  const mounted = useMounted();
  const { address, isConnected } = useAccount();
  const { connectors, connect, isPending, error } = useConnect();
  const { disconnect } = useDisconnect();
  if (!mounted) return <div className="h-11 w-36" />;
  if (isConnected && address) {
    return (
      <div className="flex items-center gap-2">
        <span
          className="inline-flex min-h-11 items-center gap-2 rounded-md border border-header-line px-3 font-mono text-[13px] text-header-fg"
          title={address}
        >
          <span className="h-2 w-2 rounded-full bg-[#3dd68c]" aria-hidden="true" />
          <span className="sr-only">Connected wallet </span>
          {shortAddress(address)}
        </span>
        <button
          type="button"
          onClick={() => disconnect()}
          className="inline-flex min-h-11 items-center rounded-md px-3 text-sm text-header-muted transition-colors duration-150 hover:bg-header-active hover:text-header-fg"
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
          className={buttonClass("accent")}
        >
          <WalletIcon size={17} />
          {isPending ? "Connecting…" : "Connect wallet"}
        </button>
      ))}
      {error && (
        <div className="max-w-xs">
          <ErrorPanel error={walletError(error)} />
        </div>
      )}
    </div>
  );
}

function NetworkPrompt() {
  const mounted = useMounted();
  const config = useAppConfig();
  const { isConnected, chainId } = useAccount();
  const { switchChain, isPending, error } = useSwitchChain();
  const expected = config.deployment.chainId;
  if (!mounted || !isConnected || chainId === expected) return null;
  return (
    <div role="alert" className="border-b border-warn-line bg-warn-bg text-warn-fg">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3 px-4 py-3 text-sm sm:px-6">
        <span>
          Wrong network: your wallet is on chain {chainId}, and this app uses chain {expected}.
        </span>
        <button
          type="button"
          disabled={isPending}
          onClick={() => switchChain({ chainId: expected })}
          className={buttonClass("primary", "sm")}
        >
          {isPending ? "Switching…" : `Switch to chain ${expected}`}
        </button>
        {error && <ErrorPanel error={walletError(error)} />}
      </div>
    </div>
  );
}

function NavLinks({ pathname, vertical }: { pathname: string; vertical: boolean }) {
  return (
    <ul className={vertical ? "flex flex-col gap-1" : "flex items-center gap-1"}>
      {NAV.map((item) => {
        const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <li key={item.href}>
            <Link
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={`flex min-h-11 items-center rounded-md px-3 text-[15px] transition-colors duration-150 ${
                active ? "bg-header-active font-semibold text-accent" : "text-header-muted hover:text-header-fg"
              }`}
            >
              {item.label}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

export function Shell({ children }: { children: ReactNode }) {
  const config = useAppConfig();
  const pathname = usePathname();
  const [menuPath, setMenuPath] = useState<string | null>(null);
  const menuOpen = menuPath === pathname;
  return (
    <div className="flex min-h-screen flex-col bg-bg">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:rounded-md focus:bg-accent focus:px-4 focus:py-3 focus:font-semibold focus:text-accent-fg"
      >
        Skip to content
      </a>
      <header className="border-b border-header-line bg-header text-header-fg">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <Link href="/" className="rounded-md text-header-fg" aria-label="Stakeout home">
            <Logo />
          </Link>
          <nav aria-label="Main" className="hidden lg:block">
            <NavLinks pathname={pathname} vertical={false} />
          </nav>
          <div className="flex items-center gap-2">
            <div className="hidden lg:block">
              <ThemeSwitch />
            </div>
            <div className="hidden sm:block">
              <WalletButton />
            </div>
            <button
              type="button"
              className="inline-flex h-11 w-11 items-center justify-center rounded-md border border-header-line text-header-fg lg:hidden"
              aria-expanded={menuOpen}
              aria-controls="mobile-menu"
              aria-label={menuOpen ? "Close menu" : "Open menu"}
              onClick={() => setMenuPath(menuOpen ? null : pathname)}
            >
              {menuOpen ? <CrossIcon /> : <MenuIcon />}
            </button>
          </div>
        </div>
        {menuOpen && (
          <div id="mobile-menu" className="border-t border-header-line lg:hidden">
            <div className="mx-auto max-w-6xl space-y-4 px-4 py-4 sm:px-6">
              <nav aria-label="Main">
                <NavLinks pathname={pathname} vertical />
              </nav>
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-header-line pt-4">
                <ThemeSwitch />
                <div className="sm:hidden">
                  <WalletButton />
                </div>
              </div>
            </div>
          </div>
        )}
      </header>
      <NetworkPrompt />
      <main id="main" className="mx-auto w-full max-w-6xl flex-1 space-y-6 px-4 py-8 sm:px-6 sm:py-10">
        {children}
      </main>
      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-8 text-sm text-fg-muted sm:px-6 md:flex-row md:items-start md:justify-between">
          <div className="space-y-2">
            <p className="font-semibold text-fg">Stakeout is a testnet prototype. Do not use real funds.</p>
            <p>
              Data source: {config.dataSource}. Contracts from {config.deploymentFile}, deployed {config.deployment.deployedAt}.
            </p>
            <p>© {new Date().getFullYear()} Team Synergy. Built at Hacker House Goa 2026.</p>
          </div>
          <nav aria-label="Footer">
            <ul className="flex flex-wrap gap-1">
              {FOOTER_LINKS.map((link) => (
                <li key={link.href}>
                  <Link href={link.href} className="flex min-h-11 items-center rounded-md px-3 text-fg hover:bg-sunken">
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        </div>
      </footer>
    </div>
  );
}
