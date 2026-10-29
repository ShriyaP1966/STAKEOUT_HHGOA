"""Start the Graph Service on 127.0.0.1 at GRAPH_SERVICE_PORT. Usage (from services/graph):  python scripts/run_service.py"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import uvicorn  # noqa: E402

from app.config import ConfigError, service_port  # noqa: E402

if __name__ == "__main__":
    try:
        port = service_port()
    except ConfigError as exc:
        sys.stderr.write(f"Configuration error: {exc}\n")
        raise SystemExit(1) from None
    uvicorn.run("app.main:app", host="127.0.0.1", port=port)
