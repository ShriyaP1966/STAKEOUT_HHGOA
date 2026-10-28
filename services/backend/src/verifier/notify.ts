// Optional notifier: POSTs each logged decision to a webhook (for viaSocket). Off unless NOTIFY_WEBHOOK_URL is set.
// The payload format below is UNVERIFIED against viaSocket: it is plain JSON with the public facts only.
import type { Redactor } from "../redact.js";

/** The only fields ever sent. Deliberately no reason, inputs, complaint text, evidence or cluster data. */
export type NotifyPayload = {
  id: number;
  kind: string;
  outcome: string;
  target: string;
  txHash: string | null;
  rule: string;
};

export interface Notifier {
  /** Fire and forget. Never throws and never waits for the webhook. */
  notify(decision: NotifyPayload): void;
  /** Resolves when every request already started has finished (used by tests and at shutdown). */
  flush(): Promise<void>;
}

const OFF: Notifier = { notify() {}, flush: async () => {} };

export function makeNotifier(cfg: { url?: string; timeoutMs?: number }, redact: Redactor, warn: (message: string) => void): Notifier {
  if (!cfg.url) return OFF;
  const { url } = cfg;
  if (cfg.timeoutMs === undefined) throw new Error("NOTIFY_TIMEOUT_MS is required when NOTIFY_WEBHOOK_URL is set.");
  const timeoutMs = cfg.timeoutMs;
  const pending = new Set<Promise<void>>();

  async function send(body: string) {
    let res: Response;
    try {
      res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body, signal: AbortSignal.timeout(timeoutMs) });
    } catch (e) {
      if ((e as Error).name === "TimeoutError") throw new Error(`the webhook did not answer within ${timeoutMs} ms (NOTIFY_TIMEOUT_MS)`);
      throw new Error(`could not reach the webhook (${(e as Error).message})`);
    }
    await res.text().catch(() => undefined);
    if (!res.ok) throw new Error(`the webhook answered HTTP ${res.status}`);
  }

  return {
    notify(d) {
      try {
        // built field by field, so nothing else can ride along
        const body = JSON.stringify({ id: d.id, kind: d.kind, outcome: d.outcome, target: d.target, txHash: d.txHash, rule: d.rule });
        const p: Promise<void> = send(body)
          .catch((e) => warn(redact(`decision webhook failed: ${(e as Error).message}`)))
          .finally(() => pending.delete(p));
        pending.add(p);
      } catch (e) {
        warn(redact(`decision webhook failed: ${(e as Error).message}`));
      }
    },
    flush: async () => void (await Promise.allSettled([...pending])),
  };
}
