import type { Metadata } from "next";
import Link from "next/link";
import { Status } from "@shared/enums";
import { AlertIcon, ArrowRightIcon, CheckIcon, DocumentIcon, FlagIcon, SearchIcon, ShieldIcon } from "@/components/icons";
import { LEVEL_DOT, LEVEL_PANEL } from "@/components/status";
import { buttonClass } from "@/components/styles";
import { SITE_TAGLINE } from "@/lib/site";
import { warningFor } from "@/lib/warning";

export const metadata: Metadata = {
  title: { absolute: "Stakeout: check the wallet before you send" },
};

const STATUSES = [Status.None, Status.Reported, Status.Flagged, Status.Confirmed, Status.Linked];

const STEPS = [
  {
    Icon: DocumentIcon,
    title: "Victims report for free",
    body: "Describe what happened in your own words or by voice. Only the scam address and a hash of your complaint go on chain.",
  },
  {
    Icon: FlagIcon,
    title: "Verified reporters stake to flag",
    body: "A reporter puts a deposit behind a report. If nobody confirms or challenges it in time, the flag lapses and the deposit is returned.",
  },
  {
    Icon: ShieldIcon,
    title: "Wallet behavior confirms",
    body: "A cluster is confirmed only when the wallet itself moves money like a scam: rapid splitting, merging and forwarding to exit points.",
  },
];

const TRUST = [
  { title: "Reports alone never confirm a wallet", body: "The wallet's own transaction pattern is required. Reports only add confidence." },
  { title: "Evidence can be checked by anyone", body: "Each evidence bundle is hashed on chain. Recompute the hash on the Verify page to see if it was changed." },
  { title: "The AI explains, it does not decide", body: "Summaries are written from the evidence. Confirmation comes from published rules and the verifier role." },
  { title: "Trust points are named", body: "A reviewer multisig whitelists reporters and settles disputes. One verifier role posts confirmations." },
];

const EXPLORE = [
  { href: "/report", title: "Report a scam", body: "Turn a complaint into a free on-chain report." },
  { href: "/verify", title: "Verify evidence", body: "Check that a stored bundle matches its on-chain hash." },
  { href: "/dashboard", title: "Dashboard", body: "Reports, flags, clusters and payouts read from contract events." },
  { href: "/faq", title: "FAQ", body: "How staking, challenges and confirmation work." },
];

function ExampleWarning() {
  const warning = warningFor(Status.Confirmed);
  return (
    <figure className="rounded-lg border border-line bg-surface p-5 sm:p-6">
      <figcaption className="mb-4 flex items-center justify-between gap-3">
        <span className="text-sm font-semibold text-fg">What you see before sending</span>
        <span className="rounded-sm border border-line px-2 py-0.5 text-xs font-semibold text-fg-muted">Example</span>
      </figcaption>
      <div className="space-y-2">
        <p className="text-xs font-semibold tracking-wide text-fg-muted uppercase">Recipient address</p>
        <p className="rounded-md border border-line-strong bg-surface-2 px-3 py-3 font-mono text-[13px] text-fg-muted">0x…</p>
      </div>
      <div className={`mt-4 flex gap-3 rounded-md border p-4 ${LEVEL_PANEL.strong}`}>
        <AlertIcon size={22} className="mt-0.5 shrink-0" />
        <div className="space-y-1">
          <p className="text-base font-bold">{warning.label}</p>
          <p className="text-sm leading-relaxed">{warning.message}</p>
        </div>
      </div>
      <div className="mt-4 rounded-md border border-line bg-sunken p-4 text-sm text-fg">
        <p className="font-semibold">Sending through StakeoutGuard</p>
        <p className="mt-1 leading-relaxed text-fg-muted">
          The guard contract refuses to forward funds to confirmed and linked addresses, so the transfer reverts and nothing leaves your wallet.
        </p>
      </div>
    </figure>
  );
}

export default function Home() {
  return (
    <div className="space-y-16 sm:space-y-20">
      <section className="grid items-center gap-10 pt-2 lg:grid-cols-[1.1fr_1fr]">
        <div className="space-y-6">
          <p className="text-sm font-semibold tracking-wide text-accent-text uppercase">Scam oracle for crypto wallets. Testnet prototype.</p>
          <h1 className="text-4xl leading-[1.05] font-bold tracking-tight text-fg sm:text-5xl lg:text-6xl">Check the wallet before you send.</h1>
          <p className="border-l-2 border-accent pl-4 text-xl leading-snug font-semibold text-fg sm:text-2xl">{SITE_TAGLINE}</p>
          <p className="max-w-xl text-lg leading-relaxed text-fg-muted">
            Stakeout follows the money trail from scam reports, lets verified reporters stake on their claims, and warns you when a recipient belongs to a
            confirmed scam cluster.
          </p>
          <div className="flex flex-wrap gap-3">
            <Link href="/wallet" className={buttonClass("primary")}>
              <SearchIcon size={17} />
              Check an address
            </Link>
            <Link href="/report" className={buttonClass("secondary")}>
              Report a scam
            </Link>
          </div>
          <p className="max-w-xl text-sm leading-relaxed text-fg-muted">
            There are no accounts or passwords. Looking up an address needs no wallet. Connect a wallet only to report, stake or send.
          </p>
        </div>
        <ExampleWarning />
      </section>

      <section aria-labelledby="how-heading" className="space-y-6">
        <h2 id="how-heading" className="text-2xl font-bold tracking-tight text-fg sm:text-3xl">
          How a wallet gets confirmed
        </h2>
        <ol className="grid gap-px overflow-hidden rounded-lg border border-line bg-line md:grid-cols-3">
          {STEPS.map(({ Icon, title, body }, index) => (
            <li key={title} className="space-y-3 bg-surface p-6">
              <div className="flex items-center gap-3">
                <span className="font-mono text-sm text-fg-muted">0{index + 1}</span>
                <Icon className="text-fg" />
              </div>
              <h3 className="text-lg font-bold text-fg">{title}</h3>
              <p className="text-sm leading-relaxed text-fg-muted">{body}</p>
            </li>
          ))}
        </ol>
      </section>

      <section aria-labelledby="status-heading" className="grid gap-8 lg:grid-cols-[1fr_1.4fr]">
        <div className="space-y-3">
          <h2 id="status-heading" className="text-2xl font-bold tracking-tight text-fg sm:text-3xl">
            Five statuses, read straight from the contract
          </h2>
          <p className="leading-relaxed text-fg-muted">
            Any wallet or contract can call getStatus on the Stakeout contract. This app shows the same answer, with the evidence behind it.
          </p>
        </div>
        <ul className="divide-y divide-line rounded-lg border border-line bg-surface">
          {STATUSES.map((status) => {
            const warning = warningFor(status);
            return (
              <li key={status} className="flex gap-4 p-4 sm:p-5">
                <span className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${LEVEL_DOT[warning.level]}`} aria-hidden="true" />
                <div className="space-y-1">
                  <p className="flex flex-wrap items-baseline gap-x-3 gap-y-1 font-semibold text-fg">
                    {warning.label}
                    <span className="font-mono text-xs font-normal text-fg-muted">{Status[status]}</span>
                  </p>
                  <p className="text-sm leading-relaxed text-fg-muted">{warning.message}</p>
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      <section aria-labelledby="trust-heading" className="space-y-6">
        <h2 id="trust-heading" className="text-2xl font-bold tracking-tight text-fg sm:text-3xl">
          Why the answer can be trusted
        </h2>
        <ul className="grid gap-x-10 gap-y-6 md:grid-cols-2">
          {TRUST.map((item) => (
            <li key={item.title} className="flex gap-3">
              <CheckIcon className="mt-1 shrink-0 text-ok-fg" />
              <div className="space-y-1">
                <p className="font-semibold text-fg">{item.title}</p>
                <p className="text-sm leading-relaxed text-fg-muted">{item.body}</p>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="explore-heading" className="space-y-6">
        <h2 id="explore-heading" className="text-2xl font-bold tracking-tight text-fg sm:text-3xl">
          Try the rest of Stakeout
        </h2>
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {EXPLORE.map((item) => (
            <li key={item.href}>
              <Link
                href={item.href}
                className="group flex h-full flex-col justify-between gap-4 rounded-lg border border-line bg-surface p-5 transition-colors duration-150 hover:border-fg"
              >
                <span className="space-y-1">
                  <span className="block font-semibold text-fg">{item.title}</span>
                  <span className="block text-sm leading-relaxed text-fg-muted">{item.body}</span>
                </span>
                <ArrowRightIcon className="text-fg-muted transition-colors duration-150 group-hover:text-fg" />
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
