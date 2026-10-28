import { keccak256, toUtf8Bytes } from "ethers";

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

/**
 * Deterministic JSON: object keys sorted at every depth, no whitespace.
 * Backend and web app must both use this file so hashes always match.
 * Rejects values that have no stable JSON form (undefined, NaN, bigint, functions).
 */
export function canonicalize(value: unknown): string {
  return JSON.stringify(sortKeys(value, "$"));
}

function sortKeys(value: unknown, path: string): Json {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error(`canonicalize: non-finite number at ${path}`);
    return value;
  }
  if (Array.isArray(value)) return value.map((v, i) => sortKeys(v, `${path}[${i}]`));
  if (typeof value === "object") {
    const out: { [key: string]: Json } = {};
    for (const key of Object.keys(value as object).sort()) {
      const v = (value as Record<string, unknown>)[key];
      if (v === undefined) throw new Error(`canonicalize: undefined at ${path}.${key}`);
      out[key] = sortKeys(v, `${path}.${key}`);
    }
    return out;
  }
  throw new Error(`canonicalize: unsupported ${typeof value} at ${path}`);
}

/** keccak256 of the canonical text, as a 0x-prefixed 32-byte hex string. */
export function hashBundle(bundle: unknown): string {
  return keccak256(toUtf8Bytes(canonicalize(bundle)));
}
