import type { Provider } from "ethers";
import { Role } from "../../../../shared/enums.js";
import type { Rules } from "../config.js";
import type { Db } from "../db.js";
import { applyPlan } from "./actions.js";
import type { PromotedEvent, StakeoutClient } from "./contractClient.js";
import { decide } from "./decide.js";
import type { Deployment } from "./deployment.js";
import { NotImplementedError } from "./errors.js";
import { log } from "./log.js";

const NEXT_BLOCK_KEY = "verifier.nextBlock";

export type WatcherDeps = {
  client: StakeoutClient;
  provider: Provider;
  db: Db;
  rules: Rules;
  deployment: Deployment;
  chainId: number;
  pollMs: number;
  chunkBlocks: number;
  graphServiceUrl: string;
  graphTimeoutMs: number;
};

const eventKey = (chainId: number, ev: PromotedEvent) => `${chainId}:${ev.blockHash}:${ev.logIndex}`;

/**
 * Polls for Promoted events. The next block to scan and every handled event are stored in SQLite, so a restart
 * resumes where it stopped and never handles an event twice. An event is marked handled only AFTER its outcome is
 * logged; before any send, the chain is checked again (already in a cluster, flag still live), so a crash between
 * sending and marking cannot produce a second transaction.
 */
export function startWatcher(deps: WatcherDeps) {
  const { client, provider, db, rules, deployment, chainId } = deps;
  let stopped = false;
  let wake: (() => void) | null = null;
  const warned = new Set<string>();

  async function handlePromoted(ev: PromotedEvent, key: string): Promise<"handled" | "blocked"> {
    const flag = await client.liveFlag(ev.target);
    if (!flag?.live) {
      db.logDecision({
        target: ev.target, kind: "confirm", outcome: "skipped", rule: "feasibility:no-live-flag",
        reason: "the target no longer has a live flag (expired, resolved or replaced) by the time the event was handled",
        inputs: { flagId: ev.flagId.toString(), blockNumber: ev.blockNumber }, txHash: null, evidenceHash: null,
      });
      db.claimEvent(key);
      return "handled";
    }
    if ((await client.clusterRole(ev.target)) !== Role.None) {
      db.logDecision({
        target: ev.target, kind: "confirm", outcome: "skipped", rule: "feasibility:already-in-cluster",
        reason: "the target is already in a cluster", inputs: { flagId: ev.flagId.toString(), blockNumber: ev.blockNumber },
        txHash: null, evidenceHash: null,
      });
      db.claimEvent(key);
      return "handled";
    }
    try {
      const plan = await decide({ rules, graphServiceUrl: deps.graphServiceUrl, graphTimeoutMs: deps.graphTimeoutMs }, ev);
      await applyPlan({ reader: client, writer: client, db }, ev.target, plan);
      db.claimEvent(key);
      return "handled";
    } catch (e) {
      const message = e instanceof NotImplementedError ? e.message : `could not handle the event: ${(e as Error).message}`;
      if (!warned.has(`${key}:${message}`)) {
        warned.add(`${key}:${message}`);
        log[e instanceof NotImplementedError ? "warn" : "error"](`Promoted flag ${ev.flagId} for ${ev.target} (block ${ev.blockNumber}) is waiting: ${message}`);
      }
      return "blocked";
    }
  }

  async function tick() {
    const latest = await provider.getBlockNumber();
    const safeHead = latest - rules.confirmationsToWait;
    let from = Number(db.getKv(NEXT_BLOCK_KEY) ?? deployment.deploymentBlock);
    while (from <= safeHead && !stopped) {
      const to = Math.min(from + deps.chunkBlocks - 1, safeHead);
      for (const ev of await client.promotedBetween(from, to)) {
        const key = eventKey(chainId, ev);
        if (db.isEventHandled(key)) continue;
        if ((await handlePromoted(ev, key)) === "blocked") {
          db.setKv(NEXT_BLOCK_KEY, String(ev.blockNumber)); // resume from this block on the next poll
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
