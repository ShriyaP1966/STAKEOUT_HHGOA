# Person 2 hand-off (AI, voice, backend)

Backend base URL: from your own config (the backend `PORT` in its `.env`). Do not hardcode it.
Every response carries `dataSource` (`synthetic` or `testnet`). Show it on screen.

## Verifier address (give the verifier role to this)
`0x411d24b954294d48a8933c84b594df7037645fa0d59d309e1f8f4bcf62aac342`  (public address only; testnet)

## Files
- `shared/hash/index.ts`: `canonicalize(value)`, `hashBundle(value)`. It is an ES module (`shared/hash/package.json` has `"type": "module"`, `exports` points at `index.ts`). Run `npm install` inside `shared/hash` first (it needs `ethers`). Use this exact file in the web app; never re-implement it. It is TypeScript source, so a Next app must compile it (for example import it by relative path and enable Next's external-directory support, or add it to the app's transpiled packages); I only tested plain Node ESM and the backend, not a Next build.
- `shared/schemas/evidence.json`: evidence bundle schema (DRAFT, owned by Person 2).
- `shared/ui/VoiceInput.tsx`: voice component (props below). The only location; there is no copy under `services/backend`. It starts with `"use client"` (Next client component).

## Running the backend (Node 24)
The backend is pinned to Node 24 (`services/backend/.nvmrc` is `24`; `package.json` has `"engines": { "node": ">=24 <25" }`). Install from `services/backend` with:

```
npm ci --ignore-scripts
```

Why: plain `npm ci` fails on Windows without Visual Studio build tools (`gyp ERR! find VS`), because `better-sqlite3` has a `binding.gyp` and no install script, so npm tries to compile it. The package already ships a prebuilt Windows binary that it loads at runtime, and `--ignore-scripts` skips the needless compile. Verified in a clean copy on Node 24.19.0 (Windows): plain `npm ci` exit 1; `npm ci --ignore-scripts` exit 0, typecheck passes, server starts, `/health` 200. Also run `npm ci` inside `shared/hash` (it needs `ethers`).

## API list as it stands
| Endpoint | Status |
|---|---|
| `GET /health` | built |
| `POST /extract` | built; shapes above; 429 behaviour above |
| `GET /evidence/{hash}` | built (returns the stored record; see the privacy flag) |
| `GET /decisions?limit=n` | built; empty until the verifier logs decisions |
| `POST /evidence/build` | not built: waits on Person 1's analysis schema and Graph Service |
| `GET /blocklist` | not built (nice to have) |

Checks that need no server, no network and no real AI call: from `services/backend`, `npm run check` (type check, verifier self-test, AI-resilience self-test, summary-guard self-test, environment-variable parity). It prints PASS or FAIL per check and exits non-zero if any fail.

## Backend settings that affect the web app
All are required in the backend's `.env` (names in `services/backend/.env.example`); a missing or invalid one stops startup with a message.
- `LLM_MAX_RETRIES`, `LLM_TIMEOUT_MS`, `LLM_RETRY_MAX_WAIT_SECONDS`: how the backend treats a rate-limited or slow AI provider. It retries at most `LLM_MAX_RETRIES` times and respects the provider's `retry-after`; a wait longer than `LLM_RETRY_MAX_WAIT_SECONDS` is not attempted and the caller gets 429 straight away. No response shape changes.
- `CORS_ORIGINS`: comma-separated list of web app origins allowed to call the backend from a browser (for example the URL the web app runs on). Missing, empty or not a valid origin: backend refuses to start. Requests from other origins get no CORS header and the browser blocks them. Requests with no Origin header (curl, server-to-server) are unaffected.
- `DECISIONS_PAGE_SIZE`: how many decisions `GET /decisions` returns when `limit` is not given.
- `DECISIONS_MAX_LIMIT`: the largest `limit` the endpoint accepts. Must be at least `DECISIONS_PAGE_SIZE` (the backend refuses to start otherwise). A `limit` that is not a whole number from 1 to this value returns 400.

## Which hash goes where (AGREED)
| Call | `evidenceHash` is |
|---|---|
| `report(target, evidenceHash)` | the `complaintHash` returned by `POST /extract`: `hashBundle({ text, complaint, dataSource })` using `shared/hash`. `text` is the submitted text, trimmed; `complaint` is exactly the object `/extract` returns (`targetAddress, amount, currency, occurredAt, narrative`); `dataSource` is `synthetic` or `testnet`. |
| `confirm(...)` / `link(...)` | the hash of the full evidence bundle, posted by the verifier only. Read it from the on-chain event and call `GET /evidence/{hash}`. |

This matches `services/backend/src/server.ts`: it builds `{ text, complaint, dataSource }`, hashes it with `hashBundle`, stores exactly that record under the hash, and returns `{ complaint, dataSource, text, complaintHash }`. `GET /evidence/{hash}` returns the same record as `bundle`.
**The same text can give different hashes.** `narrative` is written by the AI and is part of `complaint`, so submitting the same text twice can produce two different `complaintHash` values (seen in real runs). A hash is verifiable because the exact record it covers is stored: fetch it from `GET /evidence/{hash}`, run `hashBundle` on `bundle`, compare with the on-chain value. Do not promise that resubmitting the same text reproduces the same hash. Because `text` is in the record, the hash also proves which words the extracted fields came from.

Only the hash goes on-chain. **Privacy flag (undecided):** `GET /evidence/{hash}` currently returns the victim's full submitted text to anyone who has the hash, and the hash is public once it is on-chain. All current data is synthetic; whether to restrict this is an open team decision.
Tamper test: fetch the stored record, run `hashBundle` on it, compare with the on-chain hash. A mismatch means it was altered. `npm run verify-complaint-hash` (backend running) does this end to end and also shows that changing one character of the text, or the extracted amount, changes the hash.

## Cluster id
- Format (agreed): `0x` followed by exactly 64 hex characters, matching the contract's `bytes32`.
- Who generates it: Person 1's graph service, from data. The backend never creates one; it only validates and passes it through.
- Backend validation: one shared zod helper, `services/backend/src/clusterId.ts` (`clusterIdSchema`, `parseClusterId`). Wrong format gives the message "clusterId must be 0x followed by exactly 64 hex characters (bytes32)".
- Not yet wired into an endpoint: no endpoint accepts or returns a cluster id today. The evidence builder and verifier will use the helper when they are built.

## API shapes
Shapes below come from the code. `POST /extract` and `GET /decisions` were run against the real server (see the test list in the report); no captured sample responses are included here.

`POST /extract`  body `{ "text": string, "targetAddress"?: string }` (text trimmed; 1 to 5000 chars; empty, whitespace-only, too long, non-string or invalid JSON all return 400)
- The target address is chosen by code from the text, never by the AI. Every `0x` + 40-hex token is validated with ethers; the zero address is ignored; case is normalised to the checksummed form.
- One valid address: it is used. Several: 422 `{ error, candidates: [checksummed...] }`; show the list and re-send the same text with `targetAddress` set to the user's choice (it must be one of the candidates, otherwise 400). None: 400.
- 200 `{ complaint: { targetAddress, amount, currency, occurredAt, narrative }, dataSource, text, complaintHash }`
  - `targetAddress` is checksummed; `occurredAt` is ISO 8601; `amount` is a number; `text` is the trimmed submitted text; `complaintHash = hashBundle({ text, complaint, dataSource })`.
- 400 `{ error: string }` for a missing field, a malformed address, or an address not in the text (message is user-readable, show it).
- **429 `{ error }` with a `Retry-After` header (seconds):** either this API's own per-client rate limit, or the AI provider is rate limited or overloaded and the backend's bounded retries ran out (message: "The AI service is busy or rate limited. Please try again in about N second(s)."). Show the message and wait `Retry-After` seconds. Provider 5xx errors and timeouts that outlast the retries also give 429.
- 502 the AI gave an unusable answer (empty, not JSON, or the wrong shape): retry.
- 500 `{ error: "The AI provider returned an error (HTTP <status>)." }`: the provider refused the request for a reason that is not rate limiting (for example a bad key or request). The message is deliberately generic, because provider messages can echo parts of the API key.
- 422 more than one address in the text (see above).
- Known limits: only the address is chosen by code. amount, currency, occurredAt and narrative are written by the AI and can be steered by the text. See `docs/person2-test-report.md`.

`GET /evidence/{hash}`  hash is `0x` + 64 hex.
- 200 `{ hash, bundle }`. For a hash from `/extract`, the stored `bundle` is `{ text, complaint, dataSource }`: exactly the record that was hashed. Later, verifier evidence bundles (following `shared/schemas/evidence.json`) are stored here too.
- **This endpoint returns the victim's full submitted text (`bundle.text`) to anyone who has the hash.** That is acceptable only while all data is synthetic (`dataSource: "synthetic"`, no real victims). The team decides whether to restrict it before any real data is used.
- 400 bad hash format. 404 unknown hash.
- Planned, not yet run with a real bundle: full evidence bundles appear once `POST /evidence/build` exists.

`GET /decisions?limit=n`
- `limit` optional. Whole number from 1 up to the configured maximum (`DECISIONS_MAX_LIMIT`); default is `DECISIONS_PAGE_SIZE`.
- 200 `{ decisions: [ { id, target, kind: "confirm"|"link", outcome: "sent"|"refused"|"skipped", rule, reason, inputs, tx_hash, evidence_hash, created_at } ], dataSource }`, newest first.
- 400 `{ error: "limit must be a whole number from 1 to <max>" }` for `abc`, `0`, `-5`, `1.5`, empty, or above the maximum.
- Empty list until the verifier exists and has handled events.

`POST /evidence/build` and `GET /blocklist`: not built yet (`/evidence/build` waits on Person 1's Graph Service; the contract ABI is now available).

## Verifier status (skeleton; decides nothing real yet)
`npm run verifier` in `services/backend`. It starts only if `RULES_PATH` and `DEPLOYMENT_PATH` point at valid files, the node is on `CHAIN_ID`, the contract exists at the deployed address and the verifier wallet has `VERIFIER_ROLE`; otherwise it stops with a message saying what is missing and who owns it. It watches `Promoted` events (position and handled events kept in SQLite) and logs decisions to the `decisions` table with `kind` `confirm`|`link` and `outcome` `sent`|`refused`|`skipped`, the values the `/decisions` page validates. `VERIFIER_DRY_RUN=true` simulates `confirm`/`link` without sending. For a live flag it stops at `not implemented: waiting for Person 1 graph analysis / agreed rules.json`.
- **Needed from Person 3:** the deployment file at `DEPLOYMENT_PATH` (shape used: `chainId`, `stakeoutAddress`, `deploymentBlock`, as written by their deploy script) and `VERIFIER_ROLE` granted to the verifier address above. Please also run the verifier against their local node and report what you see.
- **Needed from Person 1 and Person 3:** an agreed `config/rules.json` (`docs/rules-proposal.md`).
- **Needed from Person 1:** the analysis schema and a running Graph Service (`docs/graph-analysis-proposal.md` is only a proposal).

## Voice component: `shared/ui/VoiceInput.tsx`
```tsx
import { VoiceInput } from "<path to shared>/ui/VoiceInput";
<VoiceInput lang={langFromYourConfig} onText={(text) => setComplaintText(text)} />
```
| Prop | Type | Meaning |
|---|---|---|
| `lang` | `string` (required) | BCP-47 language tag for recognition, e.g. from your app config. Nothing is hardcoded inside the component. |
| `onText` | `(text: string) => void` (required) | Called with the recognised text. Send it to `POST /extract`. |

- Speech engine: the browser's built-in speech recognition (`SpeechRecognition` / `webkitSpeechRecognition`). Wispr Flow is not integrated (availability unconfirmed).
- On-screen label: always shows `Engine: Browser speech recognition`, with ` (unavailable)` appended if the browser has no speech recognition. Errors appear as a text alert; an unsupported browser shows a message asking the user to type instead.
- Expected to work in Chrome and Edge.
- **NOT TESTED IN A BROWSER YET.** It passes a strict TypeScript check in a temporary project with React types (zero `any`), but it is not part of the backend typecheck and no one has run it in a browser. It reads `window` during render, so a Next server render may disagree with the client on the "(unavailable)" label (possible hydration warning). Test it in the web app before relying on it.
