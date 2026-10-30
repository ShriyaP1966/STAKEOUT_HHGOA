# Graph Service analysis response (as built in services/graph; verifier written against it)

Status: **describes the real `services/graph` service** (read-only for Person 2), checked against its code (`app/service.py`), not yet against a live run from the backend. `shared/schemas/analysis.json` now exists (added in commit `bea41e3` and approved by Person 3); this document still describes the same shape in prose. The backend's own check in `services/backend/src/verifier/graphAnalysisProposal.ts` is looser than the schema (any address casing, optional `metrics`, extra keys) and is unchanged until after submission. The backend tests use a stub server with exactly this shape (marked as fixtures in `verifier-selftest.ts`).

## Routes the backend calls
1. `GET {GRAPH_SERVICE_URL}/analysis/{address}` (alias of the primary `/analyze/{address}`).
2. `GET {GRAPH_SERVICE_URL}/clusters/{clusterId}/link-candidates` (alias of `/link_candidates/{clusterId}`) returns `{ clusterId, candidates: [address, ...], details: [...] }`. The backend reads `clusterId` and `candidates`; `details` is ignored.

`GRAPH_SERVICE_URL` and `GRAPH_TIMEOUT_MS` come from `.env`. The graph returns addresses in lowercase; the backend checksums them.

## Response of `GET /analyze/{address}` (JSON)
| Field | Type | Meaning |
|---|---|---|
| `target` | address | The wallet analysed. |
| `clusterId` | `0x` + 64 hex (bytes32), or `null` | Cluster of a scam wallet. For a candidate that is not yet a member: the cluster it is most connected to. `null` if neither. |
| `behaviorScore` | number | The wallet's own behavior score (scale defined by `config/scoring.json`). |
| `signals` | array of `{name, value}` | Passed unmodified into the evidence bundle. |
| `metrics` | array of `{name, value}` | Numbers behind the score. Accepted by the backend but NOT put in the evidence bundle (see below). |
| `members` | array of addresses | Cluster members; `[]` for a candidate that is not yet a member. |
| `exitPoints` | array of addresses | Exit points; `[]` when not in a cluster. |
| `unrelatedReporterCount` | integer, 0 or more | Number of unrelated reporters. |
| `dataSource` | `"synthetic"` or `"testnet"` | Must equal the backend's `DATA_SOURCE`, or the backend refuses to build evidence. |
| `link` (candidates only) | object | The facts below, decided by the graph. |
| `linked` (candidates only) | boolean | The graph's own link verdict. Recorded in the decision inputs, never used to decide. |
| `reason` (candidates only) | string | The graph's reason for `linked`. Recorded likewise. |

### The `link` object
| Field | Meaning |
|---|---|
| `repeatedStructuredOutflowToCluster` | sends funds into the cluster or its exit points in a repeated, structured way |
| `fundedByCluster` | received funds from the cluster |
| `forwardsOnwardLikeMember` | forwards funds onward the way a cluster member does |
| `isKnownVictim` | a known victim of the cluster: never linked |
| `isOneOffPayer` | paid the cluster once and nothing more: never linked |

The verifier links if `repeatedStructuredOutflowToCluster`, or if `fundedByCluster` and `forwardsOnwardLikeMember`; never if `isKnownVictim` or `isOneOffPayer`. Inbound funding alone (dusting) is ignored. The verifier applies this rule itself to the flags; it does not trust `linked`.

## HTTP errors and how the verifier treats them
| Graph answer | Verifier |
|---|---|
| 200 | parse; a shape that does not match is an error listing the fields |
| 404 `{"detail": "..."}` (unknown address: "No graph data for this address."; also "Wallet not found in the graph.") | **decision recorded as `refused`, rule `graph:no-data`**; the flag is handled and no longer blocks the verifier |
| 404 `{"detail": "No graph data for this cluster."}` on link candidates | logged as an error, treated as zero candidates; the Confirmed event is handled |
| 404 with detail `"Not Found"` (the web framework's default: wrong route or `GRAPH_SERVICE_URL`) | an error; the event waits and is retried |
| 400 (bad address or cluster id), 502 (graph error), other non-200 | an error with the status and the first 200 characters of the body; the event waits and is retried |
| no answer within `GRAPH_TIMEOUT_MS`, or not reachable | an error naming the host and the setting; the event waits and is retried |
| not JSON | an error; the event waits and is retried |

Nothing is guessed. Only a 404 whose body carries a JSON `detail` other than `"Not Found"` counts as "no data".

## Fields the verifier needs that the graph does not provide, or cannot carry
- **`metrics` in the evidence bundle:** the graph returns it, but `shared/schemas/evidence.json` (strict, owned by Person 2 / shared) has no `metrics` field, so it is not stored or hashed. Adding it is a `shared/` change and needs a human decision.
- **Nothing else is missing** for the current decisions: score, signals, cluster, members, exit points, reporter count, data source and the link flags are all present.

## Open questions
1. Should `metrics` go into the evidence bundle (needs a `shared/schemas/evidence.json` change)?
2. Is the analysis deterministic for the same data, so a re-run gives the same evidence hash? (Not checked; the backend does not depend on it for correctness.)
3. Config fields: the verifier reads `behaviorThreshold`, `minSignals`, `reportConfidenceBoostPerReporter`, `confirmationsToWait` from `config/rules.json` (unchanged). The graph's thresholds are in `config/scoring.json`. I did not check that `config/rules.json` exists with those names; see the report.
