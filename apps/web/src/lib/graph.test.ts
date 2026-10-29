import { afterEach, describe, expect, it, vi } from "vitest";
import { bytesToHex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { clusterGraphHref, clusterGraphSchema, dataSourcesOf, describeGraphFailure, fetchClusterGraph, GraphError, isClusterId } from "./graph";
import { GRAPH_PROXY_PATH } from "./graph-path";

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
