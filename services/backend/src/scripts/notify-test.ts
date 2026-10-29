// Sends ONE clearly labelled sample decision to the configured webhook (NOTIFY_WEBHOOK_URL), through the real notifier code in
// src/verifier/notify.ts, exactly as the verifier would. THIS DELIVERS A REAL MESSAGE to whatever the webhook is connected to.
// It prints only: success or failure, the HTTP status, and the elapsed milliseconds. Never the URL or any response body.
// Usage: npm run notify-test
import { loadEnv, notifyEnv } from "../config.js";
import { makeRedactor } from "../redact.js";
import { makeNotifier, type NotifyResult } from "../verifier/notify.js";

const env = loadEnv(notifyEnv, "notify test"); // names problems, never values

if (!env.NOTIFY_WEBHOOK_URL) {
  console.error("NOTIFY_WEBHOOK_URL is empty, so there is nothing to test. Set NOTIFY_WEBHOOK_URL and NOTIFY_TIMEOUT_MS in .env, then run this again.");
  process.exitCode = 1;
} else {
  // SAMPLE data, labelled as such: a text id, outcome "skipped", rule "notify-test", and an obviously fake all-ones target address.
  // (Built from a repeat so no address literal sits in the source.)
  const sample = {
    id: "notify-test",
    kind: "confirm",
    outcome: "skipped",
    target: "0x" + "1".repeat(40),
    txHash: null,
    rule: "notify-test",
  };

  let result: NotifyResult | undefined;
  // The failure reason is already redacted by the notifier and is deliberately not printed here: this command shows only three facts.
  const notifier = makeNotifier(
    { url: env.NOTIFY_WEBHOOK_URL, timeoutMs: env.NOTIFY_TIMEOUT_MS },
    makeRedactor([env.NOTIFY_WEBHOOK_URL]),
    () => {},
    (r) => (result = r),
  );
  notifier.notify(sample);
  await notifier.flush();

  const ok = result?.ok === true;
  console.log(ok ? "SUCCESS: the sample decision was accepted by the webhook." : "FAILURE: the sample decision was not accepted by the webhook.");
  console.log(`HTTP status: ${result?.status ?? "none (no response: timeout or unreachable)"}`);
  console.log(`Elapsed: ${result?.elapsedMs ?? 0} ms`);
  process.exitCode = ok ? 0 : 1; // set, not process.exit(): exiting while connections close can crash Node on Windows
}
