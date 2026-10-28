import type { Provider } from "ethers";
import { Role } from "../../../../shared/enums.js";
import type { Rules } from "../config.js";
import type { Db } from "../db.js";
import { applyPlan } from "./actions.js";
import type { ConfirmedEvent, PromotedEvent, StakeoutClient } from "./contractClient.js";
import type { DecisionPlan } from "./decide.js";
import type { Deployment } from "./deployment.js";
import { log } from "./log.js";
import type { Notifier } from "./notify.js";
import { recordDecision } from "./record.js";

const NEXT_BLOCK_KEY = "verifier.nextBlock";

export type WatcherDeps = {
  client: StakeoutClient;
  provider: Provider;
  db: Db;
  /** Only confirmationsToWait is used here; the decisions use the rules through the functions below. */
  rules: Rules;
  deployment: Deployment;
  chainId: number;
  pollMs: number;
  chunkBlocks: number;
  /** Decide a flagged wallet (confirm or refuse). May throw: the event is then retried on the next poll. */
  decidePromoted: (event: PromotedEvent) => Promise<DecisionPlan>;
  /** Wallets the graph proposes to link to a newly confirmed cluster (PROPOSED graph route). */
  linkCandidates: (clusterId: string) => Promise<string[]>;
  /** Decide one link candidate (link or refuse). May throw. */
  decideLinkFor: (target: string, clusterId: string) => Promise<DecisionPlan>;
  /** Optional: told about every logged decision. Cannot affect any decision. */
  notifier?: Notifier;
};

type ChainEvent = { kind: "promoted"; ev: PromotedEvent } | { kind: "confirmed"; ev: ConfirmedEvent };

const eventKey = (chainId: number, ev: { blockHash: string; logIndex: number }) => `${chainId}:${ev.blockHash}:${ev.logIndex}`;

/**
 * Polls for Promoted and Confirmed events. The next block to scan and every handled event are stored in SQLite, so a
 * restart resumes where it stopped and never handles an event twice. An event is marked handled only AFTER its outcome is
 * logged; before any send, the chain is checked again (already in a cluster, flag still live), so a crash between
 * sending and marking cannot produce a second transaction.
 */
export function startWatcher(deps: WatcherDeps) {
  const { client, provider, db, rules, deployment, chainId } = deps;
  let stopped = false;
  let wake: (() => void) | null = null;
  const warned = new Set<string>();
  const warnOnce = (key: string, message: string) => {
    if (warned.has(`${key}:${message}`)) return;
    warned.add(`${key}:${message}`);
    log.error(message);
  };
  const actionDeps = { reader: client, writer: client, db, notifier: deps.notifier };

  async function handlePromoted(ev: PromotedEvent, key: string): Promise<"handled" | "blocked"> {
    const flag = await client.liveFlag(ev.target);
    if (!flag?.live) {
      recordDecision(db, deps.notifier, {
        target: ev.target, kind: "confirm", outcome: "skipped", rule: "feasibility:no-live-flag",
        reason: "the target no longer has a live flag (expired, resolved or replaced) by the time the event was handled",
        inputs: { flagId: ev.flagId.toString(), blockNumber: ev.blockNumber }, txHash: null, evidenceHash: null,
      });
      db.claimEvent(key);
      return "handled";
    }
    if ((await client.clusterRole(ev.target)) !== Role.None) {
      recordDecision(db, deps.notifier, {
        target: ev.target, kind: "confirm", outcome: "skipped", rule: "feasibility:already-in-cluster",
        reason: "the target is already in a cluster", inputs: { flagId: ev.flagId.toString(), blockNumber: ev.blockNumber },
        txHash: null, evidenceHash: null,
      });
      db.claimEvent(key);
      return "handled";
    }
    try {
      const plan = await deps.decidePromoted(ev);
      await applyPlan(actionDeps, ev.target, plan);
      db.claimEvent(key);
      return "handled";
    } catch (e) {
      warnOnce(key, `Promoted flag ${ev.flagId} for ${ev.target} (block ${ev.blockNumber}) is waiting: could not handle the event: ${(e as Error).message}`);
      return "blocked";
    }
  }

  async function handleConfirmed(ev: ConfirmedEvent, key: string): Promise<"handled" | "blocked"> {
    try {
      const inCluster = new Set([...ev.members, ...ev.exitPoints].map((a) => a.toLowerCase()));
      for (const candidate of await deps.linkCandidates(ev.clusterId)) {
        // each candidate is marked handled on its own, so a retry after a failure never decides one twice
        const subKey = `${key}:link:${candidate.toLowerCase()}`;
        if (db.isEventHandled(subKey)) continue;
        if (inCluster.has(candidate.toLowerCase()) || (await client.clusterRole(candidate)) !== Role.None) {
          db.claimEvent(subKey); // already in a cluster: nothing to decide
          continue;
        }
        const plan = await deps.decideLinkFor(candidate, ev.clusterId);
        await applyPlan(actionDeps, candidate, plan);
        db.claimEvent(subKey);
      }
      db.claimEvent(key);
      return "handled";
    } catch (e) {
      warnOnce(key, `Confirmed cluster ${ev.clusterId.slice(0, 10)}... (block ${ev.blockNumber}) is waiting: could not handle the event: ${(e as Error).message}`);
      return "blocked";
    }
  }

  async function tick() {
    const latest = await provider.getBlockNumber();
    const safeHead = latest - rules.confirmationsToWait;
    let from = Number(db.getKv(NEXT_BLOCK_KEY) ?? deployment.deploymentBlock);
    while (from <= safeHead && !stopped) {
      const to = Math.min(from + deps.chunkBlocks - 1, safeHead);
      const events: ChainEvent[] = [
        ...(await client.promotedBetween(from, to)).map((ev): ChainEvent => ({ kind: "promoted", ev })),
        ...(await client.confirmedBetween(from, to)).map((ev): ChainEvent => ({ kind: "confirmed", ev })),
      ].sort((a, b) => a.ev.blockNumber - b.ev.blockNumber || a.ev.logIndex - b.ev.logIndex);
      for (const item of events) {
        const key = eventKey(chainId, item.ev);
        if (db.isEventHandled(key)) continue;
        const outcome = item.kind === "promoted" ? await handlePromoted(item.ev, key) : await handleConfirmed(item.ev, key);
        if (outcome === "blocked") {
          db.setKv(NEXT_BLOCK_KEY, String(item.ev.blockNumber)); // resume from this block on the next poll
          return;
        }
      }
      db.setKv(NEXT_BLOCK_KEY, String(to + 1));
      from = to + 1;
    }
  }

  const loop = (async () => {
    while (!stopped) {
      try {
        await tick();
      } catch (e) {
        log.error(`poll failed: ${(e as Error).message}`);
      }
      await new Promise<void>((resolve) => {
        wake = resolve;
        setTimeout(resolve, deps.pollMs);
      });
    }
  })();

  return {
    async stop() {
      stopped = true;
      wake?.();
      await loop;
    },
  };
}
