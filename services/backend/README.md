# Stakeout backend (Person 2)

TypeScript service: complaint extraction, evidence storage, decision log, and a verifier skeleton. `POST /evidence/build` and `GET /blocklist` are not built yet (they wait on the Graph Service schema). The verifier watches the contract but **decides nothing real yet** (see "Verifier" below).

## Setup
1. Use Node 24 (`.nvmrc` is `24`; `package.json` enforces `>=24 <25`), then `npm ci --ignore-scripts` (see "Install trouble on Windows" for why that flag). Also run `npm ci` inside `shared/hash`.
2. Create `.env` in this folder from `.env.example`: copy the NAMES and fill in your own values. If a `.env` already exists, add missing lines to it; never overwrite it.
3. `npm run gen-wallet` creates the verifier wallet and writes its key to `.env` (never printed). It refuses to run if a key is already set.
4. `npm start`

## Environment variables (exactly those read in `src/config.ts`)
All are required. There are no defaults in code; a missing or invalid one stops startup with a message naming it (never its value).

| Variable | Used by | Meaning |
|---|---|---|
| `LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL` | server | OpenAI-compatible LLM endpoint, key and model name |
| `PORT` | server | Port to listen on |
| `DB_PATH` | server | SQLite file path (its folder is created if missing; git-ignored) |
| `DATA_SOURCE` | server | `synthetic` or `testnet`, shown on every response |
| `GRAPH_SERVICE_URL` | server | Person 1's Graph Service base URL |
| `LLM_MAX_RETRIES` | server | Most times a rate-limited (429), failing (5xx) or timed-out AI call is retried. 0 means never retry. |
| `LLM_TIMEOUT_MS` | server | How long to wait for one AI call |
| `LLM_RETRY_MAX_WAIT_SECONDS` | server | Longest wait between retries. If the provider asks for longer, the request fails at once with 429 and the provider's own wait in `Retry-After`. Without a `retry-after` header the waits are 1, 2, 4... seconds up to this cap. |
| `RATE_LIMIT_PER_MINUTE` | server | Requests per minute per client |
| `CORS_ORIGINS` | server | Comma-separated web app origins allowed by CORS (for example the web app's URL); must contain at least one valid origin |
| `DECISIONS_PAGE_SIZE` | server | Default `limit` for `GET /decisions` |
| `DECISIONS_MAX_LIMIT` | server | Largest allowed `limit`; must be at least `DECISIONS_PAGE_SIZE` |
| `RPC_URL`, `CHAIN_ID` | `test-tx`, verifier | Node connection. The verifier refuses to start if the node reports a different chain. Only the host of `RPC_URL` is ever printed, because RPC URLs often carry keys. |
| `VERIFIER_PRIVATE_KEY` | `test-tx`, verifier | Written by `gen-wallet`; never share. Never logged. |
| `DEPLOYMENT_PATH`, `RULES_PATH` | verifier | Paths to the deployment file (Person 3) and `config/rules.json` (agreed by Person 1 and 3); both must exist and be valid |
| `GRAPH_TIMEOUT_MS` | verifier | How long to wait for the Graph Service |
| `RPC_TIMEOUT_MS` | verifier | How long to wait for the node at startup |
| `VERIFIER_DRY_RUN` | verifier | `true` or `false`. With `true`, `confirm` and `link` are only simulated against the node and nothing is sent. |
| `VERIFIER_POLL_INTERVAL_MS` | verifier | Pause between polls for new events |
| `VERIFIER_LOG_CHUNK_BLOCKS` | verifier | Blocks queried per event request |

## Install trouble on Windows
Plain `npm ci` fails with `gyp ERR! find VS` because `better-sqlite3` has a `binding.gyp` and no install script, so npm tries to compile it, which needs Visual Studio build tools. Its package already ships a prebuilt Windows binary that it loads at runtime, and `npm ci --ignore-scripts` skips the compile. Verified in a clean copy on Node 24.19.0 (Windows): plain `npm ci` exit 1; `npm ci --ignore-scripts` exit 0, then typecheck passes, the server starts and `/health` returns 200.

## Verifier (`npm run verifier`, separate process from the API server)
What exists: it loads `RULES_PATH` and `DEPLOYMENT_PATH` (clear errors if missing, empty or invalid), reads the ABI from `shared/abi/Stakeout.json`, checks the node is on `CHAIN_ID`, that contract code exists at the deployed address and that the signer has `VERIFIER_ROLE`, then polls for `Promoted` events. The next block to scan and every handled event are stored in SQLite, so a restart never handles an event twice. Decisions are logged in the `decisions` table with `kind` = `confirm`|`link` and `outcome` = `sent`|`refused`|`skipped`.

What it does NOT do yet: decide. For a live flag it reaches `decide()` which throws `not implemented: waiting for Person 1 graph analysis / agreed rules.json`; the event stays unhandled and is retried, and nothing is sent or logged as a decision. It only logs a skipped decision when it can already tell on-chain that the flag is no longer live or the target is already in a cluster.

Other pieces are built but not reachable until `decide()` exists: the checks that mirror the contract's reverts (address limit counts members plus exit points together, duplicates, already in a cluster, no live unchallenged member flag, cluster must exist for link), the dry-run switch, and the Graph Service client (proposal only: see `docs/graph-analysis-proposal.md`; `docs/rules-proposal.md` lists the rules fields).

Checks: `npm run verifier-selftest` (stand-in chain and a local HTTP server; proves our logic, not the real contract). Testing against the real contract needs a local node and deployment from Person 3's scripts (see AGENTS.md section 8).

## Endpoints
- `GET /health`
- `POST /extract` body `{"text": "...", "targetAddress"?: "..."}` (text trimmed, 1 to 5000 chars) returns `{complaint, dataSource, text, complaintHash}` where `complaintHash = hashBundle({ text, complaint, dataSource })`; 422 `{error, candidates}` if the text has several addresses; 429 with `Retry-After` if the AI provider is rate limited or overloaded past the retries (or this API's own limit); 502 if the AI's answer is unusable; 500 with a generic message if the provider rejects the request
- `GET /evidence/:hash`
- `GET /decisions?limit=n`

See `docs/person2-handoff.md` for response shapes and the hash rule.

## npm scripts
`start`, `typecheck`, `gen-wallet`, `test-tx`, `hash-file -- <file.json>`, `check-cluster-id -- <id>`, `verify-complaint-hash` (needs the server running; recomputes the hash from a live response and runs the tamper checks), `check` (runs typecheck, verifier-selftest, llm-selftest, summary-selftest and env-parity; no server, network or real AI call), `llm-selftest`, `summary-selftest`, `env-parity`, `verifier-address` (prints the verifier's PUBLIC address only), `verifier`, `verifier-selftest`, `robustness -- [multilingual|injection|address-selection|bad-input]` (needs the server running; the full run takes a few minutes because it waits for rate-limit windows).

## Known limitations
- The same complaint text can produce different `complaintHash` values, because `narrative` is AI-written and is part of the hashed `complaint`. A hash is verifiable because the exact record `{ text, complaint, dataSource }` is stored under it.
- `GET /evidence/:hash` returns the stored record `{ text, complaint, dataSource }`, including the victim's full submitted text, to anyone who has the hash. Fine while all data is synthetic; the team decides whether to restrict it.
- The target address is chosen by code (one valid address in the text, otherwise 422 with candidates or 400), so instructions inside a complaint cannot change it. amount, currency, time and narrative are still written by the AI and can be steered. Confirmation never depends on `/extract`. See `docs/person2-test-report.md`.
