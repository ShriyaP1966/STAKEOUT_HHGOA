"""Read-only look at what TigerGraph has, to find out why a graph was not created.
Usage (from services/graph):  python scripts/diagnose_graph.py            (read-only: only runs the GSQL command "ls")
                              python scripts/diagnose_graph.py --try-create   (see below)

It connects like test_connection.py and prints: the graphs on the workspace, whether the graph named in TG_GRAPH_NAME exists, which of
the expected global vertex and edge types already exist (and whether they match), and the raw answer of the listing with secrets removed.

--try-create is the ONLY option that changes anything. It runs the schema statements one by one exactly as setup_graph.py would, but
prints the raw answer of EACH statement (secrets removed) and stops at the first problem. It refuses to run if the graph already exists,
and it never drops or alters anything. Without the flag nothing is created."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.config import ConfigError, tigergraph_settings  # noqa: E402
from graph.gsql_admin import existing_type_differs, failure_reason, raw_gsql, read_listing, schema_statements  # noqa: E402
from graph.tg import SCHEMA_FILE, GraphConnectionError, connect  # noqa: E402


def main(argv: list[str]) -> int:
    try_create = "--try-create" in argv
    try:
        settings = tigergraph_settings()
        secrets, name = settings.secrets(), settings.graph_name
        conn = connect(settings)
        listing, result = read_listing(conn, secrets)
    except ConfigError as exc:
        sys.stderr.write(f"Configuration error: {exc}\n")
        return 1
    except GraphConnectionError as exc:
        sys.stderr.write(f"Diagnosis stopped: {exc}\n")
        return 1

    print(f"Graphs on the workspace: {', '.join(listing.graphs) if listing.graphs else '(none listed)'}")
    exists = name in listing.graphs
    print(f"Graph named in TG_GRAPH_NAME ({name}) exists: {'YES' if exists else 'NO'}")
    statements = schema_statements(SCHEMA_FILE.read_text(encoding="utf-8"), name)
    for st in (s for s in statements if s.kind != "graph"):
        known = listing.vertices if st.kind == "vertex" else listing.edges
        if st.name not in known:
            print(f"  global {st.kind} type {st.name}: not present")
        else:
            difference = existing_type_differs(st, listing)
            print(f"  global {st.kind} type {st.name}: present, " + ("matches the expected definition" if difference is None else f"DIFFERS ({difference})"))
    print("\nRaw answer of the listing (secrets removed):")
    print(result.shown(secrets, limit=4000))

    if not try_create:
        print("\nRead-only run: nothing was created. Add --try-create to see the raw answer of each schema statement.")
        return 0
    if exists:
        print(f"\n--try-create refused: graph {name} already exists, and this tool never alters an existing graph.")
        return 1
    print("\n--try-create: running the schema statements one at a time.")
    for st in statements:
        if st.kind != "graph":
            known = listing.vertices if st.kind == "vertex" else listing.edges
            if st.name in known:
                print(f"- {st.name}: already exists globally, skipped")
                continue
        try:
            answer = raw_gsql(conn, f"USE GLOBAL\n{st.text}", secrets)
        except GraphConnectionError as exc:
            print(f"- {st.name}: the request itself failed: {exc}")
            return 1
        print(f"- {st.kind} {st.name}: return code {answer.return_code}; raw answer (secrets removed):\n{answer.shown(secrets, limit=1500)}")
        reason = failure_reason(answer)
        if reason:
            print(f"  STOP: {reason}. Later statements were not run.")
            return 1
    after, _ = read_listing(conn, secrets)
    print(f"\nGraphs now: {', '.join(after.graphs) or '(none)'}. Graph {name} exists: {'YES' if name in after.graphs else 'NO'}")
    return 0 if name in after.graphs else 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
