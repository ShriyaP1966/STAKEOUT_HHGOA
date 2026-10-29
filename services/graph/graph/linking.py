"""Link facts for a wallet that is NOT in a cluster, and the linking rule (AGENTS.md section 4).

The graph decides the five facts below; the verifier only applies the rule. Inbound funding alone (dusting) never links.
Only config/scoring.json supplies numbers (repeatedFlowsMin, passThroughRatioMin, rapidForwardTimeMaxSeconds).
"""

from __future__ import annotations

from dataclasses import dataclass

from .metrics import Transfer, WalletMetrics
from .scoring_config import Scoring


@dataclass(frozen=True)
class LinkFacts:
    """Counts between one wallet and one cluster, plus the wallet's own pass-through behavior."""
    outflows_to_cluster: int        # transfers from the wallet into cluster members or exit points
    inflows_from_cluster: int       # transfers from cluster members or exit points to the wallet
    total_in: float
    total_out: float
    out_count: int
    delay_count: int                # outgoing transfers that have an earlier incoming transfer
    fast_delay_count: int           # ... of which came within rapidForwardTimeMaxSeconds of it
    cluster_reported: bool          # at least one cluster member has a report against it


def facts_for(address: str, members: set[str], transfers: list[Transfer], metrics: WalletMetrics, cluster_reported: bool, cfg: Scoring) -> LinkFacts:
    rapid = cfg.t("rapidForwardTimeMaxSeconds")
    return LinkFacts(
        outflows_to_cluster=sum(1 for t in transfers if t.source == address and t.target in members),
        inflows_from_cluster=sum(1 for t in transfers if t.target == address and t.source in members),
        total_in=metrics.total_in, total_out=metrics.total_out, out_count=metrics.out_count,
        delay_count=len(metrics.forward_delays), fast_delay_count=sum(1 for d in metrics.forward_delays if d <= rapid),
        cluster_reported=cluster_reported,
    )


def link_flags(f: LinkFacts, cfg: Scoring) -> dict[str, bool]:
    """The five flags of the PROPOSED link object (docs/graph-analysis-proposal.md)."""
    # the lower median of the forward delays is at most the limit exactly when this many delays are within it
    median_is_fast = f.delay_count > 0 and f.fast_delay_count >= (f.delay_count - 1) // 2 + 1
    relay_like = f.total_in > 0 and f.total_out / f.total_in >= cfg.t("passThroughRatioMin") and median_is_fast
    forwards = relay_like and f.out_count >= 1
    return {
        "repeatedStructuredOutflowToCluster": f.outflows_to_cluster >= cfg.t("repeatedFlowsMin"),
        "fundedByCluster": f.inflows_from_cluster >= 1,
        "forwardsOnwardLikeMember": forwards,
        # a victim paid the cluster, got nothing back, does not pass funds on, and the cluster has been reported
        "isKnownVictim": f.outflows_to_cluster >= 1 and f.inflows_from_cluster == 0 and not relay_like and f.cluster_reported,
        "isOneOffPayer": f.outflows_to_cluster == 1 and f.inflows_from_cluster == 0,
    }


def decide_link(flags: dict[str, bool]) -> tuple[bool, str]:
    """AGENTS.md section 4. Never for a known victim or a one-off payer; dusting (funded only) is ignored."""
    if flags["isKnownVictim"]:
        return False, "known victim of the cluster is never linked"
    if flags["isOneOffPayer"]:
        return False, "one-off payer is never linked"
    if flags["repeatedStructuredOutflowToCluster"]:
        return True, "sends funds into the cluster in a repeated, structured way"
    if flags["fundedByCluster"] and flags["forwardsOnwardLikeMember"]:
        return True, "funded by the cluster and forwards onward like a member"
    return False, "inbound funding alone is ignored, and no repeated outflow into the cluster"
