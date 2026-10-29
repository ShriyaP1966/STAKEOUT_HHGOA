"""scripts/sample_addresses.py: reads roles and addresses from the file, hardcodes none, fails loudly when the file is missing."""

import contextlib
import importlib.util
import io
import json
import tempfile
import unittest
from pathlib import Path

from graph import generate
from tests.test_pipeline import params

SERVICE = Path(__file__).resolve().parent.parent


def load():
    spec = importlib.util.spec_from_file_location("sample_addresses", SERVICE / "scripts" / "sample_addresses.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def run(folder):
    out, err = io.StringIO(), io.StringIO()
    with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
        code = load().main(["--data", str(folder)])
    return code, out.getvalue(), err.getvalue()


class SampleAddresses(unittest.TestCase):
    def test_prints_one_address_per_role_and_scenario_from_the_file(self):
        folder = Path(tempfile.mkdtemp())
        _, _, truth = generate.generate(params(4))
        (folder / "scenarios.json").write_text(json.dumps(truth))
        code, out, err = run(folder)
        self.assertEqual(code, 0, err)
        roles = {w["role"] for w in truth["wallets"].values()}
        scenarios = {w["scenario"] for w in truth["wallets"].values()}
        for role in roles:
            address = [l.split(": ")[1] for l in out.splitlines() if l.startswith(f"{role}: ")][0]
            self.assertEqual(truth["wallets"][address]["role"], role)
        for scenario in scenarios:
            self.assertTrue(any(l.startswith(f"{scenario}: ") for l in out.splitlines()), scenario)
        self.assertEqual(out, run(folder)[1], "same file, same output")

    def test_roles_and_addresses_are_not_typed_in_the_script(self):
        text = (SERVICE / "scripts" / "sample_addresses.py").read_text(encoding="utf-8")
        self.assertNotRegex(text, r"0x[0-9a-fA-F]{6,}")
        _, _, truth = generate.generate(params(1))
        for role in {w["role"] for w in truth["wallets"].values()}:
            self.assertNotIn(role, text)

    def test_a_made_up_role_in_the_file_is_printed(self):
        folder = Path(tempfile.mkdtemp())
        address = "0x" + "ab" * 20
        (folder / "scenarios.json").write_text(json.dumps({"seed": 9, "wallets": {address: {"role": "role_made_up_here", "scenario": "scenario_made_up_here"}}}))
        code, out, _ = run(folder)
        self.assertEqual(code, 0)
        self.assertIn(f"role_made_up_here: {address}", out)
        self.assertIn(f"scenario_made_up_here: {address}", out)

    def test_missing_file_fails_loudly(self):
        code, out, err = run(Path(tempfile.mkdtemp()))
        self.assertEqual(code, 1)
        self.assertIn("Not found", err)
        self.assertEqual(out, "")

    def test_a_file_that_is_not_a_scenarios_file_fails_loudly(self):
        folder = Path(tempfile.mkdtemp())
        (folder / "scenarios.json").write_text(json.dumps({"hello": 1}))
        code, _, err = run(folder)
        self.assertEqual(code, 1)
        self.assertIn("not a scenarios file", err)
        (folder / "scenarios.json").write_text("{ nope")
        self.assertEqual(run(folder)[0], 1)


if __name__ == "__main__":
    unittest.main()
