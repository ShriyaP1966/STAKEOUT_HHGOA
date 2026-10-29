"""Connect to TigerGraph with the settings in services/graph/.env and print the graph name and the installed queries.
Usage (from services/graph):  python scripts/test_connection.py
Exit status 0 only if the connection worked. A failure prints a clear message (never a password or a secret) and stops."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.config import ConfigError, tigergraph_settings  # noqa: E402
from graph.tg import QUERY_NAMES, GraphConnectionError, connect, installed_queries, redact  # noqa: E402


def main() -> int:
    try:
        settings = tigergraph_settings()
    except ConfigError as exc:
        sys.stderr.write(f"Configuration error: {exc}\n")
        return 1
    try:
        conn = connect(settings)
        queries = installed_queries(conn)
    except GraphConnectionError as exc:
        sys.stderr.write(f"Connection failed: {exc}\n")
        return 1
    except Exception as exc:  # noqa: BLE001 - anything else from the driver is still a loud failure
        sys.stderr.write(f"Connection failed: {redact(str(exc), settings.secrets()) or type(exc).__name__}\n")
        return 1
    print(f"Connected. Graph: {settings.graph_name}")
    print("Installed queries: " + (", ".join(queries) if queries else "(none)"))
    missing = [q for q in QUERY_NAMES if q not in queries]
    if missing:
        print("Not installed yet (run scripts/setup_graph.py): " + ", ".join(missing))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
