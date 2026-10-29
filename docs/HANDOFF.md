# Person 3 handoff: contracts, scripts, deployments, web app

For Person 1 and Person 2. Commands are in `AGENTS.md` section 8; configuration is in `README.md`.

## Complaint hash (web app, `/report`)
The web app sends `{ text, targetAddress?, timezone }` to `POST /extract`. `timezone` is the viewer's IANA zone from `Intl.DateTimeFormat().resolvedOptions().timeZone`. It requires the response field `text` and recomputes `hashBundle({ text, complaint, dataSource })` with the text the backend returned. The report button stays disabled unless that equals `complaintHash`.

## Web app environment (`apps/web/.env.local`)
These are all the variables `apps/web` reads. Each is validated at startup, and a problem shows a configuration-error screen naming the variable.

| Variable | Rule |
|---|---|
| `NEXT_PUBLIC_RPC_URL` | http or https URL |
| `NEXT_PUBLIC_LOG_CHUNK_SIZE` | whole number, at least 1, and within the RPC provider's `eth_getLogs` block-range limit |
| `NEXT_PUBLIC_EXPLORER_URL` | http or https URL; required when `NEXT_PUBLIC_DEPLOYMENT` is `target` |
| `NEXT_PUBLIC_DEPLOYMENT` | `target` or `localhost` |
| `NEXT_PUBLIC_DATA_SOURCE` | `synthetic` or `testnet` |
| `NEXT_PUBLIC_BACKEND_URL` | http or https URL |
| `NEXT_PUBLIC_VOICE_LANG` | BCP-47 language tag |

`STAKEOUT_LOCAL_RPC_URL` is read only by the web tests, to include the local-node checks.

## Local chain
- `EXPLORER_API_KEY` in `.env.localhost` may be empty or left out; both behave the same, and the deploy prints that explorer verification is skipped on the local chain. It is required only for `deploy:target`, and an empty or missing value there stops with `EXPLORER_API_KEY: is missing. It is required to verify contracts on the explorer when deploying to a non-local chain`.
- `npm run seed:local` refuses to run unless the node reports the Hardhat config's local chain id and identifies as a Hardhat node. `VERIFIER_ADDRESS` may be any address, including your real verifier: the script impersonates it with `hardhat_impersonateAccount`, raises its local balance with `hardhat_setBalance` if it is below the Hardhat account balance, calls `confirm` and `link` as that verifier, and stops impersonating. Contract roles are not changed. The reviewer must still be one of the node's accounts.
