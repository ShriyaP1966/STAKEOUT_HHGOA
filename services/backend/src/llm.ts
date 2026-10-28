import OpenAI from "openai";
import type { z } from "zod";
import type { llmEnv } from "./config.js";
import { UserError } from "./errors.js";

export type ChatRequest = { system: string; user: string; json?: boolean; temperature?: number };

/** What the rest of the backend sees: send a prompt, get text back (or null if the provider returned none). */
export type Llm = { model: string; complete(req: ChatRequest): Promise<string | null> };

export type RetryConfig = { maxRetries: number; maxWaitSeconds: number };
export type RetryEvent = { attempt: number; reason: string; waitSeconds: number };

/** Still failing after the allowed retries because the provider is rate limiting or overloaded. */
export class LlmBusyError extends UserError {
  constructor(public readonly retryAfterSeconds: number) {
    super(
      `The AI service is busy or rate limited. Please try again in about ${retryAfterSeconds} second${retryAfterSeconds === 1 ? "" : "s"}.`,
      429,
      undefined,
      { "retry-after": String(retryAfterSeconds) },
    );
  }
}

type Classified = { retryable: boolean; reason: string; retryAfterSeconds?: number };

function headerOf(err: unknown, name: string): string | undefined {
  const headers = (err as { headers?: unknown }).headers as { get?: (n: string) => string | null } | Record<string, string> | undefined;
  if (!headers) return undefined;
  if (typeof (headers as { get?: unknown }).get === "function") return (headers as { get(n: string): string | null }).get(name) ?? undefined;
  return (headers as Record<string, string>)[name];
}

function retryAfterSeconds(err: unknown): number | undefined {
  const ms = Number(headerOf(err, "retry-after-ms"));
  if (Number.isFinite(ms) && ms > 0) return ms / 1000;
  const raw = headerOf(err, "retry-after");
  if (raw === undefined) return undefined;
  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds;
  const date = Date.parse(raw);
  return Number.isNaN(date) ? undefined : Math.max(0, (date - Date.now()) / 1000);
}

/** Retry only on rate limits (429), server errors (5xx) and timeouts or connection failures. Any other 4xx is final. */
export function classify(err: unknown): Classified {
  const status = (err as { status?: unknown }).status;
  if (typeof status === "number") {
    if (status === 429) return { retryable: true, reason: "rate limited (HTTP 429)", retryAfterSeconds: retryAfterSeconds(err) };
    if (status >= 500) return { retryable: true, reason: `provider error (HTTP ${status})`, retryAfterSeconds: retryAfterSeconds(err) };
    return { retryable: false, reason: `HTTP ${status}` };
  }
  // The SDK's error classes do not set `name`, so they are recognised by class, not by name.
  if (err instanceof OpenAI.APIConnectionTimeoutError) return { retryable: true, reason: "timeout" };
  if (err instanceof OpenAI.APIConnectionError) return { retryable: true, reason: "connection problem" };
  const name = (err as { name?: string }).name ?? "";
  if (name === "TimeoutError" || name === "AbortError") return { retryable: true, reason: "timeout" };
  return { retryable: false, reason: name || "unknown error" };
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Runs `send`, retrying a bounded number of times. The wait is the provider's retry-after when given, otherwise
 * 1, 2, 4... seconds; either way never longer than maxWaitSeconds. If the provider asks for longer than that, or the
 * retries run out, it stops and throws LlmBusyError carrying how long the caller should wait.
 */
export async function withRetries<T>(
  send: () => Promise<T>,
  cfg: RetryConfig,
  hooks: { sleep?: (ms: number) => Promise<void>; onRetry?: (e: RetryEvent) => void } = {},
): Promise<T> {
  const sleep = hooks.sleep ?? defaultSleep;
  for (let attempt = 0; ; attempt++) {
    try {
      return await send();
    } catch (err) {
      const c = classify(err);
      if (!c.retryable) throw err;
      const wanted = c.retryAfterSeconds ?? Math.min(2 ** attempt, cfg.maxWaitSeconds);
      if (attempt >= cfg.maxRetries || wanted > cfg.maxWaitSeconds) {
        throw new LlmBusyError(Math.max(1, Math.ceil(wanted)));
      }
      hooks.onRetry?.({ attempt: attempt + 1, reason: c.reason, waitSeconds: wanted });
      await sleep(wanted * 1000);
    }
  }
}

type Env = z.infer<typeof llmEnv>;

/** The real provider. The SDK's own retries are turned off so every retry goes through withRetries. */
export function makeLlm(env: Env, onRetry?: (e: RetryEvent) => void): Llm {
  const client = new OpenAI({ apiKey: env.LLM_API_KEY, baseURL: env.LLM_BASE_URL, maxRetries: 0, timeout: env.LLM_TIMEOUT_MS });
  const cfg: RetryConfig = { maxRetries: env.LLM_MAX_RETRIES, maxWaitSeconds: env.LLM_RETRY_MAX_WAIT_SECONDS };
  return {
    model: env.LLM_MODEL,
    complete: (req) =>
      withRetries(
        async () => {
          const res = await client.chat.completions.create({
            model: env.LLM_MODEL,
            temperature: req.temperature ?? 0,
            ...(req.json ? { response_format: { type: "json_object" as const } } : {}),
            messages: [
              { role: "system", content: req.system },
              { role: "user", content: req.user },
            ],
          });
          return res.choices[0]?.message?.content ?? null;
        },
        cfg,
        { onRetry },
      ),
  };
}
