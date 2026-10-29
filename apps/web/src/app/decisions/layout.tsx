import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Verifier decisions",
  description: "What the verifier checked, which rule applied and whether it sent a transaction.",
};

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
