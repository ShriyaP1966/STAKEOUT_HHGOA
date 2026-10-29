import os


def keep_temp(extra: dict | None = None) -> dict:
    """An environment with ONLY the variables the OS needs for temp files (so tempfile never falls back to the current folder), plus `extra`."""
    base = {k: v for k, v in os.environ.items() if k.upper() in ("TEMP", "TMP", "TMPDIR", "SYSTEMROOT")}
    return {**base, **(extra or {})}
