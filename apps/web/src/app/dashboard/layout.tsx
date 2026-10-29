import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Dashboard",
  description: "Reports, flags, confirmed clusters and reward payouts read from Stakeout contract events.",
};

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
