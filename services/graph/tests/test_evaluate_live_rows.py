"""graph.evaluate.live_rows decides "in a cluster" from the live service's answer: a wallet in `members`, or in `exitPoints` (the service
lists exit points only there), counts as in the cluster; a wallet with no cluster does not. TEST-ONLY fake responses through httpx's
MockTransport: no network, no TigerGraph, no new dependency.
Run from services/graph:  python -m unittest discover -s tests -t ."""

import unittest
from pathlib import Path
from unittest import mock

import httpx

from graph.evaluate import live_rows
from graph.scoring_config import load_scoring

SERVICE = Path(__file__).resolve().parent.parent
CFG = load_scoring(SERVICE / "tests" / "fixtures" / "scoring.test.json")

# test fixtures: made-up lower-case addresses and cluster id
MEMBER = "0x" + "a1" * 20
EXIT_POINT = "0x" + "b2" * 20
OUTSIDER = "0x" + "c3" * 20
CLUSTER = "0x" + "d4" * 32
BASE = "http://fake-graph-service.invalid"


def answer(address: str) -> dict:
    cluster_wallet = address in (MEMBER, EXIT_POINT)
    body = {
        "target": address,
        "clusterId": CLUSTER,
        "behaviorScore": 0.9 if cluster_wallet else 0.0,
        "signals": [{"name": "fanOut", "value": 2}] if cluster_wallet else [],
        "members": [MEMBER] if cluster_wallet else [],        # the exit point is left out of members, as app/service.py does
        "exitPoints": [EXIT_POINT] if cluster_wallet else [],
        "unrelatedReporterCount": 0,
        "dataSource": "synthetic",
    }
    if not cluster_wallet:
        body.update(clusterId=None, members=[], exitPoints=[])  # not in any cluster
    return body


def handler(request: httpx.Request) -> httpx.Response:
    if request.url.path == "/health":
        return httpx.Response(200, json={"status": "ok"})
    address = request.url.path.rsplit("/", 1)[-1]
    return httpx.Response(200, json=answer(address))


class LiveRowsMembership(unittest.TestCase):
    def rows(self):
        real_client = httpx.Client
        with mock.patch("httpx.Client", lambda **kw: real_client(transport=httpx.MockTransport(handler), **kw)):
            return live_rows(BASE, [MEMBER, EXIT_POINT, OUTSIDER], CFG)

    def test_a_member_is_in_the_cluster(self):
        self.assertTrue(self.rows()[MEMBER]["in_cluster"])

    def test_an_exit_point_listed_only_in_exit_points_is_in_the_cluster(self):
        body = answer(EXIT_POINT)
        self.assertNotIn(EXIT_POINT, body["members"])
        self.assertIn(EXIT_POINT, body["exitPoints"])
        self.assertTrue(self.rows()[EXIT_POINT]["in_cluster"])

    def test_a_wallet_with_no_cluster_is_not_in_a_cluster(self):
        row = self.rows()[OUTSIDER]
        self.assertIsNone(answer(OUTSIDER)["clusterId"])
        self.assertFalse(row["in_cluster"])


if __name__ == "__main__":
    unittest.main()
