import { getAddress, isAddress, zeroAddress, type Address } from "viem";

const HEX_TOKEN = /0x[0-9a-fA-F]{20,}/g;

function normalise(token: string): string {
  const body = token.slice(2);
  return body === body.toUpperCase() ? `0x${body.toLowerCase()}` : token;
}

export function findAddresses(text: string): Address[] {
  const found: Address[] = [];
  for (const token of text.match(HEX_TOKEN) ?? []) {
    if (token.length !== 42) continue;
    const candidate = normalise(token);
    if (!isAddress(candidate)) continue;
    const checksummed = getAddress(candidate);
    if (checksummed !== zeroAddress && !found.includes(checksummed)) found.push(checksummed);
  }
  return found;
}
