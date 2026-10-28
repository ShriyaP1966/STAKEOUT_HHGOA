# Trust model: who has to be trusted, and for what

Sources: `contracts/Stakeout.sol`, `contracts/StakeoutGuard.sol`, `shared/abi/Stakeout.json`, `AGENTS.md` section 4, `README.md` ("Trust points", "Deployment"), `deployments/network.json`. Nothing here was taken from outside the repo. Where the repo does not say, this document says UNKNOWN.

AGENTS.md names two trust points: "the reviewer multisig whitelists reporters and decides disputes. One verifier role posts `confirm` and `link`." This document spells out what each can and cannot do on-chain, from the contract code.

## The two trust points

| | Verifier | Reviewer |
|---|---|---|
| Roles held | `VERIFIER_ROLE` | `DEFAULT_ADMIN_ROLE` and `REVIEWER_ROLE` (both granted to the `reviewer` address in the constructor) |
| Who it is in the deployment | account `0x5E921119a5168006F82Dfc295242e23b7328cD61` | account `0xD164fAD1C47dCbF56Ded1BA7eA44F87CD2C0b6e9`; the README says this is a Safe multisig (field `reviewer` is "Reviewer Safe") |
| Kind | one account (README: "One verifier account") | a Safe with three owners and a signature threshold. **The actual owners and threshold: UNKNOWN in the repo** (`SAFE_OWNERS` and `SAFE_THRESHOLD` live in the git-ignored `.env`) |
| Chain | chain id 84532 (as in `deployments/network.json`) | same |

(Addresses and parameters are copied from `deployments/network.json`; check that file for the current values.)

## What the verifier can do (only `confirm` and `link`)
- **`confirm(clusterId, members[], exitPoints[], evidenceHash)`**: records a cluster. It reverts unless: `clusterId` and `evidenceHash` are non-zero; the number of addresses (members plus exit points together) is between 1 and `maxMembersPerCall`; no address is repeated or zero; no address is already in a cluster; and at least one member has a live, unchallenged flag (`NoLiveFlaggedMember`; a member whose flag is challenged reverts with `MemberFlagChallenged`).
- Side effect of a successful `confirm`: the live flag on each such member becomes `Confirmed` and the flagger's stake is credited back to the flagger's withdrawable credit. The verifier does not receive any funds.
- **`link(target, clusterId, evidenceHash)`**: adds one address to an existing cluster with role `Linked`. It reverts unless the cluster exists, the hash is non-zero, and the address is non-zero and not already in a cluster. It needs no flag.
- Effect of being in a cluster: `getStatus` returns `Confirmed` (members and exit points) or `Linked`, and `StakeoutGuard.sendTo` refuses to forward funds to that address.

## What the verifier cannot do
From the contract code, every one of these is restricted to another role or to nobody:
- resolve a dispute, slash a stake, or send anything to the reward pool (`resolve`: reviewer);
- remove a cluster entry (`removeMember`: reviewer);
- whitelist reporters (`addVerifiedReporter`: reviewer);
- pay out the reward pool (`payReward`: reviewer);
- change `minStake`, `flagDuration` or `maxMembersPerCall` (immutable: set in the constructor, no setter exists);
- grant or revoke roles (see the reviewer section);
- move ETH to itself: the contract only ever credits `flagger` and `challenger` (via `expire`, `confirm`, `resolve`) and `payReward` recipients, and funds leave only through `withdraw`, which pays the caller's own credit.

## What the verifier is trusted for (the real exposure)
**The contract does not check the evidence.** It requires `evidenceHash` to be non-zero and nothing more. It cannot tell whether a cluster is real. So a wrong or malicious verifier can:
- put any address that is not yet in a cluster on the blocklist side (`Confirmed` or `Linked`), as long as one member of the same `confirm` call has a live unchallenged flag (for `confirm`) or the cluster exists (for `link`, which needs no flag);
- thereby make `StakeoutGuard.sendTo` refuse payments to that address, and make `promote` revert for it (`AlreadyInCluster`).
It cannot undo that itself. The reviewer can remove an entry with `removeMember`.
Because the hash is on-chain, anyone can compare a published evidence bundle with the hash. That makes a false claim checkable; it does not stop it.

## What the reviewer can do
- `resolve(flagId, flagUpheld)` for a flag that is active and challenged. If upheld, the challenger's stake goes to `rewardPool` and the flag gets a fresh deadline; if not, the flagger's stake goes to `rewardPool`, the challenger's stake is credited back, and the flag becomes `Overturned`.
- `removeMember(target)`: removes any cluster entry.
- `addVerifiedReporter(account)`: grants `REPORTER_ROLE`.
- `payReward(recipient, amount)`: moves any amount up to `rewardPool` to any recipient's withdrawable credit. The README states: "Funds in `rewardPool` leave only through `payReward`, which only the reviewer Safe can call." So whoever controls the Safe controls the whole reward pool.
- Because it holds `DEFAULT_ADMIN_ROLE`: the README says the reviewer "rotates the verifier", and `scripts/safe-calldata.ts` is documented to produce `grantVerifier` and `revokeVerifier` calldata. The ABI exposes `grantRole`, `revokeRole`, `getRoleAdmin`, `renounceRole`. The contract source never calls `_setRoleAdmin`, so OpenZeppelin AccessControl's default applies, under which `DEFAULT_ADMIN_ROLE` administers every role. **That default is OpenZeppelin's documented behavior; the OpenZeppelin source is not in this repo (not installed), so it is UNVERIFIED here.** The practical consequence if it holds: the reviewer can add or remove any verifier, any reporter, and itself.

## What the reviewer cannot do
- call `confirm` or `link` directly, unless it first grants `VERIFIER_ROLE` to an account it controls (it can, per the default above);
- change the immutable parameters;
- touch individual credits directly (credits move only through `withdraw` for the account itself, and `payReward` from the pool);
- resolve a flag that is not challenged (`FlagNotChallenged`), or one that is no longer active.

## Everyone else
- **Anyone** can `report` (free, no access control; it only affects `Reported` status and `reportCount`), `expire` a flag past its deadline (full stake credited back to the flagger, no slashing), and `withdraw` their own credit. Free reports are open to spam; the contract limits nothing beyond gas.
- **Verified reporters** (`REPORTER_ROLE`) can `promote` (stake at least `minStake`, one live flag per target) and `challenge` (stake at least `minStake`; not their own flag).
- Parameters as deployed (from `deployments/network.json`): `minStake` 1000000000000000 wei, `flagDuration` 600 seconds, `maxMembersPerCall` 20.

## The off-chain parts the verifier relies on (this repo, `services/backend`)
These are not on-chain trust points, but a confirm is only as good as what feeds it:
- the Graph Service (Person 1) supplies behavior scores, clusters and link flags: PROPOSED interface, not yet agreed or built against a real service;
- `config/rules.json` supplies thresholds: PROPOSED, does not exist yet;
- the AI only writes a summary inside the evidence bundle; no decision reads it (AGENTS.md rule 7; `docs/person2-handoff.md`);
- the verifier service logs every outcome (`/decisions`) and, with `VERIFIER_DRY_RUN=true`, only simulates `confirm` and `link`.

## Single points of failure
1. The verifier's key: whoever holds it can post any `confirm` or `link` the contract's conditions allow. **How the key is held and who can reach it: UNKNOWN in the repo** (the service reads `VERIFIER_PRIVATE_KEY` from a local `.env`).
2. The reviewer Safe's owner set and threshold: UNKNOWN in the repo (see above).
3. The correctness of the Graph Service and the rules file, which the contract cannot check.

## Decentralization roadmap
**UNKNOWN in this repo.** `AGENTS.md` names the two trust points but states no roadmap, and neither `README.md` nor any other document here describes one. Do not present any roadmap as a repo fact. (The plan PDF shared with the backend owner lists future directions; that PDF is not in this repo, so it is not repeated here.)
What the code already allows without a change to the contract: the reviewer can grant `VERIFIER_ROLE` to more than one account, subject to the OpenZeppelin default noted above. Whether the verifier service could run as several verifiers: UNKNOWN (it is written as a single process with one key).
