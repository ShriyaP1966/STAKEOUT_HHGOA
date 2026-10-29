import { describe, expect, it } from "vitest";
import { keccak256, stringToBytes } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { checkComplaintHash } from "./complaint-hash";

const targetAddress = privateKeyToAccount(generatePrivateKey()).address;
const text = `I sent 1.5 ETH to ${targetAddress} after a fake support chat.`;
const complaint = {
  targetAddress,
  amount: 1.5,
  currency: "ETH",
  occurredAt: "2026-10-01T10:00:00.000Z",
  narrative: "I sent funds after a fake support chat.",
};

const canonical = JSON.stringify({
  complaint: {
    amount: complaint.amount,
    currency: complaint.currency,
    narrative: complaint.narrative,
    occurredAt: complaint.occurredAt,
    targetAddress: complaint.targetAddress,
  },
  dataSource: "synthetic",
  text,
});
const expectedHash = keccak256(stringToBytes(canonical));

describe("checkComplaintHash", () => {
  it("matches keccak256 of the canonical text, complaint and dataSource", () => {
    const result = checkComplaintHash({ text, complaint, dataSource: "synthetic", complaintHash: expectedHash });
    expect(result).toEqual({ matches: true, expected: expectedHash, recomputed: expectedHash });
  });

  it("ignores hex letter case in the backend hash", () => {
    expect(checkComplaintHash({ text, complaint, dataSource: "synthetic", complaintHash: expectedHash.toUpperCase().replace("0X", "0x") }).matches).toBe(true);
  });

  it("detects a changed text", () => {
    const result = checkComplaintHash({ text: `${text} `, complaint, dataSource: "synthetic", complaintHash: expectedHash });
    expect(result.matches).toBe(false);
    expect(result.recomputed).not.toBe(expectedHash);
  });

  it("detects a changed complaint field", () => {
    const altered = { ...complaint, narrative: complaint.narrative.replace("fake", "fakE") };
    expect(checkComplaintHash({ text, complaint: altered, dataSource: "synthetic", complaintHash: expectedHash }).matches).toBe(false);
    expect(checkComplaintHash({ text, complaint: { ...complaint, amount: 2 }, dataSource: "synthetic", complaintHash: expectedHash }).matches).toBe(false);
    expect(checkComplaintHash({ text, complaint: { ...complaint, extra: 1 }, dataSource: "synthetic", complaintHash: expectedHash }).matches).toBe(false);
  });

  it("detects a changed dataSource", () => {
    expect(checkComplaintHash({ text, complaint, dataSource: "testnet", complaintHash: expectedHash }).matches).toBe(false);
  });
});
