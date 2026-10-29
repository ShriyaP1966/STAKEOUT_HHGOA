import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Reviewer",
  description: "Read-only view of open challenges, verified reporters and the reward pool for the reviewer multisig.",
};

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
