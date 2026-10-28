import { canonicalize } from "../../../shared/hash/index.js";
import type { Llm } from "./extract.js";

const ADDRESS = /0x[0-9a-fA-F]{40}/g;
const NUMBER = /\d+(?:\.\d+)?/g;

type Facts = Record<string, unknown> & { members?: unknown[]; exitPoints?: unknown[]; signals?: unknown[] };

/** Numbers and addresses the summary is allowed to mention: exactly those present in the facts. */
function allowed(facts: Facts) {
  const text = canonicalize(facts);
  const addresses = new Set((text.match(ADDRESS) ?? []).map((a) => a.toLowerCase()));
  const numbers = new Set(text.replace(ADDRESS, " ").match(NUMBER) ?? []);
  for (const list of [facts.members, facts.exitPoints, facts.signals]) if (Array.isArray(list)) numbers.add(String(list.length));
  return { addresses, numbers };
}

/** Returns every number/address in the summary that is not in the facts. Empty = pass. */
export function findUnsupported(summary: string, facts: Facts): string[] {
  const ok = allowed(facts);
  const bad: string[] = [];
  for (const a of summary.match(ADDRESS) ?? []) if (!ok.addresses.has(a.toLowerCase())) bad.push(a);
  for (const n of summary.replace(ADDRESS, " ").match(NUMBER) ?? []) if (!ok.numbers.has(n)) bad.push(n);
  return bad;
}

/** Plain, non-AI fallback. Uses only values from the facts. */
export function templateSummary(f: Facts & { target: string; behaviorScore: number; unrelatedReporterCount: number; dataSource: string }): string {
  return (
    `Target ${f.target} has behavior score ${f.behaviorScore}. ` +
    `Members: ${f.members?.length ?? 0}, exit points: ${f.exitPoints?.length ?? 0}, ` +
    `unrelated reporters: ${f.unrelatedReporterCount}. Data source: ${f.dataSource}.`
  );
}

export type SummaryResult = { text: string; source: "llm" | "template" };

/** LLM summary of the facts; guard checks it; one retry; then template. The AI never decides confirmation. */
export async function buildSummary(
  llm: Llm,
  facts: Facts & { target: string; behaviorScore: number; unrelatedReporterCount: number; dataSource: string },
): Promise<SummaryResult> {
  let feedback = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await llm.client.chat.completions.create({
      model: llm.model,
      temperature: 0,
      messages: [
        {
          role: "system",
          content:
            "Write a 2-3 sentence plain-language explanation of this wallet analysis for a non-expert. " +
            "Use ONLY numbers and addresses that appear in the facts, copied exactly. Do not state a verdict " +
            "and do not say whether the wallet is confirmed; you only explain the evidence. " + feedback,
        },
        { role: "user", content: canonicalize(facts) },
      ],
    });
    const text = res.choices[0]?.message?.content?.trim();
    if (!text) continue;
    const bad = findUnsupported(text, facts);
    if (bad.length === 0) return { text, source: "llm" };
    feedback = `Your previous answer used values not in the facts (${bad.join(", ")}). Do not use them.`;
  }
  return { text: templateSummary(facts), source: "template" };
}
