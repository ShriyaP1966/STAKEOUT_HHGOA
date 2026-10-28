import type { Redactor } from "../redact.js";

// Set once the secrets are known. Every line is passed through it: ethers puts the full RPC URL (with any key in it) into its error messages.
let redactor: Redactor = (text) => text;
export const setLogRedactor = (r: Redactor) => void (redactor = r);
export const redactText = (text: string) => redactor(text);

const stamp = () => new Date().toISOString();

export const log = {
  info: (msg: string) => console.log(`${stamp()} INFO  ${redactor(msg)}`),
  warn: (msg: string) => console.warn(`${stamp()} WARN  ${redactor(msg)}`),
  error: (msg: string) => console.error(`${stamp()} ERROR ${redactor(msg)}`),
};
