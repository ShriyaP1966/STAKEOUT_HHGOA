"""The expected schema of the graph as data, and the comparison with what TigerGraph reports.
schema.gsql is the creation script; tests/test_schema.py checks that it and this spec say the same thing."""

from __future__ import annotations

from dataclasses import dataclass

VERTICES = {
    "Wallet": {"pk": ("address", "STRING"), "attrs": {"is_exit_point": "BOOL", "data_source": "STRING"}},
    "Cluster": {"pk": ("cluster_id", "STRING"), "attrs": {}},
    "Report": {"pk": ("report_id", "STRING"), "attrs": {"target_address": "STRING", "evidence_hash": "STRING"}},
}
# The transfer edge type. A NEW global type with a discriminator; the older global TRANSFER (no discriminator, shared with other graphs) is never used or changed.
TRANSFER_EDGE = "TRANSFER_TX"
EDGES = {
    TRANSFER_EDGE: {"directed": True, "from": "Wallet", "to": "Wallet", "attrs": {"amount": "DOUBLE", "timestamp": "INT", "tx_id": "STRING"}, "discriminator": True},
    "MEMBER_OF": {"directed": False, "from": "Wallet", "to": "Cluster", "attrs": {}, "discriminator": False},
    "REPORTED": {"directed": True, "from": "Report", "to": "Wallet", "attrs": {}, "discriminator": False},
}


@dataclass(frozen=True)
class Difference:
    blocking: bool
    text: str


def _attrs(entry: dict, skip: str | None = None) -> dict:
    return {a["AttributeName"]: a["AttributeType"]["Name"] for a in entry.get("Attributes", []) if a["AttributeName"] != skip}


def compare_schema(live: dict) -> list[Difference]:
    diffs: list[Difference] = []
    live_vertices = {v["Name"]: v for v in live.get("VertexTypes", [])}
    live_edges = {e["Name"]: e for e in live.get("EdgeTypes", [])}
    for name, spec in VERTICES.items():
        v = live_vertices.get(name)
        if v is None:
            diffs.append(Difference(True, f"vertex {name} is missing"))
            continue
        pk = v.get("PrimaryId", {})
        got_pk = (pk.get("AttributeName"), pk.get("AttributeType", {}).get("Name"))
        if got_pk != spec["pk"]:
            diffs.append(Difference(True, f"vertex {name}: primary id is {got_pk}, expected {spec['pk']}"))
        got = _attrs(v, skip=spec["pk"][0])
        if got != spec["attrs"]:
            diffs.append(Difference(True, f"vertex {name}: attributes are {got}, expected {spec['attrs']}"))
    for name, spec in EDGES.items():
        e = live_edges.get(name)
        if e is None:
            diffs.append(Difference(True, f"edge {name} is missing"))
            continue
        if bool(e.get("IsDirected")) != spec["directed"]:
            diffs.append(Difference(True, f"edge {name}: directed is {bool(e.get('IsDirected'))}, expected {spec['directed']}"))
        if (e.get("FromVertexTypeName"), e.get("ToVertexTypeName")) != (spec["from"], spec["to"]):
            diffs.append(Difference(True, f"edge {name}: connects {e.get('FromVertexTypeName')} -> {e.get('ToVertexTypeName')}, expected {spec['from']} -> {spec['to']}"))
        got = _attrs(e)
        if got != spec["attrs"]:
            diffs.append(Difference(True, f"edge {name}: attributes are {got}, expected {spec['attrs']}"))
        if spec["discriminator"] and not e.get("DiscriminatorCount"):
            diffs.append(Difference(False, f"edge {name} has no discriminator: two transfers between the same two wallets overwrite each other, "
                                           "so repeated flows are undercounted (not blocking, but the repeated-flow facts will be wrong)"))
    for extra in sorted(set(live_vertices) - set(VERTICES)) + sorted(set(live_edges) - set(EDGES)):
        diffs.append(Difference(False, f"{extra} exists in the live graph but not in the expected schema (left alone)"))
    return diffs
