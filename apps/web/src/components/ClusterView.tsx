"use client";

import { useQuery } from "@tanstack/react-query";
import dynamic from "next/dynamic";
import {
  dataSourcesOf,
  fetchClusterGraph,
  GRAPH_ROLES,
  GraphError,
  isClusterId,
  ROLE_COLOR_VARS,
  ROLE_LABELS,
  type ClusterGraph,
  type GraphRole,
} from "@/lib/graph";
import { Empty, ErrorPanel, Loading, Mono, Notice, PageHeader, RefreshButton, Section, Tag, type Tone } from "./ui";

const ClusterGraphCanvas = dynamic(() => import("./ClusterGraphCanvas"), {
  ssr: false,
  loading: () => <Loading label="Preparing the graph view…" />,
});

const ROLE_TONES: Record<GraphRole, Tone> = { member: "danger", exit_point: "accent", counterparty: "neutral" };

function Legend({ graph }: { graph: ClusterGraph }) {
  return (
    <ul className="flex flex-wrap gap-x-5 gap-y-2 text-sm text-fg">
      {GRAPH_ROLES.map((role) => (
        <li key={role} className="flex items-center gap-2">
          <span className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: `var(${ROLE_COLOR_VARS[role]})` }} aria-hidden="true" />
          {ROLE_LABELS[role]}
          <span className="text-fg-muted">({graph.nodes.filter((node) => node.role === role).length})</span>
        </li>
      ))}
    </ul>
  );
}

function WalletList({ graph }: { graph: ClusterGraph }) {
  return (
    <ul className="divide-y divide-line">
      {graph.nodes.map((node) => (
        <li key={node.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
          <span className="min-w-0 break-all">
            <Mono>{node.id}</Mono>
          </span>
          <Tag tone={ROLE_TONES[node.role]}>{ROLE_LABELS[node.role]}</Tag>
        </li>
      ))}
    </ul>
  );
}

function TransferList({ graph }: { graph: ClusterGraph }) {
  if (graph.edges.length === 0) return <Empty label="The graph service returned no transfers for this cluster." />;
  return (
    <ul className="divide-y divide-line">
      {graph.edges.map((edge, index) => (
        <li key={edge.txId ?? `${edge.src}-${edge.tgt}-${index}`} className="space-y-1 py-3 text-sm">
          <p className="break-all">
            <Mono>{edge.src}</Mono>
            <span className="px-2 text-fg-muted" aria-hidden="true">
              →
            </span>
            <span className="sr-only"> sent to </span>
            <Mono>{edge.tgt}</Mono>
          </p>
          <p className="text-fg-muted">
            Amount {edge.amount ?? "not given"}, timestamp {edge.timestamp ?? "not given"}
            {edge.txId && (
              <>
                , transfer id <Mono>{edge.txId}</Mono>
              </>
            )}
          </p>
        </li>
      ))}
    </ul>
  );
}

function GraphResult({ graph }: { graph: ClusterGraph }) {
  if (graph.nodes.length === 0) return <Empty label="The graph service returned no wallets for this cluster." />;
  return (
    <>
      <Section title="Money trail" description="Each dot is a wallet and each arrow is a transfer. Drag to move, scroll to zoom, hover a dot for its address.">
        <div className="space-y-4">
          <Legend graph={graph} />
          <ClusterGraphCanvas graph={graph} />
        </div>
      </Section>
      <div className="grid gap-6 lg:grid-cols-2">
        <Section title={`Wallets (${graph.nodes.length})`}>
          <WalletList graph={graph} />
        </Section>
        <Section title={`Transfers (${graph.edges.length})`} description="Amounts and timestamps are shown exactly as the graph service returns them.">
          <TransferList graph={graph} />
        </Section>
      </div>
    </>
  );
}

export function ClusterView({ clusterId }: { clusterId: string }) {
  const valid = isClusterId(clusterId);
  const query = useQuery({
    queryKey: ["clusterGraph", clusterId.toLowerCase()],
    queryFn: () => fetchClusterGraph(clusterId as `0x${string}`),
    enabled: valid,
    retry: false,
  });
  const sources = query.data ? dataSourcesOf(query.data) : [];

  return (
    <>
      <PageHeader
        title="Cluster graph"
        description={
          <>
            Wallets and transfers around one scam cluster, read from the graph service. Cluster <Mono>{clusterId}</Mono>
          </>
        }
        action={valid ? <RefreshButton onClick={() => void query.refetch()} busy={query.isFetching} /> : undefined}
      />
      {!valid && (
        <Notice tone="danger" title="Invalid cluster id">
          A cluster id is 0x followed by 64 hex characters. Open a cluster from the Dashboard or from a Confirmed or Linked address on Check address.
        </Notice>
      )}
      {valid && query.isPending && <Loading label="Loading the cluster from the graph service…" />}
      {valid && query.isError && (
        <ErrorPanel
          error={
            query.error instanceof GraphError
              ? query.error.decoded
              : { title: "Could not load the cluster", detail: query.error instanceof Error ? query.error.message : String(query.error) }
          }
        />
      )}
      {query.data && (
        <>
          <p className="flex flex-wrap items-center gap-2 text-sm text-fg-muted">
            Data source:
            {sources.map((source) => (
              <Tag key={source} tone={source === "synthetic" ? "warn" : "info"}>
                {source}
              </Tag>
            ))}
          </p>
          <GraphResult graph={query.data} />
        </>
      )}
    </>
  );
}
