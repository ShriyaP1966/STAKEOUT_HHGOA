import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { hashBundle } from "../../../shared/hash/index.js";
import type { Db } from "./db.js";
import { UserError } from "./errors.js";
import { extractComplaint } from "./extract.js";
import type { Llm } from "./llm.js";
import { parseTimeZone } from "./timezone.js";

export type ExtractRouteDeps = {
  llm: Llm;
  db: Db;
  dataSource: "synthetic" | "testnet";
  /** From DEFAULT_TIMEZONE in the config; used when the request does not name a zone. */
  defaultTimezone: string;
  now?: () => Date;
};

const extractBody = z.object({ text: z.string().trim().min(1).max(5000), targetAddress: z.string().optional() });

export function registerExtractRoute(app: FastifyInstance, deps: ExtractRouteDeps) {
  app.post("/extract", async (req) => {
    const body = extractBody.safeParse(req.body);
    if (!body.success) throw new UserError("Body must be {\"text\": \"<complaint, up to 5000 chars>\"}");

    // The zone is optional, but if the field is present it must be a valid IANA name (null, "" and numbers are rejected too).
    let timezone = deps.defaultTimezone;
    if (Object.hasOwn(req.body as object, "timezone")) {
      const parsed = parseTimeZone((req.body as Record<string, unknown>).timezone);
      if (parsed === null) {
        throw new UserError("timezone must be an IANA time zone name in Region/City form (or UTC), not a UTC offset.");
      }
      timezone = parsed;
    }

    const text = body.data.text;
    const complaint = await extractComplaint(deps.llm, text, body.data.targetAddress, timezone, deps.now?.());
    const record = { text, complaint, dataSource: deps.dataSource };
    const complaintHash = hashBundle(record);
    deps.db.saveEvidence(complaintHash, record);
    return { complaint, dataSource: deps.dataSource, text, complaintHash };
  });
}
