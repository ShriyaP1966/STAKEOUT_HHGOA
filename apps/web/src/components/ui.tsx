"use client";

import type { ReactNode } from "react";
import type { DecodedError } from "@/lib/errors";
import { formatCountdown, secondsUntil } from "@/lib/countdown";
import { useNowSeconds } from "@/lib/now";
import { useAppConfig } from "./AppConfigContext";

export function Section({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

export function Loading({ label }: { label: string }) {
  return (
    <p role="status" className="animate-pulse text-sm text-slate-500">
      {label}
    </p>
  );
}

export function Empty({ label }: { label: string }) {
  return <p className="text-sm text-slate-500">{label}</p>;
}

export function ErrorPanel({ error }: { error: DecodedError }) {
  return (
    <div role="alert" className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-900">
      <p className="font-semibold">{error.title}</p>
      <p className="mt-1 break-words">{error.detail}</p>
    </div>
  );
}

export function Mono({ children }: { children: ReactNode }) {
  return <span className="font-mono text-xs break-all">{children}</span>;
}

export function ExplorerLink({ kind, value }: { kind: "address" | "tx"; value: string }) {
  const { explorerUrl } = useAppConfig();
  if (!explorerUrl) return <Mono>{value}</Mono>;
  return (
    <a
      href={`${explorerUrl}/${kind}/${value}`}
      target="_blank"
      rel="noopener noreferrer"
      className="font-mono text-xs break-all text-indigo-700 underline hover:text-indigo-900"
    >
      {value}
    </a>
  );
}

export function Countdown({ expiresAt }: { expiresAt: bigint }) {
  const now = useNowSeconds();
  if (now === 0) return <span>…</span>;
  return <span className="font-mono tabular-nums">{formatCountdown(secondsUntil(expiresAt, now))}</span>;
}

export function RefreshButton({ onClick, busy }: { onClick: () => void; busy: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className="rounded-md border border-slate-300 px-3 py-1 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
    >
      {busy ? "Refreshing…" : "Refresh"}
    </button>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-0.5 sm:grid-cols-[10rem_1fr] sm:gap-3">
      <dt className="text-xs font-medium tracking-wide text-slate-500 uppercase">{label}</dt>
      <dd className="text-sm text-slate-900">{children}</dd>
    </div>
  );
}
