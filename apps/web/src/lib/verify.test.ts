import { describe, expect, it } from "vitest";
import { keccak256, toHex, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { hashBundle } from "@shared/hash/index";
import type { StakeoutEvent } from "./events";
import { checkBundle, findHashOnChain } from "./verify";

const randomHash = (): Hex => keccak256(toHex(crypto.getRandomValues(new Uint8Array(32))));
const randomAddress = () => privateKeyToAccount(generatePrivateKey()).address;
const ref = (logIndex: number) => ({ blockNumber: 5n, logIndex, transactionHash: randomHash() });

describe("findHashOnChain", () => {
  const target = randomAddress();
  const hash = randomHash();
  const other = randomHash();
  const events: StakeoutEvent[] = [
    { name: "ReportSubmitted", args: { reportId: 0n, target, reporter: randomAddress(), evidenceHash: hash }, ref: ref(0) },
    { name: "ReportSubmitted", args: { reportId: 1n, target, reporter: randomAddress(), evidenceHash: other }, ref: ref(1) },
    { name: "Confirmed", args: { clusterId: randomHash(), members: [target], exitPoints: [], evidenceHash: hash }, ref: ref(2) },
    { name: "Linked", args: { target, clusterId: randomHash(), evidenceHash: hash }, ref: ref(3) },
    { name: "Expired", args: { flagId: 0n, target }, ref: ref(4) },
  ];

  it("finds the hash in ReportSubmitted, Confirmed and Linked events only", () => {
    expect(findHashOnChain(events, hash).map((match) => [match.event, match.ref.logIndex])).toEqual([
      ["ReportSubmitted", 0],
      ["Confirmed", 2],
      ["Linked", 3],
    ]);
  });

  it("compares hashes without regard to letter case", () => {
    expect(findHashOnChain(events, hash.toUpperCase().replace("0X", "0x") as Hex)).toHaveLength(3);
  });

  it("returns nothing for a hash that is not on chain", () => {
    expect(findHashOnChain(events, randomHash())).toEqual([]);
  });
});

describe("checkBundle", () => {
  const bundle = { targetAddress: randomAddress(), amount: 2, narrative: "Paid a fake exchange.", dataSource: "synthetic" };
  const hash = hashBundle(bundle) as Hex;

  it("passes when the bundle re-hashes to the requested hash", () => {
    expect(checkBundle(hash, bundle)).toEqual({ status: "match", recomputed: hash, dataSource: "synthetic" });
  });

  it("fails when one character of the stored bundle changes", () => {
    const tampered = { ...bundle, narrative: bundle.narrative.replace("fake", "fakf") };
    const result = checkBundle(hash, tampered);
    expect(result.status).toBe("mismatch");
    expect(result.status !== "no-bundle" && result.recomputed).not.toBe(hash);
  });

  it("reports a missing bundle separately from a mismatch", () => {
    expect(checkBundle(hash, null)).toEqual({ status: "no-bundle" });
  });

  it("reports a bundle without dataSource", () => {
    const { dataSource: _omitted, ...withoutSource } = bundle;
    expect(_omitted).toBe("synthetic");
    const result = checkBundle(hashBundle(withoutSource) as Hex, withoutSource);
    expect(result).toMatchObject({ status: "match", dataSource: null });
  });
});
