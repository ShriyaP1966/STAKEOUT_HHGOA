"""Cluster detection from transfer data ALONE (no labels, no ground-truth file).

Pattern (all thresholds come from config/scoring.json):
1. A RELAY is a wallet that receives and sends, passes at least passThroughRatioMin of what it receives onward, and does so quickly
   (median forward time at most rapidForwardTimeMaxSeconds).
2. SPLITTING: a relay that sends to two or more relays (two or more recipients is what "split" means, not a tunable number).
   MERGING: any wallet that receives from two or more relays. A merge point is an EXIT POINT.
3. A cluster is a splitter, an exit point reachable from it within hopsToExitMax hops through relays, and every relay on a path
   between them. Clusters that share a wallet are joined.
Funds that leave an exit point (a rotated wallet) are not members: they are link candidates (see linking.py).
Cluster ids come from the members via make_cluster_id.
"""

from __future__ import annotations

from collections import defaultdict, deque
from dataclasses import dataclass, field

from .ids import make_cluster_id
from .metrics import Transfer, WalletMetrics, compute_metrics, hops_to_nearest, successors
from .scoring_config import Scoring


@dataclass(frozen=True)
class DetectedCluster:
    cluster_id: str
    members: tuple[str, ...]      # every wallet in the cluster, exit points included
    exit_points: tuple[str, ...]


@dataclass
class Detection:
    metrics: dict[str, WalletMetrics]
    clusters: list[DetectedCluster] = field(default_factory=list)

    @property
    def exit_points(self) -> set[str]:
        return {a for c in self.clusters for a in c.exit_points}

    def cluster_of(self, address: str) -> DetectedCluster | None:
        return next((c for c in self.clusters if address in c.members), None)


def is_relay(m: WalletMetrics, cfg: Scoring) -> bool:
    median = m.median_forward_time
    return (
        m.in_count >= 1 and m.out_count >= 1 and m.pass_through_ratio >= cfg.t("passThroughRatioMin")
        and median is not None and median <= cfg.t("rapidForwardTimeMaxSeconds")
    )


def _reach(start: str, graph: dict[str, set[str]]) -> set[str]:
    seen, queue = {start}, deque([start])
    while queue:
        for nxt in graph.get(queue.popleft(), ()):
            if nxt not in seen:
                seen.add(nxt)
                queue.append(nxt)
    return seen


def detect_clusters(transfers: list[Transfer], cfg: Scoring) -> Detection:
    metrics = compute_metrics(transfers)
    relays = {a for a, m in metrics.items() if is_relay(m, cfg)}
    succ = successors(transfers)
    relay_graph = {a: succ[a] for a in relays}                      # edges that start at a relay
    reverse: dict[str, set[str]] = defaultdict(set)
    for a, targets in relay_graph.items():
        for b in targets:
            reverse[b].add(a)

    splitters = [a for a in relays if len(succ[a] & relays) >= 2]
    sinks = [a for a in metrics if len(reverse[a] & relays) >= 2]
    max_hops = int(cfg.t("hopsToExitMax"))

    groups: list[tuple[set[str], set[str]]] = []                    # (members, exit points)
    for s in splitters:
        downstream = _reach(s, relay_graph)
        for m in sinks:
            if m == s or hops_to_nearest(s, {m}, relay_graph, max_hops) is None:
                continue
            upstream = _reach(m, reverse)
            members = {x for x in downstream & upstream if x in relays} | {s, m}
            groups.append((members, {m}))

    merged: list[tuple[set[str], set[str]]] = []
    for members, exits in groups:
        overlapping = [g for g in merged if g[0] & members]
        for g in overlapping:
            merged.remove(g)
            members, exits = members | g[0], exits | g[1]
        merged.append((members, exits))

    clusters = [
        DetectedCluster(make_cluster_id(members), tuple(sorted(members)), tuple(sorted(exits)))
        for members, exits in merged
    ]
    return Detection(metrics=metrics, clusters=sorted(clusters, key=lambda c: c.cluster_id))
