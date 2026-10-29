import type { Metadata } from "next";
import { ClusterView } from "@/components/ClusterView";

export const metadata: Metadata = {
  title: "Cluster graph",
  description: "The wallets and transfers around one scam cluster, drawn from the graph service.",
};

export default async function ClusterPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ClusterView clusterId={id} />;
}
