import { isAddress, isHex, size, type Hex } from "viem";
import { z } from "zod";
import type { DecodedError } from "./errors";
import { GRAPH_PROXY_PATH } from "./graph-path";

export const GRAPH_ROLES = ["member", "exit_point", "counterparty"] as const;
export type GraphRole = (typeof GRAPH_ROLES)[number];

export const ROLE_LABELS: Record<GraphRole, string> = {
  member: "Member",
  exit_point: "Exit point",
  counterparty: "Counterparty",
};

export const ROLE_COLOR_VARS: Record<GraphRole, string> = {
  member: "--danger",
  exit_point: "--accent",
  counterparty: "--fg-muted",
};

const walletAddress = z.string().refine((value) => isAddress(value, { strict: false }), "must be a valid address");

export const clusterGraphSchema = z
  .object({
    clusterId: z.string(),
    nodes: z.array(
      z.object({
        id: walletAddress,
        role: z.enum(GRAPH_ROLES),
        isExitPoint: z.boolean(),
        dataSource: z.enum(["synthetic", "testnet"]),
      }),
    ),
    edges: z.array(
      z.object({
        src: walletAddress,
        tgt: walletAddress,
        amount: z.number().nullable(),
        timestamp: z.number().nullable(),
        txId: z.string().nullable(),
      }),
    ),
  })
  .superRefine((graph, ctx) => {
    const ids = new Set(graph.nodes.map((node) => node.id.toLowerCase()));
    graph.edges.forEach((edge, index) => {
      if (!ids.has(edge.src.toLowerCase()) || !ids.has(edge.tgt.toLowerCase())) {
        ctx.addIssue({ code: "custom", path: ["edges", index], message: "refers to a wallet that is not in nodes" });
      }
    });
  });

export type ClusterGraph = z.infer<typeof clusterGraphSchema>;

export function clusterGraphHref(clusterId: string): string {
  return `/cluster/${clusterId}`;
}

export function isClusterId(value: string): value is Hex {
  return isHex(value, { strict: true }) && size(value) === 32;
}

export function dataSourcesOf(graph: ClusterGraph): string[] {
  return [...new Set(graph.nodes.map((node) => node.dataSource))].sort();
}

export class GraphError extends Error {
  constructor(
    readonly status: number | null,
    readonly decoded: DecodedError,
  ) {
    super(decoded.detail);
    this.name = "GraphError";
  }
}

function detailOf(body: unknown): string | undefined {
  if (typeof body === "object" && body !== null && "detail" in body && typeof body.detail === "string" && body.detail.trim()) {
    return body.detail;
  }
  return undefined;
}

export function describeGraphFailure(status: number | null, body: unknown): DecodedError {
  const detail = detailOf(body);
  if (status === null || detail === undefined) {
    return {
      title: "Graph service unreachable",
      detail: "The graph service at NEXT_PUBLIC_GRAPH_URL did not answer. Check that it is running, then try again.",
    };
  }
  if (status === 400) return { title: "Invalid cluster id", detail };
  if (status === 404) return { title: "No graph data for this cluster", detail };
  if (status === 502) return { title: "The graph database returned an error", detail };
  return { title: `Graph service error (${status})`, detail };
}

export async function fetchClusterGraph(clusterId: Hex): Promise<ClusterGraph> {
  let response: Response;
  try {
    response = await fetch(`${GRAPH_PROXY_PATH}/cluster/${clusterId}/graph`);
  } catch {
    throw new GraphError(null, describeGraphFailure(null, undefined));
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new GraphError(response.status, describeGraphFailure(null, undefined));
  }
  if (!response.ok) throw new GraphError(response.status, describeGraphFailure(response.status, body));
  const parsed = clusterGraphSchema.safeParse(body);
  if (!parsed.success) {
    throw new GraphError(response.status, {
      title: "Unexpected graph response",
      detail: `The graph service answered with a shape this app does not expect: ${parsed.error.issues
        .map((issue) => `${issue.path.join(".") || "(root)"} ${issue.message}`)
        .join(", ")}.`,
    });
  }
  if (parsed.data.clusterId.toLowerCase() !== clusterId.toLowerCase()) {
    throw new GraphError(response.status, {
      title: "Unexpected graph response",
      detail: `Asked for cluster ${clusterId} but the graph service answered for ${parsed.data.clusterId}.`,
    });
  }
  return parsed.data;
}
