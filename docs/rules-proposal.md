# Proposal: fields of `config/rules.json` (for Person 1 and Person 3 to agree)

Status: **PROPOSAL, not agreed.** `config/rules.json` does not exist yet. The verifier (Person 2) only reads it and invents no values. If the file is missing, empty or invalid the verifier refuses to start and says so. No numbers are proposed here: the thresholds are the team's to choose.

The verifier reads the file named by `RULES_PATH` in its `.env`. The expected shape is defined once, in `services/backend/src/config.ts` (`rulesSchema`).

| Field | Type | Meaning | Used by the verifier today? |
|---|---|---|---|
| `behaviorThreshold` | number | Minimum behavior score from the graph analysis for the wallet's own behavior to count as matching a scam pattern. This is rule "B": required for any confirm. | No. Needed by the decision logic, which is not written yet. |
| `minSignals` | integer, 0 or more | Minimum number of distinct behavior signals the analysis must report before a confirm is allowed. | No (same reason). |
| `reportConfidenceBoostPerReporter` | number, 0 or more | How much each unrelated reporter adds to confidence. Reports may only add confidence (rule "A"); they can never replace behavior. Reports alone never confirm. | No (same reason). |
| `confirmationsToWait` | integer, 0 or more | Blocks to wait after an event before acting on it. | **Yes.** The watcher only scans up to the latest block minus this number. |

## Questions the team must answer
1. What scale is `behaviorScore` on (so what does `behaviorThreshold` mean), and does Person 1's `config/scoring.json` fix it?
2. How exactly do `reportConfidenceBoostPerReporter` and `unrelatedReporterCount` combine with the behavior score? A written formula is needed, with the guarantee that behavior alone can pass but reports alone cannot.
3. Are these four fields enough? Anything else (for example separate thresholds for confirm and link) must be agreed before the verifier code is written.
4. Where does `config/rules.json` live and who commits it? The plan says all three agree it in Phase 0 and Person 2 reads it.
