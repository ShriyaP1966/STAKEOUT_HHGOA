import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Check an address",
  description: "Look up whether a wallet is reported, flagged or part of a confirmed scam cluster, then send through the guard contract.",
};

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
