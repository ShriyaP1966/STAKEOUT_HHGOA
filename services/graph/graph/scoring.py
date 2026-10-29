"""Behavior score from a wallet's metrics. Weights and thresholds come only from config/scoring.json (see scoring_config.py)."""

from __future__ import annotations

from .metrics import WalletMetrics
from .scoring_config import Scoring


def score_wallet(m: WalletMetrics, hops_to_exit: int | None, cfg: Scoring) -> dict:
    """Each signal that fires adds its weight; the sum is capped at 1. `signals` holds only the signals that fired, as objects with
    a `name` (the evidence bundle schema wants objects); `metrics` holds every measured value."""
    median = m.median_forward_time
    measured = [
        {"name": "passThroughRatio", "value": round(m.pass_through_ratio, 4)},
        {"name": "fanIn", "value": m.in_degree},
        {"name": "fanOut", "value": m.out_degree},
        {"name": "medianForwardTime", "value": median},
        {"name": "hopsToExit", "value": hops_to_exit},
        {"name": "repeatedFlows", "value": m.repeated_flows},
        {"name": "totalIn", "value": round(m.total_in, 6)},
        {"name": "totalOut", "value": round(m.total_out, 6)},
    ]
    fired = {
        "passThroughRatio": m.total_in > 0 and m.pass_through_ratio >= cfg.t("passThroughRatioMin"),
        "fanIn": m.in_degree >= cfg.t("fanInMin"),
        "fanOut": m.out_degree >= cfg.t("fanOutMin"),
        "medianForwardTime": median is not None and median <= cfg.t("rapidForwardTimeMaxSeconds"),
        "hopsToExit": hops_to_exit is not None and hops_to_exit <= cfg.t("hopsToExitMax"),
        "repeatedFlows": m.repeated_flows >= cfg.t("repeatedFlowsMin"),
    }
    signals = [{"name": n, "value": next(x["value"] for x in measured if x["name"] == n)} for n, on in fired.items() if on]
    score = min(sum(cfg.w(n) for n, on in fired.items() if on), 1.0)
    return {"behaviorScore": round(score, 4), "signals": signals, "metrics": measured}


def is_suspicious(result: dict, cfg: Scoring) -> bool:
    return result["behaviorScore"] >= cfg.t("behaviorScore") and len(result["signals"]) >= cfg.t("minSignals")
