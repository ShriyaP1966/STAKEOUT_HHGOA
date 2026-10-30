"""The HTTP service on top of a TEST-ONLY in-memory backend (tests/fake_backend.py), plus the connection and script behavior with a
faked driver. Run from services/graph:  python -m unittest discover -s tests -t .
A pass here does NOT prove the GSQL queries or the real TigerGraph answers: see the README for what a human must run."""

import contextlib
import importlib.util
import io
import os
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from fastapi.testclient import TestClient

from app.service import create_app
from graph import generate, tg
from graph.offline import analyze_all
from graph.scoring import is_suspicious
from graph.scoring_config import load_scoring
from tests import keep_temp
from tests.fake_backend import FakeBackend
from tests.test_pipeline import params

SERVICE = Path(__file__).resolve().parent.parent
CFG = load_scoring(SERVICE / "tests" / "fixtures" / "scoring.test.json")
TRANSFERS, REPORTS, TRUTH = generate.generate(params(1))


def client(backend=None) -> TestClient:
    return TestClient(create_app(backend or FakeBackend(TRANSFERS, REPORTS, CFG), CFG))


def role(name):
    return [a for a, w in TRUTH["wallets"].items() if w["role"] == name]


class Service(unittest.TestCase):
    def test_member_response_shape(self):
        master = role("scam_master")[0]
        body = client().get(f"/analyze/{master}").json()
        self.assertEqual(body["target"], master)
        self.assertEqual(body["clusterId"], TRUTH["expected_cluster_id"])
        self.assertEqual(body["members"], [a for a in TRUTH["expected_cluster_members"] if a not in TRUTH["expected_exit_points"]])
        self.assertEqual(body["exitPoints"], TRUTH["expected_exit_points"])
        self.assertEqual(body["dataSource"], "synthetic")
        self.assertTrue(all("name" in s for s in body["signals"]))
        self.assertNotIn("link", body)
        self.assertGreaterEqual(body["unrelatedReporterCount"], 0)

    def test_members_and_exit_points_are_disjoint_when_the_graph_lists_an_exit_point_as_member(self):
        class ExitAlsoMember(FakeBackend):
            def analyze(self, address):
                facts = super().analyze(address)
                if facts.cluster_ids:
                    facts.members = facts.members + [a.upper().replace("0X", "0x") for a in facts.exit_points]
                return facts

        master = role("scam_master")[0]
        body = client(ExitAlsoMember(TRANSFERS, REPORTS, CFG)).get(f"/analyze/{master}").json()
        self.assertTrue(body["exitPoints"])
        self.assertEqual(body["exitPoints"], TRUTH["expected_exit_points"])
        self.assertFalse({a.lower() for a in body["members"]} & {a.lower() for a in body["exitPoints"]})
        self.assertTrue(body["members"])

    def test_address_is_lowercased_and_validated(self):
        master = role("scam_master")[0]
        self.assertEqual(client().get(f"/analyze/{master.upper().replace('0X', '0x')}").json()["target"], master)
        self.assertEqual(client().get("/analyze/not-an-address").status_code, 400)
        self.assertEqual(client().get("/analyze/0x12").status_code, 400)

    def test_unknown_wallet_is_404(self):
        self.assertEqual(client().get("/analyze/0x" + "0" * 40).status_code, 404)

    def test_wallet_without_cluster_has_no_members_and_null_cluster(self):
        merchant = role("merchant")[0]
        body = client().get(f"/analyze/{merchant}").json()
        self.assertIsNone(body["clusterId"])
        self.assertEqual(body["members"], [])
        self.assertEqual(body["exitPoints"], [])
        self.assertNotIn("link", body)

    def test_data_source_comes_from_the_graph(self):
        merchant = role("merchant")[0]
        body = client(FakeBackend(TRANSFERS, REPORTS, CFG, data_source="testnet")).get(f"/analyze/{merchant}").json()
        self.assertEqual(body["dataSource"], "testnet")
        resp = client(FakeBackend(TRANSFERS, REPORTS, CFG, data_source="")).get(f"/analyze/{merchant}")
        self.assertEqual(resp.status_code, 502)
        self.assertIn("data_source", resp.json()["detail"])

    def test_candidates_carry_link_flags_and_the_cluster_they_would_join(self):
        rotated = role("rotated_wallet")[0]
        body = client().get(f"/analyze/{rotated}").json()
        self.assertEqual(body["clusterId"], TRUTH["expected_cluster_id"])
        self.assertEqual(body["members"], [])
        self.assertTrue(body["linked"])
        self.assertEqual(set(body["link"]), {"repeatedStructuredOutflowToCluster", "fundedByCluster", "forwardsOnwardLikeMember", "isKnownVictim", "isOneOffPayer"})
        critic = role("dusted_critic")[0]
        dusted = client().get(f"/analyze/{critic}").json()
        self.assertTrue(dusted["link"]["fundedByCluster"])
        self.assertFalse(dusted["linked"])

    def test_link_candidates_route_and_alias(self):
        cid = TRUTH["expected_cluster_id"]
        a = client().get(f"/link_candidates/{cid}").json()
        b = client().get(f"/clusters/{cid}/link-candidates").json()
        self.assertEqual(a, b)
        self.assertEqual(a["candidates"], sorted(a["candidates"]))
        linked = {d["address"] for d in a["details"] if d["linked"]}
        self.assertEqual(linked, set(role("rotated_wallet") + role("feeder")))
        for victim in role("victim") + role("repeat_victim"):
            detail = next(d for d in a["details"] if d["address"] == victim)
            self.assertTrue(detail["link"]["isKnownVictim"], victim)
            self.assertFalse(detail["linked"])
        self.assertEqual(client().get("/link_candidates/0x" + "1" * 64).status_code, 404)
        self.assertEqual(client().get("/link_candidates/0x12").status_code, 400)

    def test_analysis_alias(self):
        master = role("scam_master")[0]
        self.assertEqual(client().get(f"/analyze/{master}").json(), client().get(f"/analysis/{master}").json())

    def test_cluster_graph_has_real_edges_and_roles(self):
        cid = TRUTH["expected_cluster_id"]
        body = client().get(f"/cluster/{cid}/graph").json()
        self.assertEqual(body["clusterId"], cid)
        edge = body["edges"][0]
        self.assertEqual(set(edge), {"src", "tgt", "amount", "timestamp", "txId"})
        self.assertTrue(edge["txId"].startswith("0x"))
        roles = {n["id"]: n["role"] for n in body["nodes"]}
        self.assertEqual(roles[TRUTH["expected_exit_points"][0]], "exit_point")
        self.assertEqual(roles[role("scam_master")[0]], "member")
        self.assertEqual(roles[role("victim")[0]], "counterparty")
        self.assertEqual(client().get("/cluster/0x" + "2" * 64 + "/graph").status_code, 404)

    def test_service_matches_the_offline_reference_for_every_wallet(self):
        rows, _ = analyze_all(TRANSFERS, REPORTS, CFG)
        c = client()
        for address, row in rows.items():
            body = c.get(f"/analyze/{address}").json()
            self.assertEqual(body["behaviorScore"], row.behavior_score, address)
            self.assertEqual(is_suspicious({"behaviorScore": body["behaviorScore"], "signals": body["signals"]}, CFG), row.suspicious, address)
            self.assertEqual(body["clusterId"] is not None and (address in body["members"] or address in body["exitPoints"]), row.in_cluster, address)
            self.assertEqual(body.get("linked"), row.linked, address)

    def test_a_graph_failure_is_a_502_with_a_message(self):
        class Broken(FakeBackend):
            def analyze(self, address):
                raise tg.GraphConnectionError("TigerGraph query analyze_wallet failed: down")

        resp = client(Broken(TRANSFERS, REPORTS, CFG)).get(f"/analyze/{role('scam_master')[0]}")
        self.assertEqual(resp.status_code, 502)
        self.assertIn("analyze_wallet", resp.json()["detail"])


class FakeConn:
    """Stands in for pyTigerGraph.TigerGraphConnection; records what was called."""
    token_error: Exception | None = None
    calls: list = []

    def __init__(self, **kw):
        FakeConn.calls = [("init", dict(kw))]

    def getToken(self, secret):
        FakeConn.calls.append(("getToken", secret))
        if FakeConn.token_error:
            raise FakeConn.token_error

    def getInstalledQueries(self, fmt="py"):
        return ["analyze_wallet"]


def settings(secret, username="user-name", password="pa55word-value", port=None):
    from app.config import TigerGraphSettings
    return TigerGraphSettings("https://tg.invalid", "graph_x", secret, username, password, port)


def init_kwargs():
    return next(c[1] for c in FakeConn.calls if c[0] == "init")


class ConnectionArguments(unittest.TestCase):
    def test_secret_is_used_for_gsql_too_and_no_username_is_sent(self):
        FakeConn.token_error = None
        with mock.patch.object(tg.tg, "TigerGraphConnection", FakeConn):
            tg.connect(settings("s3cret-value", username=None, password=None))
        kw = init_kwargs()
        self.assertEqual(kw["gsqlSecret"], "s3cret-value")
        self.assertNotIn("username", kw)
        self.assertNotIn("password", kw)
        self.assertIn(("getToken", "s3cret-value"), FakeConn.calls)

    def test_username_and_password_are_used_without_a_secret(self):
        with mock.patch.object(tg.tg, "TigerGraphConnection", FakeConn):
            tg.connect(settings(None))
        kw = init_kwargs()
        self.assertEqual((kw["username"], kw["password"]), ("user-name", "pa55word-value"))
        self.assertNotIn("gsqlSecret", kw)

    def test_tg_port_is_passed_only_when_set(self):
        with mock.patch.object(tg.tg, "TigerGraphConnection", FakeConn):
            tg.connect(settings(None))
            self.assertNotIn("restppPort", init_kwargs())
            tg.connect(settings(None, port=8443))
        kw = init_kwargs()
        self.assertEqual((kw["restppPort"], kw["gsPort"]), (8443, 8443))

    def test_real_driver_serves_a_tgcloud_host_on_443_and_other_hosts_where_told(self):
        # builds the REAL pyTigerGraph connection object (its constructor uses no network) and reads the URLs it derived
        from app.config import TigerGraphSettings
        cloud = tg.tg.TigerGraphConnection(**tg.connection_arguments(TigerGraphSettings("https://ws.i.tgcloud.io", "g", "s3cret-value", None, None, None)))
        self.assertTrue(cloud.tgCloud)
        self.assertEqual(cloud.restppUrl, "https://ws.i.tgcloud.io:443/restpp")
        self.assertEqual(cloud.gsUrl, "https://ws.i.tgcloud.io:443")
        other = tg.tg.TigerGraphConnection(**tg.connection_arguments(TigerGraphSettings("https://tg.example.org", "g", None, "u", "p", 443)))
        self.assertEqual(other.restppUrl, "https://tg.example.org:443/restpp")
        self.assertEqual(other.gsUrl, "https://tg.example.org:443")


class SettingsRule(unittest.TestCase):
    """TG_SECRET alone is enough; without it username and password are both required. Messages never repeat a value."""

    base = {"TG_HOST": "https://ws.i.tgcloud.io", "TG_GRAPH_NAME": "graph_x"}

    def read(self, extra):
        from app.config import tigergraph_settings
        none = Path(tempfile.mkdtemp()) / "none.env"
        with mock.patch.dict(os.environ, keep_temp({**self.base, **extra}), clear=True), mock.patch("app.config.ENV_FILE", none):
            return tigergraph_settings()

    def test_secret_only(self):
        s = self.read({"TG_SECRET": "s3cret-value"})
        self.assertEqual((s.secret, s.username, s.password, s.port), ("s3cret-value", None, None, None))

    def test_username_and_password_only(self):
        s = self.read({"TG_USERNAME": "user-name", "TG_PASSWORD": "pa55word-value"})
        self.assertEqual((s.secret, s.username, s.password), (None, "user-name", "pa55word-value"))

    def test_secret_wins_when_everything_is_set(self):
        s = self.read({"TG_SECRET": "s3cret-value", "TG_USERNAME": "user-name", "TG_PASSWORD": "pa55word-value"})
        self.assertEqual(tg.connection_arguments(s).get("gsqlSecret"), "s3cret-value")
        self.assertNotIn("username", tg.connection_arguments(s))

    def test_none_set_fails_loudly_and_names_the_variables(self):
        from app.config import ConfigError
        with self.assertRaises(ConfigError) as ctx:
            self.read({"TG_SECRET": "", "TG_USERNAME": "", "TG_PASSWORD": ""})
        for name in ("TG_USERNAME", "TG_PASSWORD", "TG_SECRET"):
            self.assertIn(name, str(ctx.exception))

    def test_one_of_the_two_missing_names_only_that_one(self):
        from app.config import ConfigError
        with self.assertRaises(ConfigError) as ctx:
            self.read({"TG_USERNAME": "user-name"})
        self.assertIn("TG_PASSWORD", str(ctx.exception).split("Set TG_SECRET")[0])
        self.assertNotIn("user-name", str(ctx.exception))

    def test_host_and_graph_name_are_always_required(self):
        from app.config import ConfigError
        for missing in ("TG_HOST", "TG_GRAPH_NAME"):
            env = {**self.base, "TG_SECRET": "s3cret-value"}
            env[missing] = ""
            with self.assertRaises(ConfigError) as ctx:
                self.read(env)
            self.assertIn(missing, str(ctx.exception))

    def test_bad_values_name_the_variable_without_echoing_it(self):
        from app.config import ConfigError
        cases = (({"TG_HOST": "ws.i.tgcloud.io-hostvalue"}, "TG_HOST", "ws.i.tgcloud.io-hostvalue"),
                 ({"TG_PORT": "not-a-port-value"}, "TG_PORT", "not-a-port-value"),
                 ({"TG_PORT": "70000"}, "TG_PORT", "70000"), ({"TG_PORT": "0"}, "TG_PORT", "0"))
        for extra, name, value in cases:
            with self.assertRaises(ConfigError) as ctx:
                self.read({"TG_SECRET": "s3cret-value", **extra})
            self.assertIn(name, str(ctx.exception))
            self.assertNotIn(value, str(ctx.exception))
            self.assertNotIn("s3cret-value", str(ctx.exception))

    def test_port_is_read_from_the_variable(self):
        self.assertEqual(self.read({"TG_SECRET": "s3cret-value", "TG_PORT": "443"}).port, 443)

    def test_test_connection_script_works_with_the_secret_only(self):
        spec = importlib.util.spec_from_file_location("tc3", SERVICE / "scripts" / "test_connection.py")
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        out, err = io.StringIO(), io.StringIO()
        none = Path(tempfile.mkdtemp()) / "none.env"
        FakeConn.token_error = None
        env = keep_temp({**self.base, "TG_SECRET": "s3cret-value"})
        with mock.patch.dict(os.environ, env, clear=True), mock.patch("app.config.ENV_FILE", none), \
                mock.patch.object(tg.tg, "TigerGraphConnection", FakeConn), contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            self.assertEqual(module.main(), 0)
        self.assertIn("Graph: graph_x", out.getvalue())
        self.assertNotIn("s3cret-value", out.getvalue() + err.getvalue())


class Connection(unittest.TestCase):
    def test_no_secret_means_no_token_request(self):
        with mock.patch.object(tg.tg, "TigerGraphConnection", FakeConn):
            tg.connect(settings(None))
        self.assertFalse(any(c[0] == "getToken" for c in FakeConn.calls))

    def test_secret_is_used_to_get_the_token(self):
        FakeConn.token_error = None
        with mock.patch.object(tg.tg, "TigerGraphConnection", FakeConn):
            tg.connect(settings("s3cret-value"))
        self.assertIn(("getToken", "s3cret-value"), FakeConn.calls)

    def test_token_failure_is_loud_and_leaks_nothing(self):
        FakeConn.token_error = RuntimeError("401 for s3cret-value and pa55word-value")
        try:
            with mock.patch.object(tg.tg, "TigerGraphConnection", FakeConn), self.assertRaises(tg.GraphConnectionError) as ctx:
                tg.connect(settings("s3cret-value"))
        finally:
            FakeConn.token_error = None
        text = str(ctx.exception)
        self.assertIn("TG_SECRET", text)
        self.assertNotIn("s3cret-value", text)
        self.assertNotIn("pa55word-value", text)

    def test_test_connection_script_prints_graph_and_queries(self):
        spec = importlib.util.spec_from_file_location("tc", SERVICE / "scripts" / "test_connection.py")
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        env = {"TG_HOST": "https://tg.invalid", "TG_USERNAME": "u", "TG_PASSWORD": "p", "TG_GRAPH_NAME": "graph_x", "TG_SECRET": "s3cret-value"}
        out, err = io.StringIO(), io.StringIO()
        FakeConn.token_error = None
        with mock.patch.dict(os.environ, keep_temp(env), clear=True), mock.patch("app.config.ENV_FILE", Path(tempfile.mkdtemp()) / "none.env"), \
                mock.patch.object(tg.tg, "TigerGraphConnection", FakeConn), contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            self.assertEqual(module.main(), 0)
        self.assertIn("Graph: graph_x", out.getvalue())
        self.assertIn("analyze_wallet", out.getvalue())
        self.assertNotIn("s3cret-value", out.getvalue() + err.getvalue())

    def test_test_connection_script_fails_loudly_on_missing_config_and_bad_token(self):
        spec = importlib.util.spec_from_file_location("tc2", SERVICE / "scripts" / "test_connection.py")
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        none = Path(tempfile.mkdtemp()) / "none.env"
        err = io.StringIO()
        with mock.patch.dict(os.environ, keep_temp(), clear=True), mock.patch("app.config.ENV_FILE", none), contextlib.redirect_stderr(err):
            self.assertEqual(module.main(), 1)
        self.assertIn("TG_HOST", err.getvalue())
        env = {"TG_HOST": "https://tg.invalid", "TG_USERNAME": "u", "TG_PASSWORD": "p", "TG_GRAPH_NAME": "graph_x", "TG_SECRET": "s3cret-value"}
        FakeConn.token_error = RuntimeError("bad s3cret-value")
        err = io.StringIO()
        try:
            with mock.patch.dict(os.environ, keep_temp(env), clear=True), mock.patch("app.config.ENV_FILE", none), \
                    mock.patch.object(tg.tg, "TigerGraphConnection", FakeConn), contextlib.redirect_stderr(err):
                self.assertEqual(module.main(), 1)
        finally:
            FakeConn.token_error = None
        self.assertIn("token", err.getvalue())
        self.assertNotIn("s3cret-value", err.getvalue())


class ParsingAssumedShapes(unittest.TestCase):
    """The query answers below are HAND-WRITTEN from pyTigerGraph's documented output format. They are an assumption, not a recording."""

    def test_analyze_answer_is_parsed(self):
        answer = [
            {"found": 1},
            {"wallet": [{"v_id": "0xaa", "attributes": {"totalIn": 4.0, "totalOut": 3.9, "inCount": 2, "outCount": 3, "isExitPoint": False, "dataSource": "synthetic"}}]},
            {"degrees": [{"v_id": "0xaa", "attributes": {"inDegree": 2, "outDegree": 3}}]},
            {"clusterIds": ["0xc1"]}, {"membersList": ["0xaa", "0xbb"]}, {"exitPointsList": ["0xbb"]}, {"reporterCount": 2},
            {"delayCount": 3}, {"medianForwardTime": 40}, {"hopsToExit": 2}, {"fundingClusters": []}, {"paidClusters": []}, {"outflowsToCluster": 0},
        ]

        class Conn:
            def runInstalledQuery(self, name, params):
                assert name == "analyze_wallet" and params["wallet_id"] == ("0xaa",) and params["max_hops"] == int(CFG.t("hopsToExitMax"))
                return answer

        facts = tg.TigerGraphBackend(Conn(), CFG, []).analyze("0xaa")
        self.assertTrue(facts.found)
        self.assertEqual((facts.in_degree, facts.out_degree, facts.report_count, facts.median_forward_time, facts.hops_to_exit), (2, 3, 2, 40, 2))
        self.assertEqual(facts.members, ["0xaa", "0xbb"])
        self.assertEqual(facts.data_source, "synthetic")

    def test_found_zero_and_unset_accumulators(self):
        class Conn:
            def runInstalledQuery(self, name, params):
                return [{"found": 0}]

        self.assertFalse(tg.TigerGraphBackend(Conn(), CFG, []).analyze("0xaa").found)

        class Conn2:
            def runInstalledQuery(self, name, params):
                return [{"found": 1}, {"wallet": [{"v_id": "0xaa", "attributes": {"dataSource": "synthetic"}}]}, {"delayCount": 0},
                        {"medianForwardTime": 2147483647}, {"hopsToExit": 2147483647}]

        facts = tg.TigerGraphBackend(Conn2(), CFG, []).analyze("0xaa")
        self.assertIsNone(facts.median_forward_time)
        self.assertIsNone(facts.hops_to_exit)


if __name__ == "__main__":
    unittest.main()
