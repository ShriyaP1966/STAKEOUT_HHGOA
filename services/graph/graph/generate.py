"""Synthetic scenario generator. Everything (addresses, amounts, times, report text) is derived from the seed; nothing is typed in.

Usage (from services/graph):
    python -m graph.generate --seed 1                      # or leave --seed out to use SCENARIO_SEED from .env
    python -m graph.generate --seed 2 --victims 6 --merchants 2 --out data

Writes, into --out (default: services/graph/data, git-ignored):
    transfers.json  the synthetic transfers (what the loader and detection read)
    reports.json    the synthetic victim reports, each with a real content hash (what the loader reads)
    scenarios.json  GROUND TRUTH labels. TEST ONLY: only evaluate.py and the tests may read it. The loader and detection never do.

Scenarios: a scam cluster (victims -> master -> intermediates -> exit point), rotation (the exit point funds a wallet that forwards
on), a feeder (funded by several fresh wallets, then repeatedly pays the master), a repeat victim, dusting of a critic, framing
(burner wallets, each funded from a different source, send dust to an innocent wallet that also receives false reports), and hard
negatives that look busy but are innocent (merchants, an exchange-like hot wallet), plus ordinary noise.
The counts and the time spans are command line flags; the defaults only set the size of the demo.
"""

from __future__ import annotations

import argparse
import json
import random
import sys
from dataclasses import asdict, dataclass
from pathlib import Path

from app.config import DATA_DIR, ConfigError, scenario_seed
from .ids import content_hash, make_cluster_id  # make_cluster_id is re-exported for callers of the old module

DATA_SOURCE = "synthetic"


@dataclass(frozen=True)
class Params:
    seed: int
    victims: int
    intermediates: int
    merchants: int
    exchanges: int
    framing_wallets: int
    noise_pairs: int
    feeders: int
    reports: int
    false_reports: int
    base_timestamp: int
    scam_gap_max: int       # seconds: the longest pause between two hops inside the scam flow
    slow_gap_min: int       # seconds: the shortest pause between payments at a merchant


class Gen:
    def __init__(self, p: Params):
        self.p = p
        self.rng = random.Random(p.seed)
        self.transfers: list[dict] = []
        self.wallets: dict[str, dict] = {}

    def address(self) -> str:
        return "0x" + self.rng.randbytes(20).hex()

    def wallet(self, role: str, scenario: str, expected: str, hard_negative: bool = False) -> str:
        addr = self.address()
        self.wallets[addr] = {"role": role, "scenario": scenario, "expected": expected, "hard_negative": hard_negative}
        return addr

    def transfer(self, source: str, target: str, amount: float, timestamp: int) -> None:
        self.transfers.append({
            "source": source, "target": target, "amount": round(amount, 6), "timestamp": timestamp,
            "tx_id": "0x" + self.rng.randbytes(32).hex(), "data_source": DATA_SOURCE,
        })

    def gap(self, low: int, high: int) -> int:
        return self.rng.randint(low, max(low, high))


def generate(p: Params) -> tuple[list[dict], list[dict], dict]:
    g = Gen(p)
    fast = max(p.scam_gap_max // 6, 1)
    t = p.base_timestamp

    # --- scam cluster
    victims = [g.wallet("victim", "scam_cluster", "negative") for _ in range(p.victims)]
    master = g.wallet("scam_master", "scam_cluster", "member")
    inters = [g.wallet("layering_intermediate", "scam_cluster", "member") for _ in range(p.intermediates)]
    exit_point = g.wallet("exit_point", "scam_cluster", "exit_point")
    amounts = [round(g.rng.uniform(1.5, 3.5), 4) for _ in victims]
    for v, a in zip(victims, amounts):
        t += g.gap(fast, p.scam_gap_max)
        g.transfer(v, master, a, t)
    total = sum(amounts)
    t += g.gap(fast, p.scam_gap_max)
    share = total / max(len(inters), 1)
    for i in inters:
        t += g.gap(fast, p.scam_gap_max)
        g.transfer(master, i, share, t)
    for i in inters:
        t += g.gap(fast, p.scam_gap_max)
        g.transfer(i, exit_point, share * 0.995, t)
    scam_done = t

    # --- repeat victim: pays the master twice and nothing comes back (never linked)
    repeat_victim = g.wallet("repeat_victim", "scam_cluster", "negative", hard_negative=True)
    for _ in range(2):
        t += g.gap(p.slow_gap_min, p.slow_gap_min * 2)
        g.transfer(repeat_victim, master, round(g.rng.uniform(0.5, 1.5), 4), t)

    # --- rotation: the exit point funds a new wallet that forwards onward
    rotated = g.wallet("rotated_wallet", "rotation", "linked")
    downstream = g.wallet("rotation_destination", "rotation", "negative")
    t = scam_done + g.gap(p.scam_gap_max, p.scam_gap_max * 3)
    g.transfer(exit_point, rotated, total * 0.95, t)
    t += g.gap(fast, p.scam_gap_max)
    g.transfer(rotated, downstream, total * 0.95 * 0.99, t)

    # --- feeders: funded by several fresh wallets, then repeatedly pay the master quickly
    for _ in range(p.feeders):
        feeder = g.wallet("feeder", "feeder", "linked")
        t = scam_done + g.gap(p.slow_gap_min, p.slow_gap_min * 2)
        funded = 0.0
        for _ in range(3):
            funder = g.wallet("feeder_funder", "feeder", "negative")
            amount = round(g.rng.uniform(0.4, 1.0), 4)
            t += g.gap(fast, p.scam_gap_max)
            g.transfer(funder, feeder, amount, t)
            funded += amount
        for _ in range(3):
            t += g.gap(fast, p.scam_gap_max)
            g.transfer(feeder, master, funded / 3 * 0.99, t)

    # --- dusting: a cluster member sends dust to a critic
    critic = g.wallet("dusted_critic", "dusting", "negative", hard_negative=True)
    t = scam_done + g.gap(p.scam_gap_max, p.scam_gap_max * 4)
    g.transfer(inters[0], critic, round(g.rng.uniform(0.0002, 0.0009), 6), t)

    # --- framing: burners, each funded from a different source, send dust to an innocent wallet
    framed = g.wallet("framed_innocent", "framing", "negative", hard_negative=True)
    for _ in range(p.framing_wallets):
        source = g.wallet("burner_funder", "framing", "negative")
        burner = g.wallet("framing_burner", "framing", "negative", hard_negative=True)
        t += g.gap(p.scam_gap_max, p.scam_gap_max * 4)
        g.transfer(source, burner, round(g.rng.uniform(0.05, 0.2), 4), t)
        t += g.gap(p.slow_gap_min, p.slow_gap_min * 2)
        g.transfer(burner, framed, round(g.rng.uniform(0.0001, 0.0008), 6), t)

    # --- hard negatives: busy but slow merchants, and an exchange-like hot wallet that pays out quickly but never merges
    for _ in range(p.merchants):
        merchant = g.wallet("merchant", "hard_negative", "negative", hard_negative=True)
        t = p.base_timestamp + g.gap(1, p.slow_gap_min)
        for _ in range(8):
            customer = g.wallet("merchant_customer", "hard_negative", "negative")
            t += g.gap(p.slow_gap_min, p.slow_gap_min * 3)
            g.transfer(customer, merchant, round(g.rng.uniform(0.05, 1.2), 4), t)
        for _ in range(4):
            supplier = g.wallet("merchant_supplier", "hard_negative", "negative")
            t += g.gap(p.slow_gap_min * 2, p.slow_gap_min * 6)
            g.transfer(merchant, supplier, round(g.rng.uniform(0.3, 1.8), 4), t)
    for _ in range(p.exchanges):
        hot = g.wallet("exchange_hot_wallet", "hard_negative", "negative", hard_negative=True)
        t = p.base_timestamp + g.gap(1, p.slow_gap_min)
        deposited = 0.0
        for _ in range(6):
            user = g.wallet("exchange_user", "hard_negative", "negative")
            amount = round(g.rng.uniform(0.2, 2.0), 4)
            t += g.gap(fast, p.scam_gap_max)
            g.transfer(user, hot, amount, t)
            deposited += amount
        for _ in range(5):
            payee = g.wallet("exchange_withdrawal", "hard_negative", "negative")
            t += g.gap(fast, p.scam_gap_max)
            g.transfer(hot, payee, deposited / 5 * 0.995, t)

    # --- noise
    for _ in range(p.noise_pairs):
        a, b = g.wallet("regular_user", "noise", "negative"), g.wallet("regular_user", "noise", "negative")
        g.transfer(a, b, round(g.rng.uniform(0.1, 0.5), 4), p.base_timestamp + g.gap(1, p.slow_gap_min * 4))

    reports = _reports(g, victims, [master, exit_point, *inters], framed)
    g.transfers.sort(key=lambda r: (r["timestamp"], r["tx_id"]))

    ground_truth = {
        "seed": p.seed, "dataSource": DATA_SOURCE, "params": asdict(p),
        "expected_cluster_members": sorted([master, *inters, exit_point]),
        "expected_exit_points": [exit_point],
        "expected_cluster_id": make_cluster_id([master, *inters, exit_point]),
        "wallets": g.wallets,
        "note": "TEST ONLY ground truth: read by evaluate.py and the tests, never by the loader or detection.",
    }
    return g.transfers, reports, ground_truth


def _reports(g: Gen, victims: list[str], scam_targets: list[str], framed: str) -> list[dict]:
    """Real reports: content is generated, evidence_hash is the hash of that content, report_id comes from the hash."""
    out = []
    plan = [(g.rng.choice(victims), g.rng.choice(scam_targets), True) for _ in range(g.p.reports)]
    plan += [(g.address(), framed, False) for _ in range(g.p.false_reports)]
    for index, (reporter, target, genuine) in enumerate(plan):
        content = {
            "reporter": reporter, "target": target, "dataSource": DATA_SOURCE,
            "narrative": f"Synthetic report {index + 1}: the reporter says funds were sent to the target and not returned.",
            "reportedAt": g.p.base_timestamp + g.gap(1, g.p.slow_gap_min * 10),
        }
        digest = content_hash(content)
        out.append({"report_id": "rpt-" + digest[2:18], "target_address": target, "evidence_hash": digest, "content": content})
    return out


def build_parser() -> argparse.ArgumentParser:
    ap = argparse.ArgumentParser(description="Generate a synthetic scenario (see the module docstring).")
    ap.add_argument("--seed", type=int, help="random seed; if omitted, SCENARIO_SEED from .env")
    ap.add_argument("--victims", type=int, default=4)
    ap.add_argument("--intermediates", type=int, default=3)
    ap.add_argument("--merchants", type=int, default=1)
    ap.add_argument("--exchanges", type=int, default=1)
    ap.add_argument("--framing-wallets", type=int, default=3)
    ap.add_argument("--noise-pairs", type=int, default=4)
    ap.add_argument("--feeders", type=int, default=1)
    ap.add_argument("--reports", type=int, default=3, help="genuine reports against scam wallets")
    ap.add_argument("--false-reports", type=int, default=2, help="reports against the innocent framed wallet")
    ap.add_argument("--base-timestamp", type=int, default=1700000000, help="start of the synthetic timeline (unix seconds)")
    ap.add_argument("--scam-gap-max", type=int, default=180, help="longest pause between hops inside the scam flow (seconds)")
    ap.add_argument("--slow-gap-min", type=int, default=7200, help="shortest pause between merchant payments (seconds)")
    ap.add_argument("--out", type=Path, default=DATA_DIR, help="output folder")
    return ap


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        seed = args.seed if args.seed is not None else scenario_seed()
    except ConfigError as exc:
        sys.stderr.write(f"Configuration error: {exc}\nGive --seed N, or set SCENARIO_SEED in services/graph/.env.\n")
        return 1
    if args.intermediates < 2:
        sys.stderr.write("--intermediates must be at least 2 (a split needs two recipients).\n")
        return 1
    if args.victims < 1:
        sys.stderr.write("--victims must be at least 1.\n")
        return 1
    p = Params(seed, args.victims, args.intermediates, args.merchants, args.exchanges, args.framing_wallets, args.noise_pairs,
               args.feeders, args.reports, args.false_reports, args.base_timestamp, args.scam_gap_max, args.slow_gap_min)
    print(f"[generate] seed {seed}")
    transfers, reports, truth = generate(p)
    args.out.mkdir(parents=True, exist_ok=True)
    for name, payload in (("transfers.json", transfers), ("reports.json", reports), ("scenarios.json", truth)):
        (args.out / name).write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    print(f"[generate] wrote {len(transfers)} transfers, {len(reports)} reports and the test-only ground truth to {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
