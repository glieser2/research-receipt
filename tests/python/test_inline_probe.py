"""Stub-only fixed-inline diagnostic tests; not real-model or consensus evidence."""
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
frozen_spec = importlib.util.spec_from_file_location("inline_probe_frozen_v4", ROOT / "contracts/archive/research_receipt_v4_f5a656.py")
frozen_rr = importlib.util.module_from_spec(frozen_spec)
frozen_spec.loader.exec_module(frozen_rr)
PROBE_PATH = ROOT / "contracts/research_receipt_inline_probe.py"
FIXTURE_PATH = ROOT / "tests/fixtures/bradbury-inline-probe-input.json"
FROZEN_SHA256 = "f5a656c23224a4cff7c9f87f2a04c24efd7b4a413a7f0a0449c2a1c7c5408c61"
FIXTURE_SHA256 = "c9e9884c2467106aa76449f28830f8323e831801450ee0f012bae9429606bb96"
module_spec = importlib.util.spec_from_file_location("research_receipt_inline_probe", PROBE_PATH)
probe = importlib.util.module_from_spec(module_spec)
module_spec.loader.exec_module(probe)
gl = business_tests.gl
UserError = business_tests.UserError
Returned = business_tests.Returned


class InlineProbeTests(unittest.TestCase):
    def setUp(self):
        self.fixtures = json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))
        self.prompts = []
        self.gets = 0
        self.phase_calls = []
        self.outputs = []

        def forbidden_get(*args, **kwargs):
            self.gets += 1
            raise AssertionError("Inline diagnostic must never use HTTP")

        def model(prompt, *, response_format):
            self.assertEqual(response_format, "json")
            self.prompts.append(prompt)
            if not self.outputs:
                raise AssertionError("Unexpected additional model call")
            return copy.deepcopy(self.outputs.pop(0))

        def run(leader, validator):
            before = len(self.prompts)
            value = leader()
            self.phase_calls.append(len(self.prompts) - before)
            before = len(self.prompts)
            accepted = validator(Returned(copy.deepcopy(value)))
            self.phase_calls.append(len(self.prompts) - before)
            if not accepted:
                raise UserError("Independent inline assessment disagreed")
            return value

        gl.nondet.web = SimpleNamespace(request=forbidden_get)
        gl.nondet.exec_prompt = model
        gl.vm.run_nondet_default = run

    def normalized(self, payload):
        spec = probe.normalize_spec(probe.canonical(payload["spec"]))
        submission = probe.normalize_submission(probe.canonical(payload["submission"]), spec)
        return spec, submission

    def queue(self, statuses, times=1):
        self.outputs.extend({"status": status, "evidence_indices": [0], "reason": "Scripted evidence classification, not a real-model result."} for _ in range(times) for status in statuses)

    def deploy_offline(self, case="negative", payload=None):
        return probe.ResearchReceiptInlineProbe(json.dumps(payload or self.fixtures[case], ensure_ascii=True))

    def test_frozen_helpers_prompts_and_validation_are_verbatim(self):
        self.assertEqual(hashlib.sha256((ROOT / "contracts/archive/research_receipt_v4_f5a656.py").read_bytes()).hexdigest(), FROZEN_SHA256)
        self.assertEqual(hashlib.sha256(FIXTURE_PATH.read_bytes()).hexdigest(), FIXTURE_SHA256)
        for name in ["fail", "canonical", "digest", "require_keys", "text", "parse_payload", "positive_int", "normalize_spec", "validate_source_url", "normalize_submission", "content_fingerprint", "delivery_status", "aggregate_verdict", "decode_model_finding", "normalize_model_finding", "criterion_prompt", "stable_projection", "validate_assessment"]:
            with self.subTest(helper=name):
                self.assertEqual(inspect.getsource(getattr(probe, name)), inspect.getsource(getattr(frozen_rr, name)))

    def test_original_claims_loop_and_callbacks_are_reversibly_identical(self):
        business = (ROOT / "contracts/archive/research_receipt_v4_f5a656.py").read_text(encoding="utf-8")
        start = business.index("    claims = ", business.index("def independent_assessment("))
        loop = business[start:business.index("\n\ndef stable_projection(", start)]
        inline = inspect.getsource(probe.independent_assessment)
        self.assertEqual(inline[inline.index("    claims = "):].rstrip("\n"), loop.rstrip("\n"))
        source = PROBE_PATH.read_text(encoding="utf-8")
        original_start = business.index("        def leader_fn():", business.index("    def evaluate("))
        original_callbacks = business[original_start:business.index("        assessment.update(", original_start)]
        new_start = source.index("        def leader_fn():")
        new_callbacks = source[new_start:source.index("        self.assessment = ", new_start)]
        restored = new_callbacks.replace("independent_assessment(spec, submission, inline_materials)", "independent_assessment(spec, submission)")
        self.assertEqual(restored.rstrip("\n"), original_callbacks.rstrip("\n"))
        self.assertEqual(new_callbacks.count("independent_assessment(spec, submission, inline_materials)"), 2)

    def test_fixed_inline_bytes_and_all_four_prompt_bytes_match_frozen_v4(self):
        payload = self.fixtures["negative"]
        spec, submission = self.normalized(payload)
        checks, materials = probe.verified_inline_sources(submission, tuple(payload["materials"]))
        self.assertEqual([item["status"] for item in checks], ["VERIFIED", "VERIFIED"])
        self.assertEqual([(item["sha256"], item["byte_length"]) for item in submission["sources"]], [
            ("38578bd71c0a909840e67202db527cc6b4e6b437e0f39f0c909da32c1e30cb81", 3102),
            ("9c1cc43aa4a2bde5c7dea0d4830cd42c54813ff883e55c8d8f12e6189bf7f10a", 860),
        ])
        self.queue(["CONTRADICTED", "SCOPED_UNKNOWN", "SCOPED_UNKNOWN", "SUPPORTED"])
        probe.independent_assessment(spec, submission, tuple(payload["materials"]))
        for prompt, criterion, claim in zip(self.prompts, spec["criteria"], submission["claims"]):
            expected = frozen_rr.criterion_prompt(spec, submission, criterion, claim, materials)
            self.assertEqual(prompt, expected)
        self.assertEqual(len(self.prompts), 4)
        self.assertEqual(self.gets, 0)

    def test_negative_constructor_has_four_calls_per_independent_side_and_stable_receipt(self):
        self.queue(["CONTRADICTED", "SCOPED_UNKNOWN", "SCOPED_UNKNOWN", "SUPPORTED"], times=2)
        instance = self.deploy_offline()
        receipt = json.loads(instance.get_receipt())
        full = json.loads(instance.get_assessment())
        self.assertEqual(set(receipt), {"probe_version", "spec_hash", "submission_hash", "assessment"})
        self.assertEqual(receipt["probe_version"], "research-receipt/inline-source-probe/1")
        self.assertEqual(receipt["assessment"], frozen_rr.stable_projection(full))
        self.assertEqual(full["verdict"], "NOT_ACCEPTED")
        self.assertEqual([item["status"] for item in full["findings"]], ["CONTRADICTED", "SCOPED_UNKNOWN", "SCOPED_UNKNOWN", "SUPPORTED"])
        self.assertEqual([item["evidence_indices"] for item in full["findings"]], [[0]] * 4)
        self.assertEqual([item["status"] for item in full["source_checks"]], ["VERIFIED"] * 2)
        self.assertEqual(self.phase_calls, [4, 4])
        self.assertEqual(self.gets, 0)
        self.assertEqual(set(vars(instance)), {"receipt", "assessment"})
        self.assertNotIn("reason", receipt["assessment"]["findings"][0])
        self.assertIn("reason", full["findings"][0])
        for material in self.fixtures["negative"]["materials"]:
            self.assertNotIn(material, instance.get_receipt())
            self.assertNotIn(material, instance.get_assessment())
        spec, submission = self.normalized(self.fixtures["negative"])
        self.assertEqual(receipt["spec_hash"], probe.digest(spec))
        self.assertEqual(receipt["submission_hash"], probe.digest(submission))

    def test_positive_and_strict_unknown_are_only_stub_policy_controls(self):
        for case, expected in [("positive", "ACCEPTED"), ("strictUnknown", "INSUFFICIENT_EVIDENCE")]:
            with self.subTest(case=case):
                self.queue(["SUPPORTED", "SCOPED_UNKNOWN", "SCOPED_UNKNOWN", "SUPPORTED"], times=2)
                instance = self.deploy_offline(case)
                assessment = json.loads(instance.get_assessment())
                self.assertEqual(assessment["verdict"], expected)
                self.assertEqual([item["status"] for item in assessment["findings"]], ["SUPPORTED", "SCOPED_UNKNOWN", "SCOPED_UNKNOWN", "SUPPORTED"])
                self.assertEqual(self.phase_calls[-2:], [4, 4])
                self.assertEqual(self.gets, 0)
        # These outputs are explicitly scripted; only negative is planned live.

    def test_bad_material_or_author_chosen_commitment_fails_before_any_model(self):
        mutations = []
        altered = copy.deepcopy(self.fixtures["negative"])
        altered["materials"][0] += "\n"
        mutations.append(altered)
        chosen = copy.deepcopy(altered)
        chosen["submission"]["sources"][0].update(sha256=hashlib.sha256(chosen["materials"][0].encode()).hexdigest(), byte_length=len(chosen["materials"][0].encode()))
        mutations.append(chosen)
        for bad in [None, 3, "\ud800", "x" * 16385]:
            altered = copy.deepcopy(self.fixtures["negative"])
            altered["materials"][1] = bad
            mutations.append(altered)
        reordered = copy.deepcopy(self.fixtures["negative"])
        reordered["submission"]["sources"].reverse()
        reordered["materials"].reverse()
        mutations.append(reordered)
        for payload in mutations:
            with self.subTest(material_type=type(payload["materials"][1]).__name__):
                with self.assertRaises(UserError):
                    self.deploy_offline(payload=payload)
        self.assertEqual(self.prompts, [])
        self.assertEqual(self.phase_calls, [])
        self.assertEqual(self.gets, 0)

    def test_each_independent_execution_revalidates_fixed_bytes_before_model(self):
        payload = copy.deepcopy(self.fixtures["negative"])
        spec, submission = self.normalized(payload)
        bad_materials = tuple([payload["materials"][0], payload["materials"][1] + "\n"])
        with self.assertRaisesRegex(UserError, "fixed source bytes"):
            probe.independent_assessment(spec, submission, bad_materials)
        self.assertEqual(self.prompts, [])
        self.assertEqual(self.gets, 0)

    def test_four_complete_claims_are_required_before_model(self):
        payload = copy.deepcopy(self.fixtures["negative"])
        payload["submission"]["claims"].pop()
        payload["submission"]["report_body"] = "\n".join(item["statement"] for item in payload["submission"]["claims"])
        with self.assertRaisesRegex(UserError, "four bound claims"):
            self.deploy_offline(payload=payload)
        payload = copy.deepcopy(self.fixtures["negative"])
        payload["submission"]["claims"][2]["evidence_indices"] = []
        with self.assertRaisesRegex(UserError, "four bound claims"):
            self.deploy_offline(payload=payload)
        self.assertEqual(self.prompts, [])
        self.assertEqual(self.gets, 0)

    def test_malformed_leader_is_rejected_without_additional_model_judgment(self):
        def malformed(leader, validator):
            self.assertFalse(validator({"calldata": {}}))
            valid = leader()
            mutations = []
            changed = copy.deepcopy(valid)
            changed["findings"][0]["delivery_status"] = "FULFILLED"
            mutations.append(changed)
            changed = copy.deepcopy(valid)
            changed["source_checks"][0]["sha256"] = "0" * 64
            mutations.append(changed)
            changed = copy.deepcopy(valid)
            changed["findings"][0]["evidence_indices"] = []
            mutations.append(changed)
            mutations.append({"verdict": "NOT_ACCEPTED"})
            for value in mutations:
                self.assertFalse(validator(Returned(value)))
            raise UserError("Malformed leader refused")
        gl.vm.run_nondet_default = malformed
        self.queue(["CONTRADICTED", "SCOPED_UNKNOWN", "SCOPED_UNKNOWN", "SUPPORTED"])
        with self.assertRaisesRegex(UserError, "Malformed leader"):
            self.deploy_offline()
        self.assertEqual(len(self.prompts), 4)
        self.assertEqual(self.gets, 0)

    def test_validator_compares_full_projection_even_when_overall_verdict_matches(self):
        def forged(leader, validator):
            valid = leader()
            changed = copy.deepcopy(valid)
            changed["findings"][2]["status"] = "SUPPORTED"
            self.assertEqual(changed["verdict"], valid["verdict"])
            self.assertEqual(changed["findings"][2]["delivery_status"], valid["findings"][2]["delivery_status"])
            self.assertFalse(validator(Returned(changed)))
            raise UserError("Full projection mismatch")
        gl.vm.run_nondet_default = forged
        self.queue(["CONTRADICTED", "SCOPED_UNKNOWN", "SCOPED_UNKNOWN", "SUPPORTED"], times=2)
        with self.assertRaisesRegex(UserError, "Full projection"):
            self.deploy_offline()
        self.assertEqual(len(self.prompts), 8)
        self.assertEqual(self.gets, 0)

    def test_original_global_format_repair_budget_is_retained(self):
        payload = self.fixtures["negative"]
        spec, submission = self.normalized(payload)
        self.outputs.append({"status": "CONTRADICTED", "evidence_indices": ["0"], "reason": "Invalid reference format."})
        self.queue(["CONTRADICTED", "SCOPED_UNKNOWN", "SCOPED_UNKNOWN", "SUPPORTED"])
        result = probe.independent_assessment(spec, submission, tuple(payload["materials"]))
        self.assertEqual(result["verdict"], "NOT_ACCEPTED")
        self.assertEqual(len(self.prompts), 5)
        self.assertIn("FORMAT_REPAIR_ERROR_CODE: RR_MODEL_EVIDENCE_INVALID", self.prompts[1])
        self.assertEqual(self.gets, 0)

    def test_no_http_business_order_payment_or_appeal_path(self):
        tree = ast.parse(PROBE_PATH.read_text(encoding="utf-8"))
        self.assertFalse(any(isinstance(node, ast.Attribute) and node.attr in {"web", "request", "transfer", "send", "appeal", "write"} for node in ast.walk(tree)))
        contract = next(node for node in tree.body if isinstance(node, ast.ClassDef))
        self.assertEqual([node.name for node in contract.body if isinstance(node, ast.FunctionDef)], ["__init__", "get_receipt", "get_assessment"])


if __name__ == "__main__":
    unittest.main()
