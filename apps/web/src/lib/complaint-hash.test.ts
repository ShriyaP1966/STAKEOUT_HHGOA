import { describe, expect, it } from "vitest";
import { keccak256, stringToBytes } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { checkComplaintHash } from "./complaint-hash";

const targetAddress = privateKeyToAccount(generatePrivateKey()).address;
const complaint = {
  targetAddress,
  amount: 1.5,
  currency: "ETH",
  occurredAt: "2026-10-01T10:00:00.000Z",
  narrative: "I sent funds after a fake support chat.",
};

const canonical = JSON.stringify({
  amount: complaint.amount,
  currency: complaint.currency,
  dataSource: "synthetic",
  narrative: complaint.narrative,
  occurredAt: complaint.occurredAt,
  targetAddress: complaint.targetAddress,
});
const expectedHash = keccak256(stringToBytes(canonical));

describe("checkComplaintHash", () => {
  it("matches keccak256 of the canonical complaint plus dataSource", () => {
    const result = checkComplaintHash({ complaint, dataSource: "synthetic", complaintHash: expectedHash });
    expect(result).toEqual({ matches: true, expected: expectedHash, recomputed: expectedHash });
  });

  it("ignores hex letter case in the backend hash", () => {
    expect(checkComplaintHash({ complaint, dataSource: "synthetic", complaintHash: expectedHash.toUpperCase().replace("0X", "0x") }).matches).toBe(true);
  });

  it("detects a single changed character in the complaint", () => {
    const altered = { ...complaint, narrative: complaint.narrative.replace("fake", "fakE") };
    const result = checkComplaintHash({ complaint: altered, dataSource: "synthetic", complaintHash: expectedHash });
    expect(result.matches).toBe(false);
    expect(result.recomputed).not.toBe(expectedHash);
  });

  it("includes dataSource and any extra complaint fields in the hash", () => {
    expect(checkComplaintHash({ complaint, dataSource: "testnet", complaintHash: expectedHash }).matches).toBe(false);
    expect(checkComplaintHash({ complaint: { ...complaint, extra: 1 }, dataSource: "synthetic", complaintHash: expectedHash }).matches).toBe(false);
  });
});
