import type { Metadata } from "next";
import Link from "next/link";
import { DocPage, Pending, type DocSection } from "@/components/DocPage";
import { CONTACT_EMAIL } from "@/lib/site";

export const metadata: Metadata = {
  title: "Privacy",
  description: "What the Stakeout testnet prototype collects, where it goes, and what is public on chain.",
};

const SECTIONS: DocSection[] = [
  {
    id: "scope",
    heading: "Scope",
    body: (
      <p>
        This policy describes the Stakeout prototype as it is built today: a web app, a backend service run by the Stakeout team, and smart contracts on a
        public test network. It is a draft. It has not been reviewed by a lawyer and it does not describe a production service.
      </p>
    ),
  },
  {
    id: "public",
    heading: "What is public on chain",
    body: (
      <>
        <p>Blockchain data is public and permanent. When you use Stakeout, the following can be recorded on the test network and seen by anyone:</p>
        <ul>
          <li>Your wallet address, when you report, promote, challenge, expire, withdraw or send through the guard contract.</li>
          <li>The address you report, and a hash of your complaint record.</li>
          <li>Stakes, rewards and the time of each transaction.</li>
        </ul>
        <p>Your complaint text is not written on chain. Only its hash is. Nothing on chain can be deleted, by us or anyone else.</p>
      </>
    ),
  },
  {
    id: "backend",
    heading: "What the backend stores",
    body: (
      <>
        <p>When you submit a complaint on the Report page, the web app sends the backend:</p>
        <ul>
          <li>The text you typed or dictated.</li>
          <li>Your browser&apos;s time zone name, so that times like &quot;yesterday at 9 pm&quot; are read correctly.</li>
          <li>The receiving address you chose, when your text contains more than one address.</li>
        </ul>
        <p>
          The backend stores a record of your original text, the extracted details and the data source, under the record&apos;s hash, in a database on the
          machine that runs the backend. It also stores evidence bundles and a log of verifier decisions.
        </p>
        <p>
          Important: the complaint hash is public on chain, and the backend returns the stored record to anyone who requests it by that hash. This is how
          the Verify page works. Do not include names, phone numbers, bank details or other personal information in a complaint.
        </p>
        <p>
          Retention: <Pending>to be confirmed by the team</Pending>. The prototype has no automatic deletion.
        </p>
      </>
    ),
  },
  {
    id: "ai",
    heading: "AI processing",
    body: (
      <p>
        To pull the address, amount and time out of a complaint, the backend sends your complaint text and time zone to an AI model provider chosen by the team
        operating the backend. The same provider writes plain-language summaries of evidence. Which provider is used, and its own data terms:{" "}
        <Pending>to be confirmed by the team</Pending>. The AI never decides whether a wallet is confirmed.
      </p>
    ),
  },
  {
    id: "third-parties",
    heading: "Other services your browser talks to",
    body: (
      <ul>
        <li>
          Your browser wallet extension, which you choose and control. Stakeout never asks for, receives or stores your seed phrase or private keys.
        </li>
        <li>The blockchain RPC provider configured for this app, which receives read requests and your signed transactions, and can see your IP address.</li>
        <li>The block explorer, but only when you open one of its links.</li>
      </ul>
    ),
  },
  {
    id: "cookies",
    heading: "Cookies and browser storage",
    body: (
      <>
        <p>
          The web app sets no cookies and uses no analytics, advertising or tracking scripts. Fonts are served from this site, not from a third party.
        </p>
        <p>It uses your browser&apos;s local storage for two conveniences that never leave your device:</p>
        <ul>
          <li>Your color theme choice (light, dark or system).</li>
          <li>Which wallet you last connected, kept by the wallet connection library so it can reconnect.</li>
        </ul>
        <p>Clearing your browser&apos;s site data removes both.</p>
      </>
    ),
  },
  {
    id: "security",
    heading: "Security",
    body: (
      <p>
        Addresses are validated in code before they are used, contract calls are simulated before you sign, and the backend keeps its API keys on the
        server. No system is perfectly secure, and this is a prototype that has not had an independent security audit.
      </p>
    ),
  },
  {
    id: "rights",
    heading: "Your choices and requests",
    body: (
      <>
        <p>
          You can use the Check address and Verify pages without connecting a wallet or sending any text. To ask about or remove a complaint record held by
          the backend, contact the team below with the complaint hash. Records on chain cannot be removed.
        </p>
        <p>
          Rights under data protection laws that apply to you (for example India&apos;s Digital Personal Data Protection Act):{" "}
          <Pending>needs legal review</Pending>.
        </p>
      </>
    ),
  },
  {
    id: "contact",
    heading: "Contact",
    body: (
      <p>
        Privacy questions:{" "}
        <a href={`mailto:${CONTACT_EMAIL}`} className="break-all underline underline-offset-4">
          {CONTACT_EMAIL}
        </a>
        . See also the <Link href="/terms" className="underline underline-offset-4">Terms</Link>.
      </p>
    ),
  },
  {
    id: "changes",
    heading: "Changes to this policy",
    body: <p>If the prototype changes how it handles data, this page will be updated and the date at the top will change.</p>,
  },
];

export default function PrivacyPage() {
  return (
    <DocPage
      title="Privacy"
      updated="29 October 2026"
      intro={
        <p>
          Stakeout is a hackathon prototype on a test network. This page explains, in plain words, what it collects, where that goes and what becomes public.
        </p>
      }
      sections={SECTIONS}
    />
  );
}
