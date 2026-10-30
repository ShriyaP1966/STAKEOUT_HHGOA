import { describe, expect, it } from "vitest";
import {
  ContractFunctionExecutionError,
  ContractFunctionRevertedError,
  HttpRequestError,
  UserRejectedRequestError,
  encodeErrorResult,
  type Abi,
  type Address,
  type Hex,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { Status } from "@shared/enums";
import { combinedAbi, guardAbi, stakeoutAbi } from "./abi";
import { decodeError } from "./errors";

const randomAddress = (): Address => privateKeyToAccount(generatePrivateKey()).address;

function revert(abi: Abi, data: Hex, functionName: string): ContractFunctionExecutionError {
  const cause = new ContractFunctionRevertedError({ abi, data, functionName });
  return new ContractFunctionExecutionError(cause, { abi, functionName, args: [], contractAddress: randomAddress() });
}

describe("decodeError", () => {
  it("decodes Blocked into a readable message with the status name", () => {
    const to = randomAddress();
    for (const status of [Status.Confirmed, Status.Linked]) {
      const data = encodeErrorResult({ abi: guardAbi, errorName: "Blocked", args: [to, status] });
      const decoded = decodeError(revert(guardAbi, data, "sendTo"), combinedAbi);
      expect(decoded.title).toBe(`Blocked: recipient is ${Status[status]}`);
      expect(decoded.detail).toContain(to);
      expect(decoded.detail).not.toContain(data);
    }
  });

  it("decodes Stakeout errors with their arguments", () => {
    const data = encodeErrorResult({ abi: stakeoutAbi, errorName: "StakeTooLow", args: [1n, 5n] });
    const decoded = decodeError(revert(stakeoutAbi, data, "promote"), combinedAbi);
    expect(decoded.title).toBe("StakeTooLow");
    expect(decoded.detail).toContain("StakeTooLow(1, 5)");
  });

  it("falls back to the combined ABI when the call ABI lacks the error", () => {
    const to = randomAddress();
    const data = encodeErrorResult({ abi: guardAbi, errorName: "Blocked", args: [to, Status.Linked] });
    const decoded = decodeError(revert([], data, "sendTo"), combinedAbi);
    expect(decoded.title).toBe("Blocked: recipient is Linked");
  });

  it("never shows raw revert data for unknown errors", () => {
    const data: Hex = "0xdeadbeef";
    const decoded = decodeError(revert([], data, "sendTo"), combinedAbi);
    expect(decoded.title).toBe("Transaction reverted");
    expect(JSON.stringify(decoded)).not.toContain("deadbeef");
  });

  it("reads plain wallet provider errors instead of calling them unknown", () => {
    expect(decodeError({ code: -32002, message: "Request already pending" }, combinedAbi).title).toBe("Wallet request already open");
    expect(decodeError({ code: 4001, message: "User rejected" }, combinedAbi).title).toBe("Request rejected");
    expect(decodeError({ code: -32603, message: "Internal wallet failure" }, combinedAbi)).toEqual({ title: "Wallet error", detail: "Internal wallet failure" });
    expect(decodeError(42, combinedAbi).detail).toBe("An unknown error occurred.");
  });

  it("explains wallet rejections and RPC failures without leaking the RPC URL", () => {
    expect(decodeError(new UserRejectedRequestError(new Error("denied")), combinedAbi).title).toBe("Request rejected");
    const url = "https://rpc.invalid/credential-in-path";
    const rpc = decodeError(new HttpRequestError({ url, status: 503 }), combinedAbi);
    expect(rpc.title).toBe("RPC unavailable");
    expect(rpc.detail).not.toContain(url);
  });

  it("passes through plain errors and unknown values", () => {
    expect(decodeError(new Error("boom"), combinedAbi)).toEqual({ title: "Error", detail: "boom" });
    expect(decodeError("x", combinedAbi).title).toBe("Error");
  });
});
