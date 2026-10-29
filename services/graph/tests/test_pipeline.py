"""Generator, detection, offline analysis and loader payloads, on generated data. Run from services/graph:
    python -m unittest discover -s tests -t .
"""

import contextlib
import copy
import io
import json
import tempfile
import unittest
from pathlib import Path

from graph import generate, load
from tests import keep_temp
from graph.detect import detect_clusters
from graph.metrics import parse_transfers
from graph.offline import analyze_all
from graph.scoring_config import load_scoring

SERVICE = Path(__file__).resolve().parent.parent
CFG = load_scoring(SERVICE / "tests" / "fixtures" / "scoring.test.json")


def params(seed, **over):
    base = dict(seed=seed, victims=4, intermediates=3, merchants=1, exchanges=1, framing_wallets=3, noise_pairs=4, feeders=1,
                reports=3, false_reports=2, base_timestamp=1700000000, scam_gap_max=180, slow_gap_min=7200)
    return generate.Params(**{**base, **over})


class Generator(unittest.TestCase):
    def test_same_seed_same_data_different_seed_different_data(self):
        a, b, c = generate.generate(params(5)), generate.generate(params(5)), generate.generate(params(6))
        self.assertEqual(a, b)
        self.assertNotEqual(a[0], c[0])
        self.assertTrue({r["source"] for r in a[0]}.isdisjoint({r["source"] for r in c[0]}), "addresses must come from the seed")

    def test_flags_change_the_counts(self):
        small = generate.generate(params(1, victims=2, merchants=0, exchanges=0))[0]
        large = generate.generate(params(1, victims=8, merchants=3, exchanges=2))[0]
        self.assertLess(len(small), len(large))

    def test_everything_is_labelled_synthetic(self):
        transfers, reports, truth = generate.generate(params(2))
        self.assertTrue(all(t["data_source"] == "synthetic" for t in transfers))
        self.assertEqual(truth["dataSource"], "synthetic")
        self.assertTrue(all(r["content"]["dataSource"] == "synthetic" for r in reports))

    def test_report_hash_is_the_hash_of_its_content(self):
        from graph.ids import content_hash
        _, reports, _ = generate.generate(params(3))
        self.assertTrue(reports)
        for r in reports:
            self.assertEqual(r["evidence_hash"], content_hash(r["content"]))
            self.assertRegex(r["evidence_hash"], r"^0x[0-9a-f]{64}$")
            self.assertTrue(r["evidence_hash"][2:18] in r["report_id"])

    def test_cli_requires_a_seed_from_somewhere(self):
        import os
        from unittest import mock
        err = io.StringIO()
        with mock.patch.dict(os.environ, keep_temp(), clear=True), mock.patch("app.config.ENV_FILE", Path(tempfile.mkdtemp()) / "none.env"), contextlib.redirect_stderr(err):
            self.assertEqual(generate.main(["--out", tempfile.mkdtemp()]), 1)
        self.assertIn("--seed", err.getvalue())


class Detection(unittest.TestCase):
    def check(self, p):
        transfers, reports, truth = generate.generate(p)
        detection = detect_clusters(parse_transfers(transfers), CFG)
        self.assertEqual(len(detection.clusters), 1, f"seed {p.seed}")
        cluster = detection.clusters[0]
        self.assertEqual(list(cluster.members), truth["expected_cluster_members"])
        self.assertEqual(list(cluster.exit_points), truth["expected_exit_points"])
        self.assertEqual(cluster.cluster_id, truth["expected_cluster_id"])

    def test_many_seeds(self):
        for seed in range(1, 21):
            self.check(params(seed))

    def test_other_shapes(self):
        for over in ({"victims": 7, "intermediates": 5}, {"merchants": 3, "exchanges": 3}, {"feeders": 3}, {"framing_wallets": 6, "noise_pairs": 12}):
            self.check(params(9, **over))

    def test_nothing_in_a_scam_free_world(self):
        transfers, _, truth = generate.generate(params(4))
        scam = {a for a, w in truth["wallets"].items() if w["scenario"] in ("scam_cluster", "rotation", "feeder", "dusting")}
        clean = [t for t in transfers if t["source"] not in scam and t["target"] not in scam]
        self.assertGreater(len(clean), 10)
        self.assertEqual(detect_clusters(parse_transfers(clean), CFG).clusters, [])

    def test_detection_and_loader_never_read_the_ground_truth(self):
        for name in ("detect.py", "load.py", "metrics.py", "linking.py", "scoring.py", "offline.py"):
            self.assertNotIn("scenarios", (SERVICE / "graph" / name).read_text(encoding="utf-8"), name)
        # evaluate.py and the generator are the only programs allowed to name it
        allowed = {"evaluate.py", "generate.py"}
        for path in (SERVICE / "graph").glob("*.py"):
            if path.name not in allowed:
                self.assertNotIn("scenarios.json", path.read_text(encoding="utf-8"), path.name)

    def test_changing_the_threshold_changes_the_result(self):
        transfers, _, _ = generate.generate(params(1))
        strict = type(CFG)(weights=CFG.weights, thresholds={**CFG.thresholds, "rapidForwardTimeMaxSeconds": 0}, source="x")
        self.assertEqual(detect_clusters(parse_transfers(transfers), strict).clusters, [])


class Offline(unittest.TestCase):
    def test_roles_match_expectations_on_default_data(self):
        transfers, reports, truth = generate.generate(params(1))
        rows, _ = analyze_all(transfers, reports, CFG)
        by_role = lambda role: [rows[a] for a, w in truth["wallets"].items() if w["role"] == role]
        self.assertTrue(all(r.in_cluster for r in by_role("scam_master") + by_role("exit_point")))
        self.assertTrue(all(r.linked for r in by_role("rotated_wallet") + by_role("feeder")))
        for role in ("victim", "repeat_victim", "dusted_critic", "framed_innocent", "merchant", "exchange_hot_wallet", "framing_burner"):
            for r in by_role(role):
                self.assertFalse(r.in_cluster, role)
                self.assertFalse(r.linked, f"{role} must never be linked")

    def test_dusted_critic_is_a_candidate_but_not_linked(self):
        transfers, reports, truth = generate.generate(params(1))
        rows, _ = analyze_all(transfers, reports, CFG)
        critic = next(a for a, w in truth["wallets"].items() if w["role"] == "dusted_critic")
        self.assertIsNotNone(rows[critic].link)
        self.assertTrue(rows[critic].link["fundedByCluster"])
        self.assertFalse(rows[critic].linked)


class FakeLoadConn:
    """TEST ONLY connection for the loader. `keep_all` False emulates an edge type without a discriminator (one edge per wallet pair)."""

    def __init__(self, keep_all=True):
        self.keep_all, self.edges, self.vertices = keep_all, {}, []

    def upsertVertices(self, vertex_type, rows):
        self.vertices.append((vertex_type, len(rows)))

    def upsertEdges(self, source_type, edge_type, target_type, rows):
        for source, target, attrs in rows:
            key = (edge_type, source, target) if self.keep_all is False else (edge_type, source, target, attrs.get("tx_id"))
            self.edges[key] = attrs
        return len(rows)

    def getEdges(self, source_type, source_id, edge_type, target_type, target_id):
        return [a for k, a in self.edges.items() if k[:3] == (edge_type, source_id, target_id)]


class LoaderEdges(unittest.TestCase):
    def data(self):
        transfers, reports, truth = generate.generate(params(1))
        return transfers, reports

    def test_the_loader_writes_the_new_edge_type_and_never_the_old_one(self):
        transfers, reports = self.data()
        p = load.build_payloads(transfers, reports, CFG)
        conn = FakeLoadConn()
        calls = []
        original = conn.upsertEdges
        conn.upsertEdges = lambda s, e, t, rows: (calls.append(e), original(s, e, t, rows))[1]
        load.upsert(conn, p)
        self.assertEqual(set(calls), {"TRANSFER_TX", "MEMBER_OF", "REPORTED"})
        self.assertNotIn("TRANSFER", calls)
        self.assertEqual(len([k for k in conn.edges if k[0] == "TRANSFER_TX"]), len(transfers), "one edge per transfer, repeats included")

    def test_repeated_pairs_in_the_default_data(self):
        transfers, _ = self.data()
        pairs = load.repeated_pairs(transfers)
        self.assertEqual(sorted(pairs.values()), [2, 3])

    def test_the_check_passes_when_every_transfer_is_its_own_edge(self):
        transfers, reports = self.data()
        conn = FakeLoadConn()
        load.upsert(conn, load.build_payloads(transfers, reports, CFG))
        self.assertIn("every transfer is its own TRANSFER_TX edge", load.verify_repeated_transfers(conn, transfers))

    def test_the_check_stops_the_load_when_repeats_were_collapsed(self):
        transfers, reports = self.data()
        conn = FakeLoadConn(keep_all=False)           # what the old TRANSFER type did: one edge per pair
        load.upsert(conn, load.build_payloads(transfers, reports, CFG))
        with self.assertRaises(load.LoadError) as ctx:
            load.verify_repeated_transfers(conn, transfers)
        self.assertIn("no working discriminator", str(ctx.exception))
        self.assertRegex(str(ctx.exception), r"\d+ transfers from 0x[0-9a-f]+ to 0x[0-9a-f]+ were loaded but TigerGraph stored 1 TRANSFER_TX edge")

    def test_data_without_repeats_says_it_could_not_check(self):
        transfers, _ = self.data()
        unique = [t for t in transfers if (t["source"], t["target"]) not in load.repeated_pairs(transfers)]
        self.assertIn("could not be checked", load.verify_repeated_transfers(FakeLoadConn(), unique))

    def test_main_reports_the_collapse_and_exits_1(self):
        import os
        from unittest import mock
        transfers, reports = self.data()
        d = Path(tempfile.mkdtemp())
        (d / "transfers.json").write_text(json.dumps(transfers))
        (d / "reports.json").write_text(json.dumps(reports))
        none = d / "none.env"
        env = keep_temp({"TG_HOST": "https://ws.invalid", "TG_GRAPH_NAME": "g", "TG_SECRET": "s3cret-value"})
        scoring_path = str(SERVICE / "tests" / "fixtures" / "scoring.test.json")
        for keep_all, expected_code in ((True, 0), (False, 1)):
            out, err = io.StringIO(), io.StringIO()
            conn = FakeLoadConn(keep_all=keep_all)
            with mock.patch.dict(os.environ, env, clear=True), mock.patch("app.config.ENV_FILE", none), mock.patch.object(load, "connect", lambda s: conn), \
                    contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
                code = load.main(["--data", str(d), "--scoring", scoring_path])
            self.assertEqual(code, expected_code, err.getvalue())
            if expected_code:
                self.assertIn("no working discriminator", err.getvalue())
                self.assertNotIn("s3cret-value", out.getvalue() + err.getvalue())
            else:
                self.assertIn("upserted into graph g", out.getvalue())


class LoaderPayloads(unittest.TestCase):
    def build(self, seed=1):
        transfers, reports, truth = generate.generate(params(seed))
        return transfers, reports, truth, load.build_payloads(transfers, reports, CFG)

    def test_only_live_schema_attributes_are_written(self):
        _, _, _, p = self.build()
        self.assertEqual({tuple(sorted(a)) for _, a in p.wallets}, {("data_source", "is_exit_point")})
        self.assertEqual({tuple(sorted(a)) for _, a in p.clusters}, {()})
        self.assertEqual({tuple(sorted(a)) for _, a in p.reports}, {("evidence_hash", "target_address")})
        self.assertEqual({tuple(sorted(a)) for _, _, a in p.transfers}, {("amount", "timestamp", "tx_id")})
        self.assertEqual({tuple(sorted(a)) for _, _, a in p.member_of}, {()})
        self.assertEqual({tuple(sorted(a)) for _, _, a in p.reported}, {()})

    def test_exit_points_and_clusters_come_from_detection(self):
        _, _, truth, p = self.build()
        exits = {a for a, attrs in p.wallets if attrs["is_exit_point"]}
        self.assertEqual(exits, set(truth["expected_exit_points"]))
        self.assertEqual({c for c, _ in p.clusters}, {truth["expected_cluster_id"]})
        self.assertEqual({a for a, _, _ in p.member_of}, set(truth["expected_cluster_members"]))

    def test_data_source_comes_from_the_data(self):
        transfers, reports, _, _ = self.build()
        for t in transfers:
            t["data_source"] = "testnet"
        p = load.build_payloads(transfers, reports, CFG)
        self.assertEqual({a["data_source"] for _, a in p.wallets}, {"testnet"})

    def test_mixed_data_source_is_refused(self):
        transfers, reports, _, _ = self.build()
        transfers[0]["data_source"] = "testnet"
        with self.assertRaises(load.LoadError):
            load.build_payloads(transfers, reports, CFG)

    def test_edited_report_is_refused(self):
        transfers, reports, _, _ = self.build()
        tampered = copy.deepcopy(reports)
        tampered[0]["content"]["narrative"] += " edited"
        with self.assertRaises(load.LoadError) as ctx:
            load.build_payloads(transfers, tampered, CFG)
        self.assertIn("evidence_hash", str(ctx.exception))

    def test_report_for_unknown_wallet_is_refused(self):
        transfers, reports, _, _ = self.build()
        bad = copy.deepcopy(reports)
        bad[0]["target_address"] = "0x" + "0" * 40
        with self.assertRaises(load.LoadError):
            load.build_payloads(transfers, bad, CFG)

    def test_dry_run_needs_no_database_and_no_credentials(self):
        import os
        from unittest import mock
        transfers, reports, _, _ = self.build()
        d = Path(tempfile.mkdtemp())
        (d / "transfers.json").write_text(json.dumps(transfers))
        (d / "reports.json").write_text(json.dumps(reports))
        out = io.StringIO()
        with mock.patch.dict(os.environ, keep_temp(), clear=True), mock.patch("app.config.ENV_FILE", d / "none.env"), contextlib.redirect_stdout(out):
            self.assertEqual(load.main(["--dry-run", "--data", str(d), "--scoring", str(SERVICE / "tests" / "fixtures" / "scoring.test.json")]), 0)
        self.assertIn("dry run", out.getvalue())

    def test_missing_files_stop_with_a_message(self):
        err = io.StringIO()
        with contextlib.redirect_stderr(err):
            self.assertEqual(load.main(["--dry-run", "--data", tempfile.mkdtemp(), "--scoring", str(SERVICE / "tests" / "fixtures" / "scoring.test.json")]), 1)
        self.assertIn("not found", err.getvalue())

    def test_missing_scoring_file_stops(self):
        err = io.StringIO()
        with contextlib.redirect_stderr(err):
            self.assertEqual(load.main(["--dry-run", "--data", tempfile.mkdtemp(), "--scoring", str(Path(tempfile.mkdtemp()) / "none.json")]), 1)
        self.assertIn("Scoring file not found", err.getvalue())


if __name__ == "__main__":
    unittest.main()
