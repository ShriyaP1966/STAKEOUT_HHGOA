// Self-test for LISTEN_HOST: how it is validated, and that a server given a validated value binds to exactly that address.
// No network beyond the loopback address, no .env read. Usage: npm run listen-host-selftest
import { createServer } from "node:http";
import { serverEnv } from "../config.js";

let failed = false;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}: ${name}${detail ? ` (${detail})` : ""}`);
  if (!ok) failed = true;
};
const hostSchema = serverEnv.pick({ LISTEN_HOST: true });
const parse = (value: string | undefined) => hostSchema.safeParse(value === undefined ? {} : { LISTEN_HOST: value });

// test fixtures: documentation-style and reserved addresses, not real hosts
const loopback = "127.0.0.1", loopback6 = "::1", anyInterface = "0.0.0.0";
for (const good of [loopback, loopback6, anyInterface]) {
  const r = parse(good);
  check(`accepted: ${good}`, r.success && r.data.LISTEN_HOST === good);
}
for (const bad of [undefined, "", " ", "localhost", "example.com", "127.0.0.1:8000", "127.0.0.1 ", "256.0.0.1", "http://127.0.0.1"]) {
  check(`refused: ${bad === undefined ? "(missing)" : JSON.stringify(bad)}`, !parse(bad).success);
}
const missing = parse(undefined);
check("a missing value is refused and the message names LISTEN_HOST", !missing.success && missing.error.issues[0].path.join(".") === "LISTEN_HOST");

// a server given the validated value binds to that address and no other
const server = createServer();
await new Promise<void>((resolve) => server.listen(0, loopback, resolve));
const address = server.address();
check("a server bound with the loopback value reports the loopback address", address !== null && typeof address !== "string" && address.address === loopback, JSON.stringify(address));
await new Promise<void>((resolve) => server.close(() => resolve()));

process.exitCode = failed ? 1 : 0;
console.log(failed ? "\nSome listen-host checks FAILED" : "\nall listen-host self-test checks passed");
