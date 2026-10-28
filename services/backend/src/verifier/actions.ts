import { ZeroAddress, isAddress } from "ethers";
import { Role } from "../../../../shared/enums.js";
import type { Db, Decision } from "../db.js";
import type { ChainReader, ChainWriter } from "./contractClient.js";
import type { DecisionPlan } from "./decide.js";
import type { Notifier } from "./notify.js";
import { recordDecision } from "./record.js";

export type Feasibility = { ok: true } | { ok: false; rule: string; reason: string };
const no = (rule: string, reason: string): Feasibility => ({ ok: false, rule, reason });

export type ConfirmRequest = { clusterId: string; members: string[]; exitPoints: string[] };

/** Checks, against the chain, that confirm would be accepted. These mirror the contract's own reverts so the log can say why. */
export async function checkConfirmFeasible(reader: ChainReader, req: ConfirmRequest): Promise<Feasibility> {
  const all = [...req.members, ...req.exitPoints];
  if (all.length === 0) return no("feasibility:no-addresses", "confirm needs at least one member or exit point");
  const invalid = all.find((a) => !isAddress(a) || a === ZeroAddress);
  if (invalid !== undefined) return no("feasibility:invalid-address", `"${invalid}" is not a usable address (invalid or the zero address)`);
  const lower = all.map((a) => a.toLowerCase());
  if (new Set(lower).size !== lower.length) return no("feasibility:duplicate-address", "the same address appears more than once in members and exit points");

  const max = await reader.maxMembersPerCall();
  if (all.length > max) {
    return no("feasibility:member-limit", `${all.length} addresses (members plus exit points) exceed the contract's maxMembersPerCall (${max})`);
  }
  for (const a of all) {
    if ((await reader.clusterRole(a)) !== Role.None) return no("feasibility:already-in-cluster", `${a} is already in a cluster`);
  }
  const flags = await Promise.all(req.members.map((m) => reader.liveFlag(m)));
  const challenged = flags.findIndex((f) => f?.live && f.challenged);
  if (challenged >= 0) return no("feasibility:member-flag-challenged", `the flag on member ${req.members[challenged]} is challenged; a reviewer must resolve it first`);
  if (!flags.some((f) => f?.live)) return no("feasibility:no-live-flag", "no member has a live flag, so the contract would reject confirm");
  return { ok: true };
}

export async function checkLinkFeasible(reader: ChainReader, req: { target: string; clusterId: string }): Promise<Feasibility> {
  if (!isAddress(req.target) || req.target === ZeroAddress) return no("feasibility:invalid-address", `"${req.target}" is not a usable address`);
  if (!(await reader.clusterExists(req.clusterId))) return no("feasibility:cluster-not-found", "that cluster does not exist on-chain yet, so link would be rejected");
  if ((await reader.clusterRole(req.target)) !== Role.None) return no("feasibility:already-in-cluster", `${req.target} is already in a cluster`);
  return { ok: true };
}

export type ActionDeps = { reader: ChainReader; writer: ChainWriter; db: Db; notifier?: Notifier };

const DRY_RUN_REASON = "dry run (VERIFIER_DRY_RUN=true): the contract call was simulated successfully; nothing was sent";

/** Turns a decision plan into a logged outcome. Only call this with a plan produced by real decision logic. */
export async function applyPlan({ reader, writer, db, notifier }: ActionDeps, target: string, plan: DecisionPlan): Promise<void> {
  const record = (d: Decision) => recordDecision(db, notifier, d);
  if (plan.action === "refuse") {
    record({ target, kind: plan.kind, outcome: "refused", rule: plan.rule, reason: plan.reason, inputs: plan.inputs, txHash: null, evidenceHash: plan.evidenceHash });
    return;
  }
  const kind = plan.action;
  const feasibility =
    plan.action === "confirm"
      ? await checkConfirmFeasible(reader, plan)
      : await checkLinkFeasible(reader, plan);
  const evidenceHash = plan.evidenceHash;
  if (!feasibility.ok) {
    record({ target, kind, outcome: "skipped", rule: feasibility.rule, reason: feasibility.reason, inputs: plan.inputs, txHash: null, evidenceHash });
    return;
  }
  try {
    const result =
      plan.action === "confirm"
        ? await writer.confirm(plan.clusterId, plan.members, plan.exitPoints, plan.evidenceHash)
        : await writer.link(plan.target, plan.clusterId, plan.evidenceHash);
    record({
      target, kind, rule: plan.rule, inputs: plan.inputs, evidenceHash,
      outcome: result.dryRun ? "skipped" : "sent",
      reason: result.dryRun ? `${DRY_RUN_REASON}. Decision: ${plan.reason}` : `${kind} sent. ${plan.reason}`,
      txHash: result.txHash,
    });
  } catch (e) {
    record({ target, kind, outcome: "skipped", rule: plan.rule, reason: writer.explainRevert(e), inputs: plan.inputs, txHash: null, evidenceHash });
  }
}
