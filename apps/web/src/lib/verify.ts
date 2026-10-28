import type { Hex } from "viem";
import { hashBundle } from "@shared/hash/index";
import type { LogRef, StakeoutEvent } from "./events";

export type ChainMatch = { event: "ReportSubmitted" | "Confirmed" | "Linked"; ref: LogRef };

export type BundleCheck =
  | { status: "match"; recomputed: string; dataSource: string | null }
  | { status: "mismatch"; recomputed: string; dataSource: string | null }
  | { status: "no-bundle" };

const sameHash = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

export function findHashOnChain(events: StakeoutEvent[], hash: Hex): ChainMatch[] {
  return events.flatMap((event): ChainMatch[] => {
    if (event.name !== "ReportSubmitted" && event.name !== "Confirmed" && event.name !== "Linked") return [];
    return sameHash(event.args.evidenceHash, hash) ? [{ event: event.name, ref: event.ref }] : [];
  });
}

function dataSourceOf(bundle: unknown): string | null {
  if (typeof bundle === "object" && bundle !== null && "dataSource" in bundle && typeof bundle.dataSource === "string") {
    return bundle.dataSource;
  }
  return null;
}

export function checkBundle(hash: Hex, bundle: unknown | null): BundleCheck {
  if (bundle === null) return { status: "no-bundle" };
  const recomputed = hashBundle(bundle);
  return { status: sameHash(recomputed, hash) ? "match" : "mismatch", recomputed, dataSource: dataSourceOf(bundle) };
}
