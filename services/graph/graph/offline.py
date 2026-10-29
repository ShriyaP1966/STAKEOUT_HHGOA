"""The reference analysis computed in Python from the transfer and report files (no TigerGraph). It follows the same definitions as the
GSQL queries and the service; it is used by evaluate.py --offline and by the tests. It is NOT the live graph: a result from here
says the definitions work on this data, not that the installed GSQL queries return the same numbers."""

from __future__ import annotations

from dataclasses import dataclass

from .detect import Detection, detect_clusters
from .linking import decide_link, facts_for, link_flags
from .metrics import Transfer, hops_to_nearest, parse_transfers, successors
from .scoring import is_suspicious, score_wallet
from .scoring_config import Scoring


@dataclass(frozen=True)
class Row:
    address: str
    behavior_score: float
    signals: list
    suspicious: bool
    cluster_id: str | None
    in_cluster: bool
    link: dict | None           # the five flags, for a wallet outside the cluster it is a candidate of
    linked: bool | None
    reason: str | None


def analyze_all(transfer_records: list[dict], report_records: list[dict], cfg: Scoring) -> tuple[dict[str, Row], Detection]:
    transfers: list[Transfer] = parse_transfers(transfer_records)
    detection = detect_clusters(transfers, cfg)
    succ = successors(transfers)
    exits = detection.exit_points
    reported_wallets = {str(r["target_address"]).lower() for r in report_records}
    max_hops = int(cfg.t("hopsToExitMax"))

    candidate_of: dict[str, tuple[str, dict, bool, str, int]] = {}
    for cluster in detection.clusters:
        members = set(cluster.members)
        reported = bool(members & reported_wallets)
        neighbours = {t.source for t in transfers if t.target in members} | {t.target for t in transfers if t.source in members}
        for address in sorted(neighbours - members):
            flags = link_flags(facts_for(address, members, transfers, detection.metrics[address], reported, cfg), cfg)
            linked, reason = decide_link(flags)
            weight = sum(1 for t in transfers if {t.source, t.target} & {address} and {t.source, t.target} & members)
            if address not in candidate_of or weight > candidate_of[address][4]:
                candidate_of[address] = (cluster.cluster_id, flags, linked, reason, weight)

    rows: dict[str, Row] = {}
    for address, m in detection.metrics.items():
        scored = score_wallet(m, hops_to_nearest(address, exits, succ, max_hops), cfg)
        cluster = detection.cluster_of(address)
        cand = candidate_of.get(address) if cluster is None else None
        rows[address] = Row(
            address=address, behavior_score=scored["behaviorScore"], signals=scored["signals"], suspicious=is_suspicious(scored, cfg),
            cluster_id=cluster.cluster_id if cluster else (cand[0] if cand else None), in_cluster=cluster is not None,
            link=cand[1] if cand else None, linked=cand[2] if cand else None, reason=cand[3] if cand else None,
        )
    return rows, detection
