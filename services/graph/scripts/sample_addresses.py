"""Print one example address per role and per scenario from the TEST-ONLY ground truth (data/scenarios.json), for manual testing.
Usage (from services/graph):  python scripts/sample_addresses.py [--data <folder with scenarios.json>]
Read-only. Role and scenario names and the addresses all come from the file; nothing is typed in here. If the file is missing or not
what generate.py writes, it stops with a message. The example is the first address in sorted order, so the same file gives the same output."""

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.config import DATA_DIR  # noqa: E402


def examples(wallets: dict, key: str) -> dict[str, str]:
    first: dict[str, str] = {}
    for address in sorted(wallets):
        first.setdefault(wallets[address][key], address)
    return dict(sorted(first.items()))


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="One example address per role and scenario from data/scenarios.json (test-only ground truth).")
    ap.add_argument("--data", type=Path, default=DATA_DIR, help="folder with scenarios.json")
    path = ap.parse_args(argv).data / "scenarios.json"
    if not path.is_file():
        sys.stderr.write(f"Not found: {path}. Generate it first: python -m graph.generate --seed N\n")
        return 1
    try:
        truth = json.loads(path.read_text(encoding="utf-8"))
        wallets = truth["wallets"]
        if not wallets:
            raise ValueError("it lists no wallets")
        roles, scenarios = examples(wallets, "role"), examples(wallets, "scenario")
    except (json.JSONDecodeError, KeyError, TypeError, ValueError) as exc:
        sys.stderr.write(f"{path} is not a scenarios file written by graph/generate.py ({type(exc).__name__}: {exc}).\n")
        return 1
    print(f"Seed {truth.get('seed')} (synthetic test data, from {path.name})")
    print("\nBy role:")
    for role, address in roles.items():
        print(f"{role}: {address}")
    print("\nBy scenario:")
    for scenario, address in scenarios.items():
        print(f"{scenario}: {address}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
