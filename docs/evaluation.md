# Evaluation results: seeds 1 and 2

All data in this file is synthetic. No real wallets, victims or funds are involved.

Each section is the unedited output of `python -m graph.evaluate`, run from `services/graph` against the live Graph Service (which queries the TigerGraph graph). The labels were regenerated first with `python -m graph.generate --seed N`, which writes only the git-ignored `data/` folder. Nothing was written to TigerGraph. The numbers below were not edited by hand.

In both runs the "Scoring:" and "Saved" lines were shortened to repo-relative paths (`config/scoring.json`, `results/eval_seed<N>.json`) after the run; nothing else in the printed output was changed.

## Run 1, before the fix

Membership recall is 0.8 in this run because `graph/evaluate.py` counted the exit point as an expected member while the Graph Service lists exit points only in `exitPoints`, not in `members`.

### Seed 1

- Seed: 1
- Run at: 2026-10-30T17:55:43 UTC (2026-10-30T23:25:47+05:30 local time of the laptop)
- Commit: `d761d18` (HEAD when the evaluation ran)
- Mode: live Graph Service (not offline)
- Commands, in order, from `services/graph`: `python -m graph.generate --seed 1`, then `python -m graph.evaluate`
- Retries: none were needed (no call returned 500 or 502 during this run)

Output, exactly as printed:

```
Seed: 1
Mode: live Graph Service
Scoring: config/scoring.json

1. SUSPICIOUS BEHAVIOR (score and signals pass)
                  actual+   actual-
  predicted+        7        1
  predicted-        0       49
  precision 0.875, recall 1.0

2. CLUSTER MEMBERSHIP
                  actual+   actual-
  predicted+        4        0
  predicted-        1       52
  precision 1.0, recall 0.8

3. LINKED (candidates only)
                  actual+   actual-
  predicted+        2        0
  predicted-        0        6
  precision 1.0, recall 1.0

HARD NEGATIVES (innocent wallets that look suspicious on purpose)
  merchant               score 0.35   -> correctly left alone
  repeat_victim          score 0      -> correctly left alone
  framed_innocent        score 0.025  -> correctly left alone
  dusted_critic          score 0      -> correctly left alone
  exchange_hot_wallet    score 0.75   -> WRONGLY suspicious behavior
  framing_burner         score 0      -> correctly left alone
  framing_burner         score 0      -> correctly left alone
  framing_burner         score 0      -> correctly left alone

Saved results/eval_seed1.json
```

In this output the hard-negative lines marked WRONGLY are: 1, namely `exchange_hot_wallet    score 0.75   -> WRONGLY suspicious behavior`

### Seed 2

- Seed: 2
- Run at: 2026-10-30T17:55:59 UTC (2026-10-30T23:26:02+05:30 local time of the laptop)
- Commit: `d761d18` (HEAD when the evaluation ran)
- Mode: live Graph Service (not offline)
- Commands, in order, from `services/graph`: `python -m graph.generate --seed 2`, then `python -m graph.evaluate`
- Retries: none were needed (no call returned 500 or 502 during this run)

Output, exactly as printed:

```
Seed: 2
Mode: live Graph Service
Scoring: config/scoring.json

1. SUSPICIOUS BEHAVIOR (score and signals pass)
                  actual+   actual-
  predicted+        7        1
  predicted-        0       49
  precision 0.875, recall 1.0

2. CLUSTER MEMBERSHIP
                  actual+   actual-
  predicted+        4        0
  predicted-        1       52
  precision 1.0, recall 0.8

3. LINKED (candidates only)
                  actual+   actual-
  predicted+        2        0
  predicted-        0        6
  precision 1.0, recall 1.0

HARD NEGATIVES (innocent wallets that look suspicious on purpose)
  exchange_hot_wallet    score 0.75   -> WRONGLY suspicious behavior
  framed_innocent        score 0.025  -> correctly left alone
  framing_burner         score 0      -> correctly left alone
  repeat_victim          score 0      -> correctly left alone
  framing_burner         score 0      -> correctly left alone
  framing_burner         score 0      -> correctly left alone
  merchant               score 0.35   -> correctly left alone
  dusted_critic          score 0      -> correctly left alone

Saved results/eval_seed2.json
```

In this output the hard-negative lines marked WRONGLY are: 1, namely `exchange_hot_wallet    score 0.75   -> WRONGLY suspicious behavior`

## Run 2, after the fix

Run after commit `0bebfc6`, which changes `graph/evaluate.py` so that an address in `exitPoints` also counts as in the cluster. Same data, same graph, same scoring file.

### Seed 1

- Seed: 1
- Run at: 2026-10-30T18:03:06 UTC (2026-10-30T23:33:09+05:30 local time of the laptop)
- Commit: `0bebfc6` (HEAD when the evaluation ran)
- Mode: live Graph Service (not offline)
- Commands, in order, from `services/graph`: `python -m graph.generate --seed 1`, then `python -m graph.evaluate`
- Retries: none were needed (no call returned 500 or 502 during this run)

Output, exactly as printed (apart from the two shortened path lines):

```
Seed: 1
Mode: live Graph Service
Scoring: config/scoring.json

1. SUSPICIOUS BEHAVIOR (score and signals pass)
                  actual+   actual-
  predicted+        7        1
  predicted-        0       49
  precision 0.875, recall 1.0

2. CLUSTER MEMBERSHIP
                  actual+   actual-
  predicted+        5        0
  predicted-        0       52
  precision 1.0, recall 1.0

3. LINKED (candidates only)
                  actual+   actual-
  predicted+        2        0
  predicted-        0        6
  precision 1.0, recall 1.0

HARD NEGATIVES (innocent wallets that look suspicious on purpose)
  merchant               score 0.35   -> correctly left alone
  repeat_victim          score 0      -> correctly left alone
  framed_innocent        score 0.025  -> correctly left alone
  dusted_critic          score 0      -> correctly left alone
  exchange_hot_wallet    score 0.75   -> WRONGLY suspicious behavior
  framing_burner         score 0      -> correctly left alone
  framing_burner         score 0      -> correctly left alone
  framing_burner         score 0      -> correctly left alone

Saved results/eval_seed1.json
```

In this output the hard-negative lines marked WRONGLY are: 1, namely `exchange_hot_wallet    score 0.75   -> WRONGLY suspicious behavior`

### Seed 2

- Seed: 2
- Run at: 2026-10-30T18:03:19 UTC (2026-10-30T23:33:22+05:30 local time of the laptop)
- Commit: `0bebfc6` (HEAD when the evaluation ran)
- Mode: live Graph Service (not offline)
- Commands, in order, from `services/graph`: `python -m graph.generate --seed 2`, then `python -m graph.evaluate`
- Retries: none were needed (no call returned 500 or 502 during this run)

Output, exactly as printed (apart from the two shortened path lines):

```
Seed: 2
Mode: live Graph Service
Scoring: config/scoring.json

1. SUSPICIOUS BEHAVIOR (score and signals pass)
                  actual+   actual-
  predicted+        7        1
  predicted-        0       49
  precision 0.875, recall 1.0

2. CLUSTER MEMBERSHIP
                  actual+   actual-
  predicted+        5        0
  predicted-        0       52
  precision 1.0, recall 1.0

3. LINKED (candidates only)
                  actual+   actual-
  predicted+        2        0
  predicted-        0        6
  precision 1.0, recall 1.0

HARD NEGATIVES (innocent wallets that look suspicious on purpose)
  exchange_hot_wallet    score 0.75   -> WRONGLY suspicious behavior
  framed_innocent        score 0.025  -> correctly left alone
  framing_burner         score 0      -> correctly left alone
  repeat_victim          score 0      -> correctly left alone
  framing_burner         score 0      -> correctly left alone
  framing_burner         score 0      -> correctly left alone
  merchant               score 0.35   -> correctly left alone
  dusted_critic          score 0      -> correctly left alone

Saved results/eval_seed2.json
```

In this output the hard-negative lines marked WRONGLY are: 1, namely `exchange_hot_wallet    score 0.75   -> WRONGLY suspicious behavior`

## Differences between Run 1 and Run 2

Seed 1: the printed lines that differ are:

```
-  predicted+        4        0
-  predicted-        1       52
-  precision 1.0, recall 0.8
+  predicted+        5        0
+  predicted-        0       52
+  precision 1.0, recall 1.0
```

Seed 2: the printed lines that differ are:

```
-  predicted+        4        0
-  predicted-        1       52
-  precision 1.0, recall 0.8
+  predicted+        5        0
+  predicted-        0       52
+  precision 1.0, recall 1.0
```

Every other line of the two outputs for each seed (behavior table, linked table, hard negatives, mode, scoring file) is identical. Only the CLUSTER MEMBERSHIP table changed.
