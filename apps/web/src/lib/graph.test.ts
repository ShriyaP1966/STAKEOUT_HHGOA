import { afterEach, describe, expect, it, vi } from "vitest";
import { bytesToHex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import {
  clusterGraphHref,
  clusterGraphSchema,
  dataSourcesOf,
  describeGraphFailure,
  edgeCurvatures,
  escapeHtml,
  fetchClusterGraph,
  GraphError,
  isClusterId,
} from "./graph";
import { GRAPH_PROXY_PATH } from "./graph-path";
import sharedResponse from "./fixtures/cluster-graph-response.json";

const wallet = () => privateKeyToAccount(generatePrivateKey()).address.toLowerCase();
const clusterId = () => bytesToHex(crypto.getRandomValues(new Uint8Array(32)));

function fixture(id = clusterId()) {
  const [member, exitPoint, counterparty] = [wallet(), wallet(), wallet()];
  return {
    clusterId: id,
    nodes: [
      { id: member, role: "member", isExitPoint: false, dataSource: "synthetic" },
      { id: exitPoint, role: "exit_point", isExitPoint: true, dataSource: "synthetic" },
      { id: counterparty, role: "counterparty", isExitPoint: false, dataSource: "synthetic" },
    ],
    edges: [
      { src: counterparty, tgt: member, amount: 1.25, timestamp: 1, txId: "t1" },
      { src: member, tgt: exitPoint, amount: null, timestamp: null, txId: null },
    ],
  };
}

function respond(status: number, body: string) {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(body, { status, headers: { "content-type": "application/json" } })));
}

async function failureOf(promise: Promise<unknown>): Promise<GraphError> {
  const error = await promise.then(
    () => undefined,
    (reason: unknown) => reason,
  );
  expect(error).toBeInstanceOf(GraphError);
  return error as GraphError;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("isClusterId", () => {
  it("accepts 0x plus 64 hex characters only", () => {
    const id = clusterId();
    expect(isClusterId(id)).toBe(true);
    expect(isClusterId(id.toUpperCase().replace("0X", "0x"))).toBe(true);
    expect(isClusterId(id.slice(0, -2))).toBe(false);
    expect(isClusterId(`${id}00`)).toBe(false);
    expect(isClusterId(id.slice(2))).toBe(false);
    expect(isClusterId(wallet())).toBe(false);
  });

  it("builds the page link from the id", () => {
    const id = clusterId();
    expect(clusterGraphHref(id)).toBe(`/cluster/${id}`);
  });
});

describe("clusterGraphSchema", () => {
  it("accepts the documented shape", () => {
    const graph = fixture();
    expect(clusterGraphSchema.parse(graph)).toEqual(graph);
    expect(dataSourcesOf(clusterGraphSchema.parse(graph))).toEqual(["synthetic"]);
  });

  it("rejects an unknown role, a missing data source and an edge to a wallet outside nodes", () => {
    const graph = fixture();
    expect(clusterGraphSchema.safeParse({ ...graph, nodes: [{ ...graph.nodes[0], role: "victim" }, ...graph.nodes.slice(1)] }).success).toBe(false);
    expect(clusterGraphSchema.safeParse({ ...graph, nodes: [{ ...graph.nodes[0], dataSource: "" }, ...graph.nodes.slice(1)] }).success).toBe(false);
    expect(clusterGraphSchema.safeParse({ ...graph, edges: [{ ...graph.edges[0], tgt: wallet() }] }).success).toBe(false);
  });
});

describe("describeGraphFailure", () => {
  it("names the graph service when it does not answer", () => {
    expect(describeGraphFailure(null, undefined).title).toBe("Graph service unreachable");
    expect(describeGraphFailure(500, "<html>").title).toBe("Graph service unreachable");
  });

  it("shows the service's own detail for 400, 404 and 502", () => {
    expect(describeGraphFailure(400, { detail: "Invalid clusterId." })).toEqual({ title: "Invalid cluster id", detail: "Invalid clusterId." });
    expect(describeGraphFailure(404, { detail: "No graph data for this cluster." }).title).toBe("No graph data for this cluster");
    expect(describeGraphFailure(502, { detail: "graph down" }).title).toBe("The graph database returned an error");
    expect(describeGraphFailure(503, { detail: "x" }).title).toBe("Graph service error (503)");
  });
});

describe("fetchClusterGraph", () => {
  it("calls the same-origin graph proxy and returns the parsed graph", async () => {
    const graph = fixture();
    respond(200, JSON.stringify(graph));
    await expect(fetchClusterGraph(graph.clusterId as `0x${string}`)).resolves.toEqual(graph);
    expect(vi.mocked(fetch).mock.calls[0][0]).toBe(`${GRAPH_PROXY_PATH}/cluster/${graph.clusterId}/graph`);
  });

  it("maps a 404 to a clear empty-cluster error", async () => {
    respond(404, JSON.stringify({ detail: "No graph data for this cluster." }));
    const error = await failureOf(fetchClusterGraph(clusterId() as `0x${string}`));
    expect(error.status).toBe(404);
    expect(error.decoded.detail).toBe("No graph data for this cluster.");
  });

  it("reports an unreachable service when fetch fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new TypeError("fetch failed");
    }));
    expect((await failureOf(fetchClusterGraph(clusterId() as `0x${string}`))).decoded.title).toBe("Graph service unreachable");
  });

  it("refuses a wrong shape or an answer for a different cluster", async () => {
    respond(200, JSON.stringify({ ...fixture(), nodes: "none" }));
    expect((await failureOf(fetchClusterGraph(clusterId() as `0x${string}`))).decoded.title).toBe("Unexpected graph response");
    respond(200, JSON.stringify(fixture()));
    const asked = clusterId() as `0x${string}`;
    expect((await failureOf(fetchClusterGraph(asked))).decoded.detail).toContain(asked);
  });
});

describe("graph service response fixture shared by the team", () => {
  it("parses unchanged, with every role, edge and data source intact", () => {
    const graph = clusterGraphSchema.parse(sharedResponse);
    expect(isClusterId(graph.clusterId)).toBe(true);
    expect(graph.nodes).toHaveLength(sharedResponse.nodes.length);
    expect(graph.edges).toHaveLength(sharedResponse.edges.length);
    for (const role of ["member", "exit_point", "counterparty"] as const) {
      expect(graph.nodes.filter((node) => node.role === role).length).toBe(sharedResponse.nodes.filter((node) => node.role === role).length);
    }
    expect(graph.nodes.filter((node) => node.role === "exit_point").every((node) => node.isExitPoint)).toBe(true);
    expect(dataSourcesOf(graph)).toEqual([...new Set(sharedResponse.nodes.map((node) => node.dataSource))].sort());
  });

  it("is returned by fetchClusterGraph for its own cluster id", async () => {
    respond(200, JSON.stringify(sharedResponse));
    await expect(fetchClusterGraph(sharedResponse.clusterId as `0x${string}`)).resolves.toEqual(sharedResponse);
  });
});

describe("edgeCurvatures", () => {
  it("keeps a single transfer straight and spreads repeated transfers between the same wallets", () => {
    const [a, b, c] = [wallet(), wallet(), wallet()];
    expect(edgeCurvatures([{ src: a, tgt: b }])).toEqual([0]);
    const repeated = edgeCurvatures([
      { src: a, tgt: b },
      { src: a, tgt: b },
      { src: a, tgt: b },
      { src: a, tgt: c },
    ]);
    expect(repeated[3]).toBe(0);
    expect(new Set(repeated.slice(0, 3)).size).toBe(3);
  });

  it("curves a transfer back the other way to the opposite side", () => {
    const [a, b] = [wallet(), wallet()];
    const [forward, back] = edgeCurvatures([
      { src: a, tgt: b },
      { src: b, tgt: a },
    ]);
    expect(forward).not.toBe(0);
    expect(back).toBe(forward);
  });

  it("separates the repeated transfers in the shared response fixture", () => {
    const curvatures = edgeCurvatures(sharedResponse.edges);
    const pairs = new Map<string, number[]>();
    sharedResponse.edges.forEach((edge, index) => {
      const key = `${edge.src}|${edge.tgt}`;
      pairs.set(key, [...(pairs.get(key) ?? []), curvatures[index]]);
    });
    for (const values of pairs.values()) expect(new Set(values).size).toBe(values.length);
  });
});

describe("escapeHtml", () => {
  it("makes text safe to place in a tooltip", () => {
    expect(escapeHtml(`<img src=x onerror="a">&'`)).toBe("&#60;img src=x onerror=&#34;a&#34;&#62;&#38;&#39;");
  });
});
