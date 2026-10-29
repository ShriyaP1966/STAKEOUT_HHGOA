import type { Metadata } from "next";
import Link from "next/link";
import { SearchIcon } from "@/components/icons";
import { buttonClass } from "@/components/styles";

export const metadata: Metadata = {
  title: "Page not found",
};

export default function NotFound() {
  return (
    <div className="mx-auto max-w-xl space-y-6 py-12 text-center">
      <p className="font-mono text-sm text-fg-muted">404</p>
      <h1 className="text-3xl font-bold tracking-tight text-fg sm:text-4xl">This page does not exist</h1>
      <p className="leading-relaxed text-fg-muted">
        The link may be mistyped or out of date. If you were about to send funds, you can still check the recipient first.
      </p>
      <div className="flex flex-wrap justify-center gap-3">
        <Link href="/wallet" className={buttonClass("primary")}>
          <SearchIcon size={17} />
          Check an address
        </Link>
        <Link href="/" className={buttonClass("secondary")}>
          Go to the home page
        </Link>
      </div>
    </div>
  );
}
