import type { FastifyInstance } from "fastify";
import OpenAI from "openai";
import type { Redactor } from "./redact.js";

/** An error whose message is safe and meant to be shown to the person who made the request. */
export class UserError extends Error {
  constructor(
    message: string,
    public status = 400,
    public details?: Record<string, unknown>,
    public headers?: Record<string, string>,
  ) {
    super(message);
  }
}

export { makeRedactor } from "./redact.js";
export type { Redactor } from "./redact.js";

export type HttpError = { status: number; body: Record<string, unknown>; headers?: Record<string, string>; log: boolean };

/** One place that decides what a failed request looks like to the outside. */
export function toHttpError(err: Error & { statusCode?: number }, redact: Redactor): HttpError {
  if (err instanceof UserError) {
    return { status: err.status, body: { error: redact(err.message), ...err.details }, headers: err.headers, log: false };
  }
  if (err instanceof OpenAI.APIError) {
    // Provider messages can echo parts of the key, so the client only gets the status. The HTTP status stays 500 as before.
    const status = err.status;
    return { status: 500, body: { error: `The AI provider returned an error${status ? ` (HTTP ${status})` : ""}.` }, log: true };
  }
  return { status: err.statusCode ?? 500, body: { error: redact(err.message) }, log: true };
}

export function installErrorHandler(app: FastifyInstance, redact: Redactor) {
  app.setErrorHandler((err: Error & { statusCode?: number }, _req, reply) => {
    const out = toHttpError(err, redact);
    // Log only a name and a redacted message: never the error object (it can carry headers) and never request data.
    if (out.log) app.log.error({ errorName: err.name, status: out.status }, redact(err.message));
    for (const [k, v] of Object.entries(out.headers ?? {})) reply.header(k, v);
    return reply.status(out.status).send(out.body);
  });
}
