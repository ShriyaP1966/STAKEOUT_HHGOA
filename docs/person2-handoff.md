# Person 2 hand-off (AI, voice, backend)

Backend base URL: from your own config (the backend `PORT` in its `.env`). Do not hardcode it.
Every response carries `dataSource` (`synthetic` or `testnet`). Show it on screen.

## Verifier address (give the verifier role to this)
`0x5E921119a5168006F82Dfc295242e23b7328cD61`  (public address only; testnet)

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
| `POST /extract` | built; optional `timezone`; shapes below; 429 behaviour below |
| `POST /evidence/build` | built against the PROPOSED Graph Service schema; tested only with a stub Graph Service |
| `GET /evidence/{hash}` | built (returns the stored record; see the privacy flag) |
| `GET /decisions?limit=n` | built; fills as the verifier logs decisions |
| `GET /blocklist` | built (PROPOSED hash rule); tested only against a mock node |
| `POST /webhooks/dodo` | built (Dodo Payments test mode); tested only with locally signed payloads, real Dodo delivery NOT RUN |

Checks that need no real server, chain or AI call: from `services/backend`, `npm run check` (type check, every self-test, environment-variable parity). It prints PASS or FAIL per check and exits non-zero if any fail.

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

`POST /extract`  body `{ "text": string, "targetAddress"?: string, "timezone"?: string }` (text trimmed; 1 to 5000 chars; empty, whitespace-only, too long, non-string or invalid JSON all return 400)
- `timezone` (optional): an IANA zone name in Region/City form, or `UTC`, never a UTC offset. It tells the AI which zone relative times such as "yesterday" are in; without it the backend's `DEFAULT_TIMEZONE` is used. An invalid value, or `null`, an empty string or a number, gives 400 and the AI is not called. It is not part of the hash.
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

`POST /evidence/build`  body `{ "target": "<wallet address>" }`  (PROPOSED: depends on the Graph Service schema Person 1 has not agreed)
- 200 `{ hash, bundle }`. `bundle` follows `shared/schemas/evidence.json` exactly: `schemaVersion, target, clusterId, behaviorScore, signals, members, exitPoints, unrelatedReporterCount, thresholdsUsed, aiSummary { text, source }, dataSource, createdAt`. `hash = hashBundle(bundle)`; the same bundle is stored and returned by `GET /evidence/{hash}`.
- `signals, members, exitPoints, clusterId, behaviorScore, unrelatedReporterCount` come from the graph unmodified; `thresholdsUsed` is a copy of the rules applied; `dataSource` comes from the backend's config and the graph's own label must agree (otherwise 502).
- `aiSummary.source` is `llm` when the AI's plain-language summary passed the guard (every number and 0x value in it appears in the graph facts), or `template` when it failed twice. The AI only explains; nothing it writes decides or confirms anything.
- Two builds for the same wallet give different hashes (build time and summary text differ). Verify a hash by fetching the stored bundle, never by rebuilding.
- 400 bad body or zero address. 502 Graph Service unreachable, answering HTTP errors, not JSON, in the wrong shape, answering for another wallet, or labelled with another data source. 504 Graph Service too slow. 503 `config/rules.json` missing or invalid (message says who owns it). 429 with `Retry-After` if the AI is rate limited.

`GET /blocklist`  (PROPOSED: hash rule and response shape are not agreed with Person 3)
- 200 `{ rule, count, hashes, scannedFromBlock, scannedToBlock, dataSource, generatedAt }`. `hashes` are sorted, unique, `0x` + 64 hex; `rule` is the text of the hash rule.
- **Hash rule (PROPOSED):** `keccak256` of the 20 address bytes, case-insensitive. A wallet computes the same hash of an address and checks membership, so the list is never shown in the clear. This only hides the list from casual reading: anyone who already has a candidate address can hash it and check.
- Contents: members and exit points of every `Confirmed` event and the target of every `Linked` event, minus any wallet removed by `MemberRemoved`. Event names are read from the ABI at `shared/abi/Stakeout.json`; if one is missing the endpoint says which.
- Only hashes are returned: no raw addresses, cluster ids or evidence hashes.
- 503 naming the missing settings (`RPC_URL`, `CHAIN_ID`, `DEPLOYMENT_PATH`, `RPC_TIMEOUT_MS`, `BLOCKLIST_LOG_CHUNK_BLOCKS`), a missing deployment file, a wrong chain, no contract at the deployed address, or an unreachable node. The rest of the API is unaffected.

## Dodo Payments webhook (test mode): `POST /webhooks/dodo`
Follows the Standard Webhooks scheme described at https://docs.dodopayments.com/developer-resources/webhooks (checked on that page: headers `webhook-id`, `webhook-timestamp` in Unix seconds, `webhook-signature`; signed content `{id}.{timestamp}.{raw body}`; HMAC-SHA256, base64; `v1,<sig>` entries separated by spaces, any may match; secret with `whsec_` removed then base64-decoded; any non-2xx makes Dodo retry).
- **Verification:** the raw body is kept as received for this route only (every other route still parses JSON normally). Every `v1` entry is compared in constant time. A timestamp further from now than `DODO_WEBHOOK_TOLERANCE_SECONDS` is rejected.
- **Answers:** 200 `{received:true}` for a new event; 200 `{received:true,duplicate:true}` for a webhook id already seen; 401 `{error:"unauthorized"}` for any failure (wrong secret, tampered body, stale or future timestamp, missing or malformed headers), always the same body, no detail; 503 naming `DODO_WEBHOOK_SECRET` if it is not set. The rate limit applies like on every route.
- **Stored (table `webhook_events`):** the webhook id, the event type (the payload's top-level `type`, or `unknown` if it is missing or unusable) and the receive time. Never the payload, any customer data, a signature or the secret; none of them is logged either. A verified event whose body cannot be read is still acknowledged with 200 (stored as `unknown`) so Dodo does not retry it for ever.
- **What it does with an event:** records that it arrived. It takes no action on any payment event.
- **Not run:** the real Dodo account and a live delivery. UNKNOWN: whether test mode uses a separate signing secret (the page does not say). To try it for real someone must: create the webhook endpoint in Dodo's test mode, put its signing secret in `DODO_WEBHOOK_SECRET` and a tolerance in `DODO_WEBHOOK_TOLERANCE_SECONDS`, and make the backend reachable from the internet (how is not in the repo: UNKNOWN). The Dodo page also mentions a `dodo wh listen` command that needs test-mode API keys; it was not tried.

## Verifier status (decides; every input it depends on is PROPOSED)
`npm run verifier` in `services/backend`. It starts only if `RULES_PATH` and `DEPLOYMENT_PATH` point at valid files, the node is on `CHAIN_ID`, the contract exists at the deployed address and the verifier wallet has `VERIFIER_ROLE`; otherwise it stops with a message saying what is missing and who owns it.
- **Confirm:** a `Promoted` flag is confirmed only if the wallet's own behavior passes the rules (score at least `behaviorThreshold`, at least `minSignals` signals). Unrelated reports only add to a recorded confidence figure and can never confirm a wallet whose behavior fails. The evidence bundle is stored first; its hash is what goes on-chain.
- **Link:** a `Confirmed` event makes the verifier ask the graph for link candidates. Linked only if the wallet sends funds into the cluster or its exit points repeatedly in a structured way, or is funded by the cluster and then forwards onward like a member. Inbound funding alone, known victims and one-off payers are never linked.
- **Log:** every outcome goes to the `decisions` table with `kind` `confirm`|`link`, `outcome` `sent`|`refused`|`skipped`, a rule label, a reason and the inputs (the values the `/decisions` page validates). A decision that cannot be made (graph or AI down) is retried, never guessed.
- **Check the wallet any time, read-only:** `npm run verifier-status` prints the chain id the RPC reports and whether it equals `CHAIN_ID`, the verifier's PUBLIC address, whether it holds `VERIFIER_ROLE` on the deployed contract and its balance. It sends nothing. `npm run verifier-status-selftest` covers it offline against a mock node.
- **Dry run:** keep `VERIFIER_DRY_RUN=true` until a human has checked a run; then `confirm` and `link` are only simulated and logged as `skipped`.
- **Optional webhook (viaSocket):** off unless `NOTIFY_WEBHOOK_URL` is set; sends only `id, kind, outcome, target, txHash, rule`. Payload format UNVERIFIED against viaSocket.

### PROPOSED interfaces that need agreement (each lives in one small file, so a change is cheap)
| Interface | Needs | Where it is written | Details |
|---|---|---|---|
| Graph Service routes and response (including the `link` flags and the link-candidates route) | **Person 1** | `src/verifier/graphAnalysisProposal.ts`, `graphClient.ts` | `docs/graph-analysis-proposal.md` |
| `config/rules.json` fields and how the verifier uses them | **Person 1 and Person 3** | `rulesSchema` in `src/config.ts`, `src/verifier/decide.ts` | `docs/rules-proposal.md` |
| Blocklist hash rule and response shape | **Person 3** (the demo wallet does the lookup) | `src/blocklist.ts` | above |
| Deployment file fields the backend reads (`chainId`, `stakeoutAddress`, `deploymentBlock`) | Person 3 (already what their deploy script writes) | `src/verifier/deployment.ts` | confirm they will not change |
| Webhook payload | viaSocket (nobody has checked it) | `src/verifier/notify.ts` | UNVERIFIED |

**Needed from Person 3:** the deployment file at `DEPLOYMENT_PATH` and `VERIFIER_ROLE` granted to the verifier address above; please also run `docs/local-chain-test.md` and report what you see.
**Needed from Person 1:** a running Graph Service and the agreed analysis schema (`shared/schemas/analysis.json`).

## Related documents
- `docs/trust-model.md`: the verifier and the reviewer Safe, what each can and cannot do on-chain, from the contract code. UNKNOWN where the repo does not say (for example the Safe's owners and threshold, and any decentralization roadmap).
- `docs/oracle-integration.md`: how an outside contract or app calls `getStatus`, the enums, the `StakeoutGuard`, and snippets (TypeScript run read-only against the deployed contract; Solidity not compiled).

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
- **NOT TESTED IN A BROWSER YET.** It passes a strict TypeScript check in a temporary project with React types (zero `any`). Speech-recognition detection runs after mount, so the server render and the first client render are identical (checked with `renderToString`); "(unavailable)" can only appear after load. A human still has to try it in Chrome and Edge.
