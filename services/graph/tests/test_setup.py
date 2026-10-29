"""setup_graph.py and diagnose_graph.py against a TEST-ONLY fake TigerGraph workspace (no network). The fake keeps real state (which global
types, graphs and queries exist), so a test can tell "the server said fine" apart from "it really exists". Run from services/graph:
    python -m unittest discover -s tests -t .
What this proves: the scripts cannot report success unless the workspace really contains the graph. What it does NOT prove: the wording
of a real Savanna error, or that the GSQL text is accepted by a real server."""

import contextlib
import importlib.util
import io
import os
import re
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from graph import gsql_admin, schema_spec
from graph.tg import SCHEMA_FILE, GraphConnectionError
from tests import keep_temp

SERVICE = Path(__file__).resolve().parent.parent
SECRET = "s3cret-value-for-tests"
GRAPH = "graph_under_test"
SCRIPT = SCHEMA_FILE.read_text(encoding="utf-8")


# TigerGraph's answer to a successful installation, as reported from the real Savanna run
INSTALL_OK = (
    "Successfully created queries: [analyze_wallet].\n"
    "Query installation summary for graph 'stakeout_v2': succeeded: 1, skipped: 0, failed: 0."
)
INSTALL_SKIPPED = "Query installation summary for graph 'stakeout_v2': succeeded: 0, skipped: 1, failed: 0."
DRAFT_ONLY = (
    "Successfully created queries: [analyze_wallet].\n"
    "Saved as draft query with type/semantic check error.\n"
    "Query installation summary for graph 'stakeout_v2': succeeded: 0, skipped: 0, failed: 1."
)
PARSE_ERROR = "Parse error at line 7:54: mismatched input 'target' expecting {IDENT}\nQuery installation failed."


class FakeHttpError(Exception):
    def __init__(self, status, text):
        super().__init__(f"{status} error")
        self.response = type("R", (), {"status_code": status, "text": text})()


class FakeWorkspace:
    """Stands in for pyTigerGraph.TigerGraphConnection. `behaviour` decides what a CREATE statement does:
    ok | error:<text> (rejects with that text, nothing created) | silent (benign answer, nothing created) | code (return code 1, benign text) | http404."""
    gsUrl = "https://workspace.invalid"

    def __init__(self, behaviour="ok", graphs=(), vertices=None, edges=None, fail_on=None):
        self.behaviour, self.fail_on = behaviour, fail_on
        self.graphs = list(graphs)
        self.vertices, self.edges = dict(vertices or {}), dict(edges or {})
        self.queries: list[str] = []
        self.statements: list[str] = []
        self.reject_query: str | None = None
        self.reject_text = ""
        self.reject_code = True
        self.query_sources: dict[str, str] = {}

    def listing(self) -> list[str]:
        out = ["---- Global vertices, edges, and all graphs", "Vertex Types:"]
        out += [f"  - {line}" for line in self.vertices.values()]
        out += ["Edge Types:"] + [f"  - {line}" for line in self.edges.values()]
        out += ["", "Graphs:"] + [f"  - Graph {g}(Wallet:v, TRANSFER:e)" for g in self.graphs] + ["Jobs:", "", "JSON API version: v2", "__GSQL__RETURN_CODE__,0"]
        return out

    def _req(self, method, url, data=None, authMode=None, resKey=None, skipCheck=False, jsonResponse=True, headers=None):
        assert url.endswith("/gsql/v1/statements") and method == "POST"
        text = data.decode("utf-8")
        body = re.sub(r"^USE (GLOBAL|GRAPH \w+)\n", "", text)
        self.statements.append(body)
        if body.strip() == "ls":
            return self.listing()
        if body.startswith("CREATE"):
            matches_target = self.fail_on is None or self.fail_on in body
            if self.behaviour.startswith("error:") and matches_target:
                return [self.behaviour[6:], "__GSQL__RETURN_CODE__,1"]
            if self.behaviour == "silent" and matches_target:
                return ["Done."]
            if self.behaviour == "code" and matches_target:
                return ["Processing request.", "__GSQL__RETURN_CODE__,1"]
            if self.behaviour == "http404":
                raise FakeHttpError(404, f"not found; the secret {SECRET} must not be shown")
            declared = body.split("(")[0].split()
            kind, name = declared[1:3] if declared[1] in ("VERTEX", "GRAPH") else (declared[2], declared[3])
            if declared[1] == "VERTEX":
                self.vertices[name] = body[len("CREATE "):]
            elif declared[1] == "GRAPH":
                self.graphs.append(name)
            else:
                self.edges[name] = body[len("CREATE "):]
            return ["Successfully created.", "__GSQL__RETURN_CODE__,0"]
        if body.startswith("SHOW QUERY"):
            source = self.query_sources.get(body.split()[2])
            return [source, "__GSQL__RETURN_CODE__,0"] if source else ["Query not found.", "__GSQL__RETURN_CODE__,1"]
        if "INSTALL QUERY" in body:
            name = re.search(r"INSTALL QUERY (\w+)", body).group(1)
            if self.reject_query and f"INSTALL QUERY {self.reject_query}" in body:
                return [self.reject_text, "__GSQL__RETURN_CODE__,1"] if self.reject_code else self.reject_text.splitlines()
            self.queries.append(name)
            # what a real server shows for a stored query: CREATE (not CREATE OR REPLACE), formatting of its own
            shown = body.split("INSTALL QUERY")[0].replace("CREATE OR REPLACE", "CREATE").splitlines()
            self.query_sources[name] = "\n".join(re.sub(r"[ \t]+", " ", l) for l in shown if not l.strip().startswith("//"))
            return INSTALL_OK.splitlines() + ["__GSQL__RETURN_CODE__,0"]
        raise AssertionError(f"unexpected statement: {body[:60]}")

    def getSchema(self, udts=True, force=False):
        return {
            "VertexTypes": [{"Name": n, "PrimaryId": {"AttributeName": s["pk"][0], "AttributeType": {"Name": s["pk"][1]}},
                             "Attributes": [{"AttributeName": a, "AttributeType": {"Name": t}} for a, t in s["attrs"].items()]}
                            for n, s in schema_spec.VERTICES.items()],
            "EdgeTypes": [{"Name": n, "IsDirected": s["directed"], "FromVertexTypeName": s["from"], "ToVertexTypeName": s["to"],
                           "DiscriminatorCount": 1 if s["discriminator"] else 0,
                           "Attributes": [{"AttributeName": a, "AttributeType": {"Name": t}} for a, t in s["attrs"].items()]}
                          for n, s in schema_spec.EDGES.items()],
        }

    def getInstalledQueries(self, fmt="py"):
        return list(self.queries)

    def creates(self):
        return [s for s in self.statements if s.startswith("CREATE VERTEX") or "EDGE" in s.split("(")[0] or s.startswith("CREATE GRAPH")]


def load_script(name):
    spec = importlib.util.spec_from_file_location(name, SERVICE / "scripts" / f"{name}.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def run_script(module, fake, argv=None):
    env = keep_temp({"TG_HOST": "https://workspace.invalid", "TG_GRAPH_NAME": GRAPH, "TG_SECRET": SECRET})
    out, err = io.StringIO(), io.StringIO()
    none = Path(tempfile.mkdtemp()) / "none.env"
    with mock.patch.dict(os.environ, env, clear=True), mock.patch("app.config.ENV_FILE", none), mock.patch.object(module, "connect", lambda s: fake), \
            contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
        code = module.main(argv) if argv is not None else module.main()
    return code, out.getvalue(), err.getvalue()


def create(fake):
    said = []
    gsql_admin.create_schema(fake, SCRIPT, GRAPH, [SECRET], said.append)
    return said


class SchemaScript(unittest.TestCase):
    def test_statements_are_one_per_line_in_a_workable_order(self):
        statements = gsql_admin.schema_statements(SCRIPT, GRAPH)
        self.assertEqual([s.kind for s in statements], ["vertex"] * 3 + ["edge"] * 3 + ["graph"])
        self.assertEqual({s.name for s in statements[:-1]}, set(schema_spec.VERTICES) | set(schema_spec.EDGES))
        self.assertEqual(statements[-1].name, GRAPH)
        self.assertNotIn("__GRAPH__", " ".join(s.text for s in statements))
        self.assertNotIn("DEFAULT", SCRIPT.replace("no DEFAULT clauses", "").replace("No DEFAULT clauses", ""))

    def test_a_line_that_is_not_a_create_statement_is_refused(self):
        with self.assertRaises(GraphConnectionError):
            gsql_admin.schema_statements("DROP GRAPH x", GRAPH)


class FailureDetection(unittest.TestCase):
    def result(self, lines):
        return gsql_admin.GsqlResult(tuple(lines), "\n".join(l for l in lines if not l.startswith("__GSQL__")),
                                     next((int(l.split(",")[1]) for l in lines if l.startswith("__GSQL__RETURN_CODE__")), None))

    def test_the_documented_success_sample_is_not_a_failure(self):
        sample = ["---- Global vertices, edges, and all graphs", "Vertex Types:", "Edge Types:", "", "Graphs:", "Jobs:", "", "JSON API version: v2", "Syntax version: v2"]
        self.assertIsNone(gsql_admin.failure_reason(self.result(sample)))

    def test_a_non_zero_return_code_is_a_failure_whatever_the_text_says(self):
        self.assertIn("return code 1", gsql_admin.failure_reason(self.result(["All good.", "__GSQL__RETURN_CODE__,1"])))

    def test_error_like_wording_is_a_failure(self):
        for text in ("Vertex type Wallet is already used", "Permission denied", "Semantic Check Fails: x", "Unable to create", "Not allowed here"):
            self.assertIsNotNone(gsql_admin.failure_reason(self.result([text])), text)


class FreshWorkspace(unittest.TestCase):
    def test_creates_everything_and_verifies_it(self):
        fake = FakeWorkspace()
        said = create(fake)
        self.assertEqual(sorted(fake.vertices), sorted(schema_spec.VERTICES))
        self.assertEqual(sorted(fake.edges), sorted(schema_spec.EDGES))
        self.assertEqual(fake.graphs, [GRAPH])
        self.assertTrue(any("verified in TigerGraph" in s for s in said))

    def test_every_create_statement_runs_in_global_scope_one_at_a_time(self):
        fake = FakeWorkspace()
        create(fake)
        self.assertEqual(len(fake.creates()), 7)

    def test_running_it_again_creates_nothing(self):
        fake = FakeWorkspace()
        create(fake)
        before = len(fake.creates())
        said = create(fake)
        self.assertEqual(len(fake.creates()), before)
        self.assertTrue(any("already exists" in s for s in said))


class FailuresAreLoud(unittest.TestCase):
    def test_a_rejected_statement_stops_with_the_raw_text_and_no_graph_is_attempted(self):
        for text in ("Vertex type Wallet is already used by another graph", "Permission denied for this user", "Semantic Check Fails: bad", "Oops: cannot do that"):
            fake = FakeWorkspace(behaviour=f"error:{text} (secret {SECRET})")
            with self.assertRaises(GraphConnectionError) as ctx:
                create(fake)
            message = str(ctx.exception)
            self.assertIn(text, message)
            self.assertNotIn(SECRET, message)
            self.assertFalse(any(s.startswith("CREATE GRAPH") for s in fake.statements), text)
            self.assertEqual(fake.graphs, [])

    def test_a_benign_looking_answer_is_not_enough(self):
        fake = FakeWorkspace(behaviour="silent")
        with self.assertRaises(GraphConnectionError) as ctx:
            create(fake)
        self.assertIn("NOT in TigerGraph", str(ctx.exception))

    def test_a_non_zero_return_code_alone_is_enough_to_fail(self):
        fake = FakeWorkspace(behaviour="code")
        with self.assertRaises(GraphConnectionError) as ctx:
            create(fake)
        self.assertIn("return code 1", str(ctx.exception))

    def test_graph_creation_that_silently_does_nothing_is_caught(self):
        fake = FakeWorkspace(behaviour="silent", fail_on="CREATE GRAPH")
        with self.assertRaises(GraphConnectionError) as ctx:
            create(fake)
        self.assertIn("graph is NOT in TigerGraph", str(ctx.exception))
        self.assertEqual(fake.graphs, [])

    def test_http_errors_show_the_status_and_hide_the_secret(self):
        with self.assertRaises(GraphConnectionError) as ctx:
            create(FakeWorkspace(behaviour="http404"))
        self.assertIn("HTTP 404", str(ctx.exception))
        self.assertNotIn(SECRET, str(ctx.exception))


def existing_workspace(**over):
    """The workspace as seen on Savanna: global Wallet/Cluster/Report, the OLD global TRANSFER with no discriminator, MEMBER_OF, REPORTED,
    and two graphs (the team's and the first test graph) that share them."""
    vertices = {
        "Wallet": "VERTEX Wallet(PRIMARY_ID address STRING, is_exit_point BOOL, data_source STRING) WITH STATS=\"OUTDEGREE_BY_EDGETYPE\", PRIMARY_ID_AS_ATTRIBUTE=\"true\"",
        "Cluster": "VERTEX Cluster(PRIMARY_ID cluster_id STRING) WITH STATS=\"OUTDEGREE_BY_EDGETYPE\", PRIMARY_ID_AS_ATTRIBUTE=\"true\"",
        "Report": "VERTEX Report(PRIMARY_ID report_id STRING, target_address STRING, evidence_hash STRING) WITH STATS=\"OUTDEGREE_BY_EDGETYPE\", PRIMARY_ID_AS_ATTRIBUTE=\"true\"",
    }
    edges = {
        "TRANSFER": "DIRECTED EDGE TRANSFER(FROM Wallet, TO Wallet, amount DOUBLE, timestamp INT, tx_id STRING)",
        "MEMBER_OF": "UNDIRECTED EDGE MEMBER_OF(FROM Wallet, TO Cluster)",
        "REPORTED": "DIRECTED EDGE REPORTED(FROM Report, TO Wallet)",
    }
    return FakeWorkspace(graphs=["team_graph", "first_test_graph"], vertices=vertices, edges=edges, **over)


class NewEdgeOnTheExistingWorkspace(unittest.TestCase):
    """The decided approach: a NEW global edge type with a discriminator and a NEW graph; nothing that exists is touched."""

    def test_only_the_new_edge_type_and_the_new_graph_are_created(self):
        fake = existing_workspace()
        before = (dict(fake.vertices), dict(fake.edges), list(fake.graphs))
        said = create(fake)
        creates = [s for s in fake.statements if s.startswith("CREATE")]
        self.assertEqual(len(creates), 2, creates)
        self.assertTrue(creates[0].startswith("CREATE DIRECTED EDGE TRANSFER_TX (FROM Wallet, TO Wallet, DISCRIMINATOR(tx_id STRING), amount DOUBLE, timestamp INT)"))
        self.assertEqual(creates[1], f"CREATE GRAPH {GRAPH} (Wallet, Cluster, Report, TRANSFER_TX, MEMBER_OF, REPORTED)")
        # nothing that existed was changed: same vertex lines, same old edges, same graphs plus the new one
        self.assertEqual(fake.vertices, before[0])
        self.assertEqual({k: v for k, v in fake.edges.items() if k != "TRANSFER_TX"}, before[1])
        self.assertEqual(fake.graphs, before[2] + [GRAPH])
        self.assertIn("DISCRIMINATOR", fake.edges["TRANSFER_TX"])
        self.assertEqual(sum("reusing it" in s for s in said), 5)        # three vertex types and MEMBER_OF, REPORTED

    def test_no_statement_ever_drops_or_alters_anything(self):
        fake = existing_workspace()
        create(fake)
        for statement in fake.statements:
            self.assertNotRegex(statement, r"(?i)\b(DROP|ALTER|DELETE|TRUNCATE|CLEAR|SCHEMA_CHANGE)\b")

    def test_every_statement_runs_alone_in_global_scope(self):
        fake = existing_workspace()
        create(fake)
        self.assertTrue(all("\n" not in s for s in fake.statements))      # one statement per request (the USE GLOBAL line is stripped by the fake)

    def test_an_existing_graph_name_creates_nothing(self):
        fake = existing_workspace()
        fake.graphs.append(GRAPH)
        create(fake)
        self.assertEqual([s for s in fake.statements if s.startswith("CREATE")], [])

    def test_running_it_twice_creates_the_edge_type_only_once(self):
        fake = existing_workspace()
        create(fake)
        count = len([s for s in fake.statements if s.startswith("CREATE")])
        create(fake)
        self.assertEqual(len([s for s in fake.statements if s.startswith("CREATE")]), count)

    def test_a_second_new_graph_reuses_the_new_edge_type(self):
        fake = existing_workspace()
        create(fake)
        before = len([s for s in fake.statements if s.startswith("CREATE DIRECTED EDGE")])
        gsql_admin.create_schema(fake, SCRIPT, "another_new_graph", [SECRET], lambda m: None)
        self.assertEqual(len([s for s in fake.statements if s.startswith("CREATE DIRECTED EDGE")]), before)
        self.assertIn("another_new_graph", fake.graphs)

    def test_a_same_named_edge_type_without_a_discriminator_is_never_reused(self):
        fake = existing_workspace()
        fake.edges["TRANSFER_TX"] = "DIRECTED EDGE TRANSFER_TX(FROM Wallet, TO Wallet, amount DOUBLE, timestamp INT, tx_id STRING)"
        with self.assertRaises(GraphConnectionError) as ctx:
            create(fake)
        self.assertIn("DISCRIMINATOR", str(ctx.exception))
        self.assertEqual([s for s in fake.statements if s.startswith("CREATE")], [])

    def test_a_missing_discriminator_in_the_new_listing_line_is_reported(self):
        fake = existing_workspace()
        original = fake._req

        def strip_word(*a, **kw):
            answer = original(*a, **kw)
            return [l.replace("DISCRIMINATOR(tx_id STRING), ", "tx_id STRING, ") for l in answer]

        fake._req = strip_word
        said = create(fake)
        self.assertTrue(any(s.startswith("WARNING") and "DISCRIMINATOR" in s for s in said))

    def test_setup_script_end_to_end_on_that_workspace(self):
        fake = existing_workspace()
        code, out, err = run_script(load_script("setup_graph"), fake)
        self.assertEqual(code, 0, err)
        self.assertIn("Created global edge type TRANSFER_TX", out)
        self.assertIn(f"Created graph {GRAPH}", out)
        self.assertIn("Setup complete.", out)
        self.assertNotIn(SECRET, out + err)


class SafeToRunAgain(unittest.TestCase):
    def test_after_a_partial_run_only_the_missing_pieces_are_created(self):
        first = FakeWorkspace(behaviour="error:Failed on edge", fail_on="EDGE")
        with self.assertRaises(GraphConnectionError):
            create(first)
        self.assertEqual(sorted(first.vertices), sorted(schema_spec.VERTICES))   # the three vertex types were created before the failure
        self.assertEqual(first.edges, {})
        again = FakeWorkspace(vertices=first.vertices)
        said = create(again)
        created = [s for s in again.statements if s.startswith("CREATE VERTEX")]
        self.assertEqual(created, [])
        self.assertEqual(sorted(again.edges), sorted(schema_spec.EDGES))
        self.assertEqual(again.graphs, [GRAPH])
        self.assertEqual(sum("reusing it" in s for s in said), 3)

    def test_an_existing_type_with_another_definition_is_never_replaced(self):
        wrong = {"Wallet": "VERTEX Wallet (PRIMARY_ID address STRING, label STRING)"}
        fake = FakeWorkspace(vertices=wrong)
        with self.assertRaises(GraphConnectionError) as ctx:
            create(fake)
        self.assertIn("already exists but is not the expected one", str(ctx.exception))
        self.assertEqual(fake.creates(), [])

    def test_an_existing_graph_is_not_touched(self):
        fake = FakeWorkspace(graphs=[GRAPH])
        said = create(fake)
        self.assertEqual(fake.creates(), [])
        self.assertTrue(any("already exists" in s for s in said))


class SetupScript(unittest.TestCase):
    def test_success_prints_verified_steps_and_installs_every_query(self):
        fake = FakeWorkspace()
        code, out, err = run_script(load_script("setup_graph"), fake)
        self.assertEqual(code, 0, err)
        self.assertIn("Setup complete.", out)
        self.assertEqual(sorted(fake.queries), ["analyze_wallet", "get_cluster_graph", "link_candidates"])
        self.assertNotIn(SECRET, out + err)

    def test_failure_exits_1_never_says_schema_created_and_hides_the_secret(self):
        fake = FakeWorkspace(behaviour=f"error:Wallet is already used ({SECRET})")
        code, out, err = run_script(load_script("setup_graph"), fake)
        self.assertEqual(code, 1)
        self.assertNotIn("Schema created", out)
        self.assertNotIn("Setup complete", out)
        self.assertIn("Setup stopped", err)
        self.assertIn("already used", err)
        self.assertNotIn(SECRET, out + err)
        self.assertEqual(fake.queries, [])

    def test_an_existing_graph_gets_no_create_statement_at_all(self):
        fake = FakeWorkspace(graphs=[GRAPH], vertices={n: f"VERTEX {n}()" for n in schema_spec.VERTICES})
        code, out, err = run_script(load_script("setup_graph"), fake)
        self.assertEqual(code, 0, err)
        self.assertEqual(fake.creates(), [])
        self.assertIn("is not changed", out)


def result_of(text, code=None):
    lines = tuple(text.splitlines()) + ((f"__GSQL__RETURN_CODE__,{code}",) if code is not None else ())
    return gsql_admin.GsqlResult(lines, "\n".join(l for l in lines if not l.startswith("__GSQL__")), code)


class InstallVerdict(unittest.TestCase):
    """The verdict on TigerGraph's answer to INSTALL QUERY. The success summary contains the word "failed" (as "failed: 0")."""

    def test_the_real_success_text_passes(self):
        self.assertIsNone(gsql_admin.install_failure_reason(result_of(INSTALL_OK, 0)))
        self.assertIsNone(gsql_admin.install_failure_reason(result_of(INSTALL_OK)))

    def test_the_general_check_no_longer_trips_on_failed_zero(self):
        self.assertIsNone(gsql_admin.failure_reason(result_of(INSTALL_OK, 0)))
        self.assertIsNotNone(gsql_admin.failure_reason(result_of("Query installation summary: succeeded: 0, skipped: 0, failed: 1.")))

    def test_an_already_installed_query_that_was_skipped_passes(self):
        self.assertIsNone(gsql_admin.install_failure_reason(result_of(INSTALL_SKIPPED, 0)))

    def test_the_earlier_draft_and_parse_errors_fail(self):
        self.assertIn("draft", gsql_admin.install_failure_reason(result_of(DRAFT_ONLY)))
        self.assertIsNotNone(gsql_admin.install_failure_reason(result_of(PARSE_ERROR)))
        self.assertIsNotNone(gsql_admin.install_failure_reason(result_of(PARSE_ERROR, 1)))

    def test_a_draft_fails_even_if_the_summary_looks_fine(self):
        text = "Saved as draft query analyze_wallet.\n" + INSTALL_OK
        self.assertIn("draft", gsql_admin.install_failure_reason(result_of(text)))

    def test_a_missing_summary_line_fails(self):
        reason = gsql_admin.install_failure_reason(result_of("Successfully created queries: [analyze_wallet]."))
        self.assertIn("no installation summary", reason)

    def test_failed_count_above_zero_fails_and_nothing_installed_fails(self):
        self.assertIn("failed: 2", gsql_admin.install_failure_reason(result_of("Query installation summary: succeeded: 1, skipped: 0, failed: 2.")))
        self.assertIn("nothing was installed", gsql_admin.install_failure_reason(result_of("Query installation summary: succeeded: 0, skipped: 0, failed: 0.")))

    def test_a_non_zero_return_code_fails_even_with_a_good_looking_text(self):
        self.assertIn("return code 1", gsql_admin.install_failure_reason(result_of(INSTALL_OK, 1)))


class QueryInstallFailure(unittest.TestCase):
    PARSE_ERROR = "Parse error at line 7:54: mismatched input 'target' expecting {IDENT}"

    def test_a_query_that_does_not_install_stops_setup_at_that_query_with_the_raw_answer(self):
        fake = FakeWorkspace(graphs=[GRAPH])
        fake.reject_query, fake.reject_text = "get_cluster_graph", f"{self.PARSE_ERROR} (token {SECRET})"
        code, out, err = run_script(load_script("setup_graph"), fake)
        self.assertEqual(code, 1)
        self.assertIn("Setup stopped: Installing query get_cluster_graph failed", err)
        self.assertIn("mismatched input 'target'", err)
        self.assertIn("line 7:54", err)
        self.assertNotIn(SECRET, out + err)
        self.assertIn("Installed query analyze_wallet", out)           # the one before it did install
        self.assertEqual(fake.queries, ["analyze_wallet"])             # the one after it was never attempted
        self.assertNotIn("Setup complete", out)

    def test_parse_wording_alone_counts_as_a_failure(self):
        for text in ("mismatched input 'target' expecting IDENT", "no viable alternative at input 'x'", "extraneous input ';'"):
            result = gsql_admin.GsqlResult((text,), text, None)
            self.assertIsNotNone(gsql_admin.failure_reason(result), text)

    def test_the_first_query_failing_installs_nothing(self):
        fake = FakeWorkspace(graphs=[GRAPH])
        fake.reject_query, fake.reject_text = "analyze_wallet", self.PARSE_ERROR
        code, out, err = run_script(load_script("setup_graph"), fake)
        self.assertEqual(code, 1)
        self.assertEqual(fake.queries, [])
        self.assertIn("mismatched input", err)


class QueryInstallSteps(unittest.TestCase):
    def setup_run(self, fake):
        return run_script(load_script("setup_graph"), fake)

    def test_a_successful_answer_with_failed_zero_installs_all_three(self):
        fake = FakeWorkspace(graphs=[GRAPH])
        code, out, err = self.setup_run(fake)
        self.assertEqual(code, 0, err)
        self.assertEqual(sorted(fake.queries), ["analyze_wallet", "get_cluster_graph", "link_candidates"])
        self.assertEqual(out.count("Installed query"), 3)

    def test_a_second_run_skips_queries_that_are_installed_and_unchanged(self):
        fake = FakeWorkspace(graphs=[GRAPH])
        self.setup_run(fake)
        installs_before = len([s for s in fake.statements if "INSTALL QUERY" in s])
        code, out, err = self.setup_run(fake)
        self.assertEqual(code, 0, err)
        self.assertEqual(len([s for s in fake.statements if "INSTALL QUERY" in s]), installs_before)    # nothing sent again
        self.assertEqual(out.count("already installed and unchanged; skipped"), 3)
        self.assertNotIn("Installed query", out)

    def test_a_changed_query_is_installed_again(self):
        fake = FakeWorkspace(graphs=[GRAPH])
        self.setup_run(fake)
        fake.query_sources["analyze_wallet"] = "CREATE QUERY analyze_wallet(VERTEX<Wallet> something_else) FOR GRAPH x { }"
        code, out, _ = self.setup_run(fake)
        self.assertEqual(code, 0)
        self.assertIn("Installed query analyze_wallet", out)
        self.assertEqual(out.count("already installed and unchanged; skipped"), 2)

    def test_an_installed_query_whose_source_cannot_be_shown_is_installed_again(self):
        fake = FakeWorkspace(graphs=[GRAPH])
        self.setup_run(fake)
        fake.query_sources.clear()
        code, out, _ = self.setup_run(fake)
        self.assertEqual(code, 0)
        self.assertEqual(out.count("Installed query"), 3)

    def test_a_draft_answer_stops_setup_with_the_raw_text(self):
        fake = FakeWorkspace(graphs=[GRAPH])
        fake.reject_query, fake.reject_text, fake.reject_code = "analyze_wallet", DRAFT_ONLY + f" ({SECRET})", False
        code, out, err = self.setup_run(fake)
        self.assertEqual(code, 1)
        self.assertIn("Saved as draft query", err)
        self.assertIn("failed: 1", err)
        self.assertNotIn(SECRET, out + err)
        self.assertEqual(fake.queries, [])

    def test_success_text_without_the_query_in_the_installed_list_fails(self):
        fake = FakeWorkspace(graphs=[GRAPH])
        original = fake._req

        def forgetful(*a, **kw):
            answer = original(*a, **kw)
            fake.queries.clear()           # the server said fine, but nothing is installed
            return answer

        fake._req = forgetful
        code, out, err = self.setup_run(fake)
        self.assertEqual(code, 1)
        self.assertIn("not in the list of installed queries", err)
        self.assertNotIn("Setup complete", out)

    def test_a_missing_summary_line_stops_setup(self):
        fake = FakeWorkspace(graphs=[GRAPH])
        original = fake._req

        def no_summary(*a, **kw):
            answer = original(*a, **kw)
            return [l for l in answer if "summary" not in l] if any("summary" in l for l in answer) else answer

        fake._req = no_summary
        code, _, err = self.setup_run(fake)
        self.assertEqual(code, 1)
        self.assertIn("no installation summary", err)


class DiagnoseScript(unittest.TestCase):
    def test_default_run_is_read_only(self):
        fake = FakeWorkspace(graphs=["another_graph"])
        code, out, err = run_script(load_script("diagnose_graph"), fake, [])
        self.assertEqual(code, 0, err)
        self.assertEqual(set(s.strip() for s in fake.statements), {"ls"})
        self.assertIn("Graphs on the workspace: another_graph", out)
        self.assertIn(f"({GRAPH}) exists: NO", out)
        self.assertIn("Read-only run", out)
        self.assertNotIn(SECRET, out + err)

    def test_it_reports_which_global_types_exist_and_whether_they_match(self):
        fake = FakeWorkspace(vertices={"Wallet": "VERTEX Wallet (PRIMARY_ID address STRING, is_exit_point BOOL, data_source STRING)", "Cluster": "VERTEX Cluster (PRIMARY_ID bad INT)"})
        _, out, _ = run_script(load_script("diagnose_graph"), fake, [])
        self.assertIn("Wallet: present, matches", out)
        self.assertIn("Cluster: present, DIFFERS", out)
        self.assertIn("Report: not present", out)

    def test_try_create_shows_each_raw_answer_stops_at_the_first_problem_and_hides_the_secret(self):
        fake = FakeWorkspace(behaviour=f"error:Wallet is already used ({SECRET})")
        code, out, err = run_script(load_script("diagnose_graph"), fake, ["--try-create"])
        self.assertEqual(code, 1)
        self.assertIn("already used", out)
        self.assertIn("STOP:", out)
        self.assertNotIn(SECRET, out + err)
        self.assertEqual(len([s for s in fake.statements if s.startswith("CREATE")]), 1)

    def test_try_create_refuses_when_the_graph_exists(self):
        fake = FakeWorkspace(graphs=[GRAPH])
        code, out, _ = run_script(load_script("diagnose_graph"), fake, ["--try-create"])
        self.assertEqual(code, 1)
        self.assertIn("refused", out)
        self.assertEqual(fake.creates(), [])


if __name__ == "__main__":
    unittest.main()
