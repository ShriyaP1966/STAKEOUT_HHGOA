import { describe, expect, it } from "vitest";
import { getAddress, keccak256, toHex, zeroAddress } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { findAddresses } from "./address-pick";

const randomAddress = () => privateKeyToAccount(generatePrivateKey()).address;

function breakChecksum(address: string): string {
  const body = address.slice(2);
  const index = body.search(/[a-fA-F]/);
  const letter = body[index];
  const flipped = letter === letter.toUpperCase() ? letter.toLowerCase() : letter.toUpperCase();
  return `0x${body.slice(0, index)}${flipped}${body.slice(index + 1)}`;
}

describe("findAddresses", () => {
  it("finds one checksummed address in free text", () => {
    const address = randomAddress();
    expect(findAddresses(`I paid ${address.toLowerCase()} yesterday.`)).toEqual([address]);
  });

  it("returns several distinct addresses in order of appearance", () => {
    const [a, b] = [randomAddress(), randomAddress()];
    expect(findAddresses(`First ${a}, then ${b}, and again ${a.toLowerCase()}.`)).toEqual([a, b]);
  });

  it("accepts an all-uppercase address but rejects a wrong mixed-case checksum", () => {
    const address = randomAddress();
    expect(findAddresses(`sent to 0x${address.slice(2).toUpperCase()}`)).toEqual([address]);
    const broken = breakChecksum(address);
    expect(getAddress(broken.toLowerCase())).toBe(address);
    expect(findAddresses(`sent to ${broken}`)).toEqual([]);
  });

  it("ignores transaction hashes, short hex, and the zero address", () => {
    const txHash = keccak256(toHex(crypto.getRandomValues(new Uint8Array(32))));
    expect(findAddresses(`tx ${txHash}, code 0x1234, burn ${zeroAddress}`)).toEqual([]);
  });

  it("returns an empty list when there is no address", () => {
    expect(findAddresses("Someone took my money on a fake exchange.")).toEqual([]);
  });
});
