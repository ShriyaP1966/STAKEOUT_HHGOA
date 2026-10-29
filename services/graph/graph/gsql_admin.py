"""Creating the schema and installing queries, with failures that cannot pass unnoticed.

Why this module exists: pyTigerGraph's gsql() drops every line that starts with __GSQL__ (that is where the return code is) and looks
for only a few error sentences, so a statement that TigerGraph rejected can come back as an ordinary-looking answer. Here the raw
answer is read, a non-zero return code or any error-like wording fails the step, AND every step is checked afterwards against what
TigerGraph reports (the graph, the types and the queries must really be there). Nothing here drops or alters an existing graph.

UNVERIFIED against a live Savanna workspace: the exact failure text of POST /gsql/v1/statements is not documented (the TigerGraph 4.2
endpoint page gives only a success example), which is why the checks do not depend on any one sentence.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Callable

from .schema_spec import EDGES, VERTICES
from .tg import GraphConnectionError, redact

STATEMENTS_PATH = "/gsql/v1/statements"
RETURN_CODE = re.compile(r"^__GSQL__RETURN_CODE__,\s*(-?\d+)\s*$")
# Wording that means "this did not work". Deliberately broad: a false alarm stops with the full text shown, a miss would hide a failure.
FAILURE_WORDS = (
    "error", "fail", "exception", "already", "denied", "unauthorized", "forbidden", "not allowed", "not permitted", "cannot", "can't",
    "could not", "unable", "invalid", "conflict", "privilege", "does not exist", "not exist", "not found", "syntax error", "semantic", "parse", "mismatched", "no viable alternative", "extraneous", "expecting", "unexpected",
)


@dataclass(frozen=True)
class GsqlResult:
    raw: tuple          # every line as received, including the __GSQL__ lines
    text: str           # the lines without the __GSQL__ ones
    return_code: int | None

    def shown(self, secrets: list[str], limit: int = 2500) -> str:
        """The raw answer for a human, with secrets removed."""
        return redact("\n".join(self.raw), secrets)[-limit:] or "(the server sent an empty answer)"


def raw_gsql(conn, statement: str, secrets: list[str]) -> GsqlResult:
    """POST one piece of GSQL to /gsql/v1/statements exactly as pyTigerGraph.gsql() does, but keep the whole answer."""
    try:
        answer = conn._req("POST", conn.gsUrl + STATEMENTS_PATH, data=statement.encode("utf-8"), authMode="pwd", resKey=None,
                           skipCheck=True, jsonResponse=False, headers={"Content-Type": "text/plain"})
    except Exception as exc:  # noqa: BLE001
        response = getattr(exc, "response", None)
        status = getattr(response, "status_code", None)
        body = redact(getattr(response, "text", "") or "", secrets)[:800]
        detail = f"HTTP {status}: {body}" if status else (redact(str(exc), secrets) or type(exc).__name__)
        raise GraphConnectionError(f"The GSQL request to {STATEMENTS_PATH} failed ({detail}).") from None
    lines = tuple(answer if isinstance(answer, list) else str(answer).splitlines())
    code = None
    for line in lines:
        m = RETURN_CODE.match(line.strip())
        if m:
            code = int(m.group(1))
    text = "\n".join(l for l in lines if not l.startswith("__GSQL__"))
    return GsqlResult(raw=lines, text=text, return_code=code)


ZERO_COUNT = re.compile(r"\b(?:failed|failures?|errors?)\s*[:=]\s*0\b", re.I)


def failure_reason(result: GsqlResult) -> str | None:
    if result.return_code not in (None, 0):
        return f"TigerGraph returned GSQL return code {result.return_code}"
    lowered = ZERO_COUNT.sub("", result.text).lower()   # "failed: 0" in a success summary is not a failure
    hit = next((w for w in FAILURE_WORDS if w in lowered), None)
    return f"the answer contains \"{hit}\"" if hit else None


def run_checked(conn, statement: str, what: str, secrets: list[str]) -> GsqlResult:
    result = raw_gsql(conn, statement, secrets)
    reason = failure_reason(result)
    if reason:
        raise GraphConnectionError(f"{what} failed: {reason}.\nRaw answer from TigerGraph (secrets removed):\n{result.shown(secrets)}")
    return result


# ---- reading what exists (the "ls" listing)

@dataclass(frozen=True)
class Listing:
    graphs: tuple[str, ...]
    vertices: dict      # name -> the listing line
    edges: dict


def parse_listing(text: str) -> Listing:
    graphs, vertices, edges = [], {}, {}
    for line in text.splitlines():
        if m := re.match(r"^\s*-\s*Graph\s+(\w+)\s*\(", line):
            graphs.append(m.group(1))
        elif m := re.match(r"^\s*-\s*VERTEX\s+(\w+)\s*\(", line, re.I):
            vertices[m.group(1)] = line
        elif m := re.match(r"^\s*-\s*(?:DIRECTED|UNDIRECTED)\s+EDGE\s+(\w+)\s*\(", line, re.I):
            edges[m.group(1)] = line
    return Listing(tuple(graphs), vertices, edges)


def read_listing(conn, secrets: list[str]) -> tuple[Listing, GsqlResult]:
    result = raw_gsql(conn, "ls", secrets)
    if result.return_code not in (None, 0):
        raise GraphConnectionError(f"Listing the graphs failed: GSQL return code {result.return_code}.\nRaw answer (secrets removed):\n{result.shown(secrets)}")
    return parse_listing(result.text), result


# ---- the schema script

@dataclass(frozen=True)
class SchemaStatement:
    kind: str           # vertex | edge | graph
    name: str
    text: str


def schema_statements(script: str, graph_name: str) -> list[SchemaStatement]:
    """One statement per CREATE line of schema.gsql (comments and blank lines ignored), with the graph name filled in."""
    out = []
    for line in script.replace("__GRAPH__", graph_name).splitlines():
        line = line.strip()
        if not line or line.startswith("//"):
            continue
        m = re.match(r"^CREATE\s+(VERTEX|DIRECTED\s+EDGE|UNDIRECTED\s+EDGE|GRAPH)\s+(\w+)", line, re.I)
        if not m:
            raise GraphConnectionError(f"schema.gsql has a line that is not a CREATE statement: {line[:60]}")
        word = m.group(1).upper()
        out.append(SchemaStatement("vertex" if word == "VERTEX" else "graph" if word == "GRAPH" else "edge", m.group(2), line))
    return out


def existing_type_differs(statement: SchemaStatement, listing: Listing) -> str | None:
    """None if the global type already listed matches the expected definition (so it can be reused); otherwise what differs."""
    if statement.kind == "vertex":
        line, spec = listing.vertices[statement.name], VERTICES[statement.name]
        pk_name, pk_type = spec["pk"]
        wanted = [(pk_name, pk_type), *spec["attrs"].items()]
        missing = [f"{n} {t}" for n, t in wanted if not re.search(rf"\b{re.escape(n)}\s+{t}\b", line, re.I)]
    else:
        line, spec = listing.edges[statement.name], EDGES[statement.name]
        missing = [f"{n} {t}" for n, t in spec["attrs"].items() if not re.search(rf"\b{re.escape(n)}\s+{t}\b", line, re.I)]
        if not re.search(rf"FROM\s+{spec['from']}\s*,\s*TO\s+{spec['to']}\b", line, re.I):
            missing.append(f"FROM {spec['from']}, TO {spec['to']}")
        if bool(re.search(r"\bUNDIRECTED\b", line, re.I)) == spec["directed"]:
            missing.append("DIRECTED" if spec["directed"] else "UNDIRECTED")
        if spec["discriminator"] and "DISCRIMINATOR" not in line.upper():
            missing.append("a DISCRIMINATOR (the listing line does not show one)")
    return ("missing from the listing: " + ", ".join(missing)) if missing else None


def create_schema(conn, script: str, graph_name: str, secrets: list[str], say: Callable[[str], None]) -> None:
    """Create the global types and the graph. Safe to run again after a failed run: types that already exist globally and match are
    reused (never recreated), a type that exists but differs stops everything, and every step is verified in TigerGraph afterwards."""
    statements = schema_statements(script, graph_name)
    if graph_name in read_listing(conn, secrets)[0].graphs:
        return say(f"Graph {graph_name} already exists; nothing to create and nothing is changed.")
    for st in statements:
        listing, _ = read_listing(conn, secrets)
        if st.kind == "graph":
            if st.name in listing.graphs:
                return say(f"Graph {st.name} already exists; nothing to create.")
            run_checked(conn, f"USE GLOBAL\n{st.text}", f"Creating graph {st.name}", secrets)
            after, result = read_listing(conn, secrets)
            if st.name not in after.graphs:
                raise GraphConnectionError(
                    f"Creating graph {st.name} reported no error, but the graph is NOT in TigerGraph's list afterwards ({', '.join(after.graphs) or 'no graphs'}).\n"
                    f"Raw answer of the listing (secrets removed):\n{result.shown(secrets)}")
            say(f"Created graph {st.name} (verified in TigerGraph).")
            continue
        known = listing.vertices if st.kind == "vertex" else listing.edges
        if st.name in known:
            difference = existing_type_differs(st, listing)
            if difference:
                raise GraphConnectionError(
                    f"A global {st.kind} type named {st.name} already exists but is not the expected one ({difference}). "
                    "Nothing was created or changed. Use another TG_GRAPH_NAME workspace, or have the type fixed by its owner.")
            say(f"Global {st.kind} type {st.name} already exists and matches; reusing it.")
            continue
        run_checked(conn, f"USE GLOBAL\n{st.text}", f"Creating {st.kind} type {st.name}", secrets)
        after, result = read_listing(conn, secrets)
        if st.name not in (after.vertices if st.kind == "vertex" else after.edges):
            raise GraphConnectionError(
                f"Creating {st.kind} type {st.name} reported no error, but the type is NOT in TigerGraph's global listing afterwards.\n"
                f"Raw answer of the listing (secrets removed):\n{result.shown(secrets)}")
        created_line = (after.vertices if st.kind == "vertex" else after.edges)[st.name]
        say(f"Created global {st.kind} type {st.name} (verified in TigerGraph).")
        if st.kind == "edge" and EDGES[st.name]["discriminator"] and "DISCRIMINATOR" not in created_line.upper():
            say(f"WARNING: the listing line for {st.name} does not show a DISCRIMINATOR: {redact(created_line.strip(), secrets)[:240]}")


SUMMARY = re.compile(r"succeeded:\s*(\d+)\s*,\s*skipped:\s*(\d+)\s*,\s*failed:\s*(\d+)", re.I)
# Phrases that mean the query did not install even if a summary line is present ("failed: 0" is handled by reading the numbers).
INSTALL_PROBLEMS = (
    "saved as draft", "draft", "query installation failed", "failed to", "parse error", "mismatched", "no viable alternative", "extraneous",
    "expecting", "syntax error", "semantic", "error", "exception", "denied", "unauthorized", "forbidden", "cannot", "could not", "unable", "invalid",
)


def install_failure_reason(result: GsqlResult) -> str | None:
    """None only if TigerGraph says the installation succeeded: return code 0 or absent, no problem wording, and the summary line
    "succeeded: N, skipped: N, failed: N" present with failed 0 and (succeeded at least 1, or skipped at least 1 for a query that was
    already installed)."""
    if result.return_code not in (None, 0):
        return f"TigerGraph returned GSQL return code {result.return_code}"
    lowered = ZERO_COUNT.sub("", result.text).lower()
    hit = next((w for w in INSTALL_PROBLEMS if w in lowered), None)
    if hit:
        return f"the answer contains \"{hit}\""
    m = SUMMARY.search(result.text)
    if not m:
        return "the answer has no installation summary line (\"succeeded: N, skipped: N, failed: N\")"
    succeeded, skipped, failed = (int(g) for g in m.groups())
    if failed > 0:
        return f"the installation summary says failed: {failed}"
    if succeeded == 0 and skipped == 0:
        return "the installation summary says nothing was installed (succeeded: 0, skipped: 0)"
    return None


def normalize_query(text: str) -> str:
    """Query text without comments, the CREATE [OR REPLACE] QUERY words and all spaces, lower-cased: for comparing what is installed with what
    is on disk regardless of formatting."""
    text = "\n".join(line.split("//")[0] for line in text.splitlines())
    text = re.sub(r"\bCREATE\s+(?:OR\s+REPLACE\s+)?(?:DISTRIBUTED\s+)?QUERY\b", "", text, flags=re.I)
    return re.sub(r"\s+", "", text).lower()


def installed_query_unchanged(conn, graph_name: str, name: str, text: str, secrets: list[str]) -> bool:
    """True only if TigerGraph can show the installed query and it is the same as `text`. Any doubt (the statement fails, or the shown text
    differs) answers False, which means the query is simply installed again."""
    try:
        shown = raw_gsql(conn, f"USE GRAPH {graph_name}\nSHOW QUERY {name}", secrets)
    except GraphConnectionError:
        return False
    if shown.return_code not in (None, 0):
        return False
    return normalize_query(text) in normalize_query(shown.text)


def install_query(conn, graph_name: str, name: str, text: str, secrets: list[str]) -> str:
    """Install one query. Returns "unchanged" if it was already installed with the same text (nothing is sent), else "installed".
    A failure raises with the raw answer (secrets removed). The result is also checked against TigerGraph's own list of installed queries,
    which holds installed queries only, so a draft cannot pass."""
    before = [str(q) for q in conn.getInstalledQueries(fmt="list")]
    if name in before and installed_query_unchanged(conn, graph_name, name, text, secrets):
        return "unchanged"
    result = raw_gsql(conn, f"USE GRAPH {graph_name}\n{text}\nINSTALL QUERY {name}", secrets)
    reason = install_failure_reason(result)
    if reason:
        raise GraphConnectionError(f"Installing query {name} failed: {reason}.\nRaw answer from TigerGraph (secrets removed):\n{result.shown(secrets)}")
    installed = [str(q) for q in conn.getInstalledQueries(fmt="list")]
    if name not in installed:
        raise GraphConnectionError(
            f"TigerGraph reported success for query {name}, but it is not in the list of installed queries afterwards ({', '.join(installed) or 'none'}), "
            f"so it may only be a draft.\nRaw answer from TigerGraph (secrets removed):\n{result.shown(secrets)}")
    return "installed"
