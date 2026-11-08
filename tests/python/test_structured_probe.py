"""Structured-disclosure control-flow tests; scripted outputs, not LLM accuracy.

Pure planner access: import this module with tests/python on sys.path; use probe
normalizers/renderers/hash helpers. MODEL_CASES is an explicit offline oracle.
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
import test_typed_probe as typed_base

ROOT = Path(__file__).resolve().parents[2]
PROBE_PATH = ROOT / "contracts/research_receipt_structured_probe.py"
FIXTURE_PATH = ROOT / "tests/fixtures/bradbury-structured-probe-input.json"
FIXTURE_SHA256 = "73703b4f60883ae6c51eeca9dd42a4dc945e97d020d88e6616af10679982b0d9"
module_spec = importlib.util.spec_from_file_location("research_receipt_structured_probe", PROBE_PATH)
probe = importlib.util.module_from_spec(module_spec)
module_spec.loader.exec_module(probe)
gl, UserError, Returned = base.gl, base.UserError, base.Returned

MODEL_CASES = {
    "positive": {"generic": {"permissions": ("VALID", [0, 1]), "limitations": ("VALID", [0, 1])}, "verdict": "ACCEPTED", "statuses": ["SUPPORTED", "SCOPED_UNKNOWN", "SCOPED_UNKNOWN", "BOUNDARY_DISCLOSED"]},
    "negative": {"generic": {"permissions": ("CONTRADICTED", [0]), "limitations": ("VALID", [0, 1])}, "verdict": "NOT_ACCEPTED", "statuses": ["CONTRADICTED", "SCOPED_UNKNOWN", "SCOPED_UNKNOWN", "BOUNDARY_DISCLOSED"]},
    "strictUnknown": {"generic": {"permissions": ("VALID", [0, 1]), "limitations": ("VALID", [0, 1])}, "verdict": "INSUFFICIENT_EVIDENCE", "statuses": ["SUPPORTED", "SCOPED_UNKNOWN", "SCOPED_UNKNOWN", "BOUNDARY_DISCLOSED"]},
    "falseCautionOtherSource": {"generic": {"limitations": ("VALID", [0, 1])}, "found": {"default_context_sender": [1]}, "verdict": "NOT_ACCEPTED", "statuses": ["CONTRADICTED", "SCOPED_UNKNOWN", "SCOPED_UNKNOWN", "BOUNDARY_DISCLOSED"]},
    "unsupportedPromiseAsFactual": {"generic": {"permissions": ("VALID", [0, 1]), "withdrawals": ("NOT_ESTABLISHED", []), "limitations": ("VALID", [0, 1])}, "verdict": "INSUFFICIENT_EVIDENCE", "statuses": ["SUPPORTED", "NOT_ESTABLISHED", "SCOPED_UNKNOWN", "BOUNDARY_DISCLOSED"]},
    "boundaryIncomplete": {"generic": {"permissions": ("VALID", [0, 1]), "limitations": ("NOT_ESTABLISHED", [])}, "verdict": "INSUFFICIENT_EVIDENCE", "statuses": ["SUPPORTED", "SCOPED_UNKNOWN", "SCOPED_UNKNOWN", "NOT_ESTABLISHED"]},
    "unknownAsFactual": {"generic": {"permissions": ("VALID", [0, 1]), "audit": ("NOT_ESTABLISHED", []), "limitations": ("VALID", [0, 1])}, "verdict": "INSUFFICIENT_EVIDENCE", "statuses": ["SUPPORTED", "SCOPED_UNKNOWN", "NOT_ESTABLISHED", "BOUNDARY_DISCLOSED"]},
}
REJECT_CASES = ("legacyUnknownWithPromise", "extraPromiseField", "unboundBodyPromise")


def scripted_outputs(payload, case):
    spec = probe.normalize_spec(probe.canonical(payload["spec"]))
    submission = probe.normalize_submission(probe.canonical(payload["submission"]), spec)
    oracle = MODEL_CASES[case]
    result = []
    for criterion, claim in zip(spec["criteria"], submission["claims"]):
        if claim["claim_type"] == "unknown_disclosure":
            result.append({"field_checks": [{"field_id": field_id, "state": "FOUND" if field_id in oracle.get("found", {}) else "NOT_ESTABLISHED", "evidence_indices": oracle.get("found", {}).get(field_id, [])} for field_id in criterion["requested_field_ids"]], "reason": "Scripted field extraction, not a measured model result."})
        else:
            validity, refs = oracle["generic"][criterion["id"]]
            result.append({"validity": validity, "evidence_indices": refs, "reason": "Scripted typed control, not a measured model result."})
    return result


class StructuredProbeTests(unittest.TestCase):
    def setUp(self):
        self.fixture = json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))
        self.prompts, self.outputs, self.phase_calls = [], [], []
        self.gets = 0
        self.stdout = io.StringIO()
        def no_http(*args, **kwargs):
            self.gets += 1
            raise AssertionError("Structured probe must never use HTTP")
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
                raise UserError("Structured independent validator rejected leader")
            return value
        gl.nondet.web = SimpleNamespace(request=no_http)
        gl.nondet.exec_prompt = model
        gl.vm.run_nondet_default = run

    def normalized(self, case="positive", payload=None):
        value = payload or self.fixture[case]
        spec = probe.normalize_spec(probe.canonical(value["spec"]))
        sub = probe.normalize_submission(probe.canonical(value["submission"]), spec)
        return spec, sub, tuple(value["materials"])

    def queue(self, case="positive", times=1):
        for _ in range(times):
            self.outputs.extend(scripted_outputs(self.fixture[case], case))

    def deploy_offline(self, case="positive", payload=None):
        with redirect_stdout(self.stdout):
            return probe.ResearchReceiptStructuredProbe(json.dumps(payload or self.fixture[case], ensure_ascii=True))

    def independent(self, case="positive"):
        with redirect_stdout(self.stdout):
            return probe.independent_assessment(*self.normalized(case))

    def test_frozen_ten_case_matrix_separates_seven_controls_from_three_schema_rejections(self):
        self.assertEqual(hashlib.sha256(FIXTURE_PATH.read_bytes()).hexdigest(), FIXTURE_SHA256)
        self.assertEqual(set(self.fixture), set(MODEL_CASES) | set(REJECT_CASES))
        for case, expected in MODEL_CASES.items():
            with self.subTest(case=case):
                self.setUp()
                self.queue(case, times=2)
                instance = self.deploy_offline(case)
                assessment = json.loads(instance.get_assessment())
                receipt = json.loads(instance.get_receipt())
                self.assertEqual(assessment["verdict"], expected["verdict"])
                self.assertEqual([item["status"] for item in assessment["findings"]], expected["statuses"])
                self.assertEqual(receipt["assessment"], probe.stable_projection(assessment))
                self.assertEqual(self.phase_calls, [4, 4])
                self.assertEqual(self.gets, 0)
        for case in REJECT_CASES:
            with self.subTest(case=case):
                self.setUp()
                with self.assertRaises(UserError):
                    self.deploy_offline(case)
                self.assertEqual(self.prompts, [])
                self.assertEqual(self.gets, 0)
        # Scripted classifications prove control flow, never real-model accuracy.

    def test_normalization_is_idempotent_and_unknown_records_have_only_four_keys(self):
        for case in MODEL_CASES:
            spec, sub, _ = self.normalized(case)
            self.assertEqual(probe.normalize_spec(probe.canonical(spec)), spec)
            self.assertEqual(probe.normalize_submission(probe.canonical(sub), spec), sub)
            self.assertEqual(sub["report_body"], "\n".join(probe.render_claim_statement(spec, claim) for claim in sub["claims"]))
            for claim in sub["claims"]:
                if claim["claim_type"] == "unknown_disclosure":
                    self.assertEqual(set(claim), {"criterion_id", "claim_type", "scope", "disclosure_version"})

    def test_unknown_input_extra_prose_or_references_are_rejected_not_cleaned(self):
        for key, value in [("statement", "Users can exit instantly."), ("notes", "Promise"), ("evidence_indices", [0, 1]), ("unknown_field_ids", ["audit_version"]), ("guarantee", True)]:
            payload = copy.deepcopy(self.fixture["positive"])
            payload["submission"]["claims"][1][key] = value
            with self.assertRaises(UserError):
                self.deploy_offline(payload=payload)
        self.assertEqual(self.prompts, [])
        self.assertEqual(self.gets, 0)

    def test_buyer_fields_use_code_registry_and_cannot_be_missing_duplicated_or_misassigned(self):
        for fields in [[], ["audit_version", "audit_version"], ["free_question"], ["default_context_sender"]]:
            payload = copy.deepcopy(self.fixture["positive"])
            payload["spec"]["criteria"][2]["requested_field_ids"] = fields
            with self.assertRaises(UserError):
                self.deploy_offline(payload=payload)
        payload = copy.deepcopy(self.fixture["positive"])
        payload["spec"]["criteria"][2]["requested_fields"] = [{"id": "audit_version", "question": "Guarantee returns"}]
        with self.assertRaises(UserError):
            self.deploy_offline(payload=payload)
        self.assertEqual(self.prompts, [])

    def test_unknown_prompt_is_extraction_without_author_conclusion_and_contains_all_sources(self):
        spec, sub, raw = self.normalized("falseCautionOtherSource")
        _, materials = probe.verified_inline_sources(sub, raw)
        criterion, claim = spec["criteria"][0], sub["claims"][0]
        prompt = probe.build_model_prompt(spec, sub, criterion, claim, materials)
        task = json.loads(prompt.split("EVIDENCE_JSON:\n", 1)[1])
        self.assertEqual(set(task), {"criterion_id", "requested_fields", "scope_source_indices", "sources"})
        self.assertEqual(task["scope_source_indices"], [0, 1])
        self.assertEqual(task["requested_fields"], [{"field_id": "default_context_sender", "question": probe.FIELD_REGISTRY["default_context_sender"]["question"]}])
        self.assertEqual(task["sources"][1]["content"], raw[1])
        self.assertIn("return msg.sender;", task["sources"][1]["content"])
        self.assertNotIn(probe.render_claim_statement(spec, claim), prompt)
        for forbidden in ["unknown_disclosure", "evidence_requirement", "disclosure_version", "allowed_claim_types"]:
            self.assertNotIn(forbidden, prompt)

    def test_strict_and_allowed_unknown_have_identical_complete_four_prompts(self):
        prompts = []
        for case in ["positive", "strictUnknown"]:
            spec, sub, raw = self.normalized(case)
            _, materials = probe.verified_inline_sources(sub, raw)
            prompts.append([probe.build_model_prompt(spec, sub, criterion, claim, materials) for criterion, claim in zip(spec["criteria"], sub["claims"])])
        self.assertEqual(prompts[0], prompts[1])

    def test_fact_and_boundary_prompt_paths_remain_frozen_typed_tasks(self):
        spec, sub, raw = self.normalized()
        _, materials = probe.verified_inline_sources(sub, raw)
        for index in [0, 3]:
            actual = probe.build_model_prompt(spec, sub, spec["criteria"][index], sub["claims"][index], materials)
            expected = typed_base.probe.criterion_prompt(spec, sub, spec["criteria"][index], sub["claims"][index], materials)
            self.assertEqual(actual, expected)

    def test_content_fingerprint_uses_effective_content_and_ignores_type_only_relabel(self):
        spec, original, _ = self.normalized()
        changed = copy.deepcopy(original)
        unknown = changed["claims"][2]
        changed["claims"][2] = {"criterion_id": "audit", "claim_type": "factual_assertion", "statement": probe.render_claim_statement(spec, unknown), "evidence_indices": probe.effective_claim_references(original, unknown)}
        changed = probe.normalize_submission(probe.canonical(changed), spec)
        self.assertNotEqual(probe.digest(original), probe.digest(changed))
        self.assertEqual(probe.content_fingerprint(spec, original), probe.content_fingerprint(spec, changed))

    def test_unknown_empty_citations_require_complete_verified_scope_and_all_field_checks(self):
        spec, sub, raw = self.normalized()
        _, materials = probe.verified_inline_sources(sub, raw)
        criterion, claim = spec["criteria"][2], sub["claims"][2]
        output = scripted_outputs(self.fixture["positive"], "positive")[2]
        finding, error = probe.decode_model_finding(output, criterion, claim, sub, materials)
        self.assertEqual(error, "")
        self.assertEqual(finding["status"], "SCOPED_UNKNOWN")
        self.assertEqual(finding["evidence_indices"], [])
        self.assertEqual(finding["scope_source_indices"], [0, 1])
        missing_scope, missing_error = probe.decode_model_finding(output, criterion, claim, sub, {0: materials[0]})
        self.assertIsNone(missing_scope)
        self.assertEqual(missing_error, "RR_STRUCTURED_SCOPE_NOT_VERIFIED")
        for mutate in [lambda value: value["field_checks"].pop(), lambda value: value["field_checks"].reverse(), lambda value: value["field_checks"][0].update(evidence_indices=[0]), lambda value: value["field_checks"][0].update(state="FOUND", evidence_indices=[])]:
            changed = copy.deepcopy(output)
            mutate(changed)
            value, error = probe.decode_model_finding(changed, criterion, claim, sub, materials)
            self.assertIsNone(value)
            self.assertTrue(error)
        fact, error = probe.decode_model_finding({"validity": "VALID", "evidence_indices": [], "reason": "Cannot use unknown's exception."}, spec["criteria"][0], sub["claims"][0], sub, materials)
        self.assertIsNone(fact)
        self.assertTrue(error)

    def test_found_actual_references_are_sorted_strict_and_drive_contradiction(self):
        spec, sub, raw = self.normalized("falseCautionOtherSource")
        _, materials = probe.verified_inline_sources(sub, raw)
        output = scripted_outputs(self.fixture["falseCautionOtherSource"], "falseCautionOtherSource")[0]
        finding, error = probe.decode_model_finding(output, spec["criteria"][0], sub["claims"][0], sub, materials)
        self.assertEqual(error, "")
        self.assertEqual(finding["status"], "CONTRADICTED")
        self.assertEqual(finding["evidence_indices"], [1])
        for refs in [[True], ["1"], [1.0], [2], [1, 1]]:
            changed = copy.deepcopy(output)
            changed["field_checks"][0]["evidence_indices"] = refs
            self.assertTrue(probe.decode_model_finding(changed, spec["criteria"][0], sub["claims"][0], sub, materials)[1])
        values = []
        for refs in [[0, 1], [1, 0]]:
            changed = copy.deepcopy(output)
            changed["field_checks"][0]["evidence_indices"] = refs
            values.append(probe.decode_model_finding(changed, spec["criteria"][0], sub["claims"][0], sub, materials)[0])
        self.assertEqual(values[0], values[1])

    def test_repair_preserves_found_state_and_cannot_turn_it_into_absence(self):
        self.queue("falseCautionOtherSource")
        valid = copy.deepcopy(self.outputs[0])
        self.outputs[0]["field_checks"][0]["evidence_indices"] = ["1"]
        self.outputs.insert(1, valid)
        result = self.independent("falseCautionOtherSource")
        self.assertEqual(result["verdict"], "NOT_ACCEPTED")
        self.assertEqual(len(self.prompts), 5)
        self.assertIn('"state":"FOUND"', self.prompts[1])
        self.setUp()
        invalid = scripted_outputs(self.fixture["falseCautionOtherSource"], "falseCautionOtherSource")[0]
        invalid["field_checks"][0]["evidence_indices"] = ["1"]
        changed = copy.deepcopy(invalid)
        changed["field_checks"][0].update(state="NOT_ESTABLISHED", evidence_indices=[])
        self.outputs = [invalid, changed]
        with self.assertRaisesRegex(UserError, "changed original field state"):
            self.independent("falseCautionOtherSource")
        self.assertEqual(len(self.prompts), 2)

    def test_global_repair_budget_and_provider_error_policy_are_unchanged(self):
        self.queue()
        valid = copy.deepcopy(self.outputs[0])
        self.outputs[0]["evidence_indices"] = ["0"]
        self.outputs.insert(1, valid)
        self.outputs[2]["field_checks"][0]["evidence_indices"] = [0]
        with self.assertRaisesRegex(UserError, "global repair budget"):
            self.independent()
        self.assertEqual(len(self.prompts), 3)
        self.setUp()
        self.outputs = [OSError("Provider unavailable")]
        with self.assertRaises(OSError):
            self.independent()
        self.assertEqual(len(self.prompts), 1)

    def test_bad_bytes_reject_before_model_and_sources_are_not_author_selected(self):
        payload = copy.deepcopy(self.fixture["positive"])
        payload["materials"][1] += "\n"
        with self.assertRaises(UserError):
            self.deploy_offline(payload=payload)
        payload["submission"]["sources"][1].update(sha256=hashlib.sha256(payload["materials"][1].encode()).hexdigest(), byte_length=len(payload["materials"][1].encode()))
        with self.assertRaises(UserError):
            self.deploy_offline(payload=payload)
        self.assertEqual(self.prompts, [])
        self.assertEqual(self.gets, 0)

    def test_full_projection_rejects_forged_field_state_even_if_overall_verdict_stays_negative(self):
        def corrupt(leader, validator):
            self.assertFalse(validator({"calldata": {}}))
            real = leader()
            bad_scope = copy.deepcopy(real)
            bad_scope["findings"][1]["scope_source_indices"] = []
            self.assertFalse(validator(Returned(bad_scope)))
            changed = copy.deepcopy(real)
            audit = changed["findings"][2]
            audit["field_checks"][0].update(state="FOUND", evidence_indices=[0])
            audit.update(validity="CONTRADICTED", status="CONTRADICTED", delivery_status="CONTRADICTED", evidence_indices=[0])
            self.assertEqual(changed["verdict"], real["verdict"])
            self.assertFalse(validator(Returned(changed)))
            raise UserError("Structured projection mismatch")
        gl.vm.run_nondet_default = corrupt
        self.queue("negative", times=2)
        with self.assertRaisesRegex(UserError, "projection mismatch"):
            self.deploy_offline("negative")
        self.assertEqual(len(self.prompts), 8)

    def test_markers_include_field_scope_projection_and_no_prose_or_material(self):
        self.queue(times=2)
        self.deploy_offline()
        lines = self.stdout.getvalue().splitlines()
        self.assertEqual(len(lines), 3)
        markers = [json.loads(line.removeprefix("RR_STRUCTURED_PROBE_JSON ")) for line in lines]
        for item in markers[:2]:
            self.assertEqual(set(item), {"probe_version", "phase", "stage", "projection", "model_calls", "format_repairs"})
            self.assertEqual((item["model_calls"], item["format_repairs"]), (4, 0))
            self.assertIn("field_checks", item["projection"]["findings"][1])
            self.assertNotIn("reason", probe.canonical(item))
        self.assertEqual(markers[2]["equal"], True)

    def test_only_read_receipts_no_http_business_mutation_or_abandonment(self):
        tree = ast.parse(PROBE_PATH.read_text(encoding="utf-8"))
        self.assertFalse(any(isinstance(node, ast.Attribute) and node.attr in {"web", "request", "write", "send", "transfer", "appeal"} for node in ast.walk(tree)))
        contract = next(node for node in tree.body if isinstance(node, ast.ClassDef))
        self.assertEqual([node.name for node in contract.body if isinstance(node, ast.FunctionDef)], ["__init__", "get_receipt", "get_assessment"])


if __name__ == "__main__":
    unittest.main()
