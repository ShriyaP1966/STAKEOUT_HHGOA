import type { Metadata } from "next";
import Link from "next/link";
import { DocPage, Pending, type DocSection } from "@/components/DocPage";
import { CONTACT_EMAIL } from "@/lib/site";

export const metadata: Metadata = {
  title: "Terms",
  description: "Terms for using the Stakeout testnet prototype.",
};

const SECTIONS: DocSection[] = [
  {
    id: "acceptance",
    heading: "Using this prototype",
    body: (
      <p>
        By using Stakeout you agree to these terms. If you do not agree, do not use it. These terms are a draft written for a hackathon prototype and{" "}
        <Pending>need legal review</Pending> before any public launch.
      </p>
    ),
  },
  {
    id: "service",
    heading: "What Stakeout is",
    body: (
      <>
        <p>
          Stakeout is an experimental tool that records scam reports, staked flags and confirmed scam clusters in smart contracts on a public test network, and
          shows the status of any wallet address.
        </p>
        <ul>
          <li>It runs on a test network. Test tokens have no real value. Do not send real funds through it.</li>
          <li>Data shown may be synthetic, generated for testing. Every evidence view shows its data source.</li>
          <li>A status is information, not advice. A wallet with no record is not proven safe, and a status can be wrong.</li>
        </ul>
      </>
    ),
  },
  {
    id: "responsibilities",
    heading: "Your responsibilities",
    body: (
      <ul>
        <li>Report only what you believe to be true, and only addresses involved in what you describe.</li>
        <li>Do not put names, phone numbers, bank details or other personal information in a complaint. Stored complaints can be read by anyone who has their hash.</li>
        <li>Keep your wallet, seed phrase and private keys to yourself. Stakeout never asks for them.</li>
        <li>Check every transaction in your wallet before you sign it. Signed transactions cannot be reversed.</li>
      </ul>
    ),
  },
  {
    id: "acceptable-use",
    heading: "Acceptable use",
    body: (
      <ul>
        <li>Do not file false reports or flags to harm someone. Flags can be challenged, and a flag overturned by the reviewers loses its stake.</li>
        <li>Do not try to disrupt the app, the backend or the contracts, or to overload the backend with automated requests.</li>
        <li>Do not use Stakeout for anything unlawful.</li>
      </ul>
    ),
  },
  {
    id: "staking",
    heading: "Stakes, challenges and rewards",
    body: (
      <p>
        Stakes, challenges, expiry, slashing and rewards follow the rules coded in the Stakeout contract. A reviewer multisig run by the team resolves
        challenges and pays rewards, and one verifier role posts confirmations. These are named trust points, explained in the{" "}
        <Link href="/faq" className="underline underline-offset-4">
          FAQ
        </Link>
        .
      </p>
    ),
  },
  {
    id: "third-party",
    heading: "Third-party services",
    body: (
      <p>
        Stakeout depends on services it does not control: your wallet software, the test network and its RPC providers, the block explorer and the AI model
        provider used by the backend. Their own terms apply to your use of them.
      </p>
    ),
  },
  {
    id: "ip",
    heading: "Intellectual property",
    body: (
      <p>
        The Stakeout name, logo and code belong to the Stakeout team. Licensing of the code: <Pending>to be confirmed by the team</Pending>. Open-source
        libraries and fonts used by the app remain under their own licenses.
      </p>
    ),
  },
  {
    id: "availability",
    heading: "Availability and changes",
    body: (
      <p>
        The prototype may be changed, reset, redeployed or shut down at any time without notice. Contracts may be redeployed to new addresses, and test
        network data may be lost.
      </p>
    ),
  },
  {
    id: "liability",
    heading: "No warranty and limits of liability",
    body: (
      <p>
        Stakeout is provided as it is, without any warranty. To the extent the law allows, the team is not liable for any loss arising from using it or relying
        on a status it shows. Exact wording for the applicable jurisdiction: <Pending>needs legal review</Pending>.
      </p>
    ),
  },
  {
    id: "changes",
    heading: "Changes to these terms",
    body: <p>These terms may change. The date at the top shows the latest version. Continuing to use Stakeout means you accept the current version.</p>,
  },
  {
    id: "contact",
    heading: "Contact",
    body: (
      <p>
        Questions about these terms:{" "}
        <a href={`mailto:${CONTACT_EMAIL}`} className="break-all underline underline-offset-4">
          {CONTACT_EMAIL}
        </a>
        . See also the{" "}
        <Link href="/privacy" className="underline underline-offset-4">
          Privacy
        </Link>{" "}
        page.
      </p>
    ),
  },
];

export default function TermsPage() {
  return (
    <DocPage
      title="Terms"
      updated="29 October 2026"
      intro={<p>Stakeout is a testnet prototype built at Hacker House Goa 2026. These terms set out how it may be used and what it does not promise.</p>}
      sections={SECTIONS}
    />
  );
}
