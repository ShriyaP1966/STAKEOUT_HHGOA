import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

export type Decision = {
  target: string;
  kind: "confirm" | "link";
  outcome: "sent" | "refused" | "skipped";
  rule: string;
  reason: string;
  inputs: unknown;
  txHash: string | null;
  evidenceHash: string | null;
};

export function openDb(path: string) {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS evidence (hash TEXT PRIMARY KEY, bundle TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS decisions (
      id INTEGER PRIMARY KEY AUTOINCREMENT, target TEXT NOT NULL, kind TEXT NOT NULL, outcome TEXT NOT NULL,
      rule TEXT NOT NULL, reason TEXT NOT NULL, inputs TEXT NOT NULL, tx_hash TEXT, evidence_hash TEXT, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    -- Dodo webhooks already received. Only the id, the event type and the time are kept: never the payload or any customer data.
    CREATE TABLE IF NOT EXISTS webhook_events (webhook_id TEXT PRIMARY KEY, event_type TEXT NOT NULL, received_at TEXT NOT NULL);
    -- one row per chain event already handled; makes restarts idempotent
    CREATE TABLE IF NOT EXISTS handled_events (event_key TEXT PRIMARY KEY, handled_at TEXT NOT NULL);
  `);

  const q = {
    putEvidence: db.prepare("INSERT OR IGNORE INTO evidence (hash, bundle, created_at) VALUES (?, ?, ?)"),
    getEvidence: db.prepare("SELECT bundle FROM evidence WHERE hash = ?"),
    putDecision: db.prepare(
      "INSERT INTO decisions (target, kind, outcome, rule, reason, inputs, tx_hash, evidence_hash, created_at) VALUES (?,?,?,?,?,?,?,?,?)"),
    listDecisions: db.prepare("SELECT * FROM decisions ORDER BY id DESC LIMIT ?"),
    getKv: db.prepare("SELECT value FROM kv WHERE key = ?"),
    putKv: db.prepare("INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"),
    putWebhook: db.prepare("INSERT OR IGNORE INTO webhook_events (webhook_id, event_type, received_at) VALUES (?, ?, ?)"),
    hasEvent: db.prepare("SELECT 1 FROM handled_events WHERE event_key = ?"),
    markEvent: db.prepare("INSERT OR IGNORE INTO handled_events (event_key, handled_at) VALUES (?, ?)"),
  };

  return {
    close: () => db.close(),
    saveEvidence(hash: string, bundle: unknown) {
      q.putEvidence.run(hash, JSON.stringify(bundle), new Date().toISOString());
    },
    getEvidence(hash: string): unknown | null {
      const row = q.getEvidence.get(hash) as { bundle: string } | undefined;
      return row ? JSON.parse(row.bundle) : null;
    },
    logDecision(d: Decision): number {
      return Number(q.putDecision.run(d.target, d.kind, d.outcome, d.rule, d.reason, JSON.stringify(d.inputs), d.txHash, d.evidenceHash, new Date().toISOString()).lastInsertRowid);
    },
    listDecisions(limit: number) {
      return (q.listDecisions.all(limit) as Record<string, unknown>[]).map((r) => ({ ...r, inputs: JSON.parse(r.inputs as string) }));
    },
    getKv: (key: string) => (q.getKv.get(key) as { value: string } | undefined)?.value ?? null,
    setKv: (key: string, value: string) => void q.putKv.run(key, value),
    /** true if this webhook id was not seen before (and is now recorded); false for a duplicate */
    recordWebhookEvent: (id: string, eventType: string, receivedAt: string) => q.putWebhook.run(id, eventType, receivedAt).changes === 1,
    isEventHandled: (eventKey: string) => q.hasEvent.get(eventKey) !== undefined,
    /** true if this call is the first to claim the event (safe to act on it) */
    claimEvent: (eventKey: string) => q.markEvent.run(eventKey, new Date().toISOString()).changes === 1,
  };
}
export type Db = ReturnType<typeof openDb>;
