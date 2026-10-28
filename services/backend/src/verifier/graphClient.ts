import type { z } from "zod";
import { UserError } from "../errors.js";
import {
  analysisProposalSchema, linkCandidatesSchema, proposedAnalysisPath, proposedLinkCandidatesPath,
  type AnalysisProposal, type LinkCandidates,
} from "./graphAnalysisProposal.js";

export type GraphErrorKind = "unreachable" | "timeout" | "http" | "invalid-json" | "invalid-shape";

export class GraphServiceError extends Error {
  constructor(public readonly kind: GraphErrorKind, message: string) {
    super(message);
  }
}

/** One GET to the Graph Service. Every failure is a GraphServiceError with a message that says what went wrong. */
async function getJson<T extends z.ZodType>(baseUrl: string, path: string, timeoutMs: number, schema: T): Promise<z.infer<T>> {
  const url = new URL(path, baseUrl);
  let res: Response;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  } catch (e) {
    if ((e as Error).name === "TimeoutError") {
      throw new GraphServiceError("timeout", `Graph Service (${url.host}) did not answer within ${timeoutMs} ms (GRAPH_TIMEOUT_MS).`);
    }
    throw new GraphServiceError("unreachable", `Cannot reach the Graph Service at ${url.host}: ${(e as Error).message}. Is Person 1's service running?`);
  }
  const text = await res.text();
  if (!res.ok) {
    throw new GraphServiceError("http", `Graph Service answered HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new GraphServiceError("invalid-json", "Graph Service returned something that is not JSON.");
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ");
    throw new GraphServiceError(
      "invalid-shape",
      `Graph Service response does not match docs/graph-analysis-proposal.md (not yet agreed with Person 1): ${problems}`,
    );
  }
  return parsed.data;
}

/** PROPOSED route and shape: see graphAnalysisProposal.ts. */
export function fetchAnalysis(baseUrl: string, target: string, timeoutMs: number): Promise<AnalysisProposal> {
  return getJson(baseUrl, proposedAnalysisPath(target), timeoutMs, analysisProposalSchema);
}

/** PROPOSED route and shape: see graphAnalysisProposal.ts. */
export function fetchLinkCandidates(baseUrl: string, clusterId: string, timeoutMs: number): Promise<LinkCandidates> {
  return getJson(baseUrl, proposedLinkCandidatesPath(clusterId), timeoutMs, linkCandidatesSchema);
}

/** How a Graph Service failure is shown to an API caller. */
export function graphErrorToUserError(e: unknown): unknown {
  if (!(e instanceof GraphServiceError)) return e;
  return new UserError(e.message, e.kind === "timeout" ? 504 : 502);
}
