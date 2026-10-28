import type { Db, Decision } from "../db.js";
import { log } from "./log.js";
import type { Notifier } from "./notify.js";

/**
 * The one way a decision is written. It is logged first; only then is the (optional) notifier told, and the notifier
 * can neither fail nor change what was logged. If it throws anyway, that is reported (redacted) and the decision stands:
 * an exception here would make the watcher retry the event and log the decision twice.
 */
export function recordDecision(db: Db, notifier: Notifier | undefined, d: Decision): number {
  const id = db.logDecision(d);
  try {
    notifier?.notify({ id, kind: d.kind, outcome: d.outcome, target: d.target, txHash: d.txHash, rule: d.rule });
  } catch (e) {
    log.warn(`decision notifier failed: ${(e as Error).message}`);
  }
  return id;
}
