// Self-test for LLM resilience in /extract. Uses STUB providers and a fake clock: no network, no real LLM calls.
// Usage: npm run llm-selftest
import Fastify from "fastify";
import OpenAI from "openai";
import { Wallet } from "ethers";
import { installErrorHandler, makeRedactor, UserError } from "../errors.js";
import { extractComplaint } from "../extract.js";
import { LlmBusyError, withRetries, type Llm, type RetryConfig } from "../llm.js";

let failed = false;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}: ${name}${detail ? ` (${detail})` : ""}`);
  if (!ok) failed = true;
};

const hdr = (h: Record<string, string>) => new Headers(h);
const rateLimited = (h: Record<string, string> = {}) => OpenAI.APIError.generate(429, { message: "slow down" }, "429 slow down", hdr(h));
const serverError = (status = 503) => OpenAI.APIError.generate(status, { message: "overloaded" }, `${status} overloaded`, hdr({}));
const badRequest = () => OpenAI.APIError.generate(400, { message: "bad request" }, "400 bad request", hdr({}));

/** A provider that fails with the given errors in order, then returns `ok`. */
function stub(errors: unknown[], ok = "ok") {
  const state = { calls: 0 };
  return {
    state,
    send: async () => {
      const err = errors[state.calls++];
      if (err) throw err;
      return ok;
    },
  };
}
const fakeClock = () => {
  const sleeps: number[] = [];
  return { sleeps, sleep: async (ms: number) => void sleeps.push(ms) };
};
const cfg = (maxRetries: number, maxWaitSeconds: number): RetryConfig => ({ maxRetries, maxWaitSeconds });

async function retries() {
  console.log("\n## retry layer (stub provider, fake clock)");

  let p = stub([rateLimited({ "retry-after": "2" })]), clock = fakeClock();
  let out = await withRetries(p.send, cfg(2, 20), { sleep: clock.sleep });
  check("429 then success: retried once and returned the answer", out === "ok" && p.state.calls === 2);
  check("retry-after: 2 is respected exactly (waited 2000 ms)", clock.sleeps.length === 1 && clock.sleeps[0] === 2000, JSON.stringify(clock.sleeps));

  p = stub([rateLimited({ "retry-after-ms": "1500" })]); clock = fakeClock();
  await withRetries(p.send, cfg(2, 20), { sleep: clock.sleep });
  check("retry-after-ms is respected (1500 ms)", clock.sleeps[0] === 1500, JSON.stringify(clock.sleeps));

  p = stub([serverError(503), new OpenAI.APIConnectionTimeoutError()]); clock = fakeClock();
  out = await withRetries(p.send, cfg(3, 20), { sleep: clock.sleep });
  check("5xx then timeout then success: retried twice with backoff 1 s then 2 s", out === "ok" && p.state.calls === 3 && JSON.stringify(clock.sleeps) === "[1000,2000]", JSON.stringify(clock.sleeps));

  p = stub([rateLimited(), rateLimited(), rateLimited(), rateLimited()]); clock = fakeClock();
  let err: unknown;
  try { await withRetries(p.send, cfg(2, 20), { sleep: clock.sleep }); } catch (e) { err = e; }
  check("retries exhausted: gives up after maxRetries + 1 calls", p.state.calls === 3 && err instanceof LlmBusyError, `calls ${p.state.calls}`);
  check("retries exhausted: error is a 429 that carries Retry-After", err instanceof LlmBusyError && err.status === 429 && Number(err.headers?.["retry-after"]) >= 1, JSON.stringify((err as UserError).headers));

  p = stub([rateLimited({ "retry-after": "3600" })]); clock = fakeClock();
  err = undefined;
  try { await withRetries(p.send, cfg(5, 20), { sleep: clock.sleep }); } catch (e) { err = e; }
  check("provider asks for longer than the max wait: no waiting, gives up at once", p.state.calls === 1 && clock.sleeps.length === 0 && err instanceof LlmBusyError);
  check("...and tells the caller the provider's own wait (3600 s)", err instanceof LlmBusyError && err.headers?.["retry-after"] === "3600");

  p = stub([rateLimited()]); clock = fakeClock();
  err = undefined;
  try { await withRetries(p.send, cfg(0, 20), { sleep: clock.sleep }); } catch (e) { err = e; }
  check("maxRetries 0: first 429 is final", p.state.calls === 1 && err instanceof LlmBusyError);

  p = stub([badRequest()]); clock = fakeClock();
  err = undefined;
  try { await withRetries(p.send, cfg(3, 20), { sleep: clock.sleep }); } catch (e) { err = e; }
  check("non-retryable provider 400: thrown unchanged, one call, no waiting", p.state.calls === 1 && clock.sleeps.length === 0 && err instanceof OpenAI.APIError && !(err instanceof LlmBusyError));

  p = stub([new TypeError("a bug in our own code")]); clock = fakeClock();
  err = undefined;
  try { await withRetries(p.send, cfg(3, 20), { sleep: clock.sleep }); } catch (e) { err = e; }
  check("a programming error is never retried", p.state.calls === 1 && err instanceof TypeError);

  p = stub([serverError(500)]); clock = fakeClock();
  const events: Array<{ attempt: number; reason: string; waitSeconds: number }> = [];
  await withRetries(p.send, cfg(2, 20), { sleep: clock.sleep, onRetry: (e) => events.push(e) });
  check("retry event carries only attempt, reason and wait", events.length === 1 && JSON.stringify(Object.keys(events[0]).sort()) === '["attempt","reason","waitSeconds"]', JSON.stringify(events[0]));
}

const goodJson = (address: string) => JSON.stringify({ amount: 5000, currency: "USDT", occurredAt: "2026-10-27T15:00:00Z", narrative: "sent funds" }) + address.slice(0, 0);

async function http() {
  console.log("\n## HTTP behaviour of /extract (Fastify inject, stub provider)");
  const address = Wallet.createRandom().address;
  const secretKey = "fake-api-key-" + Wallet.createRandom().address.slice(2, 14);
  const text = `I sent 5000 USDT yesterday at 3pm to ${address} and they vanished.`;
  const run = async (llm: Llm) => {
    const app = Fastify();
    installErrorHandler(app, makeRedactor([secretKey]));
    app.post("/extract", async () => ({ complaint: await extractComplaint(llm, text, undefined, "UTC") }));
    const res = await app.inject({ method: "POST", url: "/extract", payload: {} });
    await app.close();
    return { status: res.statusCode, body: res.body, headers: res.headers };
  };

  let r = await run({ model: "stub", complete: async () => goodJson(address) });
  check("working provider: 200 with the complaint and the code-chosen address", r.status === 200 && r.body.includes(address));

  r = await run({ model: "stub", complete: () => withRetries(stub([rateLimited(), rateLimited(), rateLimited()]).send, cfg(1, 20), { sleep: async () => {} }) });
  check("rate limit that outlasts the retries: HTTP 429", r.status === 429, `status ${r.status}`);
  check("...with a Retry-After header", Number(r.headers["retry-after"]) >= 1, `retry-after: ${r.headers["retry-after"]}`);
  check("...and a clear message", r.body.includes("busy or rate limited"), r.body);

  r = await run({ model: "stub", complete: () => withRetries(stub([rateLimited({ "retry-after": "7" })]).send, cfg(3, 20), { sleep: async () => {} }).then(() => goodJson(address)) });
  check("rate limit then success: the caller sees a normal 200", r.status === 200);

  r = await run({ model: "stub", complete: async () => { throw OpenAI.APIError.generate(400, { message: `bad request near key ${secretKey}` }, `400 bad request near key ${secretKey}`, hdr({ "x-secret": secretKey })); } });
  check("provider 400: same HTTP status as before (500), not turned into 429", r.status === 500, `status ${r.status}`);
  check("provider 400: the response does not contain the API key", !r.body.includes(secretKey), r.body);

  r = await run({ model: "stub", complete: async () => "" });
  check("empty answer: 502 as before", r.status === 502, r.body);
  r = await run({ model: "stub", complete: async () => "this is not json" });
  check("not JSON: 502 as before", r.status === 502, r.body);
  r = await run({ model: "stub", complete: async () => JSON.stringify({ amount: "lots" }) });
  check("wrong shape: 502 as before", r.status === 502, r.body);
}

await retries();
await http();
process.exitCode = failed ? 1 : 0;
console.log(failed ? "\nSOME CHECKS FAILED" : "\nall llm self-test checks passed");
