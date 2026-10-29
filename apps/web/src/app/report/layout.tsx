import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Report a scam",
  description: "Describe a scam in your own words or by voice and submit a free on-chain report.",
};

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
