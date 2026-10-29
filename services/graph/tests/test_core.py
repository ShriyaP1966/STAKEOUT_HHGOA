"""Offline unit checks: scoring config, ids, metrics, schema and queries. Run from services/graph:
    python -m unittest discover -s tests -t .
"""

import json
import re
import tempfile
import unittest
from pathlib import Path

from graph import schema_spec
from graph.ids import canonical_json, content_hash, make_cluster_id
from graph.linking import LinkFacts, decide_link, link_flags
from graph.metrics import Transfer, compute_metrics, hops_to_nearest, successors
from graph.scoring import is_suspicious, score_wallet
from graph.scoring_config import SCORING_PATH, ScoringConfigError, load_scoring

SERVICE = Path(__file__).resolve().parent.parent
TEST_SCORING = SERVICE / "tests" / "fixtures" / "scoring.test.json"


def tr(source, target, amount, timestamp):
    return Transfer(source, target, amount, timestamp, f"{source}{target}{timestamp}", "synthetic")


class ScoringConfig(unittest.TestCase):
    def write(self, content) -> Path:
        d = Path(tempfile.mkdtemp())
        p = d / "scoring.json"
        p.write_text(content if isinstance(content, str) else json.dumps(content), encoding="utf-8")
        return p

    def test_repo_config_is_missing_today_and_that_is_loud(self):
        # Documents the current state; if config/scoring.json is added this test must be replaced by a real-file check.
        if SCORING_PATH.exists():
            self.skipTest("config/scoring.json exists now")
        with self.assertRaises(ScoringConfigError) as ctx:
            load_scoring()
        self.assertIn("config/scoring.json", str(ctx.exception))

    def test_valid_file_loads(self):
        cfg = load_scoring(TEST_SCORING)
        self.assertIn("rapidForwardTimeMaxSeconds", cfg.thresholds)

    def test_missing_field_is_named(self):
        good = json.loads(TEST_SCORING.read_text())
        del good["thresholds"]["hopsToExitMax"]
        with self.assertRaises(ScoringConfigError) as ctx:
            load_scoring(self.write(good))
        self.assertIn("thresholds.hopsToExitMax", str(ctx.exception))

    def test_wrong_type_negative_and_bad_json(self):
        good = json.loads(TEST_SCORING.read_text())
        good["weights"]["fanIn"] = "high"
        with self.assertRaises(ScoringConfigError):
            load_scoring(self.write(good))
        good["weights"]["fanIn"] = -1
        with self.assertRaises(ScoringConfigError):
            load_scoring(self.write(good))
        with self.assertRaises(ScoringConfigError):
            load_scoring(self.write("{ nope"))

    def test_source_has_no_default_thresholds(self):
        for name in ("scoring.py", "detect.py", "linking.py", "scoring_config.py"):
            text = (SERVICE / "graph" / name).read_text(encoding="utf-8")
            self.assertNotRegex(text, r"\.get\([^)]*,\s*[0-9.]+\)", f"{name} falls back to a numeric default")


class Ids(unittest.TestCase):
    def test_cluster_id_is_stable_and_case_insensitive(self):
        a, b = "0x" + "a" * 40, "0x" + "B" * 40
        self.assertEqual(make_cluster_id([a, b]), make_cluster_id([b.lower(), a.upper().replace("0X", "0x")]))
        self.assertRegex(make_cluster_id([a]), r"^0x[0-9a-f]{64}$")
        with self.assertRaises(ValueError):
            make_cluster_id([])

    def test_content_hash_ignores_key_order(self):
        self.assertEqual(content_hash({"b": 1, "a": [1, 2]}), content_hash({"a": [1, 2], "b": 1}))
        self.assertEqual(canonical_json({"b": 1, "a": 2}), '{"a":2,"b":1}')
        self.assertNotEqual(content_hash({"a": 1}), content_hash({"a": 2}))


class Metrics(unittest.TestCase):
    def test_delays_median_ratio_and_degrees(self):
        # w receives at 100 and 200, sends at 150 (delay 50), 260 (delay 60), 300 (delay 100)
        t = [tr("x", "w", 1, 100), tr("y", "w", 1, 200), tr("w", "p", 1, 150), tr("w", "q", 1, 260), tr("w", "p", 1, 300)]
        m = compute_metrics(t)["w"]
        self.assertEqual(sorted(m.forward_delays), [50, 60, 100])
        self.assertEqual(m.median_forward_time, 60)
        self.assertEqual((m.in_degree, m.out_degree, m.in_count, m.out_count), (2, 2, 2, 3))
        self.assertEqual(m.repeated_flows, 1)
        self.assertAlmostEqual(m.pass_through_ratio, 1.5)

    def test_lower_median_of_even_count(self):
        t = [tr("x", "w", 1, 0), tr("w", "a", 1, 10), tr("w", "b", 1, 30)]
        self.assertEqual(compute_metrics(t)["w"].median_forward_time, 10)

    def test_outflow_before_any_inflow_has_no_delay(self):
        t = [tr("w", "a", 1, 5), tr("x", "w", 1, 10)]
        self.assertEqual(compute_metrics(t)["w"].forward_delays, [])

    def test_hops(self):
        t = [tr("a", "b", 1, 1), tr("b", "c", 1, 2), tr("c", "d", 1, 3)]
        g = successors(t)
        self.assertEqual(hops_to_nearest("a", {"d"}, g, 3), 3)
        self.assertIsNone(hops_to_nearest("a", {"d"}, g, 2))
        self.assertEqual(hops_to_nearest("d", {"d"}, g, 0), 0)


class Scoring(unittest.TestCase):
    cfg = load_scoring(TEST_SCORING)

    def test_signals_are_objects_and_score_is_capped(self):
        t = [tr(f"s{i}", "w", 1, i) for i in range(3)] + [tr("w", f"r{i}", 1, 10 + i) for i in range(3)]
        m = compute_metrics(t)["w"]
        result = score_wallet(m, 1, self.cfg)
        self.assertTrue(all(set(s) == {"name", "value"} for s in result["signals"]))
        self.assertLessEqual(result["behaviorScore"], 1.0)
        self.assertTrue(is_suspicious(result, self.cfg))

    def test_weights_come_from_the_file(self):
        t = [tr("s", "w", 1, 0), tr("w", "r", 1, 10)]
        m = compute_metrics(t)["w"]
        low = load_scoring(TEST_SCORING)
        high = type(low)(weights={**low.weights, "passThroughRatio": 0.0, "fanIn": 0.0, "fanOut": 0.0, "medianForwardTime": 0.0,
                                  "hopsToExit": 0.0, "repeatedFlows": 0.0}, thresholds=low.thresholds, source="x")
        self.assertGreater(score_wallet(m, None, low)["behaviorScore"], 0.0)
        self.assertEqual(score_wallet(m, None, high)["behaviorScore"], 0.0)


class Linking(unittest.TestCase):
    cfg = load_scoring(TEST_SCORING)

    def facts(self, **kw):
        base = dict(outflows_to_cluster=0, inflows_from_cluster=0, total_in=0.0, total_out=0.0, out_count=0, delay_count=0,
                    fast_delay_count=0, cluster_reported=True)
        return LinkFacts(**{**base, **kw})

    def test_dusting_alone_never_links(self):
        flags = link_flags(self.facts(inflows_from_cluster=1, total_in=0.001), self.cfg)
        self.assertEqual(decide_link(flags)[0], False)

    def test_one_off_payer_and_victim_never_link(self):
        one_off = link_flags(self.facts(outflows_to_cluster=1, total_out=1.0), self.cfg)
        self.assertTrue(one_off["isOneOffPayer"])
        self.assertFalse(decide_link(one_off)[0])
        repeat_victim = link_flags(self.facts(outflows_to_cluster=3, total_out=3.0), self.cfg)
        self.assertTrue(repeat_victim["isKnownVictim"])
        self.assertFalse(decide_link(repeat_victim)[0])

    def test_structured_outflow_by_a_relay_links(self):
        relay = self.facts(outflows_to_cluster=3, total_in=3.0, total_out=3.0, out_count=3, delay_count=3, fast_delay_count=3)
        self.assertTrue(decide_link(link_flags(relay, self.cfg))[0])

    def test_funded_and_forwards_links(self):
        f = self.facts(inflows_from_cluster=1, total_in=1.0, total_out=0.99, out_count=1, delay_count=1, fast_delay_count=1)
        self.assertTrue(decide_link(link_flags(f, self.cfg))[0])

    def test_funded_but_slow_does_not_link(self):
        f = self.facts(inflows_from_cluster=1, total_in=1.0, total_out=0.99, out_count=1, delay_count=1, fast_delay_count=0)
        self.assertFalse(decide_link(link_flags(f, self.cfg))[0])


class SchemaAndQueries(unittest.TestCase):
    def test_schema_gsql_matches_the_spec(self):
        text = (SERVICE / "graph" / "schema.gsql").read_text(encoding="utf-8")
        text = "\n".join(l for l in text.splitlines() if not l.strip().startswith("//"))
        vertices = {m.group(1): m.group(2) for m in re.finditer(r"CREATE VERTEX (\w+) \((.*?)\) WITH", text)}
        self.assertEqual(set(vertices), set(schema_spec.VERTICES))
        for name, body in vertices.items():
            spec = schema_spec.VERTICES[name]
            pk = re.search(r"PRIMARY_ID (\w+) (\w+)", body)
            self.assertEqual((pk.group(1), pk.group(2)), spec["pk"])
            attrs = {m.group(1): m.group(2) for m in re.finditer(r",\s*(\w+) (STRING|BOOL|INT|DOUBLE)", body)}
            self.assertEqual(attrs, spec["attrs"], name)
        edges = {m.group(2): (m.group(1), m.group(3)) for m in re.finditer(r"CREATE (DIRECTED|UNDIRECTED) EDGE (\w+) \((.*)\)\n", text + "\n")}
        self.assertEqual(set(edges), set(schema_spec.EDGES))
        for name, (kind, body) in edges.items():
            spec = schema_spec.EDGES[name]
            self.assertEqual(kind == "DIRECTED", spec["directed"], name)
            ends = re.search(r"FROM (\w+), TO (\w+)", body)
            self.assertEqual((ends.group(1), ends.group(2)), (spec["from"], spec["to"]), name)
            attrs = {m.group(1): m.group(2) for m in re.finditer(r"(?:DISCRIMINATOR\()?(\w+) (STRING|BOOL|INT|DOUBLE)", body)}
            self.assertEqual(attrs, spec["attrs"], name)
            self.assertEqual("DISCRIMINATOR(" in body, spec["discriminator"], name)

    def test_no_graph_name_is_written_anywhere(self):
        for path in list((SERVICE / "graph").rglob("*.gsql")) + list((SERVICE / "graph").rglob("*.py")) + list((SERVICE / "app").rglob("*.py")):
            text = path.read_text(encoding="utf-8")
            for banned in ("StakeoutFinal", "StakeoutGraph", "stakeout_graph"):
                self.assertNotIn(banned, text, f"{path.name} contains the graph name {banned}")
        for path in (SERVICE / "graph" / "queries").glob("*.gsql"):
            text = path.read_text(encoding="utf-8")
            self.assertIn("FOR GRAPH __GRAPH__", text)
            self.assertNotRegex(text, r"USE GRAPH (?!__GRAPH__)")

    def test_queries_use_only_live_attributes_and_directions(self):
        edge_attrs = {"amount", "timestamp", "tx_id"}
        vertex_attrs = {"is_exit_point", "data_source", "address", "cluster_id", "report_id", "target_address", "evidence_hash"}
        for path in (SERVICE / "graph" / "queries").glob("*.gsql"):
            text = "\n".join(l.split("//")[0] for l in path.read_text(encoding="utf-8").splitlines())
            for m in re.finditer(r"\be\.(\w+)", text):
                self.assertIn(m.group(1), edge_attrs, f"{path.name}: edge attribute {m.group(1)}")
            for m in re.finditer(r"\b(?:s|t|w|c|r)\.([a-z_]+)\b", text):
                self.assertIn(m.group(1), vertex_attrs, f"{path.name}: vertex attribute {m.group(1)}")
            for m in re.finditer(r"-\((\w+)>?[:)]", text):
                self.assertIn(m.group(1), set(schema_spec.EDGES), f"{path.name}: edge type {m.group(1)}")
            self.assertNotIn("(<", text, f"{path.name} walks an edge backwards")
            self.assertNotRegex(text, r"-\(TRANSFER_TX[^>]*\)->|-\(REPORTED[^>]*\)->", "directed edges must be written TRANSFER_TX> / REPORTED>")

    def test_the_old_shared_transfer_edge_is_not_used_anywhere(self):
        old = re.compile(r"\bTRANSFER\b")
        for path in list((SERVICE / "graph" / "queries").glob("*.gsql")) + [SERVICE / "graph" / "schema.gsql"]:
            code = "\n".join(l.split("//")[0] for l in path.read_text(encoding="utf-8").splitlines())
            self.assertIsNone(old.search(code), f"{path.name} still names the old TRANSFER edge type")
        for path in list((SERVICE / "graph").glob("*.py")) + list((SERVICE / "app").glob("*.py")) + list((SERVICE / "scripts").glob("*.py")):
            self.assertNotIn('"TRANSFER"', path.read_text(encoding="utf-8"), path.name)
        self.assertEqual(schema_spec.TRANSFER_EDGE, "TRANSFER_TX")
        self.assertTrue(schema_spec.EDGES[schema_spec.TRANSFER_EDGE]["discriminator"])

    def test_the_new_edge_statement_follows_the_documented_syntax(self):
        # TigerGraph 4.2, Defining a Graph Schema: DISCRIMINATOR(...) comes right after FROM/TO and before the other attributes;
        # discriminator types may be INT, UINT, DATETIME or STRING
        text = (SERVICE / "graph" / "schema.gsql").read_text(encoding="utf-8")
        line = next(l for l in text.splitlines() if l.startswith("CREATE DIRECTED EDGE TRANSFER_TX"))
        self.assertRegex(line, r"^CREATE DIRECTED EDGE TRANSFER_TX \(FROM Wallet, TO Wallet, DISCRIMINATOR\(tx_id STRING\), amount DOUBLE, timestamp INT\)$")
        self.assertLess(line.index("DISCRIMINATOR"), line.index("amount"))

    def test_compare_schema_reports_differences(self):
        live = {"VertexTypes": [], "EdgeTypes": []}
        for name, spec in schema_spec.VERTICES.items():
            live["VertexTypes"].append({"Name": name, "PrimaryId": {"AttributeName": spec["pk"][0], "AttributeType": {"Name": spec["pk"][1]}},
                                        "Attributes": [{"AttributeName": a, "AttributeType": {"Name": t}} for a, t in spec["attrs"].items()]})
        for name, spec in schema_spec.EDGES.items():
            live["EdgeTypes"].append({"Name": name, "IsDirected": spec["directed"], "FromVertexTypeName": spec["from"], "ToVertexTypeName": spec["to"],
                                      "DiscriminatorCount": 1 if spec["discriminator"] else 0,
                                      "Attributes": [{"AttributeName": a, "AttributeType": {"Name": t}} for a, t in spec["attrs"].items()]})
        self.assertEqual(schema_spec.compare_schema(live), [])
        live["EdgeTypes"][0]["DiscriminatorCount"] = 0
        diffs = schema_spec.compare_schema(live)
        self.assertEqual([d.blocking for d in diffs], [False])
        live["EdgeTypes"][1]["IsDirected"] = True
        live["VertexTypes"][0]["Attributes"].append({"AttributeName": "extra", "AttributeType": {"Name": "INT"}})
        diffs = schema_spec.compare_schema(live)
        self.assertEqual(sum(1 for d in diffs if d.blocking), 2)


if __name__ == "__main__":
    unittest.main()
