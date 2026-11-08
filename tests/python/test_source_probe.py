"""Offline source-only probe checks. GenVM is stubbed, never a live-chain proof."""
import ast
import copy
import hashlib
import importlib.util
import inspect
import json
from pathlib import Path
from types import SimpleNamespace
import unittest

import test_contract as business_tests

ROOT = Path(__file__).resolve().parents[2]
frozen_spec = importlib.util.spec_from_file_location("source_probe_frozen_v4", ROOT / "contracts/archive/research_receipt_v4_f5a656.py")
frozen_rr = importlib.util.module_from_spec(frozen_spec)
frozen_spec.loader.exec_module(frozen_rr)
PROBE_PATH = ROOT / "contracts/research_receipt_source_probe.py"
FROZEN_SHA256 = "f5a656c23224a4cff7c9f87f2a04c24efd7b4a413a7f0a0449c2a1c7c5408c61"
module_spec = importlib.util.spec_from_file_location("research_receipt_source_probe", PROBE_PATH)
probe = importlib.util.module_from_spec(module_spec)
module_spec.loader.exec_module(probe)
gl = business_tests.gl
UserError = business_tests.UserError
Returned = business_tests.Returned


class SourceProbeTests(unittest.TestCase):
    def setUp(self):
        self.spec = business_tests.spec_data()
        self.submission = business_tests.submission_data()
        second = copy.deepcopy(self.submission["sources"][0])
        second["url"] = second["url"].replace("README.md", "SECOND.md")
        self.submission["sources"].append(second)
        self.calls = []
        self.model_calls = 0

        def request(url, *, method):
            self.assertEqual(method, "GET")
            self.calls.append(url)
            return SimpleNamespace(status=200, body=business_tests.BODY)

        def forbidden_model(*args, **kwargs):
            self.model_calls += 1
            raise AssertionError("Source-only probe must not call a model")

        def run(leader, validator):
            value = leader()
            if not validator(Returned(copy.deepcopy(value))):
                raise UserError("Source-only independent validation disagreed")
            return value

        gl.nondet.web = SimpleNamespace(request=request)
        gl.nondet.exec_prompt = forbidden_model
        gl.vm.run_nondet_default = run

    def normalized(self):
        spec = probe.normalize_spec(json.dumps(self.spec))
        return spec, probe.normalize_submission(json.dumps(self.submission), spec)

    def deploy_offline(self):
        return probe.ResearchReceiptSourceProbe(json.dumps(self.spec), json.dumps(self.submission))

    def test_frozen_normalizers_and_fetch_block_are_verbatim(self):
        business_path = ROOT / "contracts/archive/research_receipt_v4_f5a656.py"
        self.assertEqual(hashlib.sha256(business_path.read_bytes()).hexdigest(), FROZEN_SHA256)
        for name in ["fail", "canonical", "digest", "require_keys", "text", "parse_payload", "positive_int", "normalize_spec", "validate_source_url", "normalize_submission"]:
            self.assertEqual(inspect.getsource(getattr(probe, name)), inspect.getsource(getattr(frozen_rr, name)))
        source = business_path.read_text(encoding="utf-8")
        start = source.index("def independent_assessment(")
        original = source[source.index("    checks = []", start):source.index("    claims = ", start)]
        generated = inspect.getsource(probe.independent_source_checks)
        self.assertEqual(generated.split("\n", 1)[1].removesuffix("    return checks\n"), original)
        self.assertEqual(probe.MAX_SOURCE_BYTES, 16384)
        self.assertEqual(probe.SOURCE_HOST, "raw.githubusercontent.com")
        self.assertEqual(PROBE_PATH.read_text(encoding="utf-8").splitlines()[:2], source.splitlines()[:2])

    def test_two_gets_per_independent_execution_zero_model_calls(self):
        _, submission = self.normalized()
        checks = probe.independent_source_checks(submission)
        self.assertEqual(self.calls, [item["url"] for item in submission["sources"]])
        self.assertEqual([item["status"] for item in checks], ["VERIFIED", "VERIFIED"])
        self.assertEqual(self.model_calls, 0)

    def test_constructor_independently_fetches_twice_and_receipt_excludes_bodies(self):
        instance = self.deploy_offline()
        receipt = json.loads(instance.get_receipt())
        spec, submission = self.normalized()
        self.assertEqual(self.calls, [item["url"] for item in submission["sources"]] * 2)
        self.assertEqual(self.model_calls, 0)
        self.assertEqual(set(receipt), {"probe_version", "spec_hash", "submission_hash", "source_checks", "committed_sources"})
        self.assertEqual(receipt["probe_version"], "research-receipt/source-only-probe/1")
        self.assertEqual(receipt["spec_hash"], probe.digest(spec))
        self.assertEqual(receipt["submission_hash"], probe.digest(submission))
        self.assertEqual(receipt["committed_sources"], submission["sources"])
        self.assertEqual([item["status"] for item in receipt["source_checks"]], ["VERIFIED"] * 2)
        self.assertNotIn(business_tests.BODY.decode(), instance.get_receipt())
        self.assertNotIn("report_body", receipt)
        self.assertEqual(set(vars(instance)), {"receipt"})

    def test_exactly_two_sources_required_before_fetch(self):
        self.submission["sources"].pop()
        with self.assertRaisesRegex(UserError, "exactly two"):
            self.deploy_offline()
        self.assertEqual(self.calls, [])
        self.assertEqual(self.model_calls, 0)

    def test_malformed_leader_checks_fail_before_independent_fetch(self):
        _, submission = self.normalized()
        valid = [{"index": i, "status": "VERIFIED", "sha256": item["sha256"]} for i, item in enumerate(submission["sources"])]
        malformed = [None, {}, [], valid[:1], list(reversed(valid))]
        for index, field, value in [(0, "index", True), (0, "index", "0"), (0, "status", "SUPPORTED"), (0, "sha256", "A" * 64), (0, "sha256", ""), (1, "sha256", "0" * 64)]:
            changed = copy.deepcopy(valid)
            changed[index][field] = value
            malformed.append(changed)
        changed = copy.deepcopy(valid)
        changed[0]["extra"] = "not permitted"
        malformed.append(changed)
        for result in malformed:
            with self.subTest(result=result):
                def corrupt(leader, validator):
                    self.assertFalse(validator(Returned(result)))
                    raise UserError("Malformed leader refused")
                gl.vm.run_nondet_default = corrupt
                with self.assertRaisesRegex(UserError, "Malformed leader"):
                    self.deploy_offline()
        self.assertEqual(self.calls, [])

    def test_validator_return_guard_and_complete_status_comparison(self):
        def corrupt(leader, validator):
            self.assertFalse(validator({"calldata": []}))
            real = leader()
            changed = copy.deepcopy(real)
            changed[0]["status"] = "UNAVAILABLE"
            self.assertFalse(validator(Returned(changed)))
            raise UserError("Full source-check disagreement")
        gl.vm.run_nondet_default = corrupt
        with self.assertRaisesRegex(UserError, "Full source-check"):
            self.deploy_offline()
        self.assertEqual(len(self.calls), 4)
        self.assertEqual(self.model_calls, 0)

    def test_refetch_disagreement_is_not_committed(self):
        def changing(url, *, method):
            self.calls.append(url)
            return SimpleNamespace(status=200 if len(self.calls) <= 2 else 404, body=business_tests.BODY)
        gl.nondet.web.request = changing
        with self.assertRaisesRegex(UserError, "disagreed"):
            self.deploy_offline()
        self.assertEqual(len(self.calls), 4)
        self.assertEqual(self.model_calls, 0)

    def test_matching_unavailable_results_are_not_verified_evidence(self):
        def unavailable(url, *, method):
            self.calls.append(url)
            return SimpleNamespace(status=404, body=None)
        gl.nondet.web.request = unavailable
        receipt = json.loads(self.deploy_offline().get_receipt())
        self.assertEqual(len(self.calls), 4)
        self.assertEqual([item["status"] for item in receipt["source_checks"]], ["UNAVAILABLE"] * 2)
        # A constructor can commit an agreed failure. Experiment success requires
        # TWO VERIFIED checks, exact hashes and the expected length commitments.
        self.assertFalse(all(item["status"] == "VERIFIED" for item in receipt["source_checks"]))
        self.assertEqual(self.model_calls, 0)

    def test_hash_length_size_and_encoding_boundaries_are_unchanged(self):
        for response_body, expected_status in [(business_tests.BODY + b"changed", "HASH_MISMATCH"), (b"x" * 16385, "TOO_LARGE"), (b"\xff", "INVALID_ENCODING")]:
            with self.subTest(status=expected_status):
                _, submission = self.normalized()
                if expected_status == "INVALID_ENCODING":
                    for item in submission["sources"]:
                        item.update(sha256=hashlib.sha256(response_body).hexdigest(), byte_length=len(response_body))
                gl.nondet.web.request = lambda url, method: SimpleNamespace(status=200, body=response_body)
                checks = probe.independent_source_checks(submission)
                self.assertEqual([item["status"] for item in checks], [expected_status] * 2)
                probe.validate_source_checks(checks, submission)
        _, submission = self.normalized()
        for source in submission["sources"]:
            source["byte_length"] += 1
        gl.nondet.web.request = lambda url, method: SimpleNamespace(status=200, body=business_tests.BODY)
        checks = probe.independent_source_checks(submission)
        self.assertEqual([item["status"] for item in checks], ["HASH_MISMATCH"] * 2)
        self.assertEqual(self.model_calls, 0)

    def test_get_failure_still_attempts_each_source_once(self):
        def broken(url, *, method):
            self.calls.append(url)
            raise OSError("Fixture web unavailable")
        gl.nondet.web.request = broken
        _, submission = self.normalized()
        checks = probe.independent_source_checks(submission)
        self.assertEqual(len(self.calls), 2)
        self.assertEqual([item["status"] for item in checks], ["UNAVAILABLE"] * 2)
        self.assertEqual(self.model_calls, 0)

    def test_contract_has_no_model_helpers_business_writes_or_payment_path(self):
        source = PROBE_PATH.read_text(encoding="utf-8")
        tree = ast.parse(source)
        self.assertNotIn("exec_prompt", source)
        self.assertNotIn("criterion_prompt", source)
        self.assertNotIn("independent_assessment", source)
        contract = next(node for node in tree.body if isinstance(node, ast.ClassDef))
        self.assertEqual([node.name for node in contract.body if isinstance(node, ast.FunctionDef)], ["__init__", "get_receipt"])
        self.assertFalse(any(isinstance(node, ast.Attribute) and node.attr in {"send", "transfer", "appeal", "write"} for node in ast.walk(tree)))


if __name__ == "__main__":
    unittest.main()
