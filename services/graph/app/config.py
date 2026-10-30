"""Environment settings for the Graph Service. Nothing has a default value: a missing or invalid setting stops the program
with a message that names the variable (never its value). Settings are read when a program asks for them, not at import, so the
offline tools (generator, detection, tests) do not need a TigerGraph account."""

from __future__ import annotations

import os
import re
import sys
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv

SERVICE_DIR = Path(__file__).resolve().parent.parent
REPO_DIR = SERVICE_DIR.parent.parent
DATA_DIR = SERVICE_DIR / "data"
RESULTS_DIR = SERVICE_DIR / "results"

# Only the service folder's own .env is read (git-ignored), and only when a setting is first asked for.
# Variables already set in the shell win.
ENV_FILE = SERVICE_DIR / ".env"
_loaded_from: Path | None = None


def ensure_env_loaded() -> None:
    global _loaded_from
    if _loaded_from != ENV_FILE:
        load_dotenv(dotenv_path=ENV_FILE)
        _loaded_from = ENV_FILE


class ConfigError(Exception):
    """A setting is missing or invalid. The message names the variable, never its value."""


def _text(name: str) -> str:
    ensure_env_loaded()
    value = os.getenv(name)
    if value is None or value.strip() == "":
        raise ConfigError(f"Missing required environment variable {name}. Set it in services/graph/.env (see .env.example).")
    return value.strip()


def _integer(name: str, minimum: int) -> int:
    raw = _text(name)
    try:
        value = int(raw)
    except ValueError:
        raise ConfigError(f"{name} must be a whole number.") from None
    if value < minimum:
        raise ConfigError(f"{name} must be at least {minimum}.")
    return value


@dataclass(frozen=True)
class TigerGraphSettings:
    host: str
    graph_name: str
    secret: str | None      # if set it is used for everything (REST token and GSQL) and username/password are not needed
    username: str | None    # required only when there is no secret
    password: str | None
    port: int | None        # optional: forces this port for REST and GSQL (for a host the driver does not recognise as TigerGraph Cloud)

    def secrets(self) -> list[str]:
        return [s for s in (self.password, self.secret) if s]


def tigergraph_settings() -> TigerGraphSettings:
    """TG_HOST and TG_GRAPH_NAME are always required. With TG_SECRET set, TG_USERNAME and TG_PASSWORD are not needed; without it
    both are required. TG_PORT is optional. Messages name the variable and never repeat its value."""
    host = _text("TG_HOST")
    if not re.match(r"^https?://[^/\s]+", host):
        raise ConfigError("TG_HOST must be a full URL starting with http:// or https://.")
    graph_name = _text("TG_GRAPH_NAME")
    ensure_env_loaded()
    secret = (os.getenv("TG_SECRET") or "").strip() or None
    username = (os.getenv("TG_USERNAME") or "").strip() or None
    password = (os.getenv("TG_PASSWORD") or "").strip() or None
    if secret is None:
        missing = [n for n, v in (("TG_USERNAME", username), ("TG_PASSWORD", password)) if v is None]
        if missing:
            raise ConfigError(
                f"Missing required environment variable(s): {', '.join(missing)}. Set TG_SECRET (then username and password are not needed), "
                "or set both TG_USERNAME and TG_PASSWORD, in services/graph/.env."
            )
    port = None
    if (os.getenv("TG_PORT") or "").strip():
        port = _integer("TG_PORT", 1)
        if port > 65535:
            raise ConfigError("TG_PORT must be at most 65535.")
    return TigerGraphSettings(host=host, graph_name=graph_name, secret=secret, username=username, password=password, port=port)


def scenario_seed() -> int:
    return _integer("SCENARIO_SEED", 0)


def service_port() -> int:
    return _integer("GRAPH_SERVICE_PORT", 1)


def expose_all_routes() -> bool:
    """EXPOSE_ALL_ROUTES: exactly "true" (every route) or "false" (public read-only: only /health and the cluster graph).
    The value is not trimmed or case-folded, so " true", "TRUE", "1" and an empty value are refused."""
    ensure_env_loaded()
    value = os.getenv("EXPOSE_ALL_ROUTES")
    if value is None:
        raise ConfigError("Missing required environment variable EXPOSE_ALL_ROUTES. Set it to true or false in services/graph/.env (see .env.example).")
    if value not in ("true", "false"):
        raise ConfigError('EXPOSE_ALL_ROUTES must be exactly "true" or "false".')
    return value == "true"


def stop_on_config_error(action):
    """Run `action()`; on a ConfigError print the message and exit with status 1."""
    try:
        return action()
    except ConfigError as exc:
        sys.stderr.write(f"Configuration error: {exc}\n")
        raise SystemExit(1) from None
