"use client";

import type { ReactNode } from "react";
import type { DecodedError } from "@/lib/errors";
import { formatCountdown, secondsUntil } from "@/lib/countdown";
import { useNowSeconds } from "@/lib/now";
import { useAppConfig } from "./AppConfigContext";
import { AlertIcon, CheckIcon, ExternalIcon, InfoIcon, RefreshIcon } from "./icons";
import { buttonClass, TONE_CLASSES, type Tone } from "./styles";

export { buttonClass, inputClass, toneClass, type ButtonVariant, type Tone } from "./styles";

const TONES = TONE_CLASSES;

export function PageHeader({ title, description, action }: { title: string; description?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div className="max-w-2xl space-y-2">
        <h1 className="text-3xl font-bold tracking-tight text-fg sm:text-4xl">{title}</h1>
        {description && <p className="text-base leading-relaxed text-fg-muted sm:text-[17px]">{description}</p>}
      </div>
      {action}
    </div>
  );
}

export function Section({
  title,
  description,
  action,
  children,
}: {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="rounded-lg border border-line bg-surface p-5 sm:p-6">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h2 className="text-lg font-bold text-fg">{title}</h2>
          {description && <p className="text-sm leading-relaxed text-fg-muted">{description}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

export function Tag({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-sm border px-2 py-0.5 text-xs font-semibold ${TONES[tone]}`}>
      {children}
    </span>
  );
}

export function Notice({ tone = "info", title, children }: { tone?: Tone; title?: string; children: ReactNode }) {
  const Icon = tone === "ok" ? CheckIcon : tone === "danger" || tone === "warn" ? AlertIcon : InfoIcon;
  return (
    <div className={`flex gap-3 rounded-md border p-4 text-sm leading-relaxed ${TONES[tone]}`}>
      <Icon className="mt-0.5 shrink-0" />
      <div className="min-w-0 space-y-1">
        {title && <p className="font-semibold">{title}</p>}
        <div className="break-words">{children}</div>
      </div>
    </div>
  );
}

export function Loading({ label }: { label: string }) {
  return (
    <div role="status" className="space-y-3">
      <div className="h-3 w-2/3 animate-pulse rounded-sm bg-sunken" />
      <div className="h-3 w-1/2 animate-pulse rounded-sm bg-sunken" />
      <p className="text-sm text-fg-muted">{label}</p>
    </div>
  );
}

export function Empty({ label }: { label: string }) {
  return <p className="rounded-md border border-dashed border-line-strong px-4 py-5 text-sm text-fg-muted">{label}</p>;
}

export function ErrorPanel({ error }: { error: DecodedError }) {
  return (
    <div role="alert" className={`flex gap-3 rounded-md border p-4 text-sm ${TONES.danger}`}>
      <AlertIcon className="mt-0.5 shrink-0" />
      <div className="min-w-0">
        <p className="font-semibold">{error.title}</p>
        <p className="mt-1 break-words">{error.detail}</p>
      </div>
    </div>
  );
}

export function Mono({ children }: { children: ReactNode }) {
  return <span className="font-mono text-[13px] break-all">{children}</span>;
}

export function ExplorerLink({ kind, value }: { kind: "address" | "tx"; value: string }) {
  const { explorerUrl } = useAppConfig();
  if (!explorerUrl) return <Mono>{value}</Mono>;
  return (
    <a
      href={`${explorerUrl}/${kind}/${value}`}
      target="_blank"
      rel="noopener noreferrer"
      className="inline font-mono text-[13px] break-all text-fg underline decoration-line-strong underline-offset-4 hover:decoration-fg"
    >
      {value}
      <ExternalIcon size={12} className="ml-1 inline-block align-baseline" />
      <span className="sr-only"> (opens the block explorer in a new tab)</span>
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
    <button type="button" onClick={onClick} disabled={busy} className={buttonClass("secondary", "sm")}>
      <RefreshIcon size={16} className={busy ? "animate-spin" : undefined} />
      {busy ? "Refreshing…" : "Refresh"}
    </button>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-1 border-t border-line py-3 first:border-t-0 first:pt-0 sm:grid-cols-[11rem_1fr] sm:gap-4">
      <dt className="text-xs font-semibold tracking-wide text-fg-muted uppercase">{label}</dt>
      <dd className="min-w-0 text-sm text-fg">{children}</dd>
    </div>
  );
}
