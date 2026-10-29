"""Create the schema if the graph does not exist, otherwise compare it with the expected schema and report differences; then install
all queries. It never drops or alters an existing graph. Safe to run again after a failed run (see graph/gsql_admin.py).
Usage (from services/graph):  python scripts/setup_graph.py
Exit status: 0 = schema matches (or was created) and all queries installed; 1 = failure; 2 = blocking schema differences (queries not installed)."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.config import ConfigError, tigergraph_settings  # noqa: E402
from graph.gsql_admin import create_schema, install_query, read_listing  # noqa: E402
from graph.schema_spec import compare_schema  # noqa: E402
from graph.tg import QUERIES_DIR, QUERY_NAMES, SCHEMA_FILE, GraphConnectionError, connect, redact, render_gsql  # noqa: E402


def main() -> int:
    try:
        settings = tigergraph_settings()
        secrets, name = settings.secrets(), settings.graph_name
        conn = connect(settings)
        listing, _ = read_listing(conn, secrets)
        if name in listing.graphs:
            print(f"Graph {name} exists. It is not changed; comparing it with the expected schema.")
        else:
            print(f"Graph {name} does not exist (TigerGraph lists: {', '.join(listing.graphs) or 'no graphs'}). Creating it from graph/schema.gsql.")
            create_schema(conn, SCHEMA_FILE.read_text(encoding="utf-8"), name, secrets, print)
        try:
            live = conn.getSchema(force=True)
        except Exception as exc:  # noqa: BLE001
            raise GraphConnectionError(f"Cannot read the schema of graph {name} from TigerGraph: {redact(str(exc), secrets) or type(exc).__name__}") from None
        diffs = compare_schema(live)
        for d in diffs:
            print(f"  {'DIFFERENCE' if d.blocking else 'warning'}: {d.text}")
        if any(d.blocking for d in diffs):
            print("The live graph differs from the expected schema. Queries were NOT installed. Fix the differences (or tell Person 2) and run again.")
            return 2
        if not diffs:
            print("Schema matches the expected schema.")
        for query in QUERY_NAMES:
            outcome = install_query(conn, name, query, render_gsql((QUERIES_DIR / f"{query}.gsql").read_text(encoding="utf-8"), name), secrets)
            print(f"Query {query} is already installed and unchanged; skipped." if outcome == "unchanged"
                  else f"Installed query {query} (verified in the installed list).")
        print("Setup complete.")
        return 0
    except ConfigError as exc:
        sys.stderr.write(f"Configuration error: {exc}\n")
    except GraphConnectionError as exc:
        sys.stderr.write(f"Setup stopped: {exc}\n")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
