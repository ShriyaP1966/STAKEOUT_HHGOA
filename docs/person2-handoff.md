# Person 2 hand-off (AI, voice, backend)

Backend base URL: from your own config (the backend `PORT` in its `.env`). Do not hardcode it.
Every response carries `dataSource` (`synthetic` or `testnet`). Show it on screen.

## Verifier address (give the verifier role to this)
`0x4a8c8450af85ee8669F882e0799De18901931CFF`  (public address only; testnet)

## Files
- `shared/hash/index.ts`: `canonicalize(value)`, `hashBundle(value)`. Run `npm install` inside `shared/hash` first (it needs `ethers`). Use this exact file in the web app; never re-implement it.
- `shared/schemas/evidence.json`: evidence bundle schema (DRAFT, owned by Person 2).
- `services/backend/voice/VoiceInput.tsx`: voice component.

## Which hash goes where (PROPOSAL, please confirm)
| Call | `evidenceHash` is | How to get it |
|---|---|---|
| `report(target, evidenceHash)` | hash of the extracted complaint record | `complaintHash` returned by `POST /extract` (equals `hashBundle(response.complaint + dataSource)`; the web app can recompute it) |
| `confirm(...)` / `link(...)` | hash of the full evidence bundle | posted by the verifier only; web app reads it from the on-chain event and calls `GET /evidence/{hash}` |

No personal details go on-chain, only the hash. The complaint text stays in the backend database.
Tamper test: fetch the bundle, run `hashBundle` on it, compare with the on-chain hash. A mismatch means it was altered.

## API shapes (shapes only; these are NOT captured runs, real samples come after I run them)
`POST /extract`  body `{ "text": string }` (max 5000 chars)
- 200 `{ complaint: { targetAddress, amount, currency, occurredAt, narrative }, dataSource, complaintHash }`
  - `targetAddress` is checksummed; `occurredAt` is ISO 8601; `amount` is a number.
- 400 `{ error: string }` for a missing field, a malformed address, or an address not in the text (message is user-readable, show it).
- 429 rate limited. 502 the AI gave an unusable answer (retry).

`GET /evidence/{hash}`  hash is `0x` + 64 hex.
- 200 `{ hash, bundle }`  (bundle follows `shared/schemas/evidence.json`; complaint records from `/extract` are also stored here)
- 400 bad hash format. 404 unknown hash.

`GET /decisions?limit=n`
- 200 `{ decisions: [ { id, target, kind: "confirm"|"link", outcome: "sent"|"refused"|"skipped", rule, reason, inputs, tx_hash, evidence_hash, created_at } ], dataSource }`, newest first.
- Empty list until the verifier exists and has handled events.

`POST /evidence/build` and `GET /blocklist`: not built yet (waiting on the Graph Service and the contract ABI).

## Voice component
```tsx
import { VoiceInput } from "<path>/VoiceInput";
<VoiceInput lang={langFromYourConfig} onText={(text) => setComplaintText(text)} />
```
- `lang` (required): BCP-47 tag such as one your config supplies. Nothing is hardcoded inside.
- `onText(text)`: called with the recognised text; send it to `POST /extract`.
- It shows "Engine: Browser speech recognition". Works in Chrome and Edge; elsewhere it shows a message. Wispr Flow is not integrated (availability unconfirmed).
