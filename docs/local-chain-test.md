# Local chain test: run the verifier against Person 3's Hardhat node

A human runs this. Nothing here has been run by the assistant: there is no root `node_modules` on the machine where it was written, so the Hardhat commands could not be tried.
Commands are copied from the root `package.json`, `README.md`, `scripts/` and AGENTS.md section 8. Anything not found in those files is marked **UNVERIFIED**.

What this proves: the verifier starts against a real contract, finds the `VERIFIER_ROLE`, reads real `Promoted` events, logs decisions, and survives a restart without repeating itself.
What it does NOT prove: a real confirm or link on the real graph. The verifier decides using the Graph Service (PROPOSED schema) and `config/rules.json`, and neither exists yet. Without a Graph Service the verifier cannot judge a live flag: it logs why and retries, and sends nothing. With `VERIFIER_DRY_RUN=true` it would only simulate anyway.

Use throwaway keys only. Never put a key in chat or in a file that is committed.

## 0. Before you start
- [ ] Node 24 on every terminal (`node -v`).
- [ ] Repo root installed: `npm ci` (AGENTS.md section 8). The root `package.json` has no `engines` field; use Node 24 as for the backend.
- [ ] Backend installed: from `services/backend`, `npm ci --ignore-scripts`; also `npm ci` in `shared/hash`.
- [ ] Your verifier address. From `services/backend` run `npm run verifier-address`. It prints the public address only (the key is never printed). It should equal the address in `docs/person2-handoff.md`. Call it `VERIFIER_ADDRESS` below.

## 1. Start the local node (terminal A, repo root)
```
npm run node:local
```
(`hardhat node`.) Leave it running. It prints funded throwaway accounts with their private keys, and the RPC URL. Note the RPC URL and one account's private key (for the deployer).

## 2. Create `.env.localhost` in the repo root
Same variable names as `.env.example` (README, "Deployment"). The file is git-ignored (`.env*` in `.gitignore`); confirm with `git check-ignore -v .env.localhost`.

| Variable | What to put |
|---|---|
| `RPC_URL` | the URL the node printed |
| `CHAIN_ID` | the chain id the node reports; the deploy script stops if it differs from the node |
| `DEPLOYER_PRIVATE_KEY` | one of the node's printed throwaway keys |
| `REVIEWER_ADDRESS` | another of the node's printed account addresses (stands in for the Safe multisig locally) |
| `VERIFIER_ADDRESS` | **your verifier public address from step 0** |
| `MIN_STAKE_WEI`, `FLAG_DURATION_SECONDS`, `MAX_MEMBERS_PER_CALL` | local test values of your choice; they are constructor arguments, read back into the deployment file |
| `CONFIRMATIONS` | `1` (README: use 1 on a local node) |
| `EXPLORER_API_KEY` | may be left blank or omitted on localhost. Since Person 3's commit 46356fa the deploy accepts a blank value in the `localhost` deploy schema (`scripts/lib/deploy-config.ts`); on a real chain it is still required. **Before that commit** a blank value failed validation (human-run, 2026-10-29), so the line had to be removed. The fixed behaviour is NOT RUN by the assistant: a human must confirm it. |

## 3. Deploy (terminal B, repo root)
```
npm run deploy:local
```
Expected: it checks the chain id, deploys `Stakeout` and `StakeoutGuard`, confirms the role grants on chain, writes the git-ignored `deployments/localhost.json` and copies the ABIs to `shared/abi/`.
- [ ] `deployments/localhost.json` exists and contains `chainId`, `stakeoutAddress`, `deploymentBlock` (the three fields the verifier reads).
- [ ] The `verifier` in that file equals your `VERIFIER_ADDRESS`.

## 4. Seed synthetic data (terminal B, repo root)
```
npm run seed:local
```
README: creates fresh random targets: no record, reported, flagged, flagged and challenged, a confirmed member and exit point, and a linked address; writes `deployments/localhost-seed.json` (git-ignored, `"dataSource": "synthetic"`). This produces real `Promoted` events for the verifier to read.

What the seed script does with the verifier (read from `scripts/seed-local.ts` after commit 46356fa; NOT RUN by the assistant): it first checks that the node is a local Hardhat node (its chain id equals the local Hardhat chain id and `web3_clientVersion` mentions Hardhat) and refuses to run on any other node. If the `VERIFIER_ADDRESS` from the deployment is not one of the node's own unlocked accounts, it impersonates that address on the local node (`hardhat_impersonateAccount`), sets its balance to the first Hardhat account's balance when it has less (for gas), sends `confirm` and `link` as that address, and stops impersonating at the end. So the verifier no longer has to be a Hardhat account and no longer has to be funded first. **Before that commit** (human-run, 2026-10-29) a verifier address that was not a Hardhat account made the seed fail with "invalid account"; that is the behaviour Person 3 fixed.

## 5. Fund the verifier address (needed only for real sends; skip for dry run)
The verifier's dry run only simulates calls, so it needs no balance. For a live run it needs gas. If the seed script impersonated your verifier address in step 4, it already set a balance on the local node (see step 4; NOT RUN by the assistant). Otherwise, `npm run fund:local -- <recipient> <amountEth>` is in the root `package.json` (usage taken from the script's own message; NOT RUN by the assistant).
- **UNVERIFIED:** `npx hardhat console --network localhost`, then in the console `const [a] = await ethers.getSigners(); await a.sendTransaction({ to: "<VERIFIER_ADDRESS>", value: ethers.parseEther("1") })`.

## 6. Give the verifier a rules file (outside the repo)
`config/rules.json` does not exist yet and the team has not agreed values. For this test only, create a file outside the repo, for example `%TEMP%\rules-localtest.json`, with the four fields from `docs/rules-proposal.md`:
```
{ "behaviorThreshold": 1, "minSignals": 1, "reportConfidenceBoostPerReporter": 1, "confirmationsToWait": 1 }
```
These numbers are a test fixture, NOT the team's thresholds. Do not commit this file or copy it into `config/`.

## 7. Run the verifier (terminal C, `services/backend`)
Set the variables for this terminal only, so your real `.env` is untouched (PowerShell shown). Values in angle brackets are yours.
```
$env:RPC_URL = "<same RPC URL as .env.localhost>"
$env:CHAIN_ID = "<same CHAIN_ID as .env.localhost>"
$env:DEPLOYMENT_PATH = "..\..\deployments\localhost.json"
$env:RULES_PATH = "<path to the rules-localtest.json from step 6>"
$env:DB_PATH = "<a NEW database path just for this test, e.g. .\data\localtest.db>"
$env:GRAPH_SERVICE_URL = "http://127.0.0.1:8001"   # not contacted yet; any valid URL
$env:GRAPH_TIMEOUT_MS = "5000"
$env:RPC_TIMEOUT_MS = "5000"
$env:DATA_SOURCE = "synthetic"
$env:VERIFIER_DRY_RUN = "true"
$env:VERIFIER_POLL_INTERVAL_MS = "2000"
$env:VERIFIER_LOG_CHUNK_BLOCKS = "100"
npm run verifier
```
`VERIFIER_PRIVATE_KEY` and the `LLM_*` settings (the verifier builds evidence summaries) come from your `.env` as usual (they are not printed). `NOTIFY_WEBHOOK_URL` and `NOTIFY_TIMEOUT_MS` may stay empty. Use a fresh `DB_PATH` so earlier runs do not hide events.

### Expected (from reading the code; not yet observed on a real node)
- [ ] A line `Verifier started. contract 0x... on chain <id> via <host>; signer <your address> has VERIFIER_ROLE; maxMembersPerCall <n>; dry run: true; resuming from block <deploymentBlock> (deployment block).`
- [ ] If instead it says it cannot start, the message names the cause (wrong chain, no contract code, role missing, file missing). Fix that and retry.
- [ ] Events are read only up to the latest block minus `confirmationsToWait` (1 in the test rules). A local node mines only on demand; `seed:local` sends many transactions so this is normally enough. If the newest events are ignored, mine more blocks. **UNVERIFIED:** the Hardhat node RPC method `hardhat_mine`.
- [ ] For each `Promoted` event whose flag is no longer live (and which comes BEFORE the first live flag the verifier cannot handle: see the head-of-line note below) (for example the target that was later confirmed) the verifier logs a `skipped` decision: "the target no longer has a live flag ...". It marks the event handled.
- [ ] At the first target whose flag is still live (the flagged one, and the flagged-and-challenged one) the verifier tries to fetch the graph analysis. With no Graph Service running (the expected case today) it logs an ERROR once: `Promoted flag <id> for <address> (block <n>) is waiting: could not handle the event: Cannot reach the Graph Service at <host>...`. It sends nothing, writes no decision for it, and does not move past that event; events after it wait. This is intended: nothing is guessed.
- [ ] **Head-of-line waiting (found in a human run on 2026-10-29):** the verifier handles events strictly in order and stops at the first one it cannot handle. So the `skipped` decisions for LATER events (for example the target that was later confirmed, whose flag is no longer live) do not appear in the log until that live flag has been handled, which needs a running Graph Service. With no Graph Service, only the decisions for events before the first live flag exist. This is by design, not a bug in the test; `docs/local-rehearsal.md` shows how to get past it with a dev-only stand-in.
- [ ] If you point `GRAPH_SERVICE_URL` at a running Graph Service that answers in the proposed shape, the verifier decides: a refusal or a dry-run `skipped` appears in the log with its rule and reason. If the answer has the wrong shape the ERROR names the offending fields.
- [ ] With `VERIFIER_DRY_RUN=true`, `confirm` and `link` are never sent.

## 8. Check the decision log
In another terminal, from `services/backend`, start the API server against the SAME database, with the same variables you use for it normally plus `$env:DB_PATH` set to the test database path, then `npm start`. Then:
```
curl "http://localhost:<PORT>/decisions"
```
- [ ] The `skipped` decisions from step 7 appear (only those for events before the first live flag that could not be handled; later ones wait behind it, see the head-of-line note in step 7), each with `kind` `confirm`, `outcome` `skipped`, a `rule` starting `feasibility:` and a plain `reason`.

## 9. Restart test
Stop the verifier (Ctrl+C), start it again with the same variables and database.
- [ ] The started line says `resuming from block <n>` where `n` is greater than the deployment block (the position was stored).
- [ ] The number of decisions in `/decisions` does not increase: events already handled are not handled again.
- [ ] The ERROR for the live flag appears again (that event was never handled; it is retried by design).

## 10. Negative checks
- [ ] Set `$env:CHAIN_ID` to a wrong number and start: it stops with "reports chain ..., but CHAIN_ID in .env is ...".
- [ ] Point `$env:DEPLOYMENT_PATH` at a missing file: it stops and says Person 3 owns the file.
- [ ] Start Hardhat fresh (stop and start `npm run node:local`) without redeploying, then start the verifier: it stops with "No contract code at ...".
- [ ] Deploy with a `VERIFIER_ADDRESS` that is not yours and start: it stops saying your wallet does not have `VERIFIER_ROLE`.

## Record the result
Paste the verifier output and the `/decisions` response into a new dated section at the end of `docs/person2-test-report.md` (do not edit earlier sections). Remove any secret before pasting.

## Want to see decisions without Person 1's service?
`docs/local-rehearsal.md` runs the same setup with a DEV-ONLY stand-in Graph Service, so the verifier can decide (and, on the local chain only, send) for real.

## Still blocked after this passes
Real decisions need Person 1's running Graph Service and agreed `shared/schemas/analysis.json`, and an agreed `config/rules.json` (see `docs/rules-proposal.md` and `docs/graph-analysis-proposal.md`).
