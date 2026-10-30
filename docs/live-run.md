# Live run on Base Sepolia: runbook

Synthetic data only, testnet only. Every fact below comes from a file in this repo (named in brackets), or from the 2026-10-30 live run and marked "observed 2026-10-30". Anything neither source confirms is marked **unconfirmed** and collected in the list at the end. No `.env` file was read to write this; only the `.env.example` files.

Services involved: the Graph Service (`services/graph`, Python) answers questions about a wallet; the verifier (`services/backend`, TypeScript, `npm run verifier`) watches the chain and posts `confirm` and `link`. They are separate processes.

## 1. Prerequisites

**TigerGraph.** The graph lives on a TigerGraph Cloud (Savanna) workspace; `TG_HOST` is a full URL such as `https://<workspace>.tgcloud.io` [services/graph/README.md]. The workspace must be running and the graph must already be set up and loaded (`python scripts/setup_graph.py`, then `python -m graph.generate --seed <n>` and `python -m graph.load`, from `services/graph`) [services/graph/README.md]. What the console shows for a running workspace ("Active") is **unconfirmed**; the repo never says.

**`services/graph/.env`** (names only, from `services/graph/.env.example`): `TG_HOST`, `TG_PORT`, `TG_USERNAME`, `TG_PASSWORD`, `TG_SECRET`, `TG_GRAPH_NAME`, `SCENARIO_SEED`, `GRAPH_SERVICE_PORT`. Nothing has a default; a missing value stops the program and names the variable. `TG_SECRET` replaces `TG_USERNAME` and `TG_PASSWORD` when set. `TG_PORT` is not needed for a `tgcloud` host [services/graph/README.md].

**`services/backend/.env`** (names only, from `services/backend/.env.example`). The ones the verifier reads are in `verifierEnv` and `llmEnv` in `services/backend/src/config.ts`:

| Group | Names |
|---|---|
| Graph | `GRAPH_SERVICE_URL`, `GRAPH_TIMEOUT_MS` |
| Chain | `RPC_URL`, `CHAIN_ID`, `RPC_TIMEOUT_MS`, `DEPLOYMENT_PATH`, `VERIFIER_PRIVATE_KEY` |
| Rules and storage | `RULES_PATH`, `DB_PATH`, `DATA_SOURCE` |
| Verifier loop | `VERIFIER_DRY_RUN`, `VERIFIER_POLL_INTERVAL_MS`, `VERIFIER_LOG_CHUNK_BLOCKS` |
| AI (writes the evidence summary only) | `LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL`, plus the retry and timeout names in `.env.example` |
| Optional | `NOTIFY_WEBHOOK_URL`, `NOTIFY_TIMEOUT_MS` |

Consistency rules from the code and README: `CHAIN_ID` must match the node, and the deployment file's chain id (a mismatch is refused). `DATA_SOURCE` is `synthetic` or `testnet` and the graph's own label must agree with it [services/backend/README.md]. `GRAPH_SERVICE_URL` must point at the port the graph service listens on (`GRAPH_SERVICE_PORT`). Never print or paste a `.env`.

## 2. Start the Graph Service and check it

From `services/graph` with the virtual environment active (install steps are in `services/graph/README.md`):

```
python scripts/run_service.py
```

It listens on `127.0.0.1` at `GRAPH_SERVICE_PORT` [scripts/run_service.py]. Importing the app connects to TigerGraph and reads `config/scoring.json`; any problem prints `Graph Service cannot start: ...` and exits [app/main.py]. Startup output, observed 2026-10-30 (three starts, no bind error): `INFO: Started server process [<pid>]`, `Waiting for application startup.`, `Application startup complete.`, `Uvicorn running on http://127.0.0.1:8001 (Press CTRL+C to quit)`.

Checks (use `curl.exe` on Windows, as the graph README does):

```
curl.exe -i http://127.0.0.1:<GRAPH_SERVICE_PORT>/health
curl.exe -i http://127.0.0.1:<GRAPH_SERVICE_PORT>/analyze/<address>
```

- `/health` answers `{"status":"ok"}` [app/service.py]. It does not touch TigerGraph, so it proves the process is up, not that the graph answers.
- `/analyze/<address>`: 200 with `target`, `clusterId`, `behaviorScore`, `signals`, `metrics`, `members`, `exitPoints`, `unrelatedReporterCount`, `dataSource`. **`members` never contains an address that is also in `exitPoints`** (commit 1a9f8f9). 404 `No graph data for this address.` or `Wallet not found in the graph.` when the graph has no such wallet; 400 for a malformed address; 502 with TigerGraph's message for any other graph failure [app/service.py].
- Use a wallet that really is in the loaded graph: `python scripts/sample_addresses.py` lists examples (reads the test-only ground truth in `services/graph/data/`, so run `python -m graph.generate --seed N` first: `data/` is git-ignored and a fresh clone has none) [services/graph/README.md].

## 3. Start the verifier

From the repo root:

```
npm --prefix services/backend run verifier
```

The form used in the 2026-10-30 run was `npm run verifier` from `services/backend`; the form above, from the repo root, was not run.

(The AGENTS.md command; npm runs it in `services/backend`, so it reads `services/backend/.env`.) Install first with `npm ci --ignore-scripts --prefix services/backend` [AGENTS.md section 8].

**Dry run first, then live.**
1. Set `VERIFIER_DRY_RUN=true`. `confirm` and `link` are only simulated against the node and logged as `skipped` with a reason starting `dry run (VERIFIER_DRY_RUN=true): the contract call was simulated successfully; nothing was sent` [actions.ts]. A human checks the decisions (section 4).
2. Stop the verifier, set `VERIFIER_DRY_RUN=false`, start it again. The startup line shows `dry run: false`.

**`RULES_PATH`** points at `config/rules.json`. Its fields today: `behaviorThreshold`, `minSignals`, `reportConfidenceBoostPerReporter`, `confirmationsToWait`. `confirmationsToWait` is how many blocks behind the head the verifier scans [watcher.ts]. A missing file stops the start with a message naming `RULES_PATH`.

**`DB_PATH`.** Keep the **same file** for the dry run and the live run only if you want the live run to continue where the dry run stopped. This matters: the file remembers the next block to scan (`verifier.nextBlock`) and every handled event, so events handled in the dry run are not handled again (see section 4). The server and the verifier share the file for evidence and the decision log [services/backend/README.md].

**`VERIFIER_LOG_CHUNK_BLOCKS` and RPC range limits.** Blocks per event request. It must not exceed the RPC provider's `eth_getLogs` block range. The root README documents, measured 2026-10-30 for Base Sepolia (that row is about the web app's `NEXT_PUBLIC_LOG_CHUNK_SIZE`, same kind of request): `https://sepolia.base.org` allows 200; `https://base-sepolia-rpc.publicnode.com` allows 50,000; `https://base-sepolia.gateway.tenderly.co` allows 100,000. Public limits can change without notice. That the verifier's own provider and limit are the same is **unconfirmed**; check the limit of the endpoint in your `RPC_URL`.

**What a first scan costs.** On a fresh `DB_PATH` the verifier starts at `deploymentBlock` from `deployments/network.json` and walks to the head in chunks, and each chunk makes two event queries (`Promoted` and `Confirmed`) [watcher.ts, contractClient.ts]. So requests ≈ 2 × (head − deploymentBlock) ÷ `VERIFIER_LOG_CHUNK_BLOCKS`. This is **derived from the code, not measured for the verifier**. For reference the root README measured the web app at about 2,700 requests and 15 minutes with a 200 range, and 11 requests and about 4 seconds with 50,000. The first scan also handles every old `Promoted` event it meets (section 4). Later polls only scan new blocks.

**Observed 2026-10-30:** the first scan from the deployment block took about 45 minutes with `https://sepolia.base.org` at 200 blocks per request. Not measured on other RPCs for the verifier.

**Scan position.** `verifier-status` does not show it. The scan position is the `verifier.nextBlock` key in the `kv` table of the SQLite file at `DB_PATH`.

**Expected startup line** [verifier/main.ts]:

```
Verifier started. contract <stakeoutAddress> on chain <CHAIN_ID> via <rpc host>; signer <verifier address> has VERIFIER_ROLE; maxMembersPerCall <n>; dry run: <true|false>; resuming from block <block>.
Decision notifications: <on|off>.
```

`<block>` is the stored next block, or `<deploymentBlock> (deployment block)` on a fresh database. If startup fails, it prints `Verifier cannot start: ...` (with the RPC URL redacted) and exits with code 1. A read-only account check is `npm --prefix services/backend run verifier-status` [AGENTS.md].

## 4. Read a decision

Read them from the API (`GET /decisions`, server must be running) or the `decisions` table in the SQLite file. Fields [db.ts, README]:

| Field | Meaning |
|---|---|
| `target` | The wallet decided on |
| `kind` | `confirm` or `link` |
| `outcome` | `sent` (transaction sent, `tx_hash` set), `refused` (the rules said no), `skipped` (could not or did not send: dry run, infeasible, revert) |
| `rule` | Label of the rule that decided (below) |
| `reason` | Plain-language explanation |
| `inputs` | Score, signal count, reporters, thresholds used, cluster id, data source (and the link flags for a link) |
| `tx_hash`, `evidence_hash` | Set when a transaction was sent / when evidence was built |
| `created_at` | Time of the decision |

**Rules** [decide.ts, actions.ts, watcher.ts]:

- `B:behavior-passed`: the wallet's own behavior met `behaviorThreshold` and `minSignals`; the confirm is proposed. With a dry run the outcome is `skipped` and the reason says "dry run".
- `B:behaviorThreshold`, `B:minSignals`: refused, behavior too weak. Reports only add to a recorded confidence figure; they never replace behavior.
- `graph:no-data`: refused, the graph answered 404 for this wallet.
- `cluster:none`, `cluster:target-not-member`: refused, the graph's cluster data is missing or inconsistent.
- `feasibility:*`: skipped, the chain would reject the call. Seen in code: `no-addresses`, `invalid-address`, `duplicate-address`, `member-limit`, `already-in-cluster`, `member-flag-challenged`, `no-live-flag`, `cluster-not-found`.
- `link:structured-outflow`, `link:funded-and-forwards`: a link is proposed. Refusals: `link:known-victim`, `link:one-off-payer`, `link:other-cluster`, `link:no-evidence`, `link:inbound-only-or-insufficient` (inbound funding alone is ignored).

**A dry-run decision claims the event.** The watcher marks an event handled after logging its outcome, and a dry run logs `skipped` and marks it handled like any other [actions.ts, watcher.ts]. Restarting with `VERIFIER_DRY_RUN=false` on the same `DB_PATH` therefore does **not** retry that `Promoted` event. A live `confirm` needs a **fresh `promote`** (a new flag, hence a new event). This is from reading the code and was not tested live: the live run resumed after that event's block anyway. Using a new `DB_PATH` instead would make the verifier rescan from the deployment block (about 45 minutes at 200 blocks per request, observed 2026-10-30).

**Events are handled in order.** The verifier stops at the first event it cannot handle (for example the graph is down) and retries it on the next poll; later events wait behind it [docs/local-chain-test.md]. This includes the link candidates of one `Confirmed` event: one failing candidate blocked the remaining ones (seed 2 run, section "Second live run").

## 5. Troubleshooting (errors seen in this repo's history and in the 2026-10-30 live run)

- **`feasibility:duplicate-address`** ("the same address appears more than once in members and exit points"). Cause seen on 2026-10-30: the Graph Service listed the exit point in both `members` and `exitPoints`; flag #2 was skipped. Fixed in the Graph Service by commit 1a9f8f9. If it appears again, call `/analyze/<address>` for the flagged wallet and look for an address in both lists. A flag skipped this way has to lapse and be promoted again [docs/HANDOFF.md].
- **`feasibility:no-live-flag`.** The target's flag had expired, resolved or been replaced by the time the event was handled. Not an error in the verifier. Promote again with a fresh flag; the flag duration is in `deployments/network.json` (`flagDuration`) [watcher.ts].
- **`poll failed: <message>`** in the verifier log. The poll loop caught an error (node or graph unreachable, for example) and tries again after `VERIFIER_POLL_INTERVAL_MS`; nothing is lost because the next block is only stored after a chunk succeeds [watcher.ts]. Check `RPC_URL` reachability and `RPC_TIMEOUT_MS`.
- **`ERROR poll failed: read ECONNRESET`** (observed 2026-10-30). The verifier kept running and the stored block kept advancing.
- **`[Errno 10048] error while attempting to bind on address ('127.0.0.1', 8001)`** (observed 2026-10-30). An old graph service was still running on that port. Find it with `netstat -ano | findstr :8001`, check it with `Get-Process -Id <the PID that netstat shows>`, stop it with `Stop-Process -Id <that PID>`, then start again. Observed 2026-10-30: `Get-NetTCPConnection -LocalPort 8001 -State Listen` returned nothing while a copy was listening, and `netstat` found it. The live Graph Service uses `GRAPH_SERVICE_PORT`; if you change it, change `GRAPH_SERVICE_URL` in `services/backend/.env` to match.
- **Graph Service cannot start.** Prints `Graph Service cannot start: ...` with the cause (missing variable, missing `config/scoring.json`, TigerGraph connection) [app/main.py].
- **`received null`/metrics error on a link candidate** (seed 2 run, 2026-10-30). The Graph Service sent `value: null` for `hopsToExit` (not measurable) and the old strict check refused it with 502, so the link step failed and the verifier kept retrying that event while later events waited. Fixed in `4428e9b` (null entries are dropped and logged once). Details in "Second live run, seed 2".
- **Earlier flags that did not confirm** are listed in `docs/HANDOFF.md`.

## 6. Manual-test checklist

"Run" means the step was run and the output seen. Per the 2026-10-30 outputs (observed 2026-10-30): **run** by Shriya: steps 1, 3, 4, 5, 6, 7, 8, 9 and 10; **run** via Claude Code on Shriya's laptop: step 2; **reported** by Person 3, not run by Shriya: step 11; **partly**: step 12 (the Overview tab was not checked), step 13 (only the `config/scoring.json` variant was run; the `config/rules.json` variant was not) and step 14 (two different wallets decided). Nothing is entirely "not run" now; the open parts are the Overview tab of step 12 and the `rules.json` variant of step 13. The recorded live runs (2026-10-30: flag #4 on seed 1, confirm 23 seconds after the promote; flag #5 on seed 2, confirm 19 seconds after) are in `docs/HANDOFF.md`; the seed 2 run is in "Second live run, seed 2" below. The table's "who / evidence" column refers to the first run.

| # | Step | Status | Who / evidence |
|---|---|---|---|
| 1 | TigerGraph workspace running, graph loaded (`test_connection.py`) | run | run by Shriya 2026-10-30; output: Connected. Graph: stakeout_v3; installed queries: analyze_wallet, get_cluster_graph, link_candidates |
| 2 | `python scripts/run_service.py` starts without a configuration error | run | run via Claude Code on Shriya's laptop 2026-10-30, output reported (started three times, no bind error) |
| 3 | `/health` returns `{"status":"ok"}` | run | run by Shriya 2026-10-30, output seen |
| 4 | `/analyze/<known wallet>` returns 200 and no address is in both `members` and `exitPoints` | run | run by Shriya 2026-10-30, output seen |
| 5 | `/analyze/<unknown wallet>` returns 404 | run | run by Shriya 2026-10-30; HTTP 404, {"detail":"No graph data for this address."} |
| 6 | `npm --prefix services/backend run verifier-status` shows the verifier account has the role | run | run by Shriya 2026-10-30, output seen |
| 7 | Verifier starts with `VERIFIER_DRY_RUN=true`; startup line matches section 3 | run | run by Shriya 2026-10-30, output seen |
| 8 | Reporter promotes a flag on the target; a `B:behavior-passed` decision appears with outcome `skipped` (dry run) | run | promotion sent by Person 3; decision and output seen by Shriya 2026-10-30 |
| 9 | Stop; set `VERIFIER_DRY_RUN=false`; start; startup line shows `dry run: false` | run | run by Shriya 2026-10-30, output seen |
| 10 | Promote a **new** flag; a `confirm` decision with outcome `sent` and a `tx_hash` appears | run | promotion sent by Person 3; decision with tx_hash seen by Shriya 2026-10-30 |
| 11 | `getStatus(target)` returns 3 (Confirmed); linked wallets return 4 (Linked) | reported | reported by Person 3, not run by Shriya |
| 12 | The transaction opens on the Base Sepolia explorer | partly | Logs tab seen (Confirmed event), Overview tab not checked |
| 13 | Change a value in `config/rules.json`, restart, and the decision changes | partly | scoring.json variant run via Claude Code 2026-10-30: fanInMin 2 -> 7 changed behaviorScore 0.9 -> 0.875 and removed the fanIn signal for the same wallet; restored with git restore, result back to 0.9. The config/rules.json variant was not run. |
| 14 | Repeat with a different address | partly | two different wallets decided |

## Web walk-through, 2026-10-30
The website (`npm run web:dev`) and the backend were started locally. Between about 09:58 and 10:25 IST Shriya looked at the following in the browser (observed 2026-10-30; the assistant did not see the screens):

- **Check address** for `0x597164c4A6058a00581a22B22dE50472433D2E44` showed STATUS: CONFIRMED, role Member, the cluster id `0xe8e38426852fd254f5e5dc7dea2a535866d5f1775137c598a25d4b1ce10552be` with a "View money trail" button, and the evidence hash `0xb4f0cb1c50242951639341a4168108ae629c90bc9b30d3d471d2ddcbcb78a6de` with the confirm tx `0x5bf332a6d832b789cea1040a2e8ba4011b61213785c840d35c41f40f2dc7c123`. It also showed an AI summary labelled "Summary source: llm. Data source: synthetic. The summary explains the evidence. It does not confirm anything."
- **The money trail page** showed a legend of Member (4), Exit point (1) and Counterparty (8), with transfers drawn as arrows.
- **The Decisions page** showed "Data: synthetic" and the decisions, including the sent confirm for `0x5971...`, the sent `link:funded-and-forwards` for `0x37b363F437AADce2a7Dc3Ef0b7a191bD18323383` (tx `0xfd0de8848ad8be520b3949db7b5df74d5b5af32c30e57fea4ce77e621473b5ea`), the sent `link:structured-outflow` for `0xa8DB670002bFD989BE9E448a29019D9f436B54C9` (tx `0x8655ce0028b09ee98f65c90a1a90a29d91ad2be19bd025ddf965eaeb14b82725`), and refused `link:known-victim` rows with "Transaction: None (no transaction sent)".
- **The Verify page** for the evidence hash above showed "Found on chain" (block 52007868, the confirm tx), "Recomputed hash matches" (requested and recomputed hashes identical) and "Data source: synthetic".
- **Check address** for `0x37b363F437AADce2a7Dc3Ef0b7a191bD18323383` and for `0xa8DB670002bFD989BE9E448a29019D9f436B54C9` each showed STATUS: LINKED.

A script for presenting this is in `docs/demo-script.md`.

### Not covered by this walk-through
- The Report page and the promote action on the Dashboard.
- Check address for a wallet with no record.
- The Reviewer, Pricing, FAQ, Support, Terms and Privacy pages.
- The Basescan Overview tab (only the Logs tab was seen, see section 6).
- What a browser shows when the backend or the Graph Service is down.
- Any timing of page loads.

## Second live run, seed 2, 2026-10-30 (UTC)
Synthetic data, Base Sepolia. The on-chain rows are in `docs/HANDOFF.md` ("Second confirm, synthetic seed 2", written by Person 3); this section does not change them and adds what the verifier decided and what could and could not be checked. Values below come from `GET /decisions` (read by the assistant from the running backend), the files in `services/graph/results/recorded/` (git-ignored, on Shriya's laptop only) and `docs/HANDOFF.md`, not from a prompt.

Markers: **[seen in terminal]** = the assistant read it from `/decisions` or a recorded file, or Shriya saw it in the verifier terminal and pasted it into the chat (stated each time). **[read on chain by Person 3]** = written in `docs/HANDOFF.md` from the contract; the assistant did not query the chain. **[seen in browser]** = Shriya reported it; the assistant did not see the screen. **[not seen]** = nobody has shown the assistant evidence.

| Item | Value | Marker |
|---|---|---|
| Graph and seed | seed 2 loaded into `stakeout_v3`. The load output and its time were not kept; the first recorded `/analyze` call is 2026-10-30 05:33:18 UTC (`calls_seed2.txt`), so the load was before that (told "about 05:33") | load: [not seen]; first call: [seen in terminal] |
| Cluster id | `0x60dbbc2efb156c02d0b4b3cca0efbdbc5a19efb6466dac31d8fad7e419eaab78` | [seen in terminal] (cluster graph file and decisions) |
| Target | `0x8fdb72a34980be64D347BdcDda5117b919f538DC`, 4 members, 1 exit point `0x265632094a04fcde45a00607b90c305da0480377` (seed 1 counterpart: `0x597164c4A6058a00581a22B22dE50472433D2E44`) | [seen in terminal] |
| Report #5 | block 52085149, 05:41:38 UTC | [read on chain by Person 3] |
| Promote of flag #5 | block 52086814, 05:47:11 UTC, stake 0.001 ETH | [read on chain by Person 3] |
| Confirm | block 52086907, tx `0xd0e6996acb3f2f2566ea95bde3388cdd4efc653e1f811674a888280aaaca933a`. **On-chain time 05:47:30 UTC** (read by Person 3 from the chain) | [read on chain by Person 3] |
| Confirm decision (decision id 14) | rule `B:behavior-passed`, behavior score 0.875, 4 signals, 1 unrelated reporter (added confidence only, 0.925 with reports), evidence hash `0x64fb817f7865fa3a38a14f62cc83e3e55f9d68e1e76ac9ecd3b26a412fa6e1b1`, data source synthetic. **Logged at 05:47:31 UTC by the verifier's own clock when it logged the decision** (`created_at`); this is not the block time above and the two are not the same value | [seen in terminal] |
| Verify page | found the evidence hash on chain and the recomputed hash matched | [seen in browser] |
| Check address | target showed Confirmed; both link wallets showed Linked | [seen in browser] |
| Decisions page | showed the rows | [seen in browser] |
| `getStatus` | target 3, all four members 3, exit point 3 with role ExitPoint, both links 4, same cluster | [read on chain by Person 3] |

**Links, and the block.** At 05:47:41 UTC the verifier logged an error: the Graph Service sent a null `hopsToExit` for the two wallets to be linked, and the strict metrics check in the evidence builder refused it. The line ("Confirmed cluster 0x60dbbc2e... is waiting" with the null metric) was seen by Shriya in the verifier terminal and pasted into the chat [seen in terminal]; it is not saved to a file in the repo, and the assistant did not see the terminal itself. What the assistant read from files: the Graph Service answers for `0x2cdbb6ae7a3020e0b98d74ea523f341bde601ec1` and `0xa02f5ef49c7d4511cbfd7c0696c1760abb7fbbba`, saved at 05:54:21 and 05:54:28 UTC, both contain `{"name":"hopsToExit","value":null}` [seen in terminal]. The fix (null metrics are dropped and logged once; any other malformed entry still returns 502) ran at 06:11 UTC as an uncommitted working-tree change to `services/backend/src/evidence.ts` and `services/backend/src/scripts/evidence-selftest.ts`. The same two files were committed afterwards as `4428e9b` (commit time 07:19:40 UTC, 12:49:40 +0530). Whether what ran equals what was committed, byte for byte, is **unconfirmed**. The verifier startup line at 06:11:15 UTC was seen by Shriya in the verifier terminal and pasted into the chat [seen in terminal]; it is not saved to a file in the repo. The first link decision is stamped 06:11:24 UTC [seen in terminal, from `/decisions`].

| Decision id | Target | Outcome | Rule | Tx | Evidence hash |
|---|---|---|---|---|---|
| 15 | `0x2CdBb6aE7a3020E0B98D74eA523f341BDe601eC1` | sent, score 0.7, 2 signals | `link:funded-and-forwards` | `0x32972de67b335128f47a4a50e4f0bccc214a929106953395382b33cb4c45be13` (block 52094069, 06:11:22 UTC on chain per `docs/HANDOFF.md`) | `0x0e8bc73aa6b8115c11a056ad851936051a29f297576e6dc7d887db5ca36dc742` |
| 20 | `0xa02F5ef49C7d4511cbfd7C0696C1760AbB7fBBBA` | sent, score 0.825, 4 signals | `link:structured-outflow` | `0xd1c887741100b049aa7db19884700dc784b0589b0acd68d8ced0ede217e7b0c4` (block 52094115, 06:11:31 UTC on chain per `docs/HANDOFF.md`) | `0x6ba45c54f6e2c6802734be5612bcdb44c187b6d18d44f865a23ae23363f0ad0f` |

All of this table is [seen in terminal] except the on-chain block and time, which are [read on chain by Person 3]. Six of the eight candidates were refused [seen in terminal]: decisions 16, 17, 18, 19 and 22 are `link:known-victim`; decision 21 is `link:inbound-only-or-insufficient` (funded by the cluster, does not forward onward).

**One failing candidate blocks the rest.** The first link candidate failed, and because events are handled in order, that stopped the other candidates and every later event until the cause was fixed. It fails loudly, by design. It was found only by the live run, not by any self-test.

**Not run.** The `config/rules.json` variant of check 13 in section 6. The Basescan Overview tab for check 12 (also for the seed 2 transactions). The seed 2 money trail page, the AI summary for seed 2, and the Basescan view of the seed 2 transactions were not reported as seen.

## Unconfirmed (not stated by any repo file)

1. What the TigerGraph console shows for an "Active" workspace.
2. Whether the verifier's RPC provider has the same `eth_getLogs` limits as those measured for the web app, and the cost of the verifier's first scan on any RPC other than `https://sepolia.base.org` (the formula in section 3 is derived; one observation exists, see section 3).
3. Whether `GRAPH_SERVICE_URL` for the live graph service has any host restriction (the dev stand-in requires `127.0.0.1` or `localhost`; the verifier's rule is not in the files I read).
4. Any live result for the steps in section 6 beyond what `docs/HANDOFF.md` and the observations marked "observed 2026-10-30" record.
