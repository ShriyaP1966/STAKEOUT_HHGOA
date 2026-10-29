"""An address or cluster id that TigerGraph does not know gives a clean 404; every other TigerGraph error stays a loud 502.
These tests run the REAL TigerGraphBackend over a connection that raises pyTigerGraph's own exception type with the exact text seen on
Savanna, behind the real HTTP routes. Run from services/graph:  python -m unittest discover -s tests -t .
"""

import unittest
from pathlib import Path

from fastapi.testclient import TestClient
from pyTigerGraph.common.exception import TigerGraphException

from app.service import NO_ADDRESS, NO_CLUSTER, create_app
from graph import tg
from graph.scoring_config import load_scoring

CFG = load_scoring(Path(__file__).resolve().parent.parent / "tests" / "fixtures" / "scoring.test.json")
ADDRESS = "0x" + "ab" * 20
CLUSTER = "0x" + "cd" * 32
SECRET = "s3cret-value-for-tests"

# the text reported from the real workspace, produced by the driver's own exception class (str() gives the tuple form)
UNKNOWN_ADDRESS = TigerGraphException("Failed to convert user vertex id for parameter wallet_id", None)
UNKNOWN_CLUSTER = TigerGraphException("Failed to convert user vertex id for parameter cluster", None)


class RaisingConn:
    def __init__(self, error):
        self.error, self.calls = error, []

    def runInstalledQuery(self, name, params):
        self.calls.append(name)
        raise self.error


def client(error):
    conn = RaisingConn(error)
    return TestClient(create_app(tg.TigerGraphBackend(conn, CFG, [SECRET]), CFG)), conn


class ExactText(unittest.TestCase):
    def test_the_driver_exception_prints_in_the_form_that_was_reported(self):
        self.assertEqual(str(UNKNOWN_ADDRESS), "('Failed to convert user vertex id for parameter wallet_id', None)")


class UnknownIsA404(unittest.TestCase):
    def test_analyze_unknown_address(self):
        c, conn = client(UNKNOWN_ADDRESS)
        r = c.get(f"/analyze/{ADDRESS}")
        self.assertEqual(r.status_code, 404)
        self.assertEqual(r.json(), {"detail": NO_ADDRESS})
        self.assertEqual(conn.calls, ["analyze_wallet"])
        self.assertNotIn("TigerGraph", r.text)
        self.assertNotIn("wallet_id", r.text)

    def test_analysis_alias_too(self):
        self.assertEqual(client(UNKNOWN_ADDRESS)[0].get(f"/analysis/{ADDRESS}").status_code, 404)

    def test_link_candidates_unknown_cluster_and_its_alias(self):
        c, _ = client(UNKNOWN_CLUSTER)
        for path in (f"/link_candidates/{CLUSTER}", f"/clusters/{CLUSTER}/link-candidates"):
            r = c.get(path)
            self.assertEqual(r.status_code, 404, path)
            self.assertEqual(r.json(), {"detail": NO_CLUSTER})

    def test_cluster_graph_unknown_cluster(self):
        r = client(UNKNOWN_CLUSTER)[0].get(f"/cluster/{CLUSTER}/graph")
        self.assertEqual(r.status_code, 404)
        self.assertEqual(r.json(), {"detail": NO_CLUSTER})

    def test_the_body_has_the_same_shape_as_the_other_errors(self):
        c, _ = client(UNKNOWN_ADDRESS)
        bad_address = c.get("/analyze/not-an-address")
        unknown = c.get(f"/analyze/{ADDRESS}")
        self.assertEqual(set(bad_address.json()), set(unknown.json()), "both are {'detail': text}")
        self.assertEqual(unknown.headers["content-type"], bad_address.headers["content-type"])

    def test_the_wording_is_found_in_any_case_and_for_any_parameter(self):
        for text in ("failed to convert user vertex id for parameter x", "FAILED TO CONVERT USER VERTEX ID"):
            self.assertEqual(client(Exception(text))[0].get(f"/analyze/{ADDRESS}").status_code, 404, text)


class EverythingElseStaysLoud(unittest.TestCase):
    def test_other_errors_are_still_502_with_the_message(self):
        for error in (TigerGraphException("Query timeout after 30s", None), RuntimeError("connection reset"),
                      TigerGraphException("Failed to run the query: server busy", None)):
            for path in (f"/analyze/{ADDRESS}", f"/link_candidates/{CLUSTER}", f"/cluster/{CLUSTER}/graph"):
                r = client(error)[0].get(path)
                self.assertEqual(r.status_code, 502, f"{path}: {error}")
                self.assertIn("TigerGraph query", r.json()["detail"])

    def test_an_unrelated_conversion_error_is_not_mistaken_for_an_unknown_vertex(self):
        r = client(TigerGraphException("Failed to convert parameter max_hops to INT", None))[0].get(f"/analyze/{ADDRESS}")
        self.assertEqual(r.status_code, 502)
        self.assertIn("max_hops", r.json()["detail"])

    def test_secrets_are_still_removed_from_a_502(self):
        r = client(RuntimeError(f"denied for {SECRET}"))[0].get(f"/analyze/{ADDRESS}")
        self.assertEqual(r.status_code, 502)
        self.assertNotIn(SECRET, r.text)

    def test_unknown_inside_an_internal_lookup_is_not_hidden_as_a_404(self):
        # candidate_for() asks about clusters the graph itself named; if one of those is "unknown" the data is inconsistent: 502, not 404
        from tests.fake_backend import FakeBackend
        from tests.test_service import REPORTS, TRANSFERS, TRUTH, role

        class Inconsistent(FakeBackend):
            def link_candidates(self, cluster_id):
                raise tg.UnknownVertexError("TigerGraph query link_candidates failed: ('Failed to convert user vertex id for parameter cluster', None)")

        c = TestClient(create_app(Inconsistent(TRANSFERS, REPORTS, CFG), CFG))
        r = c.get(f"/analyze/{role('rotated_wallet')[0]}")
        self.assertEqual(r.status_code, 502)
        self.assertIn("TigerGraph query link_candidates", r.json()["detail"])


if __name__ == "__main__":
    unittest.main()
