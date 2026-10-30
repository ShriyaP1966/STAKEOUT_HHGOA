# Demo script: the live run on Shriya's laptop

Synthetic data only, testnet only (Base Sepolia). Use this as a numbered list while presenting. Every fact comes from `docs/live-run.md`, `docs/HANDOFF.md`, `services/graph/README.md` or the page routes in `apps/web/src/app`. Where a step needs a value those files do not give, it says **unconfirmed** and where to find it.

How to read the markers:
- **[seen in browser]**: Shriya looked at this screen on 2026-10-30 (listed in `docs/live-run.md`, "Web walk-through, 2026-10-30"). The assistant did not see the screens.
- **[read on chain by Person 3]**: written in `docs/HANDOFF.md` from the contract's events (some older lines say "recorded on chain"; same meaning).
- **[seen in terminal]**: the assistant read it from `/decisions` or a recorded file.
- **[not seen]**: nobody has recorded seeing this screen.

Times are what the docs record for the 2026-10-30 run. Anything else is "not timed".

## Important before you start: the demo replays two real runs, it does not run a new confirm
This demo replays two real runs on Base Sepolia, both on 2026-10-30: seed 1 (recorded at 01:23 to 01:24 UTC, cluster `0xe8e38426852fd254f5e5dc7dea2a535866d5f1775137c598a25d4b1ce10552be`, at the end of the steps) and seed 2 (05:47 to 06:11 UTC, cluster `0x60dbbc2efb156c02d0b4b3cca0efbdbc5a19efb6466dac31d8fad7e419eaab78`, used for the steps below). It does not show a new live confirm. Both clusters are already confirmed on chain, and the verifier skips a confirm for an address already in a cluster (rule `feasibility:already-in-cluster`, `docs/live-run.md` section 4), so a second confirm for the same wallets is not possible. The steps show what these runs left on chain, in the website and in the Decisions log.

A fresh live confirm would need a new, unconfirmed cluster (for example seed 3 loaded before the demo). That has not been run. Whether such a target exists in the loaded graph is **unconfirmed**; `python scripts/sample_addresses.py` from `services/graph` lists example wallets for the data in the local `data/` folder.

Marker legend for seed 2: **[seen in browser]** = Shriya reported it; the assistant did not see the screen. **[read on chain by Person 3]** = written in `docs/HANDOFF.md`. **[seen in terminal]** = the assistant read it from `/decisions` or a recorded file, or Shriya saw it in the verifier terminal and pasted it into the chat. **[not seen]** = no evidence.

## Steps

### 1. Before starting
- **Open or run:**
  - Graph service: `python scripts/run_service.py` from `services/graph`, then `curl.exe http://127.0.0.1:<GRAPH_SERVICE_PORT>/health` returns `{"status":"ok"}`. The live graph `stakeout_v3` already holds seeds 1 and 2 (seed 2 was loaded 2026-10-30). Do not generate or load on stage: the local `data/` files are seed 1, reloading is an idempotent upsert but unnecessary, and `generate` overwrites the local `data/`.
  - TigerGraph Savanna workspace running. What the console shows for "Active" is **unconfirmed**; `python scripts/test_connection.py` should print the graph `stakeout_v3` and its three queries.
  - Verifier, live: `VERIFIER_DRY_RUN=false`, then `npm run verifier` from `services/backend`. The startup line must say `dry run: false` and `has VERIFIER_ROLE`. Keep the same `DB_PATH` as the earlier runs: a new file rescans from the deployment block.
  - Backend: `npm --prefix services/backend start` (port 8000). Website: `npm run web:dev` (port 3000).
  - Phone hotspot ready.
- **Should show:** the commands above give those answers. [seen: Shriya ran the health, test-connection, verifier and startup-line checks on 2026-10-30, `docs/live-run.md` section 6]
- **Time:** the first verifier scan from the deployment block took about 45 minutes with `https://sepolia.base.org` at 200 blocks per request (observed 2026-10-30). Start it long before the audience arrives. Website and backend start-up: not timed.
- **Say:** "Everything runs on this laptop: the graph service, the backend and the website. The chain is Base Sepolia, and all data is synthetic."

### 2. Check address for a clean wallet
- **Open:** the website, **Check address** (`/wallet`), and enter a wallet that is in no cluster and has no report.
- **Should show:** a status of None. [not seen: no clean-wallet screen is recorded in the docs. Pick the wallet and try it beforehand; I cannot name one.]
- **Time:** not timed.
- **Say:** "Anyone can ask the contract about any address. This one has no record."

### 3. Show the existing report #5 and flag #5
- **Open:** **Dashboard** (`/dashboard`) and find report #5 under Reports and flag #5 under Flags; then the block explorer for the promote transaction `0x8b94cf8666840dd04c585b1bfceb6fd81a3113e5b6972aab062506953fe89ab6` (block 52086814). Nothing is reported or promoted during the demo.
- **Should show:** the report and the flag for `0x8fdb72a34980be64D347BdcDda5117b919f538DC`. [not seen: the Dashboard screen and the block explorer page for this transaction are not recorded as seen.]
- **Recorded (seed 2):** report #5 for `0x8fdb72a34980be64D347BdcDda5117b919f538DC` at 05:41:38 UTC (block 52085149); promote of flag #5 with a 0.001 ETH stake at 05:47:11 UTC (block 52086814). [read on chain by Person 3]
- **Time:** not timed in the browser. Chain times above.
- **Say:** "A victim reported for free. A whitelisted reporter put a stake behind it. A flag lives for 10 minutes unless it is confirmed."

### 4. Show the existing verifier decision rows on Decisions
- **Open:** **Decisions** (`/decisions`). These are the rows the verifier logged during the 2026-10-30 run; nothing is decided during the demo.
- **Should show:** "Data: synthetic" and the decisions, including a sent confirm for `0x8fdb72a3…` (rule `B:behavior-passed`, behavior score 0.875, 1 unrelated reporter that only added confidence). The Decisions page showed the rows [seen in browser]; the values are [seen in terminal] from `/decisions`.
- **Time:** the confirm was posted 19 seconds after the promote on chain: 05:47:11 to 05:47:30 UTC (block 52086907). [read on chain by Person 3] The decision row is stamped 05:47:31 UTC by the verifier's own clock when it logged the decision. That is a different clock from the block time, so do not present the two as one value. [seen in terminal]
- **Say:** "Here the verifier asked the graph, the wallet's own behavior passed the rule, and it posted the confirm. The AI only explains; it does not decide."

### 5. The confirm transaction on Basescan
- **Open:** `https://sepolia.basescan.org/tx/0xd0e6996acb3f2f2566ea95bde3388cdd4efc653e1f811674a888280aaaca933a` (the seed 2 confirm tx, block 52086907).
- **Should show:** a successful transaction and a Confirmed event in the Logs tab. [not seen for this transaction. For the seed 1 confirm only the Logs tab was seen; the Overview tab was never checked.]
- **Time:** not timed.
- **Say:** "This is the public record. Nobody can edit it."

### 6. Check address now shows Confirmed
- **Open:** **Check address** for `0x8fdb72a34980be64D347BdcDda5117b919f538DC`.
- **Should show:** STATUS: CONFIRMED [seen in browser]. On chain: target 3 [read on chain by Person 3]. The cluster id, role, AI summary and the **View money trail** page for seed 2: [not seen]. They were seen only for seed 1 (see the recorded run).
- **Time:** not timed.
- **Say:** "The wallet's own behavior, split, merge and forward to an exit point, is what confirmed it."

### 7. Verify recomputes the evidence hash
- **Open:** **Verify** (`/verify`) with evidence hash `0x64fb817f7865fa3a38a14f62cc83e3e55f9d68e1e76ac9ecd3b26a412fa6e1b1`.
- **Should show:** found on chain, and the recomputed hash matches [seen in browser]. Which other fields the page showed for seed 2 (block, data source label): [not seen].
- **Time:** not timed.
- **Say:** "The page fetches the stored evidence, hashes it again in the browser, and compares it with what is on chain. It matches, so the evidence was not changed."

### 8. The two linked wallets and the refused known victims
- **Open:** **Check address** for `0x2CdBb6aE7a3020E0B98D74eA523f341BDe601eC1` and for `0xa02F5ef49C7d4511cbfd7C0696C1760AbB7fBBBA`; then back to **Decisions**.
- **Should show:** STATUS: LINKED for each [seen in browser]. On Decisions: a sent `link:funded-and-forwards` (tx `0x32972de6…be13`), a sent `link:structured-outflow` (tx `0xd1c88774…b0c4`), and refused rows: five `link:known-victim` and one `link:inbound-only-or-insufficient` [seen in terminal: the values; the browser showed the rows]. On chain both are 4 [read on chain by Person 3].
- **Time:** in the seed 2 run the links came at 06:11:22 and 06:11:31 UTC, about 24 minutes after the confirm, because a null `hopsToExit` metric blocked the link step first (see `docs/live-run.md`, "Second live run, seed 2"). The fix is in `4428e9b`. A live run on the fixed code has not been timed, so the delay to expect is **unconfirmed**. [times: read on chain by Person 3]
- **Say:** "Wallets that only paid into the cluster once, or were victims, are never linked. Only wallets that behave like members are."

## Recorded run: seed 1 (2026-10-30, real timestamps)
Kept as the recorded run. Cluster `0xe8e38426852fd254f5e5dc7dea2a535866d5f1775137c598a25d4b1ce10552be`, target `0x597164c4A6058a00581a22B22dE50472433D2E44`. Source: `docs/live-run.md` ("Web walk-through, 2026-10-30") and `docs/HANDOFF.md`.

| What | Value | Marker |
|---|---|---|
| Report #4 and promote of flag #4 (0.001 ETH) | blocks 52007746 and 52007755, 01:23:38 and 01:23:39 UTC | [read on chain by Person 3] |
| Confirm | tx `0x5bf332a6d832b789cea1040a2e8ba4011b61213785c840d35c41f40f2dc7c123`, block 52007868, 01:24:02 UTC, 23 seconds after the promote | [read on chain by Person 3] |
| Check address | STATUS: CONFIRMED, role Member, cluster id, evidence hash `0xb4f0cb1c…8a6de`, confirm tx, AI summary labelled "Summary source: llm. Data source: synthetic. The summary explains the evidence. It does not confirm anything." | [seen in browser] |
| Money trail | legend Member (4), Exit point (1), Counterparty (8), transfers as arrows | [seen in browser] |
| Verify | evidence hash `0xb4f0cb1c50242951639341a4168108ae629c90bc9b30d3d471d2ddcbcb78a6de`: Found on chain (block 52007868), Recomputed hash matches, Data source: synthetic | [seen in browser] |
| Links | `0x37b363F437AADce2a7Dc3Ef0b7a191bD18323383` `link:funded-and-forwards` (tx `0xfd0de884…b5ea`, 01:24:16 UTC) and `0xa8DB670002bFD989BE9E448a29019D9f436B54C9` `link:structured-outflow` (tx `0x8655ce00…2725`, 01:24:24 UTC). Both STATUS: LINKED. Refused `link:known-victim` rows with "Transaction: None (no transaction sent)" | [seen in browser]; times [read on chain by Person 3] |
| Basescan | Logs tab showed the Confirmed event; Overview tab not checked | [seen in browser] (Logs only) |

If the seed 2 steps fail on stage, show this recorded run. Its responses are in `services/graph/results/recorded/` (seed 1 files saved 2026-10-30 03:14 UTC; seed 2 files `seed2run_*` saved 05:33 UTC and `nulls_*` saved 05:54 UTC). The folder is git-ignored, so it exists only on Shriya's laptop.

## If something fails

| What fails | What you see | Fallback (from the docs) |
|---|---|---|
| Graph service down | the verifier cannot decide and logs the error; `/analyze` unreachable | Restart `python scripts/run_service.py`. If port 8001 is taken: `[Errno 10048] ... ('127.0.0.1', 8001)` means an old copy runs; stop it: use `netstat -ano | findstr :8001` to find the PID, then `Get-Process -Id <the PID that netstat shows>` and `Stop-Process -Id <that PID>`. Observed 2026-10-30: `Get-NetTCPConnection -LocalPort 8001 -State Listen` returned nothing while a copy was listening, and `netstat` found it. Show the recorded responses in `services/graph/results/recorded/` (two `/analyze` files, one cluster graph file and `calls.txt`, saved 2026-10-30 03:14 UTC; the folder is git-ignored, so it exists only on Shriya's laptop). Which website pages need the graph service directly is **unconfirmed**; test each page with the service stopped |
| TigerGraph workspace paused | `/analyze` answers 502 with TigerGraph's message (`services/graph/README.md`) | Resume it in the TigerGraph console (how is **unconfirmed**); `python scripts/test_connection.py` confirms. Meanwhile use the recorded files |
| RPC slow | the verifier or the website reads events slowly | `https://sepolia.base.org` allows 200 blocks per request (about 15 minutes for the website, about 45 minutes for a verifier first scan, both observed). The root README names `https://base-sepolia-rpc.publicnode.com` with `50000` for the website's chunk size; the verifier's own limit on other providers is **unconfirmed**. Never start the verifier with a new `DB_PATH` on stage: it rescans from the deployment block. Scan position: the `verifier.nextBlock` key in the `kv` table of the SQLite file |
| Internet down | RPC, TigerGraph Cloud and Basescan unreachable | Switch the laptop to the phone hotspot. There is no offline copy of the Base Sepolia result in the docs. The recorded graph files still open locally. `docs/local-rehearsal.md` (AGENTS.md section 8) describes a local chain with a stand-in graph; that is a different run, not the Base Sepolia result |
| A flag lapsed | `feasibility:no-live-flag`: the flag expired before the verifier handled it | The flag lasts 600 seconds (10 minutes; `flagDuration` in `deployments/network.json`). Promote again with a fresh flag. Lapsed stakes come back in full: `expire`, then `withdraw` (`docs/HANDOFF.md`) |
| Backend not running | Decisions, Verify and the report hash check show an error | Start `npm --prefix services/backend start`; `http://127.0.0.1:8000/health` should answer. The same `DB_PATH` as the verifier shows the same decisions |
| Verifier shows `ECONNRESET` | log line `ERROR poll failed: read ECONNRESET` | It kept running and its stored block kept advancing (observed 2026-10-30); no action needed |
| Verifier in dry run by mistake | decisions say `dry run`, outcome `skipped` | A dry-run decision claims the event. Set `VERIFIER_DRY_RUN=false`, restart, and promote a **new** flag |

## Not covered by this script
- A second live confirm for either 2026-10-30 cluster (not possible, see the top).
- A fresh live confirm on another cluster: unconfirmed.
- The Reviewer, Pricing and other info pages; challenges and resolution.
- The screens for Check address with a clean wallet, Report and Dashboard promote (not recorded as seen).
- The Basescan Overview tab (only the Logs tab was seen, and only for the seed 1 confirm).
- The `config/rules.json` variant of the config-change test (only `config/scoring.json` was run).
- The seed 2 money trail, AI summary and Basescan pages.
- Any timing in the browser: only the chain times and the 45-minute scan are recorded.
