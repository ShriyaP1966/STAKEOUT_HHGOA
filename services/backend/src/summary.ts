import { canonicalize } from "../../../shared/hash/index.js";
import type { Llm } from "./llm.js";

// Any 0x-prefixed hex value (address, cluster id, hash) is compared WHOLE, so a longer id cannot pass on its first 40 characters.
const HEX = /0x[0-9a-fA-F]+/g;
const NUMBER = /\d+(?:\.\d+)?/g;

type Facts = Record<string, unknown> & { members?: unknown[]; exitPoints?: unknown[]; signals?: unknown[] };

/** Numbers and 0x values (addresses, ids) the summary is allowed to mention: exactly those present in the facts. */
function allowed(facts: Facts) {
  const text = canonicalize(facts);
  const hexValues = new Set((text.match(HEX) ?? []).map((a) => a.toLowerCase()));
  const numbers = new Set(text.replace(HEX, " ").match(NUMBER) ?? []);
  for (const list of [facts.members, facts.exitPoints, facts.signals]) if (Array.isArray(list)) numbers.add(String(list.length));
  return { hexValues, numbers };
}

/** Returns every number/address in the summary that is not in the facts. Empty = pass. */
export function findUnsupported(summary: string, facts: Facts): string[] {
  const ok = allowed(facts);
  const bad: string[] = [];
  for (const a of summary.match(HEX) ?? []) if (!ok.hexValues.has(a.toLowerCase())) bad.push(a);
  for (const n of summary.replace(HEX, " ").match(NUMBER) ?? []) if (!ok.numbers.has(n)) bad.push(n);
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
    const raw = await llm.complete({
      temperature: 0,
      system:
        "Write a 2-3 sentence plain-language explanation of this wallet analysis for a non-expert. " +
        "Use ONLY numbers and addresses that appear in the facts, copied exactly. Do not state a verdict " +
        "and do not say whether the wallet is confirmed; you only explain the evidence. " + feedback,
      user: canonicalize(facts),
    });
    const text = raw?.trim();
    if (!text) continue;
    const bad = findUnsupported(text, facts);
    if (bad.length === 0) return { text, source: "llm" };
    feedback = `Your previous answer used values not in the facts (${bad.join(", ")}). Do not use them.`;
  }
  return { text: templateSummary(facts), source: "template" };
}
