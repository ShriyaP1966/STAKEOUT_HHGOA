"""The Graph Service HTTP API. It is built from a backend (the live TigerGraph one, or a stand-in in tests) and the scoring config,
so it contains no connection details and no thresholds of its own.

Routes (the first of each pair is the one in the task; the second is the route the Person 2 backend currently PROPOSES, kept as an
alias so the verifier works without a change on its side):
    GET /analyze/{address}               also GET /analysis/{address}
    GET /link_candidates/{clusterId}     also GET /clusters/{clusterId}/link-candidates
    GET /cluster/{clusterId}/graph
    GET /health
"""

from __future__ import annotations

import re

from fastapi import FastAPI, HTTPException

from graph.linking import LinkFacts, decide_link, link_flags
from graph.scoring import score_wallet
from graph.scoring_config import Scoring
from graph.tg import CandidateRow, GraphConnectionError, LiveFacts, UnknownVertexError

ADDRESS = re.compile(r"^0x[0-9a-fA-F]{40}$")
CLUSTER_ID = re.compile(r"^0x[0-9a-fA-F]{64}$")
DATA_SOURCES = ("synthetic", "testnet")
NO_ADDRESS = "No graph data for this address."
NO_CLUSTER = "No graph data for this cluster."


def _link_facts(row: CandidateRow, cluster_reported: bool) -> LinkFacts:
    return LinkFacts(row.outflows_to_cluster, row.inflows_from_cluster, row.total_in, row.total_out, row.out_count,
                     row.delay_count, row.fast_delay_count, cluster_reported)


def create_app(backend, scoring: Scoring) -> FastAPI:
    app = FastAPI(title="Stakeout Graph Service (analysis from the graph)", version="3.0.0")

    def graph_call(fn, *args, unknown: str | None = None):
        """Run a backend call. `unknown` is the 404 message for an id TigerGraph does not know; without it that case stays a 502 like
        any other graph failure (used for ids the graph itself handed us, where "unknown" would mean the data is inconsistent)."""
        try:
            return fn(*args)
        except UnknownVertexError as exc:
            if unknown is None:
                raise HTTPException(status_code=502, detail=str(exc)) from None
            raise HTTPException(status_code=404, detail=unknown) from None
        except GraphConnectionError as exc:
            raise HTTPException(status_code=502, detail=str(exc)) from None

    def candidate_for(address: str, cluster_id: str) -> tuple[dict, int] | None:
        cs = graph_call(backend.link_candidates, cluster_id)
        row = next((r for r in cs.rows if r.address.lower() == address), None)
        if row is None:
            return None
        flags = link_flags(_link_facts(row, cs.cluster_reported), scoring)
        linked, reason = decide_link(flags)
        return {"flags": flags, "linked": linked, "reason": reason}, row.outflows_to_cluster + row.inflows_from_cluster

    @app.get("/health")
    def health():
        return {"status": "ok"}

    @app.get("/analyze/{address}")
    @app.get("/analysis/{address}", include_in_schema=False)
    def analyze(address: str):
        if not ADDRESS.match(address):
            raise HTTPException(status_code=400, detail="Invalid address. Expected 0x followed by 40 hex characters.")
        target = address.lower()
        facts: LiveFacts = graph_call(backend.analyze, target, unknown=NO_ADDRESS)
        if not facts.found:
            raise HTTPException(status_code=404, detail="Wallet not found in the graph.")
        if facts.data_source not in DATA_SOURCES:
            raise HTTPException(status_code=502, detail="The graph returned no valid data_source for this wallet; refusing to guess one.")

        scored = score_wallet(facts, facts.hops_to_exit, scoring)
        cluster_id = facts.cluster_ids[0] if facts.cluster_ids else None
        body = {
            "target": target,
            "clusterId": cluster_id,
            "behaviorScore": scored["behaviorScore"],
            "signals": scored["signals"],
            "metrics": scored["metrics"],
            "members": facts.members if cluster_id else [],
            "exitPoints": facts.exit_points if cluster_id else [],
            "unrelatedReporterCount": facts.report_count,
            "dataSource": facts.data_source,
        }
        if cluster_id is None:
            # not in a cluster: judge it as a link candidate of the cluster it is most connected to, if any
            best = None
            for related in sorted(set(facts.funding_clusters) | set(facts.paid_clusters)):
                found = candidate_for(target, related)
                if found and (best is None or found[1] > best[1][1]):
                    best = (related, found)
            if best:
                related, (verdict, _) = best
                body.update({"clusterId": related, "link": verdict["flags"], "linked": verdict["linked"], "reason": verdict["reason"]})
        return body

    @app.get("/link_candidates/{cluster_id}")
    @app.get("/clusters/{cluster_id}/link-candidates", include_in_schema=False)
    def link_candidates(cluster_id: str):
        if not CLUSTER_ID.match(cluster_id):
            raise HTTPException(status_code=400, detail="Invalid clusterId. Expected 0x followed by 64 hex characters.")
        cs = graph_call(backend.link_candidates, cluster_id, unknown=NO_CLUSTER)
        if cs.member_count == 0:
            raise HTTPException(status_code=404, detail="Cluster not found in the graph.")
        details = []
        for row in sorted(cs.rows, key=lambda r: r.address):
            flags = link_flags(_link_facts(row, cs.cluster_reported), scoring)
            linked, reason = decide_link(flags)
            details.append({"address": row.address.lower(), "link": flags, "linked": linked, "reason": reason})
        return {"clusterId": cluster_id, "candidates": [d["address"] for d in details], "details": details}

    @app.get("/cluster/{cluster_id}/graph")
    def cluster_graph(cluster_id: str):
        if not CLUSTER_ID.match(cluster_id):
            raise HTTPException(status_code=400, detail="Invalid clusterId. Expected 0x followed by 64 hex characters.")
        graph = graph_call(backend.cluster_graph, cluster_id, unknown=NO_CLUSTER)
        if graph is None:
            raise HTTPException(status_code=404, detail="Cluster not found in the graph.")
        return {"clusterId": cluster_id, **graph}

    return app
