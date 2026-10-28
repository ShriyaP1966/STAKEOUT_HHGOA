# Proposal: fields of `config/rules.json` (for Person 1 and Person 3 to agree)

Status: **PROPOSAL, not agreed.** `config/rules.json` does not exist yet. The verifier and the evidence builder (Person 2) only read it and invent no values. The verifier now applies these fields as described below; the numbers must still come from the team. If the file is missing, empty or invalid the verifier refuses to start and says so. No numbers are proposed here: the thresholds are the team's to choose.

The verifier reads the file named by `RULES_PATH` in its `.env`. The expected shape is defined once, in `services/backend/src/config.ts` (`rulesSchema`).

| Field | Type | Meaning | How the backend uses it now |
|---|---|---|---|
| `behaviorThreshold` | number | Minimum behavior score from the graph analysis for the wallet's own behavior to count as matching a scam pattern. Rule "B": required for any confirm. | A flagged wallet is confirmed only if `behaviorScore >= behaviorThreshold` (equal passes). |
| `minSignals` | integer, 0 or more | Minimum number of behavior signals the analysis must report before a confirm is allowed. | A confirm also needs `signals.length >= minSignals`. |
| `reportConfidenceBoostPerReporter` | number, 0 or more | How much each unrelated reporter adds to confidence. Reports may only add confidence (rule "A"). | Recorded only: `confidenceWithReports = behaviorScore + boost x unrelatedReporterCount` is written to the decision log. It is never compared with any threshold, so no number of reports can confirm a wallet whose behavior fails. |
| `confirmationsToWait` | integer, 0 or more | Blocks to wait after an event before acting on it. | The watcher only scans up to the latest block minus this number. |

Linking does not use these thresholds: it follows the linking rule in AGENTS.md section 4 using flags supplied by the graph (`docs/graph-analysis-proposal.md`).

## Questions the team must answer
0. Is "behavior must pass; reports only add recorded confidence" the intended meaning of rules A and B? Today a report can never change whether a wallet passes. If the team wants reports to matter in a borderline case, that needs a written formula and a new field, and it changes the "never A alone" guarantee's wording.
1. What scale is `behaviorScore` on (so what does `behaviorThreshold` mean), and does Person 1's `config/scoring.json` fix it?
2. How exactly do `reportConfidenceBoostPerReporter` and `unrelatedReporterCount` combine with the behavior score? A written formula is needed, with the guarantee that behavior alone can pass but reports alone cannot.
3. Are these four fields enough? Anything else (for example separate thresholds for confirm and link) must be agreed before the verifier code is written.
4. Where does `config/rules.json` live and who commits it? The plan says all three agree it in Phase 0 and Person 2 reads it.
