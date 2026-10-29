"""TEST ONLY stand-in for TigerGraph: answers the same questions as graph.tg.TigerGraphBackend, computed in Python from generated
transfer and report records. It exists so the service can be tested without a database."""

from __future__ import annotations

from graph.detect import detect_clusters
from graph.metrics import hops_to_nearest, parse_transfers, successors
from graph.scoring_config import Scoring
from graph.tg import CandidateRow, CandidateSet, LiveFacts


class FakeBackend:
    def __init__(self, transfer_records: list[dict], report_records: list[dict], cfg: Scoring, data_source: str | None = None):
        self.cfg = cfg
        self.transfers = parse_transfers(transfer_records)
        self.reports = report_records
        self.detection = detect_clusters(self.transfers, cfg)
        self.succ = successors(self.transfers)
        self.source = data_source if data_source is not None else transfer_records[0]["data_source"]

    def _cluster_by_id(self, cluster_id: str):
        return next((c for c in self.detection.clusters if c.cluster_id == cluster_id), None)

    def analyze(self, address: str) -> LiveFacts:
        m = self.detection.metrics.get(address)
        if m is None:
            return LiveFacts(found=False)
        cluster = self.detection.cluster_of(address)
        own = set(cluster.members) if cluster else set()
        all_members = {a: c for c in self.detection.clusters for a in c.members}
        hops = hops_to_nearest(address, self.detection.exit_points, self.succ, int(self.cfg.t("hopsToExitMax")))
        funders = {t.source for t in self.transfers if t.target == address}
        paid = {t.target for t in self.transfers if t.source == address}
        return LiveFacts(
            found=True, total_in=m.total_in, total_out=m.total_out, in_count=m.in_count, out_count=m.out_count,
            in_degree=m.in_degree, out_degree=m.out_degree, is_exit_point=address in self.detection.exit_points,
            data_source=self.source, cluster_ids=[cluster.cluster_id] if cluster else [],
            members=list(cluster.members) if cluster else [], exit_points=list(cluster.exit_points) if cluster else [],
            report_count=len({r["report_id"] for r in self.reports if r["target_address"] == address}),
            delay_count=len(m.forward_delays), median_forward_time=m.median_forward_time, hops_to_exit=hops,
            funding_clusters=sorted({all_members[f].cluster_id for f in funders if f in all_members and f not in own}),
            paid_clusters=sorted({all_members[p].cluster_id for p in paid if p in all_members and p not in own}),
            outflows_to_cluster=sum(1 for t in self.transfers if t.source == address and t.target in all_members and t.target not in own),
        )

    def link_candidates(self, cluster_id: str) -> CandidateSet:
        cluster = self._cluster_by_id(cluster_id)
        if cluster is None:
            return CandidateSet(0, False, [])
        members = set(cluster.members)
        rapid = self.cfg.t("rapidForwardTimeMaxSeconds")
        reported = bool(members & {r["target_address"] for r in self.reports})
        neighbours = {t.source for t in self.transfers if t.target in members} | {t.target for t in self.transfers if t.source in members}
        rows = []
        for a in sorted(neighbours - members):
            m = self.detection.metrics[a]
            rows.append(CandidateRow(
                a, sum(1 for t in self.transfers if t.source == a and t.target in members),
                sum(1 for t in self.transfers if t.target == a and t.source in members), m.total_in, m.total_out, m.out_count,
                len(m.forward_delays), sum(1 for d in m.forward_delays if d <= rapid),
            ))
        return CandidateSet(len(members), reported, rows)

    def cluster_graph(self, cluster_id: str) -> dict | None:
        cluster = self._cluster_by_id(cluster_id)
        if cluster is None:
            return None
        members = set(cluster.members)
        touching = [t for t in self.transfers if t.source in members or t.target in members]
        ids = {t.source for t in touching} | {t.target for t in touching}
        nodes = [{"id": a, "role": "exit_point" if a in cluster.exit_points else "member" if a in members else "counterparty",
                  "isExitPoint": a in cluster.exit_points, "dataSource": self.source} for a in sorted(ids)]
        edges = [{"src": t.source, "tgt": t.target, "amount": t.amount, "timestamp": t.timestamp, "txId": t.tx_id} for t in touching]
        return {"nodes": nodes, "edges": edges}
