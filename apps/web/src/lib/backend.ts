import { getAddress, isAddress, type Address, type Hex } from "viem";
import { z } from "zod";
import { BACKEND_PROXY_PATH } from "./backend-path";
import type { DecodedError } from "./errors";
import { viewerTimeZone } from "./timezone";

const dataSource = z.enum(["synthetic", "testnet"]);
const bytes32 = z.string().regex(/^0x[0-9a-fA-F]{64}$/, "must be 0x followed by 64 hex characters") as unknown as z.ZodType<Hex>;
export const extractResponseSchema = z.object({
  complaint: z.looseObject({
    targetAddress: z.string().refine((value) => isAddress(value), "must be a valid address"),
    amount: z.number(),
    currency: z.string(),
    occurredAt: z.string(),
    narrative: z.string(),
  }),
  dataSource,
  text: z.string(),
  complaintHash: bytes32,
});

export const evidenceResponseSchema = z.object({ hash: bytes32, bundle: z.unknown() });

export const bundleSummarySchema = z.looseObject({
  aiSummary: z.object({ text: z.string(), source: z.enum(["llm", "template"]) }),
  dataSource,
});

export const decisionsResponseSchema = z.object({
  decisions: z.array(
    z.looseObject({
      id: z.number(),
      target: z.string(),
      kind: z.enum(["confirm", "link"]),
      outcome: z.enum(["sent", "refused", "skipped"]),
      rule: z.string(),
      reason: z.string(),
      tx_hash: z.string().nullable(),
      evidence_hash: z.string().nullable(),
      created_at: z.string(),
    }),
  ),
  dataSource,
});

export class BackendError extends Error {
  constructor(
    readonly status: number | null,
    readonly decoded: DecodedError,
    readonly body: unknown = undefined,
  ) {
    super(decoded.detail);
    this.name = "BackendError";
  }
}

function errorMessageOf(body: unknown): string | undefined {
  if (typeof body === "object" && body !== null && "error" in body && typeof body.error === "string" && body.error.trim()) {
    return body.error;
  }
  return undefined;
}

export function describeBackendFailure(status: number | null, body: unknown): DecodedError {
  const message = errorMessageOf(body);
  if (status === null || message === undefined) {
    return {
      title: "Backend unreachable",
      detail:
        status === null
          ? "The backend did not answer. It may be offline; try again in a few minutes."
          : `The backend did not answer (HTTP ${status}). It may be offline; try again in a few minutes.`,
    };
  }
  if (status === 400) return { title: "Please check your input", detail: message };
  if (status === 404) return { title: "Not found", detail: message };
  if (status === 422) return { title: "Choose the receiving address", detail: message };
  if (status === 429) {
    return { title: "Too many requests", detail: "The backend is rate limiting requests. Wait a minute and try again." };
  }
  if (status === 502) return { title: "The AI gave an unusable answer", detail: `${message} Please try again.` };
  return { title: `Backend error (${status})`, detail: message };
}

export async function callBackend<T>(path: string, schema: z.ZodType<T>, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${BACKEND_PROXY_PATH}${path}`, init);
  } catch {
    throw new BackendError(null, describeBackendFailure(null, undefined));
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new BackendError(response.status, describeBackendFailure(response.status, undefined));
  }
  if (!response.ok) throw new BackendError(response.status, describeBackendFailure(response.status, body), body);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new BackendError(response.status, {
      title: "Unexpected backend response",
      detail: `The backend answered with a shape this app does not expect: ${parsed.error.issues.map((issue) => issue.path.join(".") || "(root)").join(", ")}.`,
    });
  }
  return parsed.data;
}

const candidatesSchema = z.object({ candidates: z.array(z.string()) });

export function candidatesOf(error: unknown): Address[] {
  if (!(error instanceof BackendError) || (error.status !== 400 && error.status !== 422)) return [];
  const parsed = candidatesSchema.safeParse(error.body);
  if (!parsed.success) return [];
  return parsed.data.candidates.filter((candidate) => isAddress(candidate)).map((candidate) => getAddress(candidate));
}

export const REPORTING_DISABLED: DecodedError = {
  title: "Reporting is disabled on this read-only demo",
  detail:
    "This site is connected to a read-only backend, which does not read complaints. Checking addresses, verifying evidence and the dashboard still work. Reporting needs the full backend running locally; see the README.",
};

export const backend = {
  extract: (text: string, targetAddress?: Address) => {
    const timezone = viewerTimeZone();
    return callBackend("/extract", extractResponseSchema, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(targetAddress === undefined ? { text, timezone } : { text, targetAddress, timezone }),
    }).catch((error: unknown) => {
      if (error instanceof BackendError && error.status === 404) throw new BackendError(404, REPORTING_DISABLED, error.body);
      throw error;
    });
  },
  evidence: (hash: Hex) => callBackend(`/evidence/${hash}`, evidenceResponseSchema),
  decisions: () => callBackend("/decisions", decisionsResponseSchema),
};
