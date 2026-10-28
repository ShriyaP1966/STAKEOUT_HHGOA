import type { Rules } from "../config.js";
import { NOT_IMPLEMENTED_MESSAGE, NotImplementedError } from "./errors.js";
import type { PromotedEvent } from "./contractClient.js";

/** What the (future) decision logic hands to the chain layer. The AI never produces one of these. */
export type DecisionPlan =
  | { action: "confirm"; clusterId: string; members: string[]; exitPoints: string[]; evidenceHash: string; rule: string; inputs: unknown }
  | { action: "link"; target: string; clusterId: string; evidenceHash: string; rule: string; inputs: unknown }
  | { action: "refuse"; kind: "confirm" | "link"; rule: string; reason: string; inputs: unknown; evidenceHash: string | null };

export type DecideDeps = {
  rules: Rules;
  graphServiceUrl: string;
  graphTimeoutMs: number;
};

/**
 * The real decision (graph behavior score against rules.json) belongs here and is deliberately not written yet:
 * it needs Person 1's agreed analysis schema and the agreed config/rules.json. Until then the verifier
 * decides nothing real; it stops at the first live flag it has to judge.
 */
export async function decide(_deps: DecideDeps, _event: PromotedEvent): Promise<DecisionPlan> {
  throw new NotImplementedError(NOT_IMPLEMENTED_MESSAGE);
}
