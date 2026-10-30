"""The Graph Service HTTP API. It is built from a backend (the live TigerGraph one, or a stand-in in tests) and the scoring config,
so it contains no connection details and no thresholds of its own.

Routes (the first of each pair is the one in the task; the second is the route the Person 2 backend currently PROPOSES, kept as an
alias so the verifier works without a change on its side):
    GET /analyze/{address}               also GET /analysis/{address}
    GET /link_candidates/{clusterId}     also GET /clusters/{clusterId}/link-candidates
    GET /cluster/{clusterId}/graph
    GET /health
With expose_all_routes=False (EXPOSE_ALL_ROUTES=false, a public read-only instance) only /health and /cluster/{clusterId}/graph are
registered, and the generated /docs, /redoc and /openapi.json are turned off; every other path answers 404.
"""

from __future__ import annotations

import re

from fastapi import FastAPI, HTTPException
from fastapi.routing import APIRoute

from graph.linking import LinkFacts, decide_link, link_flags
from graph.scoring import score_wallet
from graph.scoring_config import Scoring
from graph.tg import CandidateRow, GraphConnectionError, LiveFacts, UnknownVertexError

ADDRESS = re.compile(r"^0x[0-9a-fA-F]{40}$")
CLUSTER_ID = re.compile(r"^0x[0-9a-fA-F]{64}$")
DATA_SOURCES = ("synthetic", "testnet")
NO_ADDRESS = "No graph data for this address."
NO_CLUSTER = "No graph data for this cluster."


def members_without_exit_points(members: list[str], exit_points: list[str]) -> list[str]:
    """The graph may list an exit point among the cluster members; the API reports each address in one list only."""
    exits = {a.lower() for a in exit_points}
    return [a for a in members if a.lower() not in exits]


def _link_facts(row: CandidateRow, cluster_reported: bool) -> LinkFacts:
    return LinkFacts(row.outflows_to_cluster, row.inflows_from_cluster, row.total_in, row.total_out, row.out_count,
                     row.delay_count, row.fast_delay_count, cluster_reported)


def served_routes(app: FastAPI) -> list[str]:
    """The method and path of every registered API route (the generated documentation pages are not API routes)."""
    found = {f"{method} {r.path}" for r in app.routes if isinstance(r, APIRoute) for method in sorted(r.methods or ())}
    return sorted(found)


def describe_routes(expose_all_routes: bool, app: FastAPI) -> str:
    """One startup line: the mode and the routes served. It contains no setting value other than the mode."""
    mode = "EXPOSE_ALL_ROUTES=true (all routes)" if expose_all_routes else "EXPOSE_ALL_ROUTES=false (public read-only instance; /docs, /redoc and /openapi.json are off)"
    return f"{mode}. Serving: {', '.join(served_routes(app))}."


def create_app(backend, scoring: Scoring, expose_all_routes: bool = True) -> FastAPI:
    """`expose_all_routes` comes from EXPOSE_ALL_ROUTES; app/main.py always passes it. The default here is only so the offline tests
    that build the full app keep their two-argument call."""
    docs_off = {} if expose_all_routes else {"docs_url": None, "redoc_url": None, "openapi_url": None}
    app = FastAPI(title="Stakeout Graph Service (analysis from the graph)", version="3.0.0", **docs_off)

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
            "members": members_without_exit_points(facts.members, facts.exit_points) if cluster_id else [],
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

    if expose_all_routes:
        app.get("/analyze/{address}")(analyze)
        app.get("/analysis/{address}", include_in_schema=False)(analyze)
        app.get("/link_candidates/{cluster_id}")(link_candidates)
        app.get("/clusters/{cluster_id}/link-candidates", include_in_schema=False)(link_candidates)

    return app
