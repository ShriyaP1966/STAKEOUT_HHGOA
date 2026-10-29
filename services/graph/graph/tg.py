"""The only module that talks to TigerGraph. It connects (optionally with a secret), runs the installed queries and turns their
JSON into plain Python facts. Errors never carry the password or the secret.

UNVERIFIED against a live TigerGraph: the shape of the query answers is read from pyTigerGraph's documented output; a human must run
scripts/test_connection.py and the service once and report anything that does not parse.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import pyTigerGraph as tg

from app.config import TigerGraphSettings
from .scoring_config import Scoring

QUERIES_DIR = Path(__file__).resolve().parent / "queries"
SCHEMA_FILE = Path(__file__).resolve().parent / "schema.gsql"
QUERY_NAMES = ("analyze_wallet", "get_cluster_graph", "link_candidates")
GRAPH_PLACEHOLDER = "__GRAPH__"


class GraphConnectionError(Exception):
    """A TigerGraph call failed. The message is safe to print."""


class UnknownVertexError(GraphConnectionError):
    """TigerGraph does not know the vertex id passed to a query (an address or cluster id that is not in the graph).
    This is an answer about the data, not a failure of the service, so the API turns it into a 404."""


# The one wording TigerGraph uses, as seen on Savanna: "('Failed to convert user vertex id for parameter wallet_id', None)".
# Only this phrase is treated as "unknown vertex"; every other TigerGraph error is still a loud failure.
UNKNOWN_VERTEX_PHRASES = ("failed to convert user vertex id",)

def redact(text: str, secrets: list[str]) -> str:
    for secret in secrets:
        if secret:
            text = text.replace(secret, "[redacted]")
    return text


def connection_arguments(settings: TigerGraphSettings) -> dict:
    """Arguments for pyTigerGraph.TigerGraphConnection (2.0.4 API, read from its source).
    - With a secret: gsqlSecret=secret (the driver then signs GSQL calls with it) and no username or password.
    - Without: username and password.
    - A host whose name contains tgcloud is recognised by the driver as TigerGraph Cloud and served on port 443 (REST under /restpp,
      GSQL on the same port) without any port argument. TG_PORT, if set, is passed as both restppPort and gsPort for other hosts."""
    args: dict = {"host": settings.host, "graphname": settings.graph_name}
    if settings.secret:
        args["gsqlSecret"] = settings.secret
    else:
        args.update(username=settings.username, password=settings.password)
    if settings.port is not None:
        args.update(restppPort=settings.port, gsPort=settings.port)
    return args


def connect(settings: TigerGraphSettings) -> tg.TigerGraphConnection:
    """Open a connection. If TG_SECRET is set the REST token is requested with it, and a failure stops the program."""
    try:
        conn = tg.TigerGraphConnection(**connection_arguments(settings))
    except Exception as exc:  # noqa: BLE001 - re-raised with a safe message
        raise GraphConnectionError(f"Cannot create the TigerGraph connection to {settings.host}: {redact(str(exc), settings.secrets()) or type(exc).__name__}") from None
    if settings.secret:
        try:
            conn.getToken(settings.secret)
        except Exception as exc:  # noqa: BLE001
            reason = redact(str(exc), settings.secrets()) or type(exc).__name__
            raise GraphConnectionError(
                f"TigerGraph refused to issue a token for the secret in TG_SECRET (host {settings.host}, graph {settings.graph_name}): {reason}. "
                "Check TG_SECRET, TG_HOST, TG_PORT and TG_GRAPH_NAME in services/graph/.env. The secret itself is not printed."
            ) from None
    return conn


def render_gsql(text: str, graph_name: str) -> str:
    return text.replace(GRAPH_PLACEHOLDER, graph_name)


def _merge(parts: list[dict]) -> dict:
    merged: dict = {}
    for part in parts:
        merged.update(part)
    return merged


def _id(item: Any) -> str:
    return str(item["v_id"] if isinstance(item, dict) else item)


def _ids(items: Any) -> list[str]:
    return sorted({_id(i) for i in (items or [])})


def _first(value: Any, default: Any = None) -> Any:
    if isinstance(value, list):
        return value[0] if value else default
    return value if value is not None else default


def _attributes(vertex_list: Any) -> dict:
    first = _first(vertex_list, {})
    return first.get("attributes", {}) if isinstance(first, dict) else {}


@dataclass
class LiveFacts:
    """What analyze_wallet found. Attribute names match WalletMetrics so graph.scoring works on either."""
    found: bool
    total_in: float = 0.0
    total_out: float = 0.0
    in_count: int = 0
    out_count: int = 0
    in_degree: int = 0
    out_degree: int = 0
    is_exit_point: bool = False
    data_source: str = ""
    cluster_ids: list[str] = field(default_factory=list)
    members: list[str] = field(default_factory=list)
    exit_points: list[str] = field(default_factory=list)
    report_count: int = 0
    delay_count: int = 0
    median_forward_time: int | None = None
    hops_to_exit: int | None = None
    funding_clusters: list[str] = field(default_factory=list)
    paid_clusters: list[str] = field(default_factory=list)
    outflows_to_cluster: int = 0

    @property
    def pass_through_ratio(self) -> float:
        return self.total_out / self.total_in if self.total_in > 0 else 0.0

    @property
    def repeated_flows(self) -> int:
        return self.out_count - self.out_degree


@dataclass(frozen=True)
class CandidateRow:
    address: str
    outflows_to_cluster: int
    inflows_from_cluster: int
    total_in: float
    total_out: float
    out_count: int
    delay_count: int
    fast_delay_count: int


@dataclass(frozen=True)
class CandidateSet:
    member_count: int
    cluster_reported: bool
    rows: list[CandidateRow]


class TigerGraphBackend:
    def __init__(self, conn: tg.TigerGraphConnection, scoring: Scoring, secrets: list[str]):
        self.conn, self.scoring, self.secrets = conn, scoring, secrets

    def _run(self, name: str, params: dict) -> dict:
        try:
            return _merge(self.conn.runInstalledQuery(name, params))
        except Exception as exc:  # noqa: BLE001
            message = f"TigerGraph query {name} failed: {redact(str(exc), self.secrets) or type(exc).__name__}"
            if any(phrase in str(exc).lower() for phrase in UNKNOWN_VERTEX_PHRASES):
                raise UnknownVertexError(message) from None
            raise GraphConnectionError(message) from None

    def analyze(self, address: str) -> LiveFacts:
        max_hops = int(self.scoring.t("hopsToExitMax"))
        r = self._run("analyze_wallet", {"wallet_id": (address,), "max_hops": max_hops})
        if _first(r.get("found"), 0) == 0:
            return LiveFacts(found=False)
        w, d = _attributes(r.get("wallet")), _attributes(r.get("degrees"))
        # the degrees come back as computed expression values, not attributes; accept either shape
        degrees_row = _first(r.get("degrees"), {}) or {}
        hops = _first(r.get("hopsToExit"))
        delay_count = int(_first(r.get("delayCount"), 0))
        return LiveFacts(
            found=True,
            total_in=float(w.get("totalIn", 0.0)), total_out=float(w.get("totalOut", 0.0)),
            in_count=int(w.get("inCount", 0)), out_count=int(w.get("outCount", 0)),
            in_degree=int(d.get("inDegree", degrees_row.get("inDegree", 0))), out_degree=int(d.get("outDegree", degrees_row.get("outDegree", 0))),
            is_exit_point=bool(w.get("isExitPoint", False)), data_source=str(w.get("dataSource", "")),
            cluster_ids=_ids(r.get("clusterIds")), members=_ids(r.get("membersList")), exit_points=_ids(r.get("exitPointsList")),
            report_count=int(_first(r.get("reporterCount"), 0)), delay_count=delay_count,
            median_forward_time=int(_first(r.get("medianForwardTime"))) if delay_count > 0 else None,
            hops_to_exit=int(hops) if hops is not None and int(hops) <= max_hops else None,
            funding_clusters=_ids(r.get("fundingClusters")), paid_clusters=_ids(r.get("paidClusters")),
            outflows_to_cluster=int(_first(r.get("outflowsToCluster"), 0)),
        )

    def link_candidates(self, cluster_id: str) -> CandidateSet:
        r = self._run("link_candidates", {"cluster": (cluster_id,), "rapid_max": int(self.scoring.t("rapidForwardTimeMaxSeconds"))})
        rows = []
        for v in r.get("candidates", []):
            a = v.get("attributes", {})
            rows.append(CandidateRow(
                _id(v), int(a.get("outflowsToCluster", 0)), int(a.get("inflowsFromCluster", 0)), float(a.get("totalIn", 0.0)),
                float(a.get("totalOut", 0.0)), int(a.get("outCount", 0)), int(a.get("delayCount", 0)), int(a.get("fastDelayCount", 0)),
            ))
        return CandidateSet(int(_first(r.get("memberCount"), 0)), bool(_first(r.get("clusterReported"), False)), rows)

    def cluster_graph(self, cluster_id: str) -> dict | None:
        r = self._run("get_cluster_graph", {"cluster": (cluster_id,)})
        if int(_first(r.get("memberCount"), 0)) == 0:
            return None
        nodes = []
        for v in r.get("nodes", []):
            a = v.get("attributes", {})
            member, exit_point = bool(a.get("isMember")), bool(a.get("isExitPoint"))
            nodes.append({
                "id": _id(v), "role": "exit_point" if member and exit_point else "member" if member else "counterparty",
                "isExitPoint": exit_point, "dataSource": a.get("dataSource", ""),
            })
        edges = []
        for e in r.get("transfers", []):
            a = e.get("attributes", {})
            edges.append({"src": e["from_id"], "tgt": e["to_id"], "amount": a.get("amount"), "timestamp": a.get("timestamp"), "txId": a.get("tx_id")})
        return {"nodes": sorted(nodes, key=lambda n: n["id"]), "edges": sorted(edges, key=lambda e: (e["timestamp"] or 0, e["txId"] or ""))}


def installed_queries(conn: tg.TigerGraphConnection) -> list[str]:
    """Names of the queries installed on the connection's graph (pyTigerGraph fmt="list")."""
    return sorted(str(n) for n in conn.getInstalledQueries(fmt="list"))
