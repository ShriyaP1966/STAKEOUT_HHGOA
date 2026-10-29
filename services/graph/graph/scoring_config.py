"""Reads config/scoring.json (repo root). No weight or threshold has a default in code: a missing file, a missing field or a
wrong type stops the program with a message that lists the problems. The file is owned jointly (see docs/graph-config-proposal.md);
this module only reads it."""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

from app.config import REPO_DIR

SCORING_PATH = REPO_DIR / "config" / "scoring.json"

WEIGHT_NAMES = ("passThroughRatio", "fanIn", "fanOut", "medianForwardTime", "hopsToExit", "repeatedFlows")
THRESHOLD_NAMES = (
    "behaviorScore", "minSignals", "fanInMin", "fanOutMin", "passThroughRatioMin",
    "rapidForwardTimeMaxSeconds", "hopsToExitMax", "repeatedFlowsMin",
)


class ScoringConfigError(Exception):
    pass


@dataclass(frozen=True)
class Scoring:
    weights: dict[str, float]
    thresholds: dict[str, float]
    source: str

    def w(self, name: str) -> float:
        return self.weights[name]

    def t(self, name: str) -> float:
        return self.thresholds[name]


def _number_fields(section: object, names: tuple[str, ...], label: str, problems: list[str]) -> dict[str, float]:
    out: dict[str, float] = {}
    if not isinstance(section, dict):
        problems.append(f"{label} must be an object")
        return out
    for name in names:
        value = section.get(name)
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            problems.append(f"{label}.{name} is missing or not a number")
        elif value < 0:
            problems.append(f"{label}.{name} must not be negative")
        else:
            out[name] = float(value)
    return out


def load_scoring(path: Path | None = None) -> Scoring:
    path = path or SCORING_PATH
    if not path.is_file():
        raise ScoringConfigError(
            f"Scoring file not found at {path}. config/scoring.json is agreed by the team (see docs/graph-config-proposal.md); "
            "nothing is assumed in its absence."
        )
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise ScoringConfigError(f"Scoring file {path} is not valid JSON: {exc.msg} (line {exc.lineno}).") from None
    problems: list[str] = []
    if not isinstance(raw, dict):
        raise ScoringConfigError(f"Scoring file {path} must contain a JSON object.")
    weights = _number_fields(raw.get("weights"), WEIGHT_NAMES, "weights", problems)
    thresholds = _number_fields(raw.get("thresholds"), THRESHOLD_NAMES, "thresholds", problems)
    if problems:
        raise ScoringConfigError(f"Invalid scoring file {path}:\n" + "\n".join(f"  - {p}" for p in problems))
    return Scoring(weights=weights, thresholds=thresholds, source=str(path))
