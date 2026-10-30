import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRightIcon, ExternalIcon } from "@/components/icons";
import { Notice, PageHeader, Section } from "@/components/ui";
import { CONTACT_EMAIL } from "@/lib/site";

export const metadata: Metadata = {
  title: "Help and Contact",
  description: "How to get help with Stakeout, report a bug or contact Team Synergy.",
};

const ISSUES_URL = "https://github.com/ShriyaP1966/STAKEOUT_HHGOA/issues";

const linkClass = "font-semibold underline underline-offset-4";

const QUICK_LINKS = [
  { href: "/faq", label: "Read the FAQ" },
  { href: "/wallet", label: "Check an address" },
  { href: "/verify", label: "Verify evidence" },
  { href: "/report", label: "Report a scam" },
];

const BUG_DETAILS = [
  "The page you were on.",
  "The steps that led to the problem.",
  "What you expected to happen, and what happened instead.",
  "A screenshot, if you can.",
];

const TEAM = [
  { name: "Shriya Patil", role: "AI, Voice and Backend" },
  { name: "Akanksha Mishra", role: "Graph and Data" },
  { name: "Darshita Lodh", role: "Smart contracts and web app" },
];

export default function SupportPage() {
  return (
    <>
      <PageHeader title="Help and Contact" description="Stakeout is a hackathon prototype built by Team Synergy. Here is how to get help or reach us." />
      <Notice tone="warn" title="Stay safe">
        <p>
          We will never ask for your seed phrase or private key. We cannot recover funds sent to a scammer. If someone claiming to be Stakeout support
          contacts you first, it is a scam.
        </p>
      </Notice>
      <Section title="Quick help">
        <ul className="-my-3 divide-y divide-line">
          {QUICK_LINKS.map((item) => (
            <li key={item.href}>
              <Link href={item.href} className="group flex min-h-12 items-center justify-between gap-4 py-3 font-semibold text-fg">
                <span className="underline-offset-4 group-hover:underline">{item.label}</span>
                <ArrowRightIcon className="shrink-0 text-fg-muted transition-colors duration-150 group-hover:text-fg" />
              </Link>
            </li>
          ))}
        </ul>
      </Section>
      <Section title="Report a bug">
        <div className="space-y-3 leading-relaxed text-fg">
          <p>
            Open an issue on{" "}
            <a href={ISSUES_URL} target="_blank" rel="noopener noreferrer" className={linkClass}>
              GitHub Issues
              <ExternalIcon size={14} className="ml-1 inline-block align-baseline" />
              <span className="sr-only"> (opens in a new tab)</span>
            </a>
            . Please include:
          </p>
          <ul className="list-disc space-y-1.5 pl-5 [&_li]:pl-1">
            {BUG_DETAILS.map((detail) => (
              <li key={detail}>{detail}</li>
            ))}
          </ul>
          <p className="text-fg-muted">Do not include private keys, seed phrases or personal details such as names, phone numbers or bank details.</p>
        </div>
      </Section>
      <Section title="Contact the team">
        <div className="space-y-3 leading-relaxed text-fg">
          <p>
            Email us at{" "}
            <a href={`mailto:${CONTACT_EMAIL}`} className={`${linkClass} break-all`}>
              {CONTACT_EMAIL}
            </a>
            .
          </p>
          <p className="text-fg-muted">We reply when we can. There is no guaranteed response time.</p>
        </div>
      </Section>
      <Section title="The team">
        <dl className="divide-y divide-line">
          {TEAM.map((member) => (
            <div key={member.name} className="grid gap-1 py-3 first:pt-0 last:pb-0 sm:grid-cols-[14rem_1fr] sm:gap-4">
              <dt className="font-semibold text-fg">{member.name}</dt>
              <dd className="text-fg-muted">{member.role}</dd>
            </div>
          ))}
        </dl>
      </Section>
    </>
  );
}
