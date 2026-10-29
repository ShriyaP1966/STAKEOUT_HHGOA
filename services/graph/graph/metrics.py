"""Per-wallet facts computed from transfer records alone. This is the reference implementation of what the GSQL query
analyze_wallet computes inside TigerGraph; the offline tools (detection, generator checks, offline evaluation) use it.

Definitions (also written in docs/graph-config-proposal.md):
- degree: number of DISTINCT counterparties (in_degree = distinct senders, out_degree = distinct recipients).
- forward delay of an outgoing transfer: its timestamp minus the latest incoming transfer at or before it (none if there is none).
- median forward time: the LOWER median of the forward delays (element at sorted index (n-1)//2).
- repeated flows: outgoing transfers minus distinct recipients (how many sends repeat a recipient).
"""

from __future__ import annotations

from collections import defaultdict, deque
from dataclasses import dataclass, field
from typing import Iterable, Mapping


@dataclass(frozen=True)
class Transfer:
    source: str
    target: str
    amount: float
    timestamp: int
    tx_id: str
    data_source: str


def parse_transfers(records: Iterable[Mapping]) -> list[Transfer]:
    out = []
    for r in records:
        out.append(Transfer(str(r["source"]).lower(), str(r["target"]).lower(), float(r["amount"]), int(r["timestamp"]), str(r["tx_id"]), str(r["data_source"])))
    return out


@dataclass
class WalletMetrics:
    address: str
    total_in: float = 0.0
    total_out: float = 0.0
    in_count: int = 0
    out_count: int = 0
    senders: set = field(default_factory=set)
    recipients: set = field(default_factory=set)
    forward_delays: list = field(default_factory=list)

    @property
    def in_degree(self) -> int:
        return len(self.senders)

    @property
    def out_degree(self) -> int:
        return len(self.recipients)

    @property
    def pass_through_ratio(self) -> float:
        return self.total_out / self.total_in if self.total_in > 0 else 0.0

    @property
    def median_forward_time(self) -> int | None:
        if not self.forward_delays:
            return None
        ordered = sorted(self.forward_delays)
        return ordered[(len(ordered) - 1) // 2]

    @property
    def repeated_flows(self) -> int:
        return self.out_count - self.out_degree


def compute_metrics(transfers: list[Transfer]) -> dict[str, WalletMetrics]:
    metrics: dict[str, WalletMetrics] = {}
    inflow_times: dict[str, list[int]] = defaultdict(list)
    for t in transfers:
        src = metrics.setdefault(t.source, WalletMetrics(t.source))
        dst = metrics.setdefault(t.target, WalletMetrics(t.target))
        src.total_out += t.amount
        src.out_count += 1
        src.recipients.add(t.target)
        dst.total_in += t.amount
        dst.in_count += 1
        dst.senders.add(t.source)
        inflow_times[t.target].append(t.timestamp)
    for t in transfers:
        earlier = [ts for ts in inflow_times.get(t.source, ()) if ts <= t.timestamp]
        if earlier:
            metrics[t.source].forward_delays.append(t.timestamp - max(earlier))
    return metrics


def successors(transfers: list[Transfer]) -> dict[str, set[str]]:
    out: dict[str, set[str]] = defaultdict(set)
    for t in transfers:
        out[t.source].add(t.target)
    return out


def hops_to_nearest(start: str, goals: set[str], graph: Mapping[str, set[str]], max_hops: int) -> int | None:
    """Fewest forward hops from `start` to any wallet in `goals`, at most `max_hops`; None if there is none (start itself is hop 0)."""
    if start in goals:
        return 0
    seen = {start}
    queue = deque([(start, 0)])
    while queue:
        node, depth = queue.popleft()
        if depth == max_hops:
            continue
        for nxt in graph.get(node, ()):
            if nxt in goals:
                return depth + 1
            if nxt not in seen:
                seen.add(nxt)
                queue.append((nxt, depth + 1))
    return None
