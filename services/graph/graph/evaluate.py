"""Evaluate the analysis against the TEST-ONLY ground truth in data/scenarios.json (the only program besides the tests allowed to read it).

Usage (from services/graph):
    python -m graph.evaluate --offline                  # reference analysis computed in Python from the data files (no TigerGraph)
    python -m graph.evaluate                            # asks the running Graph Service at 127.0.0.1:GRAPH_SERVICE_PORT (live graph)
    python -m graph.evaluate --offline --scoring tests/fixtures/scoring.test.json     # a test scoring file instead of config/scoring.json

It prints the seed, three separate confusion tables and the hard negatives, and saves results/eval_seed<N>.json.
  1. suspicious behavior  : score >= thresholds.behaviorScore and enough signals       (actual: member, exit point or linked wallet)
  2. cluster membership   : the wallet is in a detected cluster                       (actual: member or exit point)
  3. linked               : among wallets OUTSIDE a cluster that touch it, the linking rule says linked   (actual: linked wallet)
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from app.config import DATA_DIR, RESULTS_DIR, ConfigError, service_port
from .offline import analyze_all
from .scoring import is_suspicious
from .scoring_config import Scoring, ScoringConfigError, load_scoring

POSITIVE_BEHAVIOR = {"member", "exit_point", "linked"}
POSITIVE_MEMBER = {"member", "exit_point"}


def table(rows: list[tuple[str, bool, bool]]) -> dict:
    """rows: (address, predicted, actual)."""
    tp = sum(1 for _, p, a in rows if p and a)
    fp = sum(1 for _, p, a in rows if p and not a)
    fn = sum(1 for _, p, a in rows if not p and a)
    tn = sum(1 for _, p, a in rows if not p and not a)
    return {
        "TP": tp, "FP": fp, "FN": fn, "TN": tn, "total": len(rows),
        "precision": round(tp / (tp + fp), 4) if tp + fp else None,
        "recall": round(tp / (tp + fn), 4) if tp + fn else None,
        "falsePositives": sorted(a for a, p, act in rows if p and not act),
        "falseNegatives": sorted(a for a, p, act in rows if not p and act),
    }


def live_rows(base_url: str, addresses: list[str], cfg: Scoring) -> dict[str, dict]:
    import httpx

    out: dict[str, dict] = {}
    with httpx.Client(timeout=30.0) as client:
        try:
            client.get(f"{base_url}/health").raise_for_status()
        except httpx.HTTPError as exc:
            raise SystemExit(f"Cannot reach the Graph Service at {base_url}: {exc}. Start it with scripts/run_service.py, or use --offline.")
        for address in addresses:
            r = client.get(f"{base_url}/analyze/{address}")
            if r.status_code == 404:
                continue
            r.raise_for_status()
            body = r.json()
            result = {"behaviorScore": body["behaviorScore"], "signals": body["signals"]}
            in_cluster = body["clusterId"] is not None and (address in body["members"] or address in body["exitPoints"])
            out[address] = {
                "suspicious": is_suspicious(result, cfg), "in_cluster": in_cluster,
                "linked": body.get("linked") if not in_cluster else None, "score": body["behaviorScore"],
            }
    return out


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Evaluate against the test-only ground truth (see the module docstring).")
    ap.add_argument("--data", type=Path, default=DATA_DIR, help="folder with transfers.json, reports.json and scenarios.json")
    ap.add_argument("--scoring", type=Path, help="scoring file to use instead of config/scoring.json (offline experiments only)")
    ap.add_argument("--offline", action="store_true", help="compute the analysis in Python instead of asking the live service")
    ap.add_argument("--out", type=Path, default=RESULTS_DIR, help="folder for eval_seed<N>.json")
    args = ap.parse_args(argv)
    try:
        cfg = load_scoring(args.scoring)
        files = {n: json.loads((args.data / f"{n}.json").read_text(encoding="utf-8")) for n in ("transfers", "reports", "scenarios")}
    except (ScoringConfigError, FileNotFoundError, json.JSONDecodeError) as exc:
        sys.stderr.write(f"Evaluation stopped: {exc}. Run: python -m graph.generate --seed N\n")
        return 1
    truth = files["scenarios"]
    seed = truth["seed"]
    wallets = truth["wallets"]
    mode = "offline reference analysis (Python, not the live graph)" if args.offline else "live Graph Service"
    print(f"Seed: {seed}")
    print(f"Mode: {mode}")
    print(f"Scoring: {cfg.source}")

    if args.offline:
        analysis, _ = analyze_all(files["transfers"], files["reports"], cfg)
        pred = {a: {"suspicious": r.suspicious, "in_cluster": r.in_cluster, "linked": r.linked, "score": r.behavior_score} for a, r in analysis.items()}
    else:
        try:
            port = service_port()
        except ConfigError as exc:
            sys.stderr.write(f"Configuration error: {exc}\n")
            return 1
        pred = live_rows(f"http://127.0.0.1:{port}", sorted(wallets), cfg)

    missing = sorted(set(wallets) - set(pred))
    if missing:
        sys.stderr.write(f"Evaluation stopped: {len(missing)} wallet(s) from the ground truth have no analysis (first: {missing[0]}).\n")
        return 1

    behavior = table([(a, pred[a]["suspicious"], wallets[a]["expected"] in POSITIVE_BEHAVIOR) for a in sorted(wallets)])
    membership = table([(a, pred[a]["in_cluster"], wallets[a]["expected"] in POSITIVE_MEMBER) for a in sorted(wallets)])
    candidates = [a for a in sorted(wallets) if pred[a]["linked"] is not None]
    linking = table([(a, bool(pred[a]["linked"]), wallets[a]["expected"] == "linked") for a in candidates])
    # a linked wallet that never reaches the candidate list can never be found: count it
    unreachable = sorted(a for a in wallets if wallets[a]["expected"] == "linked" and a not in candidates)

    hard = []
    for a in sorted(w for w in wallets if wallets[w]["hard_negative"]):
        hard.append({
            "address": a, "role": wallets[a]["role"], "scenario": wallets[a]["scenario"], "score": pred[a]["score"],
            "flaggedSuspicious": pred[a]["suspicious"], "inCluster": pred[a]["in_cluster"], "linked": pred[a]["linked"],
        })

    for title, t in (("1. SUSPICIOUS BEHAVIOR (score and signals pass)", behavior), ("2. CLUSTER MEMBERSHIP", membership), ("3. LINKED (candidates only)", linking)):
        print(f"\n{title}\n                  actual+   actual-\n  predicted+   {t['TP']:>6}   {t['FP']:>6}\n  predicted-   {t['FN']:>6}   {t['TN']:>6}")
        print(f"  precision {t['precision']}, recall {t['recall']}")
    if unreachable:
        print(f"\nLinked wallets that were never a link candidate: {len(unreachable)}")
    print("\nHARD NEGATIVES (innocent wallets that look suspicious on purpose)")
    for h in hard:
        marks = [m for m, on in (("suspicious behavior", h["flaggedSuspicious"]), ("in a cluster", h["inCluster"]), ("linked", bool(h["linked"]))) if on]
        print(f"  {h['role']:<22} score {h['score']:<6} -> " + ("WRONGLY " + ", ".join(marks) if marks else "correctly left alone"))

    args.out.mkdir(parents=True, exist_ok=True)
    path = args.out / f"eval_seed{seed}.json"
    path.write_text(json.dumps({
        "seed": seed, "mode": mode, "scoring": cfg.source, "behavior": behavior, "membership": membership, "linking": linking,
        "linkedNeverCandidates": unreachable, "hardNegatives": hard,
    }, indent=2) + "\n", encoding="utf-8")
    print(f"\nSaved {path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
