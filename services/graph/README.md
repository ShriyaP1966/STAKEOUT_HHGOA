# Stakeout Graph Service (`services/graph`)

Answers "what does the money graph say about this wallet?" for the verifier and the web app. TigerGraph is the source of truth; this service asks it, scores the answer with the numbers in `config/scoring.json`, and applies the linking rule. **Synthetic data only, testnet only.**

Taken over by Person 2 from the source repository `akanksha1209/stakeout-graph-intelligence` and reworked to the Person 1 plan. What is and is not verified is listed at the end; read it before relying on any result.

## Layout
```
app/        config.py (settings, no defaults) · service.py (the HTTP API) · main.py (builds it from .env)
graph/      schema.gsql · queries/*.gsql · schema_spec.py · tg.py (the only TigerGraph code) · scoring_config.py (reads config/scoring.json)
            metrics.py scoring.py detect.py linking.py offline.py (pure Python, no database) · ids.py
            generate.py load.py evaluate.py (command line tools)
scripts/    test_connection.py · setup_graph.py · diagnose_graph.py · run_service.py · sample_addresses.py
tests/      offline checks, a test scoring file and a test-only fake backend
```

## Install (tested on Python 3.13.15)
```
cd services/graph
python -m venv .venv
.venv\Scripts\activate            (Windows)     or    source .venv/bin/activate
pip install -r requirements.txt   (versions are pinned)
```
`pyproject.toml` and `uv.lock` of the source repository were dropped; `requirements.txt` is the only dependency list. `.python-version` says 3.11 (untested here). The install and the offline checks below were tested on Python 3.13.15 only.

## Settings: `services/graph/.env` (git-ignored; `.env.example` has the names only)
| Name | Needed by | Meaning |
|---|---|---|
| `TG_HOST` | everything that connects | full URL, e.g. `https://<workspace>.tgcloud.io` |
| `TG_SECRET` | optional | if set, it is used for everything (the REST token and GSQL, through pyTigerGraph's `gsqlSecret`) and `TG_USERNAME`/`TG_PASSWORD` are not needed. A failure to get the token stops the program with a message that never contains the secret |
| `TG_USERNAME`, `TG_PASSWORD` | only when `TG_SECRET` is empty | then both are required |
| `TG_PORT` | optional | forces this port for REST and GSQL. Not needed for a `tgcloud` host: pyTigerGraph 2.0.4 recognises it and uses port 443 (REST under `/restpp`, GSQL on the same port). Use it for another host that is served on 443 |
| `TG_GRAPH_NAME` | everything that connects | the graph this service uses. **Set a NEW name** the first time (a graph that already exists is never changed, and one created before `TRANSFER_TX` existed has the collapsing edge). No graph name is written anywhere in the code |
| `SCENARIO_SEED` | `generate`, if `--seed` is not given | whole number |
| `GRAPH_SERVICE_PORT` | the service, live `evaluate` | port on 127.0.0.1 |

Nothing has a default. A missing value stops the program and names the variable. The scoring numbers are read from `config/scoring.json` at the repo root; the file is in the repo (`config/scoring.json`); if it is missing the service and `load` stop with a clear message. The proposal behind it is in `docs/graph-config-proposal.md`.

## Commands (from `services/graph`)
| Do | Command | Needs TigerGraph |
|---|---|---|
| Check the connection (prints graph name and installed queries) | `python scripts/test_connection.py` | yes |
| Create the schema if the graph is missing, else compare; install all queries. Safe to run again after a failed run | `python scripts/setup_graph.py` | yes |
| See what the workspace has (graphs, global types, raw listing), read-only. `--try-create` also shows the raw answer of each schema statement | `python scripts/diagnose_graph.py` | yes |
| Generate synthetic data | `python -m graph.generate --seed 1` (counts and timing are flags: `--help`) | no |
| Show what would be loaded | `python -m graph.load --dry-run` | no |
| Load into the graph | `python -m graph.load` | yes |
| Run the service | `python scripts/run_service.py` | yes |
| Evaluate against the live service | `python -m graph.evaluate` | yes |
| Evaluate offline (Python reference analysis) | `python -m graph.evaluate --offline` (run `python -m graph.generate --seed N` first: `data/` is git-ignored, so a fresh clone has no data) | no |
| One example address per role and scenario, for manual testing (reads the test-only ground truth) | `python scripts/sample_addresses.py` (run `python -m graph.generate --seed N` first: `data/` is git-ignored, so a fresh clone has no ground-truth file) | no |
| Offline checks | `python -m unittest discover -s tests -t .` | no |

`setup_graph.py` **never drops or alters an existing graph**: if `TG_GRAPH_NAME` exists it compares it with `graph/schema_spec.py` and prints the differences (exit 2 on a blocking difference, queries not installed).

`setup_graph.py` fails loudly: it reads the raw GSQL answer (pyTigerGraph's `gsql()` hides the `__GSQL__` return-code lines), treats a non-zero return code or error-like wording as a failure, and then checks in TigerGraph that each global type, the graph and each query really exists. Types that already exist globally are reused only if they match; a type that differs stops everything. If `TG_GRAPH_NAME` already exists nothing is created. Global vertex and edge types are shared by every graph on a workspace, so a second graph that uses the same type names reuses the existing global types.

## The schema (graph `TG_GRAPH_NAME`)
Wallet(address PK, is_exit_point BOOL, data_source STRING) · Cluster(cluster_id PK) · Report(report_id PK, target_address STRING, evidence_hash STRING) · **TRANSFER_TX** Wallet to Wallet, directed (amount DOUBLE, timestamp INT, tx_id STRING, with `tx_id` as the **DISCRIMINATOR**) · MEMBER_OF Wallet and Cluster, undirected, no attributes · REPORTED Report to Wallet, directed, no attributes. Queries use only these attributes and follow edges only in their own direction. `dataSource` in every answer is read from `Wallet.data_source`; if the graph returns none the service answers 502 rather than guess.

**Why a new edge type.** The older global edge type `TRANSFER` (amount, timestamp, tx_id) has no discriminator, so two transfers between the same two wallets are one edge and the second overwrites the first. On the first live evaluation this hid 3 of 54 transfers and made the feeder wallet look like a one-off victim (linked recall 0.5 against 1.0 offline). A discriminator cannot be added to an existing global type without changing it for every graph that uses it, so this service uses a **new** global edge type, `TRANSFER_TX`, defined in `graph/schema.gsql` with `DISCRIMINATOR(tx_id STRING)` as the TigerGraph 4.2 reference describes (Defining a Graph Schema: "To create multi-edges, define a DISCRIMINATOR in the edge type"; the discriminator comes before the other attributes). The old `TRANSFER`, the existing vertex types and `MEMBER_OF`/`REPORTED` are reused as they are and never changed, dropped or altered, and neither is any existing graph. The new graph is created from those vertex types, those two edges and `TRANSFER_TX`, under the name in `TG_GRAPH_NAME`.

`python -m graph.load` checks after loading that every wallet pair with several transfers really holds several `TRANSFER_TX` edges, and stops with the evidence if not.

## API
| Route | Answer |
|---|---|
| `GET /analyze/{address}` (alias `/analysis/{address}`) | `target` (lower-case), `clusterId` (or null), `behaviorScore` 0 to 1, `signals` (objects with `name`, only the ones that fired), `metrics`, `members` (`[]` when no cluster; an address that is also in `exitPoints` is left out of `members`, so the two lists never share an address), `exitPoints`, `unrelatedReporterCount`, `dataSource`; for a wallet outside every cluster that is connected to one also `link` (five flags), `linked`, `reason`. 404 `{"detail": "No graph data for this address."}` if the graph has no such wallet (TigerGraph "Failed to convert user vertex id" or `found` 0), 400 for a bad address; any other TigerGraph error is a 502 with its message |
| `GET /link_candidates/{clusterId}` (alias `/clusters/{clusterId}/link-candidates`) | `candidates` (every wallet outside the cluster that touches it) and `details` with the five flags and the linking verdict for each |
| `GET /cluster/{clusterId}/graph` (an unknown cluster id is a 404 here and on /link_candidates: `{"detail": "No graph data for this cluster."}`) | `nodes` (role `member`, `exit_point` or `counterparty`) and real `edges` (`src`, `tgt`, `amount`, `timestamp`, `txId`) |
| `GET /health` | `{"status":"ok"}` |

Exact proposed schema and the open questions: `docs/graph-config-proposal.md`. The Person 2 verifier reads the first two routes under the alias spellings today.

## Live run
The step-by-step runbook for the live Base Sepolia run (graph service, verifier, reading decisions, troubleshooting, checklist) is `docs/live-run.md`.

## How it decides (definitions in the code docstrings)
- **Relay**: receives and sends, passes at least `passThroughRatioMin` of its inflow on, and does it fast (lower-median forward time at most `rapidForwardTimeMaxSeconds`).
- **Cluster** (`graph/detect.py`, from transfers alone): a relay that splits to two or more relays, a wallet that merges two or more relays (the **exit point**) within `hopsToExitMax` hops, and every relay between them. The id is `make_cluster_id(members)`. No labels, no ground-truth file.
- **Linking** (`graph/linking.py`, AGENTS.md section 4): never a known victim or a one-off payer; linked if it sends repeatedly into the cluster, or is funded by it and forwards onward like a member. Inbound funding alone (dusting) never links.
- **Generator** (`graph/generate.py`): scam cluster, rotation, feeder, repeat victim, dusting, framing (burners each funded from a different source, plus false reports against the innocent wallet), merchants, an exchange-like hot wallet, noise. `data/scenarios.json` is TEST-ONLY ground truth: only `evaluate.py`, the tests and `scripts/sample_addresses.py` (a manual-testing helper) read it.

## Known limitations
- The exchange hot wallet scores 0.75 on the synthetic data, which is a false positive. Seed-1 live evaluation of the behavior check: TP 7, FP 1, FN 0, TN 49.
- The merchant scores 0.35, a thin margin below the 0.40 threshold.
- A scammer who slows down could evade the speed signal.
- The tuned set and the held-out set come from the same generator.
- `unrelatedReporterCount` counts distinct reports, not verified unrelated reporters.
- The graph's report `evidence_hash` is a SHA-256 of the graph's own synthetic report record (reporter, target, narrative, reportedAt). It is not an evidence bundle hash, so it does not match any on-chain `evidenceHash` and is not used by the `/verify` page. Changing the algorithm alone would not fix that. It is a known difference, to be decided with Person 3 after the demo.
- The evidence bundle schema has no `metrics` field. This is also pending.

## What was run, and what a human must run
Run by the assistant (offline, Python 3.13, test scoring file): the unit checks, `generate`, `load --dry-run`, `evaluate --offline` for seeds 1, 2, 3. **Not run, needs your TigerGraph account:** everything marked "Needs TigerGraph" above.
Human steps, in order, from `services/graph` (the first one is new):
1. In `.env` set `TG_GRAPH_NAME` to a **new** graph name (not `stakeout_graph`, not `stakeout_v2`). Everything else stays as it is.
2. `python scripts/test_connection.py` (connects and lists installed queries; for a new name it lists none).
3. `python scripts/setup_graph.py`. It creates the global edge type `TRANSFER_TX` if it is missing (and checks TigerGraph's listing for it and its discriminator), reuses the existing vertex types and `MEMBER_OF`/`REPORTED` only if they match, creates the new graph, then installs the three queries. Paste any error back; it prints TigerGraph's raw answer.
4. `python -m graph.generate --seed 1`, then `python -m graph.load`. The load ends with a line saying every repeated transfer is its own `TRANSFER_TX` edge.
5. `python scripts/run_service.py`, then `curl.exe -i http://127.0.0.1:<port>/analyze/<a wallet from: python scripts/sample_addresses.py>`.
6. `python -m graph.evaluate`. For seed 1 the linking table should now read TP 2, FN 0, as the offline run does (`python -m graph.evaluate --offline`).
