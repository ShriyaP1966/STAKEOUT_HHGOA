# Person 2 hand-off (AI, voice, backend)

Backend base URL: from your own config (the backend `PORT` in its `.env`). Do not hardcode it.
Every response carries `dataSource` (`synthetic` or `testnet`). Show it on screen.

## Verifier address (give the verifier role to this)
`0x4a8c8450af85ee8669F882e0799De18901931CFF`  (public address only; testnet)

## Files
- `shared/hash/index.ts`: `canonicalize(value)`, `hashBundle(value)`. It is an ES module (`shared/hash/package.json` has `"type": "module"`, `exports` points at `index.ts`). Run `npm install` inside `shared/hash` first (it needs `ethers`). Use this exact file in the web app; never re-implement it. It is TypeScript source, so a Next app must compile it (for example import it by relative path and enable Next's external-directory support, or add it to the app's transpiled packages); I only tested plain Node ESM and the backend, not a Next build.
- `shared/schemas/evidence.json`: evidence bundle schema (DRAFT, owned by Person 2).
- `shared/ui/VoiceInput.tsx`: voice component (props below). The only location; there is no copy under `services/backend`. It starts with `"use client"` (Next client component).

## Backend settings that affect the web app
All are required in the backend's `.env` (names in `services/backend/.env.example`); a missing or invalid one stops startup with a message.
- `CORS_ORIGINS`: comma-separated list of web app origins allowed to call the backend from a browser (for example the URL the web app runs on). Missing, empty or not a valid origin: backend refuses to start. Requests from other origins get no CORS header and the browser blocks them. Requests with no Origin header (curl, server-to-server) are unaffected.
- `DECISIONS_PAGE_SIZE`: how many decisions `GET /decisions` returns when `limit` is not given.
- `DECISIONS_MAX_LIMIT`: the largest `limit` the endpoint accepts. Must be at least `DECISIONS_PAGE_SIZE` (the backend refuses to start otherwise). A `limit` that is not a whole number from 1 to this value returns 400.

## Which hash goes where (AGREED)
| Call | `evidenceHash` is |
|---|---|
| `report(target, evidenceHash)` | the `complaintHash` returned by `POST /extract`. It is `hashBundle(complaint + dataSource)` using `shared/hash`, i.e. the complaint object with a `dataSource` field added. Anyone can verify it by recomputing. |
| `confirm(...)` / `link(...)` | the hash of the full evidence bundle, posted by the verifier only. Read it from the on-chain event and call `GET /evidence/{hash}`. |

This matches `services/backend/src/server.ts`: it builds `{ ...complaint, dataSource }`, hashes it with `hashBundle`, stores that record under the hash, and returns the hash as `complaintHash`.
**Caveat: the hash is not deterministic from the text.** The `narrative` field is written by the LLM and is part of the hashed record, so the same complaint text can give a different `complaintHash` on each call (observed in a real run). Every hash does verify against the exact record stored under it (`GET /evidence/{hash}`). Do not promise that resubmitting the same text reproduces the same hash.

No personal details go on-chain, only the hash. The complaint text stays in the backend database.
Tamper test: fetch the stored record, run `hashBundle` on it, compare with the on-chain hash. A mismatch means it was altered.

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
- 200 `{ complaint: { targetAddress, amount, currency, occurredAt, narrative }, dataSource, complaintHash }`
  - `targetAddress` is checksummed; `occurredAt` is ISO 8601; `amount` is a number.
- 400 `{ error: string }` for a missing field, a malformed address, or an address not in the text (message is user-readable, show it).
- 429 rate limited. 502 the AI gave an unusable answer (retry).
- 422 more than one address in the text (see above).
- Known limits: only the address is chosen by code. amount, currency, occurredAt and narrative are written by the AI and can be steered by the text. See `docs/person2-test-report.md`.

`GET /evidence/{hash}`  hash is `0x` + 64 hex.
- 200 `{ hash, bundle }`  (bundle follows `shared/schemas/evidence.json`; complaint records from `/extract` are also stored here)
- 400 bad hash format. 404 unknown hash.
- Planned, not yet run with a real bundle: full evidence bundles appear once `POST /evidence/build` exists.

`GET /decisions?limit=n`
- `limit` optional. Whole number from 1 up to the configured maximum (`DECISIONS_MAX_LIMIT`); default is `DECISIONS_PAGE_SIZE`.
- 200 `{ decisions: [ { id, target, kind: "confirm"|"link", outcome: "sent"|"refused"|"skipped", rule, reason, inputs, tx_hash, evidence_hash, created_at } ], dataSource }`, newest first.
- 400 `{ error: "limit must be a whole number from 1 to <max>" }` for `abc`, `0`, `-5`, `1.5`, empty, or above the maximum.
- Empty list until the verifier exists and has handled events.

`POST /evidence/build` and `GET /blocklist`: not built yet (waiting on the Graph Service and the contract ABI).

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
- **NOT TESTED IN A BROWSER YET.** It compiles in intent only (it is not part of the backend typecheck, and the repo has no React setup to build it). Test it in the web app before relying on it.
