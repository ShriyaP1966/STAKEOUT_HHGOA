import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { BACKEND_PROXY_PATH } from "./backend-path";
import { BackendError, callBackend, describeBackendFailure } from "./backend";

function respond(status: number, body: string) {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(body, { status, headers: { "content-type": "application/json" } })));
}

async function failureOf(promise: Promise<unknown>): Promise<BackendError> {
  const error = await promise.then(
    () => undefined,
    (reason: unknown) => reason,
  );
  expect(error).toBeInstanceOf(BackendError);
  return error as BackendError;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("describeBackendFailure", () => {
  it("shows the backend's own message for 400 and 404", () => {
    expect(describeBackendFailure(400, { error: "Complaint is missing: amount." })).toEqual({
      title: "Please check your input",
      detail: "Complaint is missing: amount.",
    });
    expect(describeBackendFailure(404, { error: "No evidence stored for that hash" }).title).toBe("Not found");
  });

  it("explains rate limiting and unusable AI answers", () => {
    expect(describeBackendFailure(429, { error: "Rate limit exceeded" }).title).toBe("Too many requests");
    const unusable = describeBackendFailure(502, { error: "The AI returned an empty answer. Try again." });
    expect(unusable.title).toBe("The AI gave an unusable answer");
    expect(unusable.detail).toContain("The AI returned an empty answer.");
  });

  it("treats a missing or non-JSON body as an unreachable backend", () => {
    expect(describeBackendFailure(null, undefined).title).toBe("Backend unreachable");
    expect(describeBackendFailure(500, "Internal Server Error").title).toBe("Backend unreachable");
  });

  it("keeps the status for other errors", () => {
    expect(describeBackendFailure(500, { error: "boom" })).toEqual({ title: "Backend error (500)", detail: "boom" });
  });
});

describe("callBackend", () => {
  const schema = z.object({ ok: z.literal(true), dataSource: z.enum(["synthetic", "testnet"]) });

  it("calls the same-origin proxy path and returns the parsed body", async () => {
    respond(200, JSON.stringify({ ok: true, dataSource: "synthetic" }));
    await expect(callBackend("/health", schema)).resolves.toEqual({ ok: true, dataSource: "synthetic" });
    expect(vi.mocked(fetch).mock.calls[0][0]).toBe(`${BACKEND_PROXY_PATH}/health`);
  });

  it("maps 400, 429 and 502 responses", async () => {
    for (const [status, title] of [
      [400, "Please check your input"],
      [429, "Too many requests"],
      [502, "The AI gave an unusable answer"],
    ] as const) {
      respond(status, JSON.stringify({ error: "message from the backend" }));
      const error = await failureOf(callBackend("/extract", schema));
      expect(error.status).toBe(status);
      expect(error.decoded.title).toBe(title);
    }
  });

  it("reports an unreachable backend when fetch fails or the proxy returns HTML", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new TypeError("fetch failed");
    }));
    expect((await failureOf(callBackend("/health", schema))).decoded.title).toBe("Backend unreachable");
    respond(500, "<html>Internal Server Error</html>");
    expect((await failureOf(callBackend("/health", schema))).decoded.title).toBe("Backend unreachable");
  });

  it("rejects a 200 response with an unexpected shape instead of showing it", async () => {
    respond(200, JSON.stringify({ ok: true }));
    const error = await failureOf(callBackend("/health", schema));
    expect(error.decoded.title).toBe("Unexpected backend response");
    expect(error.decoded.detail).toContain("dataSource");
  });
});
