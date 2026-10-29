"""Load transfers and reports into the live graph.

Usage (from services/graph):
    python -m graph.load --dry-run          # builds and prints the payloads, touches no database (no TigerGraph account needed)
    python -m graph.load                    # connects (TG_* in .env) and upserts

Inputs are data/transfers.json and data/reports.json only. Clusters and exit points come from detection (graph/detect.py) run on the
transfers; the ground-truth file is never read. Only the attributes of the live schema are written:
    Wallet(address, is_exit_point, data_source)   Cluster(cluster_id)   Report(report_id, target_address, evidence_hash)
    TRANSFER_TX Wallet->Wallet(amount, timestamp, tx_id; tx_id is the discriminator)   MEMBER_OF Wallet-Cluster   REPORTED Report->Wallet
Nothing is dropped or deleted; upserts only.
"""

from __future__ import annotations

import argparse
import json
import sys
from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path

from app.config import DATA_DIR, ConfigError, tigergraph_settings
from .detect import Detection, detect_clusters
from .ids import content_hash
from .metrics import Transfer, parse_transfers
from .schema_spec import TRANSFER_EDGE
from .scoring_config import Scoring, ScoringConfigError, load_scoring
from .tg import GraphConnectionError, connect

BATCH = 500


class LoadError(Exception):
    pass


@dataclass
class Payloads:
    wallets: list      # (address, {is_exit_point, data_source})
    clusters: list     # (cluster_id, {})
    reports: list      # (report_id, {target_address, evidence_hash})
    transfers: list    # (source, target, {amount, timestamp, tx_id})
    member_of: list    # (address, cluster_id, {})
    reported: list     # (report_id, target, {})
    detection: Detection


def build_payloads(transfer_records: list[dict], report_records: list[dict], cfg: Scoring) -> Payloads:
    transfers: list[Transfer] = parse_transfers(transfer_records)
    sources: dict[str, set[str]] = defaultdict(set)
    for t in transfers:
        sources[t.source].add(t.data_source)
        sources[t.target].add(t.data_source)
    mixed = sorted(a for a, s in sources.items() if len(s) != 1)
    if mixed:
        raise LoadError(f"{len(mixed)} wallet(s) are touched by transfers with different data_source values; refusing to guess (first: {mixed[0]}).")

    detection = detect_clusters(transfers, cfg)
    exit_points = detection.exit_points

    reports, reported = [], []
    for r in report_records:
        target = str(r["target_address"]).lower()
        if target not in sources:
            raise LoadError(f"Report {r['report_id']} targets a wallet that has no transfers in the data: {target}")
        if content_hash(r["content"]) != r["evidence_hash"]:
            raise LoadError(f"Report {r['report_id']}: evidence_hash does not match the hash of its content; the file was edited or is not generated.")
        reports.append((r["report_id"], {"target_address": target, "evidence_hash": r["evidence_hash"]}))
        reported.append((r["report_id"], target, {}))

    return Payloads(
        wallets=[(a, {"is_exit_point": a in exit_points, "data_source": next(iter(s))}) for a, s in sorted(sources.items())],
        clusters=[(c.cluster_id, {}) for c in detection.clusters],
        reports=reports,
        transfers=[(t.source, t.target, {"amount": t.amount, "timestamp": t.timestamp, "tx_id": t.tx_id}) for t in transfers],
        member_of=[(a, c.cluster_id, {}) for c in detection.clusters for a in c.members],
        reported=reported,
        detection=detection,
    )


def _read(path: Path, what: str):
    if not path.is_file():
        raise LoadError(f"{what} not found at {path}. Run: python -m graph.generate --seed N")
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise LoadError(f"{path} is not valid JSON: {exc.msg} (line {exc.lineno}).") from None


def _batches(rows: list):
    for i in range(0, len(rows), BATCH):
        yield rows[i:i + BATCH]


def upsert(conn, p: Payloads) -> None:
    for batch in _batches(p.wallets):
        conn.upsertVertices("Wallet", batch)
    for batch in _batches(p.clusters):
        conn.upsertVertices("Cluster", batch)
    for batch in _batches(p.reports):
        conn.upsertVertices("Report", batch)
    for batch in _batches(p.transfers):
        conn.upsertEdges("Wallet", TRANSFER_EDGE, "Wallet", batch)
    for batch in _batches(p.member_of):
        conn.upsertEdges("Wallet", "MEMBER_OF", "Cluster", batch)
    for batch in _batches(p.reported):
        conn.upsertEdges("Report", "REPORTED", "Wallet", batch)


def repeated_pairs(transfer_records: list[dict]) -> dict[tuple[str, str], int]:
    """(source, target) pairs that have more than one transfer with different tx ids, with how many."""
    txs: dict[tuple[str, str], set[str]] = defaultdict(set)
    for t in transfer_records:
        txs[(str(t["source"]).lower(), str(t["target"]).lower())].add(t["tx_id"])
    return {pair: len(ids) for pair, ids in txs.items() if len(ids) > 1}


def verify_repeated_transfers(conn, transfer_records: list[dict]) -> str:
    """After loading: every pair with several transfers must hold several edges. If TigerGraph kept fewer, the edge type has no working
    discriminator and the repeated flows would silently be undercounted, so this stops the load with the evidence. Returns a note."""
    pairs = repeated_pairs(transfer_records)
    if not pairs:
        return "no wallet pair has more than one transfer in this data, so the discriminator could not be checked"
    for (source, target), expected in sorted(pairs.items()):
        stored = conn.getEdges("Wallet", source, TRANSFER_EDGE, "Wallet", target)
        if len(stored) < expected:
            raise LoadError(
                f"{expected} transfers from {source} to {target} were loaded but TigerGraph stored {len(stored)} {TRANSFER_EDGE} edge(s). "
                f"The edge type has no working discriminator, so repeated transfers overwrite each other. Create the graph from schema.gsql "
                f"(python scripts/setup_graph.py) and load into that one.")
    return f"checked {len(pairs)} wallet pair(s) with repeated transfers: every transfer is its own {TRANSFER_EDGE} edge"


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Load generated data into the graph (see the module docstring).")
    ap.add_argument("--data", type=Path, default=DATA_DIR, help="folder with transfers.json and reports.json")
    ap.add_argument("--scoring", type=Path, help="scoring file to use instead of config/scoring.json (for offline tests only)")
    ap.add_argument("--dry-run", action="store_true", help="build and print the payloads, do not connect")
    args = ap.parse_args(argv)
    try:
        cfg = load_scoring(args.scoring)
        transfer_records = _read(args.data / "transfers.json", "Transfers file")
        p = build_payloads(transfer_records, _read(args.data / "reports.json", "Reports file"), cfg)
    except (ScoringConfigError, LoadError) as exc:
        sys.stderr.write(f"Load stopped: {exc}\n")
        return 1
    print(f"[load] scoring from {cfg.source}")
    print(f"[load] detected {len(p.detection.clusters)} cluster(s), {len(p.detection.exit_points)} exit point(s) from the transfers")
    print(f"[load] payloads: {len(p.wallets)} Wallet, {len(p.clusters)} Cluster, {len(p.reports)} Report, "
          f"{len(p.transfers)} {TRANSFER_EDGE}, {len(p.member_of)} MEMBER_OF, {len(p.reported)} REPORTED")
    if args.dry_run:
        print("[load] dry run: nothing was sent.")
        return 0
    try:
        settings = tigergraph_settings()
        conn = connect(settings)
        upsert(conn, p)
        note = verify_repeated_transfers(conn, transfer_records)
    except ConfigError as exc:
        sys.stderr.write(f"Configuration error: {exc}\n")
        return 1
    except (GraphConnectionError, LoadError) as exc:
        sys.stderr.write(f"Load stopped: {exc}\n")
        return 1
    except Exception as exc:  # noqa: BLE001
        from .tg import redact
        sys.stderr.write(f"Load stopped: TigerGraph rejected the upsert: {redact(str(exc), settings.secrets()) or type(exc).__name__}\n")
        return 1
    print(f"[load] upserted into graph {settings.graph_name}; {note}.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
