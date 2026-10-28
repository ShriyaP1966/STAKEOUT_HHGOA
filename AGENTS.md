# AGENTS.md: Stakeout rules for coding agents

Read this file fully before changing anything. These rules come from the team plan and override your own defaults. If a rule conflicts with a task, stop and ask the human.

## 1. What this project is

Stakeout is a scam oracle for crypto wallets. Victims report free. A graph (TigerGraph) and AI trace the money. Verified reporters stake to promote a report into a flag. A flag is confirmed only when the target wallet's own behavior matches a scam pattern. Any wallet or contract can call `getStatus(address)`.

Hackathon project, testnet only, synthetic data only.

## 2. Who owns what (stay in your lane)

| Area | Folder | Owner |
|---|---|---|
| Graph Service (Python, FastAPI, TigerGraph) | `services/graph` | Person 1 |
| Backend, AI, verifier service (TypeScript) | `services/backend` | Person 2 |
| Smart contracts | `contracts` | Person 3 |
| Web app (Next.js) | `apps/web` | Person 3 |
| Shared enums, schemas, hash lib, deployments | `shared`, `config`, `deployments` | Agreed by all |

- Only edit files in the folder the current task belongs to.
- Do NOT change anything in `shared/`, `config/`, the contract interface, or the enums without an explicit human instruction. Other people's code depends on them. If you think a change is needed, write it down and ask.

## 3. Hard rules (never break these)

1. **NO HARDCODING.** Never type any of these into source code or UI text:
   - wallet addresses, cluster ids, transaction hashes, report ids
   - statuses, scores, thresholds, time limits, minimum stake
   - API keys, private keys, RPC URLs, chain ids, contract addresses, model names
   These come from `.env`, `config/*.json`, `deployments/*.json`, the contract, or the graph.
2. **No fake demo logic.** Never write code like "if address equals X, show a warning". A warning must come from a real `getStatus` call. The app must work for any address.
3. **Secrets.** Never write secrets into any file except a local, git-ignored `.env`. Update `.env.example` with variable NAMES only (empty values). Never print or log secrets.
4. **Testnet only.** No real funds, no mainnet configuration.
5. **Label data.** Every evidence bundle and screen shows `dataSource` (`synthetic` or `testnet`). Never present generated data as real victims.
6. **"Recorded run" means real.** A stored result is allowed only if the real pipeline produced it. Show its timestamp. Never hand-edit it.
7. **The AI explains; it never confirms.** Confirmation comes from graph behavior plus rules in `config/rules.json`, posted by the verifier role.
8. **Validate inputs in code.** Addresses are checked with library functions, never by an LLM.
9. **Fail loudly.** Missing config stops the program with a clear message. Never swallow errors.
10. **No personal data on-chain.** Only hashes and addresses.
11. **Do not invent.** Do not fabricate APIs, sponsor features, test results, numbers or sources. If you do not know, say so and ask.

## 4. Shared design rules

Statuses (fixed order): `None=0, Reported=1, Flagged=2, Confirmed=3, Linked=4`. Roles: `None, Member, ExitPoint, Linked`.

**Confirmation rule:** the target wallet's own behavior (rapid splitting, merging, forwarding, flows to exit points) is REQUIRED. Reports from unrelated victims may only add confidence. Never confirm on reports alone.

**Linking rule:** ignore inbound funding alone (dusting). A wallet is Linked only if it sends funds into the cluster or exit points in a repeated, structured way, or is funded by the cluster AND then forwards onward like a member. Exclude known victims and one-off payers.

**Stake expiry:** a flag with no confirmation and no open challenge lapses after the configured time limit. The stake is returned in full, with no slashing. An open challenge pauses expiry. `getStatus` shows a timed-out flag as Reported.

**Cluster mapping:** `confirm` takes member and exit-point lists and stores address to (clusterId, role). `link` adds one address. `getStatus` reads this map. Lookup order: cluster entry, then active flag, then report, then None.

**Contract functions:** `report`, `promote` (stake), `expire`, `confirm`, `link`, `challenge` (stake), `resolve`, `removeMember`, `addVerifiedReporter`, `withdraw`, `getStatus`. Use pull payments and reentrancy protection. Emit events for every state change.

**Trust points (document them, never hide them):** the reviewer multisig whitelists reporters and decides disputes. One verifier role posts `confirm` and `link`.

## 5. How to work on a task

1. Read the task and the matching section of the team plan. Restate what "complete" means for it.
2. Make a short plan. Prefer small changes that can be tested by hand.
3. Use existing config and shared files. Add configuration instead of constants.
4. Do not add new dependencies without saying which and why. Pin versions through the lockfile.
5. Keep code readable. Small functions, clear names, comments only where the reason is not obvious.
6. When finished, report: what changed, which files, how to test it by hand, and anything left undone.
7. If the spec is ambiguous, blocked, or would need a shared interface change, stop and ask. Do not guess.

## 6. Definition of done

A task is done only if ALL are true:
- It meets the "complete" criteria in the team plan for that task.
- No hardcoded values (see the audit below).
- It works with a different address, seed, or config value than the one you tested with.
- Errors and empty states are handled and visible.
- `.env.example` and the README are updated if configuration changed.
- You have listed the manual test steps and clearly marked which you actually ran and which a human must run (browser, wallet, block explorer).

**Never claim a manual test passed unless you ran it and saw the result.** Report real command output, not what you expect.

## 7. Hardcoding audit (run before declaring done)

- Search source for address-like strings: `grep -rEn "0x[a-fA-F0-9]{40}" services apps contracts --include=*.ts --include=*.tsx --include=*.py --include=*.sol` (allowed only in tests clearly marked as fixtures).
- Search for key-like words: `grep -rEin "private_?key|api_?key|secret" services apps contracts` and make sure only variable names appear, never values.
- Change a value in `config/*.json`, restart, and confirm behavior changes.
- Run the feature with a new generated seed or address and confirm it still works.

## 8. Commands

Fill these in once the repo exists (Person 3 owns this section):

- Install: TBD
- Run graph service: TBD
- Run backend and verifier: TBD
- Run web app: TBD
- Deploy contract to testnet: TBD
- Load synthetic scenario: TBD

## 9. When to stop and ask a human

- A change to `shared/`, `config/`, the contract interface, or enums.
- Anything involving real keys, mainnet, real funds, or real personal data.
- A sponsor API behaves differently from the plan.
- You cannot make a test pass without hardcoding. Do not hardcode; ask.
