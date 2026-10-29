# Proposal: config files and schemas for the Graph Service (for the team to agree)

Status: **PROPOSAL, not agreed.** Nothing here was written into `config/` or `shared/`; those folders are not Person 2's to edit. This file holds the exact content proposed, so someone with the right to edit them can copy it after the team agrees. Written while Person 2 took over the `services/graph` lane (see `services/graph/README.md`).

## 0. What is missing today
- `config/scoring.json` does **not exist** in this repo. The Graph Service reads exactly that path (`<repo>/config/scoring.json`), has no default for any weight or threshold, and stops with a clear message if the file is absent or incomplete.
- The source repository (`akanksha1209/stakeout-graph-intelligence`) holds **two different copies** of it (a root `config/scoring.json` marked `1.0.0-draft`, and `services/graph/config/scoring.json` with other numbers, e.g. `fanInMin` 3 against 1). Which one the team means is a decision, not something code can settle.
- For offline tests and the seed 1/2/3 evaluation, the root draft was copied to `services/graph/tests/fixtures/scoring.test.json`, labelled as a TEST copy. **Every evaluation number reported with it is "test thresholds, not agreed".**

## 1. `config/scoring.json` (read by the Graph Service)
Proposed content (the source repo's root draft, unchanged except the two descriptive fields):
```json
{
  "name": "Stakeout scam behavior scoring",
  "version": "1.0.0-draft",
  "weights": {
    "passThroughRatio": 0.50,
    "fanIn": 0.25,
    "fanOut": 0.25,
    "medianForwardTime": 0.15,
    "hopsToExit": 0.10,
    "repeatedFlows": 0.10
  },
  "thresholds": {
    "behaviorScore": 0.40,
    "minSignals": 1,
    "fanInMin": 1,
    "fanOutMin": 1,
    "passThroughRatioMin": 0.4,
    "rapidForwardTimeMaxSeconds": 3600,
    "hopsToExitMax": 2,
    "repeatedFlowsMin": 2
  }
}
```
All six weights and all eight thresholds are required; the service lists every missing one by name. Meaning:

| Field | Meaning in the code |
|---|---|
| weights.* | Added to the score when that signal fires; the sum is capped at 1. So `behaviorScore` is on a 0 to 1 scale. |
| thresholds.behaviorScore, minSignals | Used by `graph/evaluate.py` to decide "suspicious". (The verifier uses `config/rules.json` for its own decision; see section 2.) |
| fanInMin, fanOutMin | Distinct senders / distinct recipients needed for the fan-in / fan-out signal. |
| passThroughRatioMin | out/in needed for the pass-through signal, and for a wallet to count as a relay in detection and linking. |
| rapidForwardTimeMaxSeconds | A wallet is a relay only if its (lower) median forward time is at most this. |
| hopsToExitMax | Fewest forward hops to an exit point must be at most this for the hops signal, and an exit point must be within this many hops of a splitter to form a cluster. |
| repeatedFlowsMin | Repeated sends needed for the repeated-flows signal, and transfers into a cluster needed for "repeated structured outflow". |

**Finding from the test run (please read before agreeing the numbers).** With `fanInMin` 1 and `fanOutMin` 1, any wallet with one inflow and one outflow earns both fan signals. On the generated data, merchants, the exchange-like hot wallet and the framing burners come out "suspicious" on behavior alone, while the **cluster membership** result stays exact (see the README for the three seeds). The verifier only confirms a wallet that the graph puts in a cluster, so those wallets are not confirmed, but a higher `fanInMin`/`fanOutMin` (the other copy has 3) would also fix the behavior score. The team should choose.

An extra field is probably needed: "structured" in "repeated, structured outflow" (AGENTS.md section 4) is implemented only as "at least `repeatedFlowsMin` separate transfers into the cluster". A real definition of "structured" (for example similar amounts or regular spacing) would need a new threshold in this file. Not added: no number was invented.

## 2. `config/rules.json` (read by the Person 2 verifier)
Fields are those in `docs/rules-proposal.md`, which the verifier validates. The values for the first two are taken from the source repo's draft (`behaviorScore` 0.40, `minSignals` 1); the other two have no draft value, so they are marked for the team. A file with these placeholders fails the verifier's check loudly, on purpose.
```json
{
  "behaviorThreshold": 0.4,
  "minSignals": 1,
  "reportConfidenceBoostPerReporter": "TEAM_MUST_CHOOSE",
  "confirmationsToWait": "TEAM_MUST_CHOOSE"
}
```
Note: the source repo's two `rules.json` copies disagree with each other (0.40 / 1 against 0.60 / 2, the latter with extra fields `repeatedFlowsMin` and `passThroughRatioMin` that belong in `scoring.json`). Scale agrees: both are on 0 to 1.

## 3. `shared/schemas/analysis.json` (the Graph Service answer for one wallet)
Matches what `GET /analyze/{address}` returns and what `services/backend/src/verifier/graphAnalysisProposal.ts` parses. Proposed JSON Schema:
```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "GraphAnalysis",
  "type": "object",
  "required": ["target", "clusterId", "behaviorScore", "signals", "members", "exitPoints", "unrelatedReporterCount", "dataSource"],
  "properties": {
    "target": { "type": "string", "pattern": "^0x[a-f0-9]{40}$", "description": "lower-case address" },
    "clusterId": { "type": ["string", "null"], "pattern": "^0x[a-f0-9]{64}$", "description": "null when the wallet is in no cluster; for a link candidate, the cluster it would join" },
    "behaviorScore": { "type": "number", "minimum": 0, "maximum": 1 },
    "signals": { "type": "array", "items": { "type": "object", "required": ["name"], "properties": { "name": { "type": "string" }, "value": {} } }, "description": "only the signals that fired" },
    "metrics": { "type": "array", "items": { "type": "object", "required": ["name"], "properties": { "name": { "type": "string" }, "value": {} } }, "description": "every measured value (optional)" },
    "members": { "type": "array", "items": { "type": "string", "pattern": "^0x[a-f0-9]{40}$" }, "description": "empty when clusterId is null or the wallet is only a candidate" },
    "exitPoints": { "type": "array", "items": { "type": "string", "pattern": "^0x[a-f0-9]{40}$" } },
    "unrelatedReporterCount": { "type": "integer", "minimum": 0 },
    "dataSource": { "enum": ["synthetic", "testnet"], "description": "read from Wallet.data_source in the graph" },
    "link": {
      "type": "object",
      "required": ["repeatedStructuredOutflowToCluster", "fundedByCluster", "forwardsOnwardLikeMember", "isKnownVictim", "isOneOffPayer"],
      "properties": {
        "repeatedStructuredOutflowToCluster": { "type": "boolean" }, "fundedByCluster": { "type": "boolean" }, "forwardsOnwardLikeMember": { "type": "boolean" },
        "isKnownVictim": { "type": "boolean" }, "isOneOffPayer": { "type": "boolean" }
      },
      "description": "present only for a wallet outside every cluster that is connected to one"
    },
    "linked": { "type": "boolean", "description": "the graph's own application of the linking rule (informational; the verifier applies the rule itself)" },
    "reason": { "type": "string" }
  }
}
```
There is deliberately **no `createdAt`** in the answer: it would make the same data hash differently on each call.

## 4. Things the Graph Service now does that other lanes should know
1. **Routes.** The task asked for `/analyze/{address}` and `/link_candidates/{clusterId}`. The Person 2 backend currently PROPOSES `/analysis/{address}` and `/clusters/{clusterId}/link-candidates`. Both spellings are served (the second is an alias) so the verifier works without a change. If the team prefers one, the other alias is deleted in `app/service.py` (or the backend's `graphAnalysisProposal.ts` changes).
2. **`unrelatedReporterCount` is the number of distinct Report vertices pointing at the wallet.** The live `Report` vertex has no reporter attribute, so the graph cannot check that reporters are "unrelated" to the cluster. Needed from Person 3 (who defines what a report stores): a `reporter` attribute, or an agreement that this count is good enough.
3. **`TRANSFER` needs a discriminator.** The live `TRANSFER(amount, timestamp, tx_id)` as described has none, which means two transfers between the same two wallets overwrite each other, and repeated flows (the feeder, a repeat victim) are undercounted or lost. `schema.gsql` declares `tx_id` as the discriminator when it creates a new graph; for the existing live graph `scripts/setup_graph.py` prints a warning if it has none. Nothing alters the live graph.
4. **Cluster ids** are SHA-256 over the sorted, lower-cased member addresses, as `0x` + 64 hex characters (`make_cluster_id`). They are valid bytes32 for the contract (the verifier checks the format only) but they are not keccak256 and cannot be recomputed on chain.
5. **Report `evidence_hash`** is SHA-256 over the canonical JSON of the generated report content (same canonical form as `shared/hash`). `shared/hash` uses keccak256, and Python's standard library has none. If the hash must equal what the web app or the contract would compute, a keccak dependency is needed (for example `pycryptodome`, which provides Keccak-256); that is a new dependency and was not added without asking.
6. **No CORS middleware.** The old service allowed every origin. The service now answers server-to-server callers (the backend); browser calls should go through the backend. If the web app must call it directly, an allowed-origins setting would be added.
7. **Host and port.** The service binds 127.0.0.1 on `GRAPH_SERVICE_PORT` (no default port in code).

## 5. Open questions for the team
0. Which `scoring.json` is the agreed one, and who commits it to `config/`? (Section 0.)
1. Fan-in / fan-out minimums: keep 1, or raise (the other copy uses 3)? (Section 1.)
2. Do we need a threshold for "structured" outflow? (Section 1.)
3. Report schema: add a reporter attribute? (Section 4.2.)
4. TRANSFER discriminator in the live graph: present or not? (Section 4.3; `scripts/setup_graph.py` tells.)
5. keccak256 for report hashes, or is SHA-256 enough? (Section 4.5.)
6. Routes: keep both spellings, or choose one? (Section 4.1.)
