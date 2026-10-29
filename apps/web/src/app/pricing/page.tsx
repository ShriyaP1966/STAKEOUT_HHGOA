import type { Metadata } from "next";
import { CheckIcon } from "@/components/icons";
import { Notice, PageHeader, Section, Tag } from "@/components/ui";

export const metadata: Metadata = {
  title: "Pricing",
  description: "Proposed Stakeout plans: free address checks, a wallet API and exchange data.",
};

type Plan = { name: string; price: string; audience: string; features: string[] };

const PLANS: Plan[] = [
  {
    name: "Free",
    price: "₹0",
    audience: "anyone about to send crypto",
    features: [
      "Unlimited address checks",
      "Free scam reports, typed or by voice",
      "Evidence verification on the Verify page",
      "Send through StakeoutGuard",
    ],
  },
  {
    name: "Wallet API",
    price: "₹999 per month",
    audience: "wallets and dApps",
    features: [
      "Status lookups through an API",
      "Warn users before they send to a flagged address",
      "Evidence summaries for confirmed wallets",
      "Usage limits per plan",
    ],
  },
  {
    name: "Exchange and compliance",
    price: "Contact us",
    audience: "exchanges and investigators",
    features: ["Cluster, member and exit-point data", "Verifier decision log", "Priority review of disputes", "Bulk address screening"],
  },
];

const QUESTIONS = [
  { q: "Can I pay today?", a: "No. Stakeout is a prototype on a test network and processes no payments." },
  {
    q: "Why is checking an address free?",
    a: "Warning people before they send is the core purpose, so it stays free. Paid plans would cover high-volume API use and data for businesses.",
  },
];

function PlanCard({ plan }: { plan: Plan }) {
  const headingId = `plan-${plan.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  return (
    <article aria-labelledby={headingId} className="flex h-full min-w-0 flex-col gap-4 rounded-lg border border-line bg-surface p-5 sm:p-6">
      <div className="space-y-2">
        <Tag>Proposed</Tag>
        <h2 id={headingId} className="text-lg font-bold text-fg">
          {plan.name}
        </h2>
        <p className="text-2xl font-bold tracking-tight text-fg">{plan.price}</p>
        <p className="text-sm leading-relaxed text-fg-muted">For {plan.audience}</p>
      </div>
      <ul className="space-y-2.5 border-t border-line pt-4">
        {plan.features.map((feature) => (
          <li key={feature} className="flex gap-2.5 text-[15px] leading-relaxed text-fg">
            <CheckIcon className="mt-1 shrink-0 text-ok-fg" />
            <span className="min-w-0">{feature}</span>
          </li>
        ))}
      </ul>
    </article>
  );
}

export default function PricingPage() {
  return (
    <>
      <PageHeader title="Pricing" description="Proposed plans for after the hackathon. Stakeout is a testnet prototype and is not selling anything yet." />
      <Notice tone="info" title="Proposed pricing">
        These plans show how Stakeout could be paid for. Nothing can be bought today, and no payments are processed.
      </Notice>
      <div className="space-y-3">
        <div className="grid gap-4 md:grid-cols-3">
          {PLANS.map((plan) => (
            <PlanCard key={plan.name} plan={plan} />
          ))}
        </div>
        <p className="text-sm leading-relaxed text-fg-muted">The on-chain getStatus check stays free for any wallet or contract, on every plan.</p>
      </div>
      <Section title="Questions">
        <dl className="space-y-4">
          {QUESTIONS.map((item) => (
            <div key={item.q} className="space-y-1">
              <dt className="font-semibold text-fg">{item.q}</dt>
              <dd className="leading-relaxed text-fg-muted">{item.a}</dd>
            </div>
          ))}
        </dl>
      </Section>
    </>
  );
}
