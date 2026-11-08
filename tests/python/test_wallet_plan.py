"""Offline authority migration; does not establish model or chain outcomes."""
import importlib.util
import json
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("wallet_plan", ROOT / "scripts/prepare-v6-wallet-e2e.py")
planner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(planner)


class WalletPlan(unittest.TestCase):
    def test_unavailable_or_invalid_owners_rejected(self):
        for owner in [None, "0x", "0x" + "0" * 40, *planner.DEAD, "0x6a1f0a11003b197f192961b006a9e6534b447f75"]:
            with self.subTest(owner=owner), self.assertRaises(ValueError):
                planner.build(owner)

    def test_all_cases_rebuilt_with_new_authority_and_frozen_oracles(self):
        old_bytes = (ROOT / planner.OLD_PLAN).read_bytes()
        old = json.loads(old_bytes)
        fixture, _, plan = planner.build("0x1111111111111111111111111111111111111111")
        self.assertEqual((ROOT / planner.OLD_PLAN).read_bytes(), old_bytes)
        self.assertEqual(plan["executionAuthority"], "user-controlled-wallet")
        self.assertEqual(plan["actorCommitment"]["actors"]["owner"], "0x" + "1" * 40)
        self.assertEqual([x["name"] for x in plan["cases"]], [x["name"] for x in old["cases"]])
        for actual, previous in zip(plan["cases"], old["cases"]):
            self.assertEqual(actual["expectedTransaction"], previous["expectedTransaction"])
            self.assertEqual(actual["expectedError"], previous["expectedError"])
            self.assertEqual(actual["modelCallsPerIndependentExecution"], previous["modelCallsPerIndependentExecution"])
            self.assertEqual(actual["role"], "owner")
        for actual, previous in zip(plan["expected"], old["expected"]):
            self.assertEqual(actual["assessment"]["projection"]["findings"], previous["assessment"]["projection"]["findings"])
            self.assertEqual(actual["assessment"]["projection"]["verdict"], previous["assessment"]["projection"]["verdict"])
            self.assertNotEqual(actual["snapshot"]["snapshot_hash"], previous["snapshot"]["snapshot_hash"])
        for key, value in fixture.items():
            if isinstance(value, dict) and "client_ref" in value:
                is_other_author_order = value.get("client_ref") == fixture["authorOtherSpec"]["client_ref"]
                self.assertEqual(value["author"], plan["actorCommitment"]["actors"]["author"] if is_other_author_order else "0x" + "1" * 40)
        self.assertEqual(plan["chainWritesPerformedByPlanner"], 0)

    def test_two_wallets_have_distinct_bindings_but_same_criteria(self):
        a, _, pa = planner.build("0x1111111111111111111111111111111111111111")
        b, _, pb = planner.build("0x2222222222222222222222222222222222222222")
        self.assertEqual(a["correctionSpec"]["criteria"], b["correctionSpec"]["criteria"])
        self.assertNotEqual(pa["expected"][0]["specHash"], pb["expected"][0]["specHash"])
        self.assertNotEqual(pa["expected"][0]["snapshot"]["snapshot_hash"], pb["expected"][0]["snapshot"]["snapshot_hash"])


if __name__ == "__main__":
    unittest.main()
