"""EXPOSE_ALL_ROUTES: how the setting is read, and which routes exist in each mode. TEST-ONLY in-memory backend, no network, no TigerGraph.
Run from services/graph:  python -m unittest discover -s tests -t ."""

import os
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from fastapi.testclient import TestClient

from app.config import ConfigError, expose_all_routes
from app.service import create_app, describe_routes, served_routes
from graph import generate
from graph.scoring_config import load_scoring
from tests import keep_temp
from tests.fake_backend import FakeBackend
from tests.test_pipeline import params

SERVICE = Path(__file__).resolve().parent.parent
CFG = load_scoring(SERVICE / "tests" / "fixtures" / "scoring.test.json")
TRANSFERS, REPORTS, TRUTH = generate.generate(params(1))

ALWAYS = ["GET /health", "GET /cluster/{cluster_id}/graph"]
ALL_ONLY = ["GET /analyze/{address}", "GET /analysis/{address}", "GET /link_candidates/{cluster_id}", "GET /clusters/{cluster_id}/link-candidates"]


def app_for(expose: bool):
    return create_app(FakeBackend(TRANSFERS, REPORTS, CFG), CFG, expose)


def wallet() -> str:
    return next(a for a, w in TRUTH["wallets"].items() if w["role"] == "scam_master")


class SettingRule(unittest.TestCase):
    def read(self, value):
        none = Path(tempfile.mkdtemp()) / "none.env"
        env = {} if value is None else {"EXPOSE_ALL_ROUTES": value}
        with mock.patch.dict(os.environ, keep_temp(env), clear=True), mock.patch("app.config.ENV_FILE", none):
            return expose_all_routes()

    def test_exactly_true_and_false_are_accepted(self):
        self.assertIs(self.read("true"), True)
        self.assertIs(self.read("false"), False)

    def test_anything_else_is_refused_and_the_message_names_the_variable(self):
        for bad in (None, "", " ", "TRUE", "False", "1", "0", "yes", " true", "true ", "true\n"):
            with self.subTest(value=bad):
                with self.assertRaises(ConfigError) as ctx:
                    self.read(bad)
                self.assertIn("EXPOSE_ALL_ROUTES", str(ctx.exception))

    def test_the_message_does_not_repeat_the_value(self):
        with self.assertRaises(ConfigError) as ctx:
            self.read("not-a-bool-value")
        self.assertNotIn("not-a-bool-value", str(ctx.exception))


class PublicReadOnlyMode(unittest.TestCase):
    def setUp(self):
        self.app = app_for(False)
        self.client = TestClient(self.app)

    def test_only_health_and_the_cluster_graph_are_registered(self):
        self.assertEqual(served_routes(self.app), sorted(ALWAYS))

    def test_the_kept_routes_answer_200(self):
        self.assertEqual(self.client.get("/health").status_code, 200)
        cluster = TRUTH["expected_cluster_id"]
        r = self.client.get(f"/cluster/{cluster}/graph")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()["clusterId"], cluster)

    def test_the_removed_routes_answer_404(self):
        cluster = TRUTH["expected_cluster_id"]
        for path in (f"/analyze/{wallet()}", f"/analysis/{wallet()}", f"/link_candidates/{cluster}", f"/clusters/{cluster}/link-candidates"):
            with self.subTest(path=path):
                self.assertEqual(self.client.get(path).status_code, 404)

    def test_the_generated_documentation_is_off(self):
        for path in ("/docs", "/redoc", "/openapi.json"):
            with self.subTest(path=path):
                self.assertEqual(self.client.get(path).status_code, 404)

    def test_the_startup_line_names_the_mode_and_the_routes(self):
        line = describe_routes(False, self.app)
        self.assertIn("EXPOSE_ALL_ROUTES=false", line)
        for route in ALWAYS:
            self.assertIn(route, line)
        for route in ALL_ONLY:
            self.assertNotIn(route, line)


class AllRoutesMode(unittest.TestCase):
    def setUp(self):
        self.app = app_for(True)
        self.client = TestClient(self.app)

    def test_every_route_is_registered(self):
        self.assertEqual(served_routes(self.app), sorted(ALWAYS + ALL_ONLY))

    def test_every_route_answers_200(self):
        cluster = TRUTH["expected_cluster_id"]
        for path in ("/health", f"/cluster/{cluster}/graph", f"/analyze/{wallet()}", f"/analysis/{wallet()}",
                     f"/link_candidates/{cluster}", f"/clusters/{cluster}/link-candidates"):
            with self.subTest(path=path):
                self.assertEqual(self.client.get(path).status_code, 200)

    def test_the_generated_documentation_is_on(self):
        for path in ("/docs", "/redoc", "/openapi.json"):
            with self.subTest(path=path):
                self.assertEqual(self.client.get(path).status_code, 200)

    def test_the_two_argument_call_is_the_same_as_true(self):
        self.assertEqual(served_routes(create_app(FakeBackend(TRANSFERS, REPORTS, CFG), CFG)), served_routes(self.app))

    def test_the_startup_line_names_the_mode_and_every_route(self):
        line = describe_routes(True, self.app)
        self.assertIn("EXPOSE_ALL_ROUTES=true", line)
        for route in ALWAYS + ALL_ONLY:
            self.assertIn(route, line)


if __name__ == "__main__":
    unittest.main()
