// Proves complaintHash = hashBundle({ text, complaint, dataSource }) against a RUNNING backend.
// Usage: npm run verify-complaint-hash   (start the server first with `npm start`)
// The wallet address is generated fresh on every run.
import "dotenv/config";
import { Wallet } from "ethers";
import { canonicalize, hashBundle } from "../../../../shared/hash/index.js";

let failed = false;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}: ${name}${detail ? ` (${detail})` : ""}`);
  if (!ok) failed = true;
};

// Sets process.exitCode instead of calling process.exit(): exiting while HTTP connections close crashes Node on Windows.
async function main() {
  const port = process.env.PORT;
  if (!port) {
    console.error("PORT must be set in .env");
    failed = true;
    return;
  }
  const base = `http://localhost:${port}`;

  const text = `I sent 2500 USDT yesterday at 3pm to ${Wallet.createRandom().address} and the scammers vanished.`;
  const res = await fetch(`${base}/extract`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text }),
  });
  const body = await res.json();
  console.log(`POST /extract -> ${res.status}; response keys: ${Object.keys(body).join(", ")}`);
  if (res.status !== 200) {
    console.log(JSON.stringify(body));
    failed = true;
    return;
  }

  const record = { text: body.text, complaint: body.complaint, dataSource: body.dataSource };
  check("returned text equals the trimmed submitted text", body.text === text.trim());
  check("recomputed hash equals complaintHash", hashBundle(record) === body.complaintHash, body.complaintHash);

  const ev = await fetch(`${base}/evidence/${body.complaintHash}`);
  const evBody = await ev.json();
  check("GET /evidence/:hash returns 200", ev.status === 200, `status ${ev.status}`);
  check("stored bundle is exactly { text, complaint, dataSource }", canonicalize(evBody.bundle) === canonicalize(record));
  check("hash of the stored bundle equals the hash it is stored under", hashBundle(evBody.bundle) === body.complaintHash);

  const tampered = { ...record, text: record.text.replace(/.$/, (c: string) => (c === "x" ? "y" : "x")) };
  check("changing one character of the text changes the hash", hashBundle(tampered) !== body.complaintHash);
  const tamperedComplaint = { ...record, complaint: { ...record.complaint, amount: record.complaint.amount + 1 } };
  check("changing the extracted amount changes the hash", hashBundle(tamperedComplaint) !== body.complaintHash);
}

await main();
process.exitCode = failed ? 1 : 0;
