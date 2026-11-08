"""Typed diagnostic control-flow tests with scripted models; never accuracy evidence.

Offline planner entry point: import this module (tests/python on sys.path), then
use probe.normalize_spec, probe.normalize_submission, probe.digest and MATRIX.
expected_projection() uses the explicit predeclared vectors below, never a model.
"""
import ast
import copy
import hashlib
import importlib.util
import io
import json
from contextlib import redirect_stdout
from pathlib import Path
from types import SimpleNamespace
import unittest

import test_contract as base

ROOT = Path(__file__).resolve().parents[2]
PROBE_PATH = ROOT / "contracts/research_receipt_typed_probe.py"
FIXTURE_PATH = ROOT / "tests/fixtures/bradbury-typed-probe-input.json"
FIXTURE_SHA256 = "d83ad1fc3877a6dc72ff5f2719ab8ff3ce0abaf253d490a9d5c5551732ec7aa9"
module_spec = importlib.util.spec_from_file_location("research_receipt_typed_probe", PROBE_PATH)
probe = importlib.util.module_from_spec(module_spec)
module_spec.loader.exec_module(probe)
gl, UserError, Returned = base.gl, base.UserError, base.Returned

V = ["VALID"] * 4
F = ["FULFILLED"] * 4
S = ["SUPPORTED", "SCOPED_UNKNOWN", "SCOPED_UNKNOWN", "BOUNDARY_DISCLOSED"]
R = [[0, 1]] * 4
MATRIX = {
    "positive": {"validities": V, "statuses": S, "delivery": F, "refs": R, "verdict": "ACCEPTED"},
    "negative": {"validities": ["CONTRADICTED", *V[1:]], "statuses": ["CONTRADICTED", *S[1:]], "delivery": ["CONTRADICTED", *F[1:]], "refs": [[0], *R[1:]], "verdict": "NOT_ACCEPTED"},
    "strictUnknown": {"validities": V, "statuses": S, "delivery": ["FULFILLED", "FULFILLED", "INSUFFICIENT", "FULFILLED"], "refs": R, "verdict": "INSUFFICIENT_EVIDENCE"},
    "falseCautionOtherSource": {"validities": ["CONTRADICTED", *V[1:]], "statuses": ["CONTRADICTED", *S[1:]], "delivery": ["CONTRADICTED", *F[1:]], "refs": [[1], *R[1:]], "verdict": "NOT_ACCEPTED"},
    "unknownWithPromise": {"validities": ["VALID", "NOT_ESTABLISHED", "VALID", "VALID"], "statuses": ["SUPPORTED", "NOT_ESTABLISHED", "SCOPED_UNKNOWN", "BOUNDARY_DISCLOSED"], "delivery": ["FULFILLED", "INSUFFICIENT", "FULFILLED", "FULFILLED"], "refs": [[0, 1], [], [0, 1], [0, 1]], "verdict": "INSUFFICIENT_EVIDENCE"},
    "contradictionWithUnknown": {"validities": ["CONTRADICTED", *V[1:]], "statuses": ["CONTRADICTED", *S[1:]], "delivery": ["CONTRADICTED", *F[1:]], "refs": [[0], *R[1:]], "verdict": "NOT_ACCEPTED"},
    "boundaryIncomplete": {"validities": ["VALID", "VALID", "VALID", "NOT_ESTABLISHED"], "statuses": ["SUPPORTED", "SCOPED_UNKNOWN", "SCOPED_UNKNOWN", "NOT_ESTABLISHED"], "delivery": ["FULFILLED", "FULFILLED", "FULFILLED", "INSUFFICIENT"], "refs": [[0, 1], [0, 1], [0, 1], []], "verdict": "INSUFFICIENT_EVIDENCE"},
    "unknownAsFactual": {"validities": ["VALID", "VALID", "NOT_ESTABLISHED", "VALID"], "statuses": ["SUPPORTED", "SCOPED_UNKNOWN", "NOT_ESTABLISHED", "BOUNDARY_DISCLOSED"], "delivery": ["FULFILLED", "FULFILLED", "INSUFFICIENT", "FULFILLED"], "refs": [[0, 1], [0, 1], [], [0, 1]], "verdict": "INSUFFICIENT_EVIDENCE"},
    "falsePermissionsAsBoundary": {"reject_before_model": True},
}


def expected_projection(payload, case):
    row = MATRIX[case]
    if row.get("reject_before_model"):
        return None
    spec = probe.normalize_spec(probe.canonical(payload["spec"]))
    submission = probe.normalize_submission(probe.canonical(payload["submission"]), spec)
    checks, _ = probe.verified_inline_sources(submission, tuple(payload["materials"]))
    return {"verdict": row["verdict"], "source_checks": checks, "findings": [
        {"criterion_id": claim["criterion_id"], "claim_type": claim["claim_type"], "validity": row["validities"][index], "status": row["statuses"][index], "delivery_status": row["delivery"][index], "evidence_indices": row["refs"][index]}
        for index, claim in enumerate(submission["claims"])]}


class TypedProbeTests(unittest.TestCase):
    def setUp(self):
        self.fixture = json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))
        self.prompts, self.outputs, self.phase_calls = [], [], []
        self.gets = 0
        self.stdout = io.StringIO()

        def no_http(*args, **kwargs):
            self.gets += 1
            raise AssertionError("Typed probe must not perform HTTP")

        def model(prompt, *, response_format):
            self.assertEqual(response_format, "json")
            self.prompts.append(prompt)
            if not self.outputs:
                raise AssertionError("Unexpected model call")
            value = self.outputs.pop(0)
            if isinstance(value, Exception):
                raise value
            return copy.deepcopy(value)

        def run(leader, validator):
            before = len(self.prompts)
            value = leader()
            self.phase_calls.append(len(self.prompts) - before)
            before = len(self.prompts)
            accepted = validator(Returned(copy.deepcopy(value)))
            self.phase_calls.append(len(self.prompts) - before)
            if not accepted:
                raise UserError("Typed independent validator rejected leader")
            return value

        gl.nondet.web = SimpleNamespace(request=no_http)
        gl.nondet.exec_prompt = model
        gl.vm.run_nondet_default = run

    def normalized(self, case="positive", payload=None):
        value = payload or self.fixture[case]
        spec = probe.normalize_spec(probe.canonical(value["spec"]))
        submission = probe.normalize_submission(probe.canonical(value["submission"]), spec)
        return spec, submission, tuple(value["materials"])

    def queue_case(self, case="positive", times=1):
        row = MATRIX[case]
        for _ in range(times):
            self.outputs.extend({"validity": validity, "evidence_indices": refs, "reason": "Scripted typed validity, not a measured model judgment."} for validity, refs in zip(row["validities"], row["refs"]))

    def deploy_offline(self, case="positive", payload=None):
        with redirect_stdout(self.stdout):
            return probe.ResearchReceiptTypedProbe(json.dumps(payload or self.fixture[case], ensure_ascii=True))

    def independent(self, case="positive", payload=None):
        with redirect_stdout(self.stdout):
            return probe.independent_assessment(*self.normalized(case, payload))

    def test_frozen_nine_case_matrix_uses_explicit_new_schema_oracles(self):
        self.assertEqual(hashlib.sha256(FIXTURE_PATH.read_bytes()).hexdigest(), FIXTURE_SHA256)
        self.assertEqual(set(self.fixture), set(MATRIX))
        for case, row in MATRIX.items():
            with self.subTest(case=case):
                self.setUp()
                if row.get("reject_before_model"):
                    with self.assertRaisesRegex(UserError, "not allowed"):
                        self.deploy_offline(case)
                    self.assertEqual(self.prompts, [])
                else:
                    self.queue_case(case, times=2)
                    instance = self.deploy_offline(case)
                    receipt = json.loads(instance.get_receipt())
                    self.assertEqual(receipt["assessment"], expected_projection(self.fixture[case], case))
                    self.assertEqual(self.phase_calls, [4, 4])
                    self.assertEqual(len(self.prompts), 8)
                    self.assertNotIn("reason", receipt["assessment"]["findings"][0])
                    self.assertIn("reason", json.loads(instance.get_assessment())["findings"][0])
                self.assertEqual(self.gets, 0)
        # All validity outputs above are scripted. These tests do not predict LLM results.

    def test_unknown_reviews_both_actual_materials_despite_authors_narrow_citation(self):
        spec, submission, raw = self.normalized("falseCautionOtherSource")
        _, materials = probe.verified_inline_sources(submission, raw)
        claim = submission["claims"][0]
        self.assertEqual(claim["evidence_indices"], [0])
        prompt = probe.criterion_prompt(spec, submission, spec["criteria"][0], claim, materials)
        task = json.loads(prompt.split("EVIDENCE_JSON:\n", 1)[1])
        self.assertEqual([item["index"] for item in task["sources"]], [0, 1])
        self.assertEqual(task["sources"][1]["content"], raw[1])
        self.assertIn("return msg.sender;", task["sources"][1]["content"])
        self.assertIn("ALLOWED_EVIDENCE_INDICES_JSON: [0,1]", prompt)
        self.assertIn("Inspect ALL supplied verified materials", prompt)
        self.assertIn("Author-selected citations cannot hide an answer", prompt)

    def test_strict_and_allowed_unknown_have_byte_identical_four_prompts(self):
        prompts = []
        for case in ["positive", "strictUnknown"]:
            spec, submission, raw = self.normalized(case)
            _, materials = probe.verified_inline_sources(submission, raw)
            current = [probe.criterion_prompt(spec, submission, criterion, claim, materials) for criterion, claim in zip(spec["criteria"], submission["claims"])]
            self.assertTrue(all("evidence_requirement" not in prompt and "allowed_claim_types" not in prompt for prompt in current))
            prompts.append(current)
        self.assertEqual(prompts[0], prompts[1])

    def test_buyer_kind_and_allowed_types_cannot_be_downgraded_by_author(self):
        with self.assertRaisesRegex(UserError, "not allowed"):
            self.normalized("falsePermissionsAsBoundary")
        for fields in [
            {"verification_kind": "evidence_review", "allowed_claim_types": ["boundary_disclosure"]},
            {"verification_kind": "boundary_review", "allowed_claim_types": ["factual_assertion"]},
            {"verification_kind": "boundary_review", "allowed_claim_types": []},
            {"verification_kind": "arbitrary", "allowed_claim_types": ["factual_assertion"]},
        ]:
            value = copy.deepcopy(self.fixture["positive"])
            value["spec"]["criteria"][0].update(fields)
            with self.assertRaises(UserError):
                self.deploy_offline(payload=value)
        self.assertEqual(self.prompts, [])

    def test_type_only_change_changes_submission_hash_but_not_content_fingerprint(self):
        spec, original, _ = self.normalized()
        changed = copy.deepcopy(original)
        changed["claims"][0]["claim_type"] = "unknown_disclosure"
        changed = probe.normalize_submission(probe.canonical(changed), spec)
        self.assertNotEqual(probe.digest(original), probe.digest(changed))
        self.assertEqual(probe.content_fingerprint(original), probe.content_fingerprint(changed))

    def test_legal_reference_permutations_match_but_illegal_or_incomplete_scope_is_rejected(self):
        spec, submission, raw = self.normalized()
        _, materials = probe.verified_inline_sources(submission, raw)
        criterion, claim = spec["criteria"][1], submission["claims"][1]
        findings = []
        for refs in [[0, 1], [1, 0]]:
            value, error = probe.decode_model_finding({"validity": "VALID", "evidence_indices": refs, "reason": "Accurate complete scope."}, criterion, claim, submission, materials)
            self.assertEqual(error, "")
            findings.append(value)
        self.assertEqual(findings[0], findings[1])
        for refs in [[0], [0, 0], [2], [True], ["0"], [0.0], []]:
            value, error = probe.decode_model_finding({"validity": "VALID", "evidence_indices": refs, "reason": "Must not be repaired silently."}, criterion, claim, submission, materials)
            self.assertIsNone(value)
            self.assertTrue(error)
        value, error = probe.decode_model_finding({"validity": "CONTRADICTED", "evidence_indices": [1], "reason": "A direct counterexample in the other material."}, criterion, claim, submission, materials)
        self.assertEqual(error, "")
        self.assertEqual(value["evidence_indices"], [1])

    def test_scope_format_repair_is_global_once_and_preserves_original_validity(self):
        self.queue_case()
        self.outputs[1]["evidence_indices"] = [0]
        self.outputs.insert(2, {"validity": "VALID", "evidence_indices": [0, 1], "reason": "Same validity with complete scope."})
        result = self.independent()
        self.assertEqual(result["verdict"], "ACCEPTED")
        self.assertEqual(len(self.prompts), 5)
        self.assertIn("RR_TYPED_EVIDENCE_SCOPE_INCOMPLETE", self.prompts[2])
        self.assertIn("PRESERVE_VALIDITY: VALID", self.prompts[2])
        self.assertEqual(self.gets, 0)

    def test_format_repair_cannot_upgrade_negative_validity_or_resample_later_failures(self):
        spec, submission, raw = self.normalized()
        self.outputs = [
            {"validity": "CONTRADICTED", "evidence_indices": ["0"], "reason": "PRIVATE_FREE_TEXT_NOT_REPLAYED"},
            {"validity": "VALID", "evidence_indices": [0, 1], "reason": "Forbidden outcome change."},
        ]
        with self.assertRaisesRegex(UserError, "changed the original validity"):
            self.independent()
        self.assertEqual(len(self.prompts), 2)
        self.assertNotIn("PRIVATE_FREE_TEXT_NOT_REPLAYED", self.prompts[1])
        self.assertIn("PRESERVE_VALIDITY: CONTRADICTED", self.prompts[1])
        self.setUp()
        self.queue_case()
        invalid = {"validity": "VALID", "evidence_indices": ["0"], "reason": "Invalid citation."}
        self.outputs[0] = invalid
        self.outputs.insert(1, {"validity": "VALID", "evidence_indices": [0, 1], "reason": "First repair."})
        self.outputs[2] = invalid
        with self.assertRaisesRegex(UserError, "global repair budget"):
            self.independent()
        self.assertEqual(len(self.prompts), 3)

    def test_valid_negative_output_and_provider_errors_do_not_trigger_repair(self):
        self.queue_case("unknownWithPromise")
        result = self.independent("unknownWithPromise")
        self.assertEqual(result["verdict"], "INSUFFICIENT_EVIDENCE")
        self.assertEqual(len(self.prompts), 4)
        self.setUp()
        self.outputs = [OSError("Provider failed"), {"validity": "VALID", "evidence_indices": [0, 1], "reason": "Must not retry IO."}]
        with self.assertRaises(OSError):
            self.independent()
        self.assertEqual(len(self.prompts), 1)

    def test_bad_fixed_bytes_are_rejected_before_any_model_even_if_author_changes_hash(self):
        for change_commitment in [False, True]:
            value = copy.deepcopy(self.fixture["positive"])
            value["materials"][1] += "\n"
            if change_commitment:
                raw = value["materials"][1].encode("utf-8")
                value["submission"]["sources"][1].update(sha256=hashlib.sha256(raw).hexdigest(), byte_length=len(raw))
            with self.assertRaises(UserError):
                self.deploy_offline(payload=value)
        self.assertEqual(self.prompts, [])
        self.assertEqual(self.gets, 0)

    def test_validator_checks_types_derived_statuses_and_full_projection(self):
        def corrupt(leader, validator):
            self.assertFalse(validator({"calldata": {}}))
            real = leader()
            changed = copy.deepcopy(real)
            changed["findings"][3]["status"] = "SUPPORTED"
            self.assertFalse(validator(Returned(changed)))
            changed = copy.deepcopy(real)
            changed["findings"][0]["claim_type"] = "boundary_disclosure"
            self.assertFalse(validator(Returned(changed)))
            changed = copy.deepcopy(real)
            changed["findings"][0].update(validity="NOT_ESTABLISHED", status="NOT_ESTABLISHED", delivery_status="INSUFFICIENT", evidence_indices=[])
            changed["verdict"] = "INSUFFICIENT_EVIDENCE"
            self.assertFalse(validator(Returned(changed)))
            raise UserError("Typed mismatch rejected")
        gl.vm.run_nondet_default = corrupt
        self.queue_case(times=2)
        with self.assertRaisesRegex(UserError, "Typed mismatch"):
            self.deploy_offline()
        self.assertEqual(len(self.prompts), 8)

    def test_common_contradiction_priority_and_three_type_tasks_remain_explicit(self):
        spec, submission, raw = self.normalized()
        _, materials = probe.verified_inline_sources(submission, raw)
        prompts = [probe.criterion_prompt(spec, submission, criterion, claim, materials) for criterion, claim in zip(spec["criteria"], submission["claims"])]
        for prompt in prompts:
            self.assertIn("If ANY material assertion has clear opposing source evidence", prompt)
            self.assertIn("before considering missing coverage, unknowns or disclaimers", prompt)
            self.assertIn("When the typed assertion or disclosure itself cannot be established", prompt)
            self.assertIn("lack of evidence for an underlying fact does not refute a correctly scoped unknown disclosure", prompt)
        self.assertIn("A requested fact still reported as unknown cannot satisfy this type", prompts[0])
        self.assertIn("absence alone is NOT opposing evidence", prompts[2])
        self.assertIn("not invalid merely for being a disclaimer", prompts[3])
        self.assertIn("cannot replace another criterion", prompts[3])

    def test_marker_whitelist_exports_only_projection_counts_and_comparison(self):
        self.queue_case(times=2)
        self.deploy_offline()
        lines = self.stdout.getvalue().splitlines()
        self.assertEqual(len(lines), 3)
        markers = [json.loads(line.removeprefix("RR_TYPED_PROBE_JSON ")) for line in lines]
        for marker in markers[:2]:
            self.assertEqual(set(marker), {"probe_version", "phase", "stage", "projection", "model_calls", "format_repairs"})
            self.assertEqual(marker["phase"], "independent")
            self.assertEqual(marker["stage"], "complete")
            self.assertEqual(marker["model_calls"], 4)
            self.assertEqual(marker["format_repairs"], 0)
            self.assertNotIn("reason", probe.canonical(marker))
        self.assertEqual(markers[2], {"probe_version": probe.PROBE_VERSION, "phase": "validator", "stage": "comparison", "equal": True})

    def test_diagnostic_has_no_http_business_writes_or_abandonment_api(self):
        tree = ast.parse(PROBE_PATH.read_text(encoding="utf-8"))
        self.assertFalse(any(isinstance(node, ast.Attribute) and node.attr in {"web", "request", "write", "transfer", "send", "appeal"} for node in ast.walk(tree)))
        contract = next(node for node in tree.body if isinstance(node, ast.ClassDef))
        self.assertEqual([node.name for node in contract.body if isinstance(node, ast.FunctionDef)], ["__init__", "get_receipt", "get_assessment"])


if __name__ == "__main__":
    unittest.main()
