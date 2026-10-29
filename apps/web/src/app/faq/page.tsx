import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { ChevronIcon } from "@/components/icons";
import { PageHeader } from "@/components/ui";

export const metadata: Metadata = {
  title: "FAQ",
  description: "How Stakeout reports, flags and confirms scam wallets, and what each status means.",
};

const linkClass = "font-semibold underline underline-offset-4";

const GROUPS: { title: string; items: { q: string; a: ReactNode }[] }[] = [
  {
    title: "General",
    items: [
      {
        q: "What does Stakeout do?",
        a: (
          <p>
            It tells you whether a wallet address has been reported, flagged by a staked reporter, or confirmed as part of a scam cluster, so you can stop
            before sending money. The answer comes from the Stakeout contract, which any wallet or app can also query.
          </p>
        ),
      },
      {
        q: "Is this live with real money?",
        a: <p>No. Stakeout is a hackathon prototype on a public test network. Test tokens have no value. Do not send real funds through it.</p>,
      },
      {
        q: "Do I need an account?",
        a: (
          <p>
            No. There are no accounts or passwords. You can check any address without a wallet. Connect a wallet only to report, stake, challenge, withdraw or
            send through the guard.
          </p>
        ),
      },
    ],
  },
  {
    title: "Using Stakeout",
    items: [
      {
        q: "How do I check an address?",
        a: (
          <p>
            Open <Link href="/wallet" className={linkClass}>Check address</Link>, paste the address and press Check status. The result shows the status, the
            evidence hash behind it and, for confirmed wallets, a plain-language summary of the evidence.
          </p>
        ),
      },
      {
        q: "How do I report a scam?",
        a: (
          <p>
            Open <Link href="/report" className={linkClass}>Report</Link> and describe what happened, typed or by voice. The backend extracts the address,
            amount and time. You check the details, then submit. Reporting is free apart from network gas.
          </p>
        ),
      },
      {
        q: "What is sending through StakeoutGuard?",
        a: (
          <p>
            The guard is a small contract that forwards a payment only if the recipient is not Confirmed or Linked. If it is, the transaction reverts and
            nothing leaves your wallet.
          </p>
        ),
      },
    ],
  },
  {
    title: "Statuses, staking and flags",
    items: [
      {
        q: "What do the five statuses mean?",
        a: (
          <ul>
            <li>None: no reports, flags or cluster entries.</li>
            <li>Reported: someone filed a free, unverified report.</li>
            <li>Flagged: a verified reporter staked a deposit on a report. The flag lapses unless it is confirmed or challenged.</li>
            <li>Confirmed: the address belongs to a confirmed scam cluster.</li>
            <li>Linked: the address moves funds like a member of a confirmed cluster.</li>
          </ul>
        ),
      },
      {
        q: "Who can promote a report into a flag?",
        a: <p>Only verified reporters, approved by the reviewer multisig. They must stake the minimum deposit set in the contract.</p>,
      },
      {
        q: "What happens if a flag is wrong?",
        a: (
          <p>
            Another verified reporter can challenge it by staking at least the minimum deposit. The reviewer multisig resolves the challenge, and the losing side&apos;s stake
            goes into the reward pool. If nobody acts before the time limit, the flag lapses and its stake is returned in full.
          </p>
        ),
      },
      {
        q: "Can reports alone get a wallet confirmed?",
        a: (
          <p>
            No. Confirmation needs the wallet&apos;s own behavior to match a scam pattern, such as rapid splitting, merging and forwarding to exit points.
            Reports only add confidence. This makes it hard to frame an innocent wallet with fake reports.
          </p>
        ),
      },
    ],
  },
  {
    title: "Security and privacy",
    items: [
      {
        q: "Does Stakeout ever ask for my seed phrase?",
        a: <p>Never. If anything claiming to be Stakeout asks for a seed phrase or private key, it is a scam.</p>,
      },
      {
        q: "What goes on chain when I report?",
        a: (
          <p>
            The reported address and a hash of your complaint record. The complaint text stays with the backend, but anyone with the hash can fetch it, so
            leave out personal details. See <Link href="/privacy" className={linkClass}>Privacy</Link>.
          </p>
        ),
      },
      {
        q: "What does the AI do?",
        a: (
          <p>
            It reads complaints to extract the address, amount and time, and writes plain summaries of evidence. It never decides whether a wallet is
            confirmed, and addresses are always checked by code.
          </p>
        ),
      },
      {
        q: "How can I check that evidence was not edited?",
        a: (
          <p>
            Paste the hash on <Link href="/verify" className={linkClass}>Verify</Link>. Your browser fetches the stored bundle, hashes it again and compares it
            with the hash on chain. Any change, even one character, shows as a mismatch.
          </p>
        ),
      },
    ],
  },
  {
    title: "Troubleshooting",
    items: [
      {
        q: "The app says wrong network.",
        a: <p>Your wallet is on a different chain. Use the Switch button in the yellow bar, or change the network in your wallet.</p>,
      },
      {
        q: "A button is missing or disabled.",
        a: (
          <p>
            Some actions are limited by role or timing. Promote and challenge need a verified reporter wallet. Expire works only after the time limit. The line
            under each button explains why it is unavailable.
          </p>
        ),
      },
      {
        q: "The backend cannot be reached.",
        a: <p>Report, Verify, evidence summaries and Decisions need the backend. Checking an address and the dashboard work from the chain alone.</p>,
      },
    ],
  },
];

export default function FaqPage() {
  return (
    <>
      <PageHeader title="Frequently asked questions" description="Short answers about how Stakeout works. Each answer describes what the prototype actually does today." />
      <div className="space-y-10">
        {GROUPS.map((group, index) => (
          <section key={group.title} aria-labelledby={`faq-group-${index}`} className="space-y-3">
            <h2 id={`faq-group-${index}`} className="text-xl font-bold text-fg">
              {group.title}
            </h2>
            <div className="divide-y divide-line rounded-lg border border-line bg-surface">
              {group.items.map((item) => (
                <details key={item.q} className="group">
                  <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-4 px-5 py-4 font-semibold text-fg [&::-webkit-details-marker]:hidden">
                    {item.q}
                    <ChevronIcon className="shrink-0 text-fg-muted transition-transform duration-150 group-open:rotate-180" />
                  </summary>
                  <div className="space-y-2 px-5 pb-5 leading-relaxed text-fg-muted [&_li]:pl-1 [&_ul]:list-disc [&_ul]:space-y-1.5 [&_ul]:pl-5">{item.a}</div>
                </details>
              ))}
            </div>
          </section>
        ))}
      </div>
    </>
  );
}
