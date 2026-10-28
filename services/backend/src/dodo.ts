// POST /webhooks/dodo: receiver for Dodo Payments (test mode) webhooks, which follow the Standard Webhooks scheme.
// Source: https://docs.dodopayments.com/developer-resources/webhooks (headers webhook-id, webhook-timestamp, webhook-signature;
// signed content "{id}.{timestamp}.{raw body}"; HMAC-SHA256, base64; "v1,<sig>" entries separated by spaces; any may match).
// The real Dodo account and a live delivery have NOT been run: only locally signed payloads (dodo-selftest).
import { createHmac, timingSafeEqual } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { Db } from "./db.js";
import { UserError } from "./errors.js";

const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;
const MAX_SIGNATURE_HEADER = 4096;
const ID_SHAPE = /^[A-Za-z0-9_.:-]{1,128}$/;
const EVENT_TYPE_SHAPE = /^[A-Za-z0-9._-]{1,100}$/;

/** The signing key: the secret with an optional "whsec_" prefix removed, then base64-decoded. Throws if it is not valid base64. */
export function parseWebhookSecret(secret: string): Buffer {
  const raw = secret.startsWith("whsec_") ? secret.slice("whsec_".length) : secret;
  if (raw.length === 0 || raw.length % 4 !== 0 || !BASE64.test(raw)) {
    throw new Error("the webhook secret must be whsec_ followed by base64");
  }
  return Buffer.from(raw, "base64");
}

export type VerifyInput = {
  key: Buffer;
  id: string;
  /** the webhook-timestamp header: Unix seconds, as text */
  timestamp: string;
  /** the webhook-signature header: one or more space-separated "v1,<base64>" entries */
  signatureHeader: string;
  /** the body exactly as received, before any parsing */
  body: string;
  toleranceSeconds: number;
  nowSeconds: number;
};

/**
 * True only if the timestamp is within the tolerance and at least one "v1" signature matches. Every entry is checked with a
 * constant-time comparison and there is no early exit, so timing does not reveal which entry (or how much of it) was right.
 * It answers yes or no only: the caller never learns why a request failed.
 */
export function verifyStandardWebhook(input: VerifyInput): boolean {
  const { key, id, timestamp, signatureHeader, body, toleranceSeconds, nowSeconds } = input;
  if (!/^\d{1,12}$/.test(timestamp)) return false;
  if (Math.abs(nowSeconds - Number(timestamp)) > toleranceSeconds) return false;
  if (signatureHeader.length === 0 || signatureHeader.length > MAX_SIGNATURE_HEADER) return false;

  const expected = createHmac("sha256", key).update(`${id}.${timestamp}.${body}`).digest();
  let matched = false;
  for (const entry of signatureHeader.split(" ")) {
    const comma = entry.indexOf(",");
    if (comma < 0 || entry.slice(0, comma) !== "v1") continue;
    const encoded = entry.slice(comma + 1);
    if (!BASE64.test(encoded)) continue;
    const candidate = Buffer.from(encoded, "base64");
    if (candidate.length === expected.length && timingSafeEqual(candidate, expected)) matched = true;
  }
  return matched;
}

export type DodoRouteDeps = {
  db: Db;
  /** From DODO_WEBHOOK_SECRET and DODO_WEBHOOK_TOLERANCE_SECONDS. With no secret the route answers 503 and nothing else is affected. */
  config: { secret: string | undefined; toleranceSeconds: number | undefined };
  nowSeconds?: () => number;
};

const UNAUTHORIZED = { error: "unauthorized" };

export function registerDodoRoute(app: FastifyInstance, deps: DodoRouteDeps) {
  const key = deps.config.secret ? parseWebhookSecret(deps.config.secret) : null;
  const now = deps.nowSeconds ?? (() => Math.floor(Date.now() / 1000));

  // The route lives in its own encapsulated scope so the raw-body parser below applies to this route only.
  app.register(async (scope) => {
    // Keep the body as the exact string that was received: the signature covers those bytes, not a re-serialised object.
    scope.addContentTypeParser("application/json", { parseAs: "string" }, (_req, body, done) => done(null, body));

    scope.post("/webhooks/dodo", async (req, reply) => {
      if (key === null || deps.config.toleranceSeconds === undefined) {
        throw new UserError(
          "DODO_WEBHOOK_SECRET is not set, so Dodo webhooks cannot be verified. Set DODO_WEBHOOK_SECRET and DODO_WEBHOOK_TOLERANCE_SECONDS in .env.",
          503,
        );
      }
      const header = (name: string) => (typeof req.headers[name] === "string" ? (req.headers[name] as string) : undefined);
      const id = header("webhook-id");
      const timestamp = header("webhook-timestamp");
      const signatureHeader = header("webhook-signature");
      const body = typeof req.body === "string" ? req.body : undefined;

      const verified =
        id !== undefined && timestamp !== undefined && signatureHeader !== undefined && body !== undefined && ID_SHAPE.test(id) &&
        verifyStandardWebhook({ key, id, timestamp, signatureHeader, body, toleranceSeconds: deps.config.toleranceSeconds, nowSeconds: now() });
      if (!verified) {
        // no reason, no header, no body in the log or the response
        req.log.warn("dodo webhook rejected");
        return reply.code(401).send(UNAUTHORIZED);
      }

      // Only the event type is read from the payload. Nothing else from it is kept.
      let type = "unknown";
      try {
        const parsed = JSON.parse(body as string) as { type?: unknown };
        if (typeof parsed.type === "string" && EVENT_TYPE_SHAPE.test(parsed.type)) type = parsed.type;
      } catch {
        /* a verified event whose body is not JSON is still acknowledged, so Dodo does not retry it */
      }
      const isNew = deps.db.recordWebhookEvent(id as string, type, new Date(now() * 1000).toISOString());
      return isNew ? { received: true } : { received: true, duplicate: true };
    });
  });
}
