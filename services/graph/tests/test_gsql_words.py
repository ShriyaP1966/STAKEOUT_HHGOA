"""Every name the GSQL queries declare must not be a reserved or easily-confused keyword (TigerGraph 4.2 list in graph/gsql_words.py).
The parser compares case-insensitively, so `Target` clashes just like `target`. This is what stopped analyze_wallet on Savanna.
It checks names only; it cannot prove the queries compile (only a TigerGraph server can). Run from services/graph:
    python -m unittest discover -s tests -t .
"""

import re
import unittest
from pathlib import Path

from graph.gsql_words import NON_RESERVED, RESERVED, is_unsafe_name

QUERIES = sorted((Path(__file__).resolve().parent.parent / "graph" / "queries").glob("*.gsql"))
TYPES = r"(?:VERTEX<\w+>|INT|UINT|STRING|BOOL|DOUBLE|FLOAT|DATETIME|EDGE)"


def code_of(path: Path) -> str:
    return "\n".join(line.split("//")[0] for line in path.read_text(encoding="utf-8").splitlines())


def declared_names(code: str) -> dict[str, str]:
    """name -> where it was declared. Covers parameters, local variables, vertex-set variables, accumulators, pattern aliases,
    loop variables and PRINT aliases."""
    names: dict[str, str] = {}

    def add(kind, matches):
        for m in matches:
            names.setdefault(m, kind)

    header = re.search(r"QUERY\s+\w+\s*\((.*?)\)\s*FOR GRAPH", code, re.S)
    if header:
        add("parameter", re.findall(rf"{TYPES}\s+(\w+)", header.group(1)))
    add("local variable", re.findall(rf"\b{TYPES}\s+(\w+)\s*=", code))
    add("vertex-set variable", re.findall(r"^\s*(\w+)\s*=", code, re.M))
    add("accumulator", re.findall(r"@@?(\w+)", code))
    add("pattern alias", re.findall(r":(\w+)\b(?!:)", code))
    add("loop variable", re.findall(r"\bFOREACH\s+(\w+)\s+IN\b", code, re.I))
    add("PRINT alias", re.findall(r"\bAS\s+(\w+)", code))
    return names


class QueryNames(unittest.TestCase):
    def test_the_lists_hold_the_words_that_broke_the_install(self):
        for word in ("TARGET", "RANGE", "SET", "COUNT"):
            self.assertIn(word, RESERVED)
        for word in ("SRC", "TGT", "PATH", "LIST", "MAP", "NOW", "LOG", "FILE", "GROUP", "MATCH", "DEFAULT"):
            self.assertIn(word, NON_RESERVED)
        self.assertTrue(is_unsafe_name("Target") and is_unsafe_name("target"))

    def test_the_name_finder_sees_the_old_mistakes(self):
        old = "CREATE OR REPLACE QUERY q(VERTEX<Wallet> target, INT max_hops) FOR GRAPH g {\n  Target = SELECT s FROM All:s WHERE s == target;\n}"
        found = declared_names(old)
        self.assertEqual(found.get("target"), "parameter")
        self.assertTrue(any(n.lower() == "target" for n in found))
        self.assertTrue(any(is_unsafe_name(n) for n in found))

    def test_there_are_queries_to_check(self):
        self.assertEqual([q.stem for q in QUERIES], ["analyze_wallet", "get_cluster_graph", "link_candidates"])

    def test_no_query_declares_a_reserved_or_confusing_name(self):
        for path in QUERIES:
            for name, where in declared_names(code_of(path)).items():
                self.assertFalse(is_unsafe_name(name), f"{path.name}: {where} `{name}` is a GSQL keyword")

    def test_the_parameter_names_match_what_python_sends(self):
        sent = {
            "analyze_wallet": {"wallet_id", "max_hops"},
            "get_cluster_graph": {"cluster"},
            "link_candidates": {"cluster", "rapid_max"},
        }
        for path in QUERIES:
            header = re.search(r"QUERY\s+\w+\s*\((.*?)\)\s*FOR GRAPH", code_of(path), re.S).group(1)
            params = set(re.findall(rf"{TYPES}\s+(\w+)", header))
            self.assertEqual(params, sent[path.stem], path.name)


if __name__ == "__main__":
    unittest.main()
