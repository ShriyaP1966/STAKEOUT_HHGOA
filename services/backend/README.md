# Stakeout backend (Person 2)

TypeScript service: complaint extraction, evidence storage, decision log. The verifier service, `POST /evidence/build` and `GET /blocklist` are not built yet (they wait on the Graph Service schema and the contract ABI).

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
| `RATE_LIMIT_PER_MINUTE` | server | Requests per minute per client |
| `CORS_ORIGINS` | server | Comma-separated web app origins allowed by CORS (for example the web app's URL); must contain at least one valid origin |
| `DECISIONS_PAGE_SIZE` | server | Default `limit` for `GET /decisions` |
| `DECISIONS_MAX_LIMIT` | server | Largest allowed `limit`; must be at least `DECISIONS_PAGE_SIZE` |
| `RPC_URL`, `CHAIN_ID` | `test-tx` (and the future verifier) | Testnet connection |
| `VERIFIER_PRIVATE_KEY` | `test-tx` (and the future verifier) | Written by `gen-wallet`; never share |
| `DEPLOYMENT_PATH`, `RULES_PATH` | future verifier | Paths to `deployments/network.json` and `config/rules.json` (owned by others) |

## Install trouble on Windows
Plain `npm ci` fails with `gyp ERR! find VS` because `better-sqlite3` has a `binding.gyp` and no install script, so npm tries to compile it, which needs Visual Studio build tools. Its package already ships a prebuilt Windows binary that it loads at runtime, and `npm ci --ignore-scripts` skips the compile. Verified in a clean copy on Node 24.19.0 (Windows): plain `npm ci` exit 1; `npm ci --ignore-scripts` exit 0, then typecheck passes, the server starts and `/health` returns 200.

## Endpoints
- `GET /health`
- `POST /extract` body `{"text": "...", "targetAddress"?: "..."}` (text trimmed, 1 to 5000 chars) returns `{complaint, dataSource, text, complaintHash}` where `complaintHash = hashBundle({ text, complaint, dataSource })`; 422 `{error, candidates}` if the text has several addresses
- `GET /evidence/:hash`
- `GET /decisions?limit=n`

See `docs/person2-handoff.md` for response shapes and the hash rule.

## npm scripts
`start`, `typecheck`, `gen-wallet`, `test-tx`, `hash-file -- <file.json>`, `check-cluster-id -- <id>`, `verify-complaint-hash` (needs the server running; recomputes the hash from a live response and runs the tamper checks), `robustness -- [multilingual|injection|address-selection|bad-input]` (needs the server running; the full run takes a few minutes because it waits for rate-limit windows).

## Known limitations
- The same complaint text can produce different `complaintHash` values, because `narrative` is AI-written and is part of the hashed `complaint`. A hash is verifiable because the exact record `{ text, complaint, dataSource }` is stored under it.
- `GET /evidence/:hash` returns the victim's full submitted text to anyone who has the hash. Whether to restrict it is undecided.
- The target address is chosen by code (one valid address in the text, otherwise 422 with candidates or 400), so instructions inside a complaint cannot change it. amount, currency, time and narrative are still written by the AI and can be steered. Confirmation never depends on `/extract`. See `docs/person2-test-report.md`.
