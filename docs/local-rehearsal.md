# Local rehearsal: run the verifier end to end on the local chain with a DEV-ONLY Graph Service stand-in

**This is a rehearsal, not an integration test.** The Graph Service here is a stand-in written by Person 2 (`npm run dev:graph-stub`). It is NOT Person 1's Graph Service, its data is synthetic and its answers are made up by a generator from the seed file. It proves that the verifier, the contract and the decision log work together on a local chain. It proves nothing about Person 1's graph, the agreed schema, or the team's thresholds.

It builds on `docs/local-chain-test.md` (same node, deploy and seed). Read that first for the background and for what each variable means.

## Status of every step
Each step says who ran it. "NOT RUN" means the assistant did not run it; a human must, and should record what they see.

| Step | What | Status |
|---|---|---|
| 1 | Start the local node | NOT RUN by the assistant (a human-run node on chain 31337 was seen answering on the local RPC port, nothing more) |
| 2 | Deploy with `VERIFIER_ADDRESS` a Hardhat account | NOT RUN by the assistant. Human-run on 2026-10-29: worked with Hardhat Account #2 (see `docs/person2-test-report.md`, section 12) |
| 3 | Seed | NOT RUN by the assistant. Human-run on 2026-10-29: worked |
| 4 | Generate the fixture from the real seed file | RAN by the assistant on 2026-10-29: wrote 5 analyses and 2 clusters of link candidates, exit 0 (rules file was a temporary test fixture with threshold 1 and minimum signals 1) |
| 5 | Start the stand-in | RAN by the assistant on 2026-10-29: printed the banner, answered the flagged target with score 2 and 2 signals, the challenged target with score 0 and 0 signals, and 3 link candidates; then stopped by its own process id |
| 6 | Verifier in dry run | NOT RUN with the stand-in |
| 7 | Verifier live (`VERIFIER_DRY_RUN=false`), see a real confirm and `getStatus` change | NOT RUN |
| 8 | `GET /decisions` | NOT RUN |
| 9 | viaSocket alert | NOT RUN |

The offline self-test `npm run dev-graph-selftest` (part of `npm run check`) covers the stand-in itself with generated random addresses; it needs no chain.

## Before you start
- Node 24 in every terminal, repo root installed (`npm ci`), backend installed (`npm ci --ignore-scripts` in `services/backend`).
- Everything below is local only. Never use a real key. The Hardhat node prints throwaway keys; use one of those for the verifier, and do not paste it into a file that is committed.
- Your real `.env` may contain `NOTIFY_WEBHOOK_URL`. The verifier reads it and **sends a real message for every decision it records, including skipped and refused ones**. To avoid emails during the rehearsal, set `$env:NOTIFY_WEBHOOK_URL = ""` and `$env:NOTIFY_TIMEOUT_MS = ""` in the verifier terminal (step 6), and turn them back on only for step 9.

## 1. Start the node (terminal A, repo root)
```
npm run node:local
```
Leave it running. Note the RPC URL, the chain id (31337) and the printed accounts. Pick one account as the verifier (for example Account #2) and note its address and private key.

## 2. Deploy with the verifier set to a Hardhat account (terminal B, repo root)
In `.env.localhost` (git-ignored, same variable names as `.env.example`; see `docs/local-chain-test.md` step 2) set `VERIFIER_ADDRESS` to the **Hardhat account's address**, not your real verifier address. Do not list `EXPLORER_API_KEY` at all (an empty value fails validation). Use a `FLAG_DURATION_SECONDS` long enough for the whole rehearsal: a flag nobody confirms lapses after that time, and the verifier then records "no live flag" instead of deciding.
```
npm run deploy:local
```
**Why not your real verifier address?** The seed script then needs to act as that address. Human-run on 2026-10-29: with an external address as verifier the seed script fails with "invalid account". That is a bug to report to Person 3 (`scripts/seed-local.ts`); it is outside Person 2's folders, so it is not changed here.

## 3. Seed (terminal B, repo root)
```
npm run seed:local
```
Writes the git-ignored `deployments/localhost-seed.json` (synthetic). Read only its structure; it holds addresses and a cluster id, no secrets.

## 4. Rules file and fixture (terminal C, `services/backend`)
Create a rules file outside the repo, for example in your temp folder, with the four fields from `docs/rules-proposal.md`:
```
{ "behaviorThreshold": 1, "minSignals": 1, "reportConfidenceBoostPerReporter": 1, "confirmationsToWait": 1 }
```
These are TEST numbers, not the team's thresholds. Then set this terminal's variables (PowerShell; values in angle brackets are yours):
```
$env:DATA_SOURCE = "synthetic"
$env:CHAIN_ID = "31337"
$env:RULES_PATH = "<path to that rules file>"
$env:GRAPH_FIXTURE_PATH = "<a path outside the repo for the generated fixture>"
$env:GRAPH_SERVICE_URL = "http://127.0.0.1:8001"   # the port the stand-in will listen on; host must be 127.0.0.1 or localhost
npm run dev:graph-fixture -- ..\..\deployments\localhost-seed.json
```
Expected: `Fixture written: 5 analyses, 2 cluster(s) of link candidates (synthetic, chain 31337).`
What it builds, all from the seed file and the rules file (no address is typed in source):
- **Flagged target:** behavior score just above `behaviorThreshold`, just above `minSignals` signals, and its own new cluster id (derived from the seed's cluster id and its address, so a live confirm does not collide with the cluster the seed already created).
- **Challenged target:** behavior score just below the threshold, so the verifier must refuse it. It has the same number of unrelated reporters, to show that reports cannot make up for weak behavior.
- **Member, exit point and linked address:** analyses with the PROPOSED `link` facts for the seed's cluster. They are listed as link candidates for both clusters. All three are already in a cluster on chain, so the verifier skips them without recording a decision (nothing to decide). A real `link` therefore does NOT happen in this rehearsal.

## 5. Start the stand-in (terminal C)
Same variables as step 4:
```
npm run dev:graph-stub
```
Expected: a banner `DEV STAND-IN, NOT Person 1's Graph Service, synthetic data only`, then `Listening on 127.0.0.1:<port> only`. It refuses to start (and says why) unless `DATA_SOURCE` is synthetic, `CHAIN_ID` is 31337, `GRAPH_SERVICE_URL` is a local address with a port, and the fixture is synthetic and for the same chain. It answers only the two PROPOSED routes in `docs/graph-analysis-proposal.md`, nothing else. An address that is not in the fixture gets a 404, which the verifier will log as a waiting error.
Leave it running. Optional quick look (replace the address with one from the seed file): `curl http://127.0.0.1:<port>/analysis/<flagged target>`.

## 6. Run the verifier in dry run (terminal D, `services/backend`)
Variables as in `docs/local-chain-test.md` step 7, with these differences:
```
$env:GRAPH_SERVICE_URL = "http://127.0.0.1:8001"       # the stand-in, same port as step 4
$env:VERIFIER_DRY_RUN = "true"
$env:VERIFIER_PRIVATE_KEY = "<the Hardhat account's key, typed in this terminal only>"
$env:DB_PATH = "<a NEW database path>"
$env:NOTIFY_WEBHOOK_URL = ""
$env:NOTIFY_TIMEOUT_MS = ""
npm run verifier
```
`LLM_*` come from your `.env` as usual: the verifier asks the AI for the evidence summary (that is a real call to your provider; the AI only writes the summary, it never decides).
Expected, from reading the code (NOT RUN):
- [ ] Start line with `signer <the Hardhat account> has VERIFIER_ROLE` and `dry run: true`.
- [ ] Earlier `Promoted` events whose flags are no longer live get `skipped` decisions.
- [ ] The flagged target: a `skipped` decision (dry run) whose rule is `B:behavior-passed`, i.e. the verifier WOULD confirm. Nothing is sent.
- [ ] The challenged target: a `refused` decision with rule `B:behaviorThreshold`. Behavior failed, whatever the reporter count.
- [ ] No ERROR about the Graph Service any more. (Without the stand-in the verifier waits with an ERROR at the first live flag and later events wait behind it: head-of-line waiting, see `docs/local-chain-test.md`.)

## 7. Run it live on the local chain only (terminal D)
Stop the verifier. Make sure `RPC_URL` points at the local node and `CHAIN_ID` is 31337. Use a NEW `DB_PATH` (the old one remembers the events as handled). The seeded flag may have lapsed since step 3 if `FLAG_DURATION_SECONDS` was short; if the log says "no live flag", run `npm run seed:local` again, regenerate the fixture (step 4), restart the stand-in and use a new database.
The verifier needs local ETH for gas. The Hardhat accounts are funded; if you used another address, `npm run fund:local -- <address> <amountEth>` exists in the root `package.json` (usage taken from the script's own message; NOT RUN by the assistant).
```
$env:VERIFIER_DRY_RUN = "false"
npm run verifier
```
Expected (NOT RUN):
- [ ] For the flagged target: a `sent` decision with a transaction hash, rule `B:behavior-passed`.
- [ ] Before and after, check the status on chain. `getStatus(<flagged target>)` should change from Flagged (2) to Confirmed (3). Use the web app, or `npx hardhat console --network localhost` in the repo root and call `getStatus` on the deployed contract (UNVERIFIED console recipe). Check the same for the challenged target: it must stay Flagged.
- [ ] A new `Confirmed` event follows. The three candidates are already in clusters, so the verifier skips them silently (no `link` is sent).

**Only on the local chain.** The verifier refuses nothing by itself about the chain, so never point `RPC_URL` at a public network while this stand-in is running.

## 8. Check `GET /decisions`
In terminal E, `services/backend`, with the same `DB_PATH` and the usual `.env`:
```
npm start
curl "http://localhost:<PORT>/decisions"
```
Expected (NOT RUN): the decisions from steps 6 and 7 with `kind`, `outcome`, `rule`, a plain `reason`, `txHash` for the sent one, and the evidence hash.

## 9. Check the viaSocket alert
Restore `NOTIFY_WEBHOOK_URL` and `NOTIFY_TIMEOUT_MS` in the verifier terminal (or remove the two lines that blank them), use a NEW database, and run the rehearsal again from step 7. Expected (NOT RUN): one message per recorded decision in the connected inbox, with public facts only. If you only want to test the webhook, `npm run notify-test` sends one labelled sample.

## Stopping and cleaning up
Ctrl+C in each terminal. The fixture and databases are outside the repo or git-ignored. Nothing here is committed.

## Limits of this rehearsal (read before trusting it)
- The stand-in's answers are generated to make the verifier's rules pass or fail. They say nothing about how Person 1's graph will score real data.
- The PROPOSED routes and shapes are still not agreed with Person 1. If they change, `graphAnalysisProposal.ts` changes and so must the stand-in's fixture.
- A real `link` transaction is not exercised, because the seed puts every candidate in a cluster already.
