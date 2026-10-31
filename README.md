# Stakeout

Stakeout is a scam oracle for crypto wallets. Victims report suspicious addresses for free. Verified reporters stake to promote a report into a time-limited flag. A flag is confirmed only when a verifier posts graph evidence that the target wallet's own behavior matches a scam pattern. Any wallet or contract can call `getStatus(address)`.

Hackathon project. Testnet only. Synthetic data only.

## Repository layout

| Folder | Contents | Owner |
|---|---|---|
| `contracts` | `Stakeout.sol`, `StakeoutGuard.sol`, test-only helpers in `contracts/test` | Person 3 |
| `test` | Hardhat tests for the contracts | Person 3 |
| `apps/web` | Next.js web app: `/wallet`, `/report`, `/verify`, `/dashboard`, `/decisions`, `/reviewer` | Person 3 |
| `services/graph` | Graph service (Python, FastAPI, TigerGraph); see `services/graph/README.md` | Person 1 (first version), Person 2 (completed) |
| `services/backend` | Backend, AI, verifier service | Person 2 |
| `shared` | `enums.ts`, exported contract ABIs in `shared/abi`, the hash library in `shared/hash`, schemas in `shared/schemas`, and the voice component in `shared/ui` | All |
| `config` | Shared configuration agreed by the team: `rules.json` (verifier thresholds, read through `RULES_PATH`) and `scoring.json` (graph behaviour scoring, read by the graph service) | All |
| `deployments` | Deployed contract addresses per network | All |
| `docs` | Team documentation, including `docs/person2-handoff.md` | All |
| `scripts` | Deploy, seed, ABI export, and Safe calldata scripts | Person 3 |

Read `AGENTS.md` before changing anything.

## Setup

Prerequisites:

| Part | Runtime |
|---|---|
| Contracts, scripts and web app | Node.js and **npm 11 or newer**. Tested with Node 26.8.1 and npm 11.19.0. npm 10 (the default with Node 22) fails `npm ci` in `apps/web` with "Missing: zod@3.25.76 from lock file", because the lockfile was written by npm 11; `apps/web/package.json` declares `engines.npm` `>=11` |
| Backend and verifier (`services/backend`) | **Node 24** (`>=24 <25`, enforced by its `package.json`; `services/backend/.nvmrc` is `24`). Use Node 24 in the terminal that runs it |
| Graph service (`services/graph`) | Python. Tested on Python 3.13.15; see `services/graph/README.md` |

Install every part from the repo root:

```sh
npm ci
npm ci --prefix shared/hash
npm ci --prefix apps/web
npm ci --ignore-scripts --prefix services/backend
```

`shared/hash` is installed separately because the web app and the backend both import it and it brings its own copy of ethers. The backend needs `--ignore-scripts` on Windows; its README explains why. The graph service uses its own Python environment: follow "Install" in `services/graph/README.md`.

npm may warn that install scripts are not covered by `allowScripts`, for example for `utf-8-validate` (pulled in by the wallet libraries), `keccak` or `secp256k1`. npm skips those native build steps, and each of these packages then loads its built-in JavaScript version instead, so the warning needs no action.

Then check the contracts and the web app:

```sh
npm run compile
npm test
npm run web:test
```

Create the env files you need from the examples. Each one is git-ignored:

| File | Copy from | Used by |
|---|---|---|
| `.env` | `.env.example` | `deploy:target` and `safe:calldata -- target` |
| `.env.localhost` | `.env.example` | `deploy:local`, `seed:local`, and `safe:calldata -- localhost` |
| `apps/web/.env.local` | `apps/web/.env.example` | The web app at build and dev time |
| `services/backend/.env` | `services/backend/.env.example` | The backend and the verifier. Every variable is required and described in `services/backend/README.md`. `LISTEN_HOST` is the IP address the backend binds to: set `127.0.0.1` so it listens on this machine only, which is all the web app needs (it reaches the backend through its own `/backend/*` path). Without it the backend stops with a config error naming `LISTEN_HOST` |
| `services/graph/.env` | `services/graph/.env.example` | The graph service; variables are described in `services/graph/README.md` |

Without them, contract compile and tests still work, and the web app builds but shows a configuration-error screen.

## Commands

| Task | Command |
|---|---|
| Install dependencies | `npm ci` |
| Compile contracts and generate typings | `npm run compile` |
| Run tests | `npm test` |
| Coverage report | `npm run coverage` |
| Lint Solidity | `npm run lint` |
| Type-check TypeScript | `npm run typecheck` |
| Export ABIs to `shared/abi` | `npm run export-abi` |
| Start a local chain | `npm run node:local` |
| Deploy to the local chain | `npm run deploy:local` |
| Create a deployer wallet in `.env` | `npm run gen:deployer` |
| Validate `.env` and show the deployer balance | `npm run check:env` |
| Create the reviewer Safe | `npm run create:safe` |
| Check everything before a testnet deploy, without deploying | `npm run deploy:check` |
| Deploy to the target network | `npm run deploy:target` |
| Check a deployment on chain | `npm run check:deployment -- <network> [--verifier-rotated]` |
| Verify deployed contracts on the explorer | `npm run verify:target` (needs only `RPC_URL`, `CHAIN_ID` and `EXPLORER_API_KEY` in `.env`; constructor arguments are read from the chain) |
| Send local test ETH | `npm run fund:local -- <recipient> <amountEth>` |
| Print Safe transaction calldata | `npm run safe:calldata -- <network> <action> <args>` |
| Seed synthetic data on the local chain | `npm run seed:local` |
| Install the web app | `npm ci --prefix apps/web` |
| Run the web app in development | `npm run web:dev` |
| Build the web app | `npm run web:build` |
| Test the web app | `npm run web:test` |
| Lint the web app | `npm --prefix apps/web run lint` |
| Type-check the web app | `npm --prefix apps/web run typecheck` |

## Configuration

`.env.example` lists every environment variable the code reads. Copy it and fill in values; never commit the filled copy.

| Network | Env file | Deployment file | Explorer verification |
|---|---|---|---|
| `target` | `.env` | `deployments/network.json` (committed hand-off) | Yes |
| `localhost` | `.env.localhost` | `deployments/localhost.json` (git-ignored) | Skipped |

| Variable | Meaning |
|---|---|
| `RPC_URL` | http or https RPC endpoint of the network |
| `CHAIN_ID` | Chain id the RPC endpoint must report |
| `DEPLOYER_PRIVATE_KEY` | Key of the funded account that sends the deploy transactions. It receives no role |
| `REVIEWER_ADDRESS` | Safe multisig that becomes admin and reviewer |
| `VERIFIER_ADDRESS` | Verifier service account, provided by the backend owner |
| `MIN_STAKE_WEI` | Minimum stake in wei |
| `FLAG_DURATION_SECONDS` | Flag lifetime in seconds |
| `MAX_MEMBERS_PER_CALL` | Maximum addresses per `confirm` call |
| `CONFIRMATIONS` | Blocks to wait after each deployment. Use 1 on a local node, which only mines on demand |
| `EXPLORER_API_KEY` | Block explorer API key. Required only when deploying to a non-local chain (`target`). On `localhost`, an empty `EXPLORER_API_KEY=` behaves exactly like an unset one, and explorer verification is skipped with a message |
| `SAFE_OWNERS` | Three distinct owner addresses for the reviewer Safe, separated by commas. Used by `create:safe` |
| `SAFE_THRESHOLD` | Owner signatures the Safe needs, from 1 to the number of owners |

Every value is validated before anything is sent. A missing or invalid variable stops the deploy and is named in the error. Values are never printed. The Hardhat `target` and `localhost` networks are built only from these files; nothing assumes a particular chain.

The contract takes its thresholds as constructor arguments, so nothing is hardcoded in Solidity:

| Argument | Meaning |
|---|---|
| `minStake` | Minimum wei for `promote` and `challenge` |
| `flagDuration` | Seconds a flag stays live without confirmation or challenge |
| `maxMembersPerCall` | Maximum total addresses in one `confirm` call |
| `reviewer` | Reviewer multisig: receives `DEFAULT_ADMIN_ROLE` and `REVIEWER_ROLE` |
| `verifier` | Verifier service account: receives `VERIFIER_ROLE` |

The deployer receives no role.

## Deployment

Target network:

```sh
cp .env.example .env
npm run gen:deployer
npm run check:env
npm run create:safe
npm run deploy:check
npm run deploy:target
```

1. `gen:deployer` creates a random deployer wallet, writes its key to `.env` only, and prints only its public address. It refuses if `DEPLOYER_PRIVATE_KEY` already has a value. Fund that address from a faucet for the testnet.
2. Fill `SAFE_OWNERS`, `SAFE_THRESHOLD`, `VERIFIER_ADDRESS`, and `EXPLORER_API_KEY`. `check:env` validates every variable, rejects a verifier that is the deployer or a Safe owner, and prints the deployer balance.
3. `create:safe` deploys a Safe with exactly those owners and threshold. The deployer only pays gas and is not an owner unless it is listed. It writes the Safe address to `REVIEWER_ADDRESS`, reads the owners and threshold back from the chain, and refuses to run when `REVIEWER_ADDRESS` already has a value.
4. `deploy:check` runs every check without deploying, including that the Safe on chain matches `SAFE_OWNERS` and `SAFE_THRESHOLD`.

These scripts and `deploy:target` refuse to run unless the RPC endpoint reports `CHAIN_ID` and viem's chain list marks that chain as a testnet.

Local chain:

```sh
npm run node:local
npm run deploy:local
```

Run the second command in another terminal after creating `.env.localhost` with the same variable names. `EXPLORER_API_KEY` may be left empty or left out. The local node prints funded throwaway accounts.

The deploy script checks that the RPC chain id matches `CHAIN_ID`, deploys `Stakeout` and then `StakeoutGuard`, waits for `CONFIRMATIONS`, and confirms the role grants on chain. It then writes the deployment file and copies the ABIs to `shared/abi/Stakeout.json` and `shared/abi/StakeoutGuard.json`. On `target` it verifies both contracts on the explorer. On `localhost` it prints that verification is skipped because the chain is local. If verification fails, it prints the reason and the manual `npx hardhat verify` command, and the deploy still succeeds.

### Hand-off file

`deployments/network.json` is what the graph and verifier services read. The verifier reads events starting at `deploymentBlock`.

| Field | Type | Meaning |
|---|---|---|
| `chainId` | number | Chain id |
| `stakeoutAddress` | string | `Stakeout` address |
| `guardAddress` | string | `StakeoutGuard` address |
| `deploymentBlock` | number | Block that contains the `Stakeout` deployment |
| `reviewer` | string | Reviewer Safe |
| `verifier` | string | Verifier account |
| `minStake` | string | Minimum stake in wei, as a decimal string |
| `flagDuration` | number | Flag lifetime in seconds |
| `maxMembersPerCall` | number | Maximum addresses per `confirm` call |
| `deployedAt` | string | ISO 8601 timestamp of the deployment block |

The three parameters are read back from the deployed contract, not copied from the env file.

### Safe transactions

The reviewer is a Safe, so reviewer actions go through the Safe transaction builder. The helper prints the target address, value, and encoded calldata. It never sends anything.

```sh
npm run safe:calldata -- target addVerifiedReporter <account>
npm run safe:calldata -- target resolve <flagId> <true|false>
npm run safe:calldata -- target removeMember <target>
npm run safe:calldata -- target grantVerifier <account>
npm run safe:calldata -- target revokeVerifier <account>
npm run safe:calldata -- target payReward <recipient> <amountWei>
```

It reads the contract address from the deployment file and `RPC_URL` and `CHAIN_ID` from the network's env file. It checks that contract code exists there, and reads `VERIFIER_ROLE` from the contract. Paste `to`, `value`, and `data` into the Safe transaction builder.

To replace the verifier, put the new address in `VERIFIER_ADDRESS`, then submit `grantVerifier` for the new address and `revokeVerifier` for the `verifier` in the deployment file as one Safe batch. After it executes, `npm run check:deployment -- target --verifier-rotated` confirms on chain that the new address has `VERIFIER_ROLE` and the old one does not, then updates `verifier` in the deployment file. It changes nothing if the roles do not match.

### Local seed data

`npm run seed:local` runs only on the `localhost` network, and only when the node reports the local Hardhat chain id from the Hardhat config and identifies itself as a Hardhat node; on any other chain it refuses to run. `deployments/localhost.json` must match the running node. It sends real transactions from the node's unlocked accounts. The reviewer must be one of the node's accounts. The verifier may be any address: if it is not one of the node's accounts, the script uses `hardhat_impersonateAccount` to act as it, raises its balance with `hardhat_setBalance` to the Hardhat config's account balance when it is lower, calls `confirm` and `link` as that verifier, and then stops impersonating. Contract roles are not changed. Each run creates fresh random target addresses: one with no record, one reported, one flagged, one flagged and challenged, a confirmed member and exit point, and a linked address. It writes them to the git-ignored `deployments/localhost-seed.json`, labeled `"dataSource": "synthetic"`. The confirmation in this script is a local test fixture. It is not graph evidence.

## Web app

`apps/web` is a Next.js app with its own `package.json`. It reads:

- contract addresses, chain id, and `deploymentBlock` from the deployment file chosen by `NEXT_PUBLIC_DEPLOYMENT`
- ABIs from `shared/abi`
- `Status`, `Role`, and `FlagState` from `shared/enums.ts`
- `hashBundle` from `shared/hash` and the voice component from `shared/ui/VoiceInput.tsx`, imported in place, never copied
- the backend in `services/backend` through the same-origin path `/backend/*`, which `next.config.ts` forwards to `NEXT_PUBLIC_BACKEND_URL`, because the backend sends no CORS headers

Install `shared/hash` once with `npm ci --prefix shared/hash`, because it brings its own copy of ethers.

| Variable (in `apps/web/.env.local`) | Meaning |
|---|---|
| `NEXT_PUBLIC_RPC_URL` | http or https RPC endpoint used for all reads |
| `NEXT_PUBLIC_LOG_CHUNK_SIZE` | Blocks per `getLogs` request when reading events from `deploymentBlock`. Must not exceed the RPC provider's block-range limit. Measured on 2026-10-30 for Base Sepolia: `https://sepolia.base.org` allows 200 (about 2,700 requests and 15 minutes to read the full history), `https://base-sepolia-rpc.publicnode.com` allows 50,000 (11 requests, about 4 seconds), `https://base-sepolia.gateway.tenderly.co` allows 100,000. Both larger endpoints returned the same complete event history. For the testnet demo use publicnode with `50000`. Public limits can change without notice, so reload the Dashboard before a demo |
| `NEXT_PUBLIC_EXPLORER_URL` | Block explorer base URL. Links use `/address/<a>` and `/tx/<hash>`. Required for `target`, optional for `localhost` |
| `NEXT_PUBLIC_DEPLOYMENT` | `target` reads `deployments/network.json`; `localhost` reads `deployments/localhost.json` |
| `NEXT_PUBLIC_DATA_SOURCE` | `synthetic` or `testnet`. Shown on every screen |
| `NEXT_PUBLIC_BACKEND_URL` | http or https base URL of the backend in `services/backend` |
| `NEXT_PUBLIC_GRAPH_URL` | http or https base URL of the graph service in `services/graph`. The browser reaches it through the same-origin path `/graph/*`, which `next.config.ts` forwards here, because the graph service sends no CORS headers |
| `NEXT_PUBLIC_VOICE_LANG` | BCP-47 language tag passed to the voice component, for example `en-US` |
| `NEXT_PUBLIC_SITE_URL` | Optional. Public http or https base URL of the deployed site. Used as the base for absolute links in page metadata (link previews), for the `Sitemap` line in `/robots.txt`, and for the page list in `/sitemap.xml`. Leave it empty locally: the app works the same, `/robots.txt` has no sitemap line and `/sitemap.xml` is empty. A value that is not an http or https URL is treated as empty |

Next.js inlines these values at build time, so rebuild after changing them. If any value is missing or invalid, or the deployment file is missing or malformed, every page shows a configuration-error screen that names each problem.

| Page | What it shows |
|---|---|
| `/wallet` | Checks any address with `getStatus` and shows a warning matched to the status: none, a note for Reported, a soft warning with a countdown for Flagged, a strong warning with the cluster id for Confirmed and Linked. Shows the evidence hash from the matching event. Sends go through `StakeoutGuard.sendTo`, and a blocked send shows the decoded `Blocked` error |
| `/dashboard` | Reports, flags with live countdowns, clusters with members, exit points, and linked addresses, and reward payouts, all from events. Rows link to the explorer. Verified reporters can promote Reported targets and challenge live flags; anyone can expire a lapsed, unchallenged flag. A panel shows the connected wallet's credit with a Withdraw button |
| `/report` | Complaint text box with voice input. Sends the text and the viewer's IANA time zone (`timezone`, from the browser) to `POST /extract`, shows the structured complaint and `dataSource`, recomputes the complaint hash as `hashBundle({ text, complaint, dataSource })` using the text the backend returned, and only if it matches lets the user call `report(targetAddress, complaintHash)` |
| `/verify` | Takes a hash, fetches the bundle from `GET /evidence/{hash}`, and shows three results: whether a `ReportSubmitted`, `Confirmed`, or `Linked` event carries the hash, whether the recomputed hash matches, and the bundle's `dataSource` |
| `/decisions` | The verifier's decisions from `GET /decisions`: target, kind, outcome, rule, reason, time, and transaction |
| `/cluster/[id]` | The money trail of one cluster from the graph service's `GET /cluster/{clusterId}/graph`: a force-directed graph of wallets and transfers coloured by the role the graph returns (member, exit point, counterparty), the data source of every wallet, and readable lists of the wallets and transfers. The id must be 0x plus 64 hex characters. Linked from each cluster on `/dashboard` and from Confirmed and Linked addresses on `/wallet`. Loading, empty, invalid-id and unreachable-service states are shown, never placeholder data |
| `/reviewer` | Read-only view of open challenges, verified reporters, and the reward pool, plus the exact `npm run safe:calldata` command for each reviewer action. Actions go through the reviewer Safe |

For Confirmed and Linked addresses, `/wallet` also fetches the evidence bundle for the event's hash and shows `aiSummary.text`, `aiSummary.source`, and `dataSource`. Every page that needs the backend shows a clear error when it is unreachable, never placeholder data.

On-chain buttons read the stake from `minStake()` and show it before sending. Promote and challenge appear only for accounts with `REPORTER_ROLE`; when a button is hidden or disabled, one line says why. Each action shows pending, confirmed, or failed with the transaction linked, decodes contract errors, and refreshes statuses and balances when it confirms. On `/wallet`, a Reported address can be promoted directly. On `/report`, if the complaint mentions more than one valid address, the user picks the one that received the money, and it is sent to the backend as `targetAddress`.

Local run:

```sh
npm run node:local
npm run deploy:local
npm run seed:local
npm ci --prefix apps/web
npm run web:dev
```

The hosted demo at https://stakeout-six.vercel.app is connected to a read-only backend (`EXPOSE_WRITE_ROUTES=false`), so `/report` there says reporting is disabled; `/wallet`, `/verify`, `/dashboard`, `/decisions` and the money trail work. Reporting needs the full backend running locally, as below.

Run the commands after the first in a second terminal. Start the backend as described in `docs/person2-handoff.md` for `/report`, `/verify`, `/decisions`, and the `/wallet` summaries. Before `web:dev`, create `apps/web/.env.local` with `NEXT_PUBLIC_DEPLOYMENT=localhost`, `NEXT_PUBLIC_DATA_SOURCE=synthetic`, and the backend URL. To point a browser wallet at the local node, add a network with the node's RPC URL and chain id, and import one of the throwaway accounts the node prints.

`npm run web:test` skips the local-node tests by default. To run them against a seeded local chain, set `STAKEOUT_LOCAL_RPC_URL` to the node's RPC URL for that one command, for example `STAKEOUT_LOCAL_RPC_URL=http://127.0.0.1:8545 npm run web:test` in a POSIX shell.

## Contracts

### Stakeout

Statuses: `None=0, Reported=1, Flagged=2, Confirmed=3, Linked=4`. Cluster roles: `None=0, Member=1, ExitPoint=2, Linked=3`. The same values are exported from `shared/enums.ts`.

| Function | Caller | Effect |
|---|---|---|
| `report(target, evidenceHash)` | Anyone | Free report, returns its id |
| `promote(reportId)` | `REPORTER_ROLE`, payable | Stakes at least `minStake` to flag the report's target until `now + flagDuration` |
| `expire(flagId)` | Anyone | After the deadline, an unchallenged flag lapses and the full stake is credited back |
| `confirm(clusterId, members, exitPoints, evidenceHash)` | `VERIFIER_ROLE` | Records a cluster. At least one member must have a live, unchallenged flag. Those flags are confirmed and their stakes credited back |
| `link(target, clusterId, evidenceHash)` | `VERIFIER_ROLE` | Adds one address to an existing cluster as `Linked` |
| `challenge(flagId)` | `REPORTER_ROLE`, payable | Stakes at least `minStake` against a live flag. Pauses its expiry |
| `resolve(flagId, flagUpheld)` | `REVIEWER_ROLE` | Upheld: challenger stake goes to `rewardPool`, the flag gets a fresh deadline. Overturned: flagger stake goes to `rewardPool`, challenger stake is credited back |
| `removeMember(target)` | `REVIEWER_ROLE` | Removes an address from its cluster |
| `addVerifiedReporter(account)` | `REVIEWER_ROLE` | Grants `REPORTER_ROLE` |
| `withdraw()` | Anyone with credit | Pull payment of the caller's credit |
| `payReward(recipient, amount)` | `REVIEWER_ROLE` | Moves `amount` from `rewardPool` to the recipient's credit, which they collect with `withdraw`. Reverts with `RewardExceedsPool(requested, available)` above the pool |
| `getStatus(address)` | Anyone, view | `(status, clusterId, role, expiresAt)`. Never reverts |

A flag is live while it is `Active` and either challenged or before its deadline. `getStatus` checks the cluster entry first, then a live flag, then whether any report exists. A flag whose deadline has passed shows as `Reported` even before anyone calls `expire`.

Reporter removal and verifier rotation use the standard `grantRole` and `revokeRole`, called by the reviewer.

### StakeoutGuard

`sendTo(to)` forwards the attached value to `to` unless `getStatus(to)` is `Confirmed` or `Linked`, in which case it reverts with `Blocked(to, status)`. `isAllowed(account)` returns the same decision as a view.

### Events

```
ReportSubmitted(uint256 indexed reportId, address indexed target, address indexed reporter, bytes32 evidenceHash)
Promoted(uint256 indexed flagId, uint256 indexed reportId, address indexed target, address flagger, uint256 stake, uint64 expiresAt)
Expired(uint256 indexed flagId, address indexed target)
Confirmed(bytes32 indexed clusterId, address[] members, address[] exitPoints, bytes32 evidenceHash)
Linked(address indexed target, bytes32 indexed clusterId, bytes32 evidenceHash)
Challenged(uint256 indexed flagId, address indexed challenger, uint256 stake)
Resolved(uint256 indexed flagId, bool flagUpheld)
MemberRemoved(address indexed target, bytes32 indexed clusterId)
Withdrawn(address indexed account, uint256 amount)
```

## Trust points

- The reviewer multisig holds `DEFAULT_ADMIN_ROLE` and `REVIEWER_ROLE`. It whitelists and removes reporters, rotates the verifier, removes cluster entries, and decides challenges.
- One verifier account holds `VERIFIER_ROLE` and posts every `confirm` and `link`.
- Funds in `rewardPool` leave only through `payReward`, which only the reviewer Safe can call.
