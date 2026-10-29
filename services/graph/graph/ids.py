"""Identifiers and hashes derived from data. Nothing here is typed in by hand."""

from __future__ import annotations

import hashlib
import json
from typing import Any, Iterable


def make_cluster_id(members: Iterable[str]) -> str:
    """bytes32-shaped cluster id: SHA-256 over the sorted, lower-cased member addresses, as 0x + 64 hex characters."""
    cleaned = sorted({m.lower().strip() for m in members})
    if not cleaned:
        raise ValueError("Cannot make a cluster id for an empty member list.")
    return "0x" + hashlib.sha256("".join(cleaned).encode("utf-8")).hexdigest()


def canonical_json(value: Any) -> str:
    """Sorted keys at every depth, no whitespace, non-ASCII kept as is (the same text shape as shared/hash canonicalize)."""
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False)


def content_hash(value: Any) -> str:
    """0x + SHA-256 of the canonical JSON text. NOTE: shared/hash uses keccak256; Python's standard library has no keccak256,
    so this is SHA-256 (the same family as make_cluster_id) until the team decides whether to add a keccak dependency."""
    return "0x" + hashlib.sha256(canonical_json(value).encode("utf-8")).hexdigest()
