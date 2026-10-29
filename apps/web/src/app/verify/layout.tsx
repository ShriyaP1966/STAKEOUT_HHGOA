import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Verify evidence",
  description: "Recompute an evidence hash in your browser and compare it with the hash recorded on chain.",
};

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
