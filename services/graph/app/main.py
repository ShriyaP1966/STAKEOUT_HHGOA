"""Service entry point. Run from services/graph:  uvicorn app.main:app --host 127.0.0.1 --port <GRAPH_SERVICE_PORT>
Importing this module connects to TigerGraph and reads config/scoring.json; any problem stops the program with a clear message."""

import sys

from app.config import ConfigError, service_port, tigergraph_settings
from app.service import create_app
from graph.scoring_config import ScoringConfigError, load_scoring
from graph.tg import GraphConnectionError, TigerGraphBackend, connect


def build():
    try:
        settings = tigergraph_settings()
        service_port()  # validated here so a bad value stops the start, even though uvicorn takes the port from its command line
        scoring = load_scoring()
        conn = connect(settings)
    except (ConfigError, ScoringConfigError, GraphConnectionError) as exc:
        sys.stderr.write(f"Graph Service cannot start: {exc}\n")
        raise SystemExit(1) from None
    return create_app(TigerGraphBackend(conn, scoring, settings.secrets()), scoring)


app = build()
