# Stakeout backend (Person 2)

TypeScript service: complaint extraction, evidence building and storage, a hashed blocklist, the verifier (which decides confirm, link or refuse and logs why), and a decision log. Everything that depends on Person 1's Graph Service or the agreed `config/rules.json` is marked PROPOSED below and in `docs/`; none of it has run against a real Graph Service or a real contract.

## Setup
1. Use Node 24 (`.nvmrc` is `24`; `package.json` enforces `>=24 <25`), then `npm ci --ignore-scripts` (see "Install trouble on Windows" for why that flag). Also run `npm ci` inside `shared/hash`.
2. Create `.env` in this folder from `.env.example`: copy the NAMES and fill in your own values. If a `.env` already exists, add missing lines to it; never overwrite it.
3. `npm run gen-wallet` creates the verifier wallet and writes its key to `.env` (never printed). It refuses to run if a key is already set.
4. `npm start`

## Environment variables (exactly those read in `src/config.ts`)
All are required, except the `NOTIFY_` and `DODO_` variables, which may be left empty. There are no defaults in code; a missing or invalid one stops startup with a message naming it (never its value). The `/blocklist` variables are checked when that endpoint is first used, so the rest of the API runs without them.

| Variable | Used by | Meaning |
|---|---|---|
| `LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL` | server, verifier | OpenAI-compatible LLM endpoint, key and model name |
| `LLM_MAX_RETRIES` | server, verifier | Most times a rate-limited (429), failing (5xx) or timed-out AI call is retried. 0 means never retry. |
| `LLM_TIMEOUT_MS` | server, verifier | How long to wait for one AI call |
| `LLM_RETRY_MAX_WAIT_SECONDS` | server, verifier | Longest wait between retries. If the provider asks for longer, the request fails at once with 429 and the provider's own wait in `Retry-After`. Without a `retry-after` header the waits are 1, 2, 4... seconds up to this cap. |
| `PORT` | server | Port to listen on |
| `DB_PATH` | server, verifier | SQLite file path (its folder is created if missing; git-ignored). The server and the verifier must point at the same file to share evidence and the decision log. |
| `DATA_SOURCE` | server, verifier | `synthetic` or `testnet`, shown on every response and bundle. The graph's own label must agree with it. |
| `DEFAULT_TIMEZONE` | server | IANA zone (Region/City form, or UTC) used to resolve relative times when a request has no `timezone` |
| `GRAPH_SERVICE_URL`, `GRAPH_TIMEOUT_MS` | server, verifier | Person 1's Graph Service base URL and how long to wait for it |
| `RATE_LIMIT_PER_MINUTE` | server | Requests per minute per client |
| `CORS_ORIGINS` | server | Comma-separated web app origins allowed by CORS; must contain at least one valid origin |
| `DECISIONS_PAGE_SIZE` | server | Default `limit` for `GET /decisions` |
| `DECISIONS_MAX_LIMIT` | server | Largest allowed `limit`; must be at least `DECISIONS_PAGE_SIZE` |
| `RPC_URL`, `CHAIN_ID` | `test-tx`, verifier, `GET /blocklist` | Node connection. A mismatch with the node's chain is refused. Only the host of `RPC_URL` is ever printed, because RPC URLs often carry keys. |
| `DEPLOYMENT_PATH` | verifier, `GET /blocklist` | Path to Person 3's deployment file (`chainId`, `stakeoutAddress`, `deploymentBlock` are read) |
| `RPC_TIMEOUT_MS` | verifier, `GET /blocklist` | How long to wait for the node |
| `BLOCKLIST_LOG_CHUNK_BLOCKS` | `GET /blocklist` | Blocks per event request when scanning |
| `RULES_PATH` | verifier, `POST /evidence/build` | Path to `config/rules.json` (agreed by Person 1 and 3). The verifier needs it to start; evidence building reads it per request and answers 503 if it is missing. |
| `VERIFIER_PRIVATE_KEY` | `test-tx`, verifier | Written by `gen-wallet`; never share. Never logged. |
| `VERIFIER_DRY_RUN` | verifier | `true` or `false`. With `true`, `confirm` and `link` are only simulated against the node and nothing is sent. Keep `true` until a human has checked a run. |
| `VERIFIER_POLL_INTERVAL_MS` | verifier | Pause between polls for new events |
| `VERIFIER_LOG_CHUNK_BLOCKS` | verifier | Blocks queried per event request |
| `DODO_WEBHOOK_SECRET`, `DODO_WEBHOOK_TOLERANCE_SECONDS` | server | Optional Dodo Payments (test mode) webhook. The secret is the signing secret Dodo shows for the endpoint (`whsec_` followed by base64); an invalid one stops startup without being printed. The tolerance is how many seconds a webhook timestamp may differ from now (Standard Webhooks libraries use 300; the Dodo page names no number of its own). If the secret is set the tolerance is required. If the secret is empty, `POST /webhooks/dodo` answers 503 and nothing else is affected. |
| `NOTIFY_WEBHOOK_URL`, `NOTIFY_TIMEOUT_MS` | verifier | Optional viaSocket webhook. Empty means no notifications at all. If the URL is set, the timeout is required. |

## Install trouble on Windows
Plain `npm ci` fails with `gyp ERR! find VS` because `better-sqlite3` has a `binding.gyp` and no install script, so npm tries to compile it, which needs Visual Studio build tools. Its package already ships a prebuilt Windows binary that it loads at runtime, and `npm ci --ignore-scripts` skips the compile. Verified in a clean copy on Node 24.19.0 (Windows): plain `npm ci` exit 1; `npm ci --ignore-scripts` exit 0, then typecheck passes, the server starts and `/health` returns 200.

## Verifier (`npm run verifier`, separate process from the API server)
**Startup:** loads `RULES_PATH` and `DEPLOYMENT_PATH` (clear errors if missing, empty or invalid), reads the ABI from `shared/abi/Stakeout.json`, checks the node is on `CHAIN_ID`, that contract code exists at the deployed address and that the signer has `VERIFIER_ROLE`, then polls for `Promoted` and `Confirmed` events. The next block to scan and every handled event are stored in SQLite, so a restart never handles an event twice.

**Confirm (a `Promoted` flag).** The graph analysis for the flagged wallet is fetched (PROPOSED route and shape, `docs/graph-analysis-proposal.md`). The wallet is confirmed only if its OWN behavior passes the rules: behavior score at least `behaviorThreshold` and at least `minSignals` signals. Reports from unrelated victims only add to a confidence figure that is recorded in the log; no number of reports can confirm a wallet whose behavior fails. The evidence bundle is built, hashed and stored first, and its hash is the `evidenceHash` sent on-chain.

**Link (a `Confirmed` event).** The graph proposes link candidates for the new cluster (PROPOSED route). A candidate is linked only if it sends funds into the cluster or its exit points in a repeated, structured way, or is funded by the cluster and then forwards onward like a member. Inbound funding alone is ignored, and known victims and one-off payers are never linked. The graph supplies these facts as flags; the confirm thresholds play no part.

**Log:** every outcome is written to the `decisions` table with `kind` = `confirm`|`link` and `outcome` = `sent`|`refused`|`skipped`, a rule label, a plain reason, the inputs (score, signal count, reporters, thresholds used) and the evidence hash. `skipped` also covers "cannot be sent": the flag is no longer live, over the contract's address limit, already in a cluster, challenged, or dry run. If anything needed for a decision fails (graph down, AI down), nothing is guessed: the event is retried on the next poll.

**Dry run:** with `VERIFIER_DRY_RUN=true` the contract call is simulated and logged as `skipped` ("dry run"); nothing is sent.

**Notifications (optional):** if `NOTIFY_WEBHOOK_URL` is set, each logged decision is POSTed to it with only `{ id, kind, outcome, target, txHash, rule }`. Never the reason, inputs or any complaint text. The URL is redacted from every log line. A failure or a slow webhook is logged and never blocks or changes a decision. The payload format is UNVERIFIED against viaSocket.

**Local rehearsal without Person 1 (DEV ONLY):** `npm run dev:graph-fixture -- <seed file>` and `npm run dev:graph-stub` run a stand-in Graph Service on 127.0.0.1 for the PROPOSED routes, from a fixture file named by `GRAPH_FIXTURE_PATH`. It refuses to start unless `DATA_SOURCE` is synthetic and `CHAIN_ID` is 31337. It is NOT Person 1's service. Steps: `docs/local-rehearsal.md`. Offline test: `npm run dev-graph-selftest`.

**Trying the webhook (`npm run notify-test`):** sends ONE clearly labelled sample (id `notify-test`, kind `confirm`, outcome `skipped`, rule `notify-test`, target an all-ones sample address, no tx hash) through the real notifier code, exactly as the verifier would. **It delivers a real message to whatever the webhook is connected to** (for a viaSocket flow wired to Gmail, an email). It prints only three lines: `SUCCESS` or `FAILURE`, `HTTP status: <n>` (or `none` if there was no response), and `Elapsed: <n> ms`. It never prints the URL, any part of it, or the response body, and it sends nothing if `NOTIFY_WEBHOOK_URL` is empty (it says so and exits 1). Exit code 0 means the webhook answered with a 2xx status; 1 means anything else.

**Checks:** `npm run decide-selftest` and `npm run verifier-selftest` (stand-in chain, stub graph, stub AI; they prove our logic, not the real contract or the real graph). Testing against the real contract needs a local node and deployment from Person 3's scripts: `docs/local-chain-test.md`.

## Endpoints
- `GET /health`
- `POST /extract` body `{"text": "...", "targetAddress"?: "...", "timezone"?: "..."}` (text trimmed, 1 to 5000 chars; `timezone` is an IANA name, default `DEFAULT_TIMEZONE`, invalid gives 400) returns `{complaint, dataSource, text, complaintHash}` where `complaintHash = hashBundle({ text, complaint, dataSource })`; 422 `{error, candidates}` if the text has several addresses; 429 with `Retry-After` if the AI provider is rate limited or overloaded past the retries (or this API's own limit); 502 if the AI's answer is unusable; 500 with a generic message if the provider rejects the request
- `POST /evidence/build` body `{"target": "<address>"}` fetches the graph analysis (PROPOSED), builds the bundle from `shared/schemas/evidence.json`, hashes it with `shared/hash`, stores it and returns `{hash, bundle}`. 400 bad input; 502 or 504 for a failing or slow Graph Service; 503 if the rules file is missing; 429 if the AI is rate limited.
- `GET /evidence/:hash` returns `{hash, bundle}`
- `GET /blocklist` (PROPOSED) returns hashed addresses of Confirmed and Linked wallets, read from contract events: `{rule, count, hashes, scannedFromBlock, scannedToBlock, dataSource, generatedAt}`. 503 with the missing settings named if the node or deployment is not configured.
- `GET /decisions?limit=n`
- `POST /webhooks/dodo` (Dodo Payments test mode, Standard Webhooks) verifies `webhook-id`, `webhook-timestamp` and `webhook-signature` against the raw body and answers 200 for a new or duplicate event, 401 (no detail) for any verification failure, 503 if `DODO_WEBHOOK_SECRET` is not set. It stores only the webhook id, the event type and the receive time. The existing rate limit applies. **Tested only with locally signed payloads: the real Dodo account and a live delivery are NOT RUN.**

See `docs/person2-handoff.md` for response shapes, the hash rules and the list of PROPOSED interfaces.

## npm scripts
`start`, `typecheck`, `gen-wallet`, `test-tx`, `hash-file -- <file.json>`, `check-cluster-id -- <id>`, `verify-complaint-hash` (needs the server running; recomputes the hash from a live response and runs the tamper checks), `check` (runs typecheck, every self-test below and env-parity; no real server, no real chain, no real AI call), `llm-selftest`, `summary-selftest`, `timezone-selftest`, `evidence-selftest`, `decide-selftest`, `blocklist-selftest`, `notify-selftest`, `notify-test` (sends one labelled sample to the configured webhook: a real delivery; see Verifier), `notify-test-selftest` (offline: runs that command against a local stub webhook), `dodo-selftest`, `verifier-status-selftest`, `verifier-status` (read-only: the chain id the RPC reports and whether it matches `CHAIN_ID`, the verifier's PUBLIC address, whether it holds `VERIFIER_ROLE`, its balance; sends nothing), `env-parity`, `verifier-address` (prints the verifier's PUBLIC address only), `verifier`, `verifier-selftest`, `robustness -- [multilingual|injection|address-selection|bad-input]` (needs the server running; the full run takes a few minutes because it waits for rate-limit windows).

## More documents
- `docs/trust-model.md`: who has to be trusted, and for what, from the contract code. Unknowns are marked UNKNOWN.
- `docs/oracle-integration.md`: how another contract or app calls `getStatus(address)`, the enums, the `StakeoutGuard` behavior, and code snippets (the TypeScript one was run read-only against the deployed contract; the Solidity one was not compiled).
- `docs/person2-handoff.md`, `docs/person2-test-report.md`, `docs/local-chain-test.md`.

## Known limitations
- **Dodo Payments:** only locally signed payloads have been tested. The real Dodo account, a live delivery, and whether test mode uses a separate signing secret (the Dodo page does not say) are NOT RUN / UNKNOWN. The route records that an event arrived; it takes no action on any payment event.
- **PROPOSED, not agreed:** the Graph Service routes and response shape (including the link flags), the `config/rules.json` fields and how the verifier uses them, and the blocklist hash rule and response. Each is isolated in one small file (`src/verifier/graphAnalysisProposal.ts` and `graphClient.ts`, `src/config.ts` `rulesSchema`, `src/blocklist.ts`), so an agreed change is a one-file change. See `docs/person2-handoff.md`.
- The verifier's decisions and the evidence builder have only run against stand-ins (a stub Graph Service, a stub AI, a mock node). They have not run against Person 1's service or Person 3's deployed contract.
- Rules in use: pass needs behavior score >= `behaviorThreshold` and signal count >= `minSignals`. `reportConfidenceBoostPerReporter` only feeds a recorded confidence figure and never changes pass or fail. Linking uses the graph's flags, not the thresholds. `confirmationsToWait` delays event handling.
- Two evidence builds for the same wallet give different hashes (the build time and the AI-written summary are in the bundle). The bundle that was hashed is stored under its hash.
- The blocklist hashes only hide the list from casual reading: anyone who already has a candidate address can hash it and check. It reflects reorg-free chains only (no reorg handling).
- The same complaint text can produce different `complaintHash` values, because `narrative` is AI-written and is part of the hashed `complaint`. A hash is verifiable because the exact record `{ text, complaint, dataSource }` is stored under it.
- `GET /evidence/:hash` returns the stored record `{ text, complaint, dataSource }`, including the victim's full submitted text, to anyone who has the hash. Fine while all data is synthetic; the team decides whether to restrict it.
- The target address is chosen by code (one valid address in the text, otherwise 422 with candidates or 400), so instructions inside a complaint cannot change it. amount, currency, time and narrative are still written by the AI and can be steered. Confirmation never depends on `/extract`. See `docs/person2-test-report.md`.
