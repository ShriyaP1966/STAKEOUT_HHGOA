// Optional notifier: POSTs each logged decision to a webhook (for viaSocket). Off unless NOTIFY_WEBHOOK_URL is set.
// The payload format below is UNVERIFIED against viaSocket: it is plain JSON with the public facts only.
import type { Redactor } from "../redact.js";

/** The only fields ever sent. Deliberately no reason, inputs, complaint text, evidence or cluster data. */
export type NotifyPayload = {
  /** the decision log row id; a text label for the sample sent by `npm run notify-test` */
  id: number | string;
  kind: string;
  outcome: string;
  target: string;
  txHash: string | null;
  rule: string;
};

/** What one delivery attempt came to. Deliberately no URL, response body or message: only these facts. */
export type NotifyResult = { ok: boolean; status?: number; elapsedMs: number };

export interface Notifier {
  /** Fire and forget. Never throws and never waits for the webhook. */
  notify(decision: NotifyPayload): void;
  /** Resolves when every request already started has finished (used by tests and at shutdown). */
  flush(): Promise<void>;
}

const OFF: Notifier = { notify() {}, flush: async () => {} };

/** A failed delivery. `status` is set only when the webhook answered with a non-2xx HTTP status. */
class DeliveryError extends Error {
  constructor(message: string, public readonly status?: number) {
    super(message);
  }
}

/**
 * `onResult` (optional) is told how each delivery went: ok, the HTTP status when there was one, and the elapsed milliseconds.
 * It never receives the URL or any response text. If it throws, that is reported and the notifier carries on.
 */
export function makeNotifier(
  cfg: { url?: string; timeoutMs?: number },
  redact: Redactor,
  warn: (message: string) => void,
  onResult?: (result: NotifyResult) => void,
): Notifier {
  if (!cfg.url) return OFF;
  const { url } = cfg;
  if (cfg.timeoutMs === undefined) throw new Error("NOTIFY_TIMEOUT_MS is required when NOTIFY_WEBHOOK_URL is set.");
  const timeoutMs = cfg.timeoutMs;
  const pending = new Set<Promise<void>>();

  /** Resolves with the HTTP status of a 2xx answer; throws DeliveryError otherwise. The answer's body is read and thrown away. */
  async function send(body: string): Promise<number> {
    let res: Response;
    try {
      res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body, signal: AbortSignal.timeout(timeoutMs) });
    } catch (e) {
      if ((e as Error).name === "TimeoutError") throw new DeliveryError(`the webhook did not answer within ${timeoutMs} ms (NOTIFY_TIMEOUT_MS)`);
      throw new DeliveryError(`could not reach the webhook (${(e as Error).message})`);
    }
    await res.text().catch(() => undefined);
    if (!res.ok) throw new DeliveryError(`the webhook answered HTTP ${res.status}`, res.status);
    return res.status;
  }

  const report = (result: NotifyResult) => {
    try {
      onResult?.(result);
    } catch (e) {
      warn(redact(`decision webhook result hook failed: ${(e as Error).message}`));
    }
  };

  return {
    notify(d) {
      try {
        // built field by field, so nothing else can ride along
        const body = JSON.stringify({ id: d.id, kind: d.kind, outcome: d.outcome, target: d.target, txHash: d.txHash, rule: d.rule });
        const started = Date.now();
        const p: Promise<void> = send(body)
          .then(
            (status) => report({ ok: true, status, elapsedMs: Date.now() - started }),
            (e) => {
              warn(redact(`decision webhook failed: ${(e as Error).message}`));
              const status = e instanceof DeliveryError ? e.status : undefined;
              report({ ok: false, ...(status !== undefined ? { status } : {}), elapsedMs: Date.now() - started });
            },
          )
          .finally(() => pending.delete(p));
        pending.add(p);
      } catch (e) {
        warn(redact(`decision webhook failed: ${(e as Error).message}`));
      }
    },
    flush: async () => void (await Promise.allSettled([...pending])),
  };
}
