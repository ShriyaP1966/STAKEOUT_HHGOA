import OpenAI from "openai";
import { getAddress, isAddress } from "ethers";
import { z } from "zod";
import type { llmEnv } from "./config.js";

export class UserError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

const llmComplaint = z.object({
  targetAddress: z.string().nullable(),
  amount: z.number().positive().nullable(),
  currency: z.string().min(1).nullable(),
  occurredAt: z.iso.datetime({ offset: true }).nullable(),
  narrative: z.string().min(1).nullable(),
});

export type Complaint = {
  targetAddress: string; // EIP-55 checksummed
  amount: number;
  currency: string;
  occurredAt: string;
  narrative: string;
};

const ADDRESS_LIKE = /0x[0-9a-fA-F]{20,}/g;

export function makeLlm(env: z.infer<typeof llmEnv>) {
  return { client: new OpenAI({ apiKey: env.LLM_API_KEY, baseURL: env.LLM_BASE_URL }), model: env.LLM_MODEL };
}
export type Llm = ReturnType<typeof makeLlm>;

export async function extractComplaint(llm: Llm, text: string, now = new Date()): Promise<Complaint> {
  const res = await llm.client.chat.completions.create({
    model: llm.model,
    temperature: 0,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content:
          "Extract a scam complaint into JSON with keys: targetAddress (the wallet address the victim " +
          "says received the money or scammed them, copied exactly as written), amount (number), " +
          "currency (string), occurredAt (ISO 8601 with timezone; resolve relative times against the " +
          `current time ${now.toISOString()}), narrative (one neutral sentence). ` +
          "Use null for anything not stated. Never invent or correct an address. Output JSON only.",
      },
      { role: "user", content: text },
    ],
  });

  const content = res.choices[0]?.message?.content;
  if (!content) throw new UserError("The AI returned an empty answer. Try again.", 502);
  let json: unknown;
  try {
    json = JSON.parse(content);
  } catch {
    throw new UserError("The AI returned something that is not JSON. Try again.", 502);
  }
  const parsed = llmComplaint.safeParse(json);
  if (!parsed.success) throw new UserError("The AI answer did not match the expected shape. Try again.", 502);

  return validateComplaint(parsed.data, text);
}

/** Pure code checks. The LLM is never trusted for address validity. */
export function validateComplaint(c: z.infer<typeof llmComplaint>, originalText: string): Complaint {
  const missing = (["targetAddress", "amount", "currency", "occurredAt", "narrative"] as const).filter((k) => c[k] === null);
  if (missing.length) throw new UserError(`Complaint is missing: ${missing.join(", ")}. Please add these details.`);

  const addr = c.targetAddress!;
  if (!isAddress(addr)) {
    throw new UserError(`"${addr}" is not a valid wallet address (expected 0x followed by 40 hex characters, with a correct checksum if mixed case).`);
  }
  const inText = (originalText.match(ADDRESS_LIKE) ?? []).map((a) => a.toLowerCase());
  if (!inText.includes(addr.toLowerCase())) {
    throw new UserError("The address found by the AI does not appear in your text. Please paste the address again.");
  }
  return {
    targetAddress: getAddress(addr),
    amount: c.amount!,
    currency: c.currency!,
    occurredAt: c.occurredAt!,
    narrative: c.narrative!,
  };
}
