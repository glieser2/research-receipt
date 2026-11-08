"""Offline new-policy sufficiency controls; not retrospective success or accuracy."""
import ast
import copy
import hashlib
import importlib.util
import inspect
import io
import json
from contextlib import redirect_stdout
from pathlib import Path
from types import SimpleNamespace
import unittest

import test_contract as base
import test_structured_probe as structured

ROOT = Path(__file__).resolve().parents[2]
PROBE_PATH = ROOT / "contracts/research_receipt_sufficiency_probe.py"
FIXTURE_PATH = structured.FIXTURE_PATH
module_spec = importlib.util.spec_from_file_location("research_receipt_sufficiency_probe", PROBE_PATH)
probe = importlib.util.module_from_spec(module_spec)
module_spec.loader.exec_module(probe)
gl, UserError, Returned = base.gl, base.UserError, base.Returned


def scripted_outputs(payload, case):
    previous = structured.scripted_outputs(payload, case)
    claims = payload["submission"]["claims"]
    return [value if claim["claim_type"] == "unknown_disclosure" else {"result": "ESTABLISHED" if value["validity"] == "VALID" else "NOT_ESTABLISHED", "reason": "Scripted joint-basis sufficiency; no real model result."} for value, claim in zip(previous, claims)]


class SufficiencyProbeTests(unittest.TestCase):
    def setUp(self):
        self.fixture = json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))
        self.prompts, self.outputs, self.phase_calls = [], [], []
        self.stdout = io.StringIO()
        self.gets = 0
        def no_http(*args, **kwargs):
            self.gets += 1
            raise AssertionError("No source HTTP allowed")
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
                raise UserError("Sufficiency validator rejected leader")
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
            return probe.ResearchReceiptSufficiencyProbe(json.dumps(payload or self.fixture[case], ensure_ascii=True))

    def independent(self, case="positive"):
        with redirect_stdout(self.stdout):
            return probe.independent_assessment(*self.normalized(case))

    def test_reuses_frozen_fixture_with_new_policy_seven_controls_and_three_rejections(self):
        self.assertEqual(hashlib.sha256(FIXTURE_PATH.read_bytes()).hexdigest(), structured.FIXTURE_SHA256)
        for case, old in structured.MODEL_CASES.items():
            with self.subTest(case=case):
                self.setUp()
                self.queue(case, times=2)
                instance = self.deploy_offline(case)
                value = json.loads(instance.get_assessment())
                expected_statuses = ["NOT_ESTABLISHED" if case == "negative" and index == 0 else item for index, item in enumerate(old["statuses"])]
                expected_verdict = "INSUFFICIENT_EVIDENCE" if case == "negative" else old["verdict"]
                self.assertEqual([item["status"] for item in value["findings"]], expected_statuses)
                self.assertEqual(value["verdict"], expected_verdict)
                self.assertEqual(json.loads(instance.get_receipt())["assessment"], probe.stable_projection(value))
                self.assertEqual(self.phase_calls, [4, 4])
                self.assertEqual(self.gets, 0)
                for claim, finding in zip(self.normalized(case)[1]["claims"], value["findings"]):
                    if claim["claim_type"] != "unknown_disclosure":
                        self.assertEqual(finding["basis_scope_source_indices"], claim["evidence_indices"])
                        self.assertEqual(finding["evidence_indices"], [])
                        self.assertEqual(finding["field_checks"], [])
                        self.assertEqual(finding["scope_source_indices"], [])
                    else:
                        self.assertEqual(finding["basis_scope_source_indices"], [])
                        self.assertEqual(finding["scope_source_indices"], [0, 1])
        for case in structured.REJECT_CASES:
            self.setUp()
            with self.assertRaises(UserError):
                self.deploy_offline(case)
            self.assertEqual(self.prompts, [])

    def test_normalization_render_fingerprint_registry_and_unknown_code_are_verbatim(self):
        for name in ["normalize_spec", "normalize_submission", "render_claim_statement", "effective_claim_references", "content_fingerprint", "verified_inline_sources", "unknown_prompt", "decode_unknown_finding", "preserved_field_states"]:
            self.assertEqual(inspect.getsource(getattr(probe, name)), inspect.getsource(getattr(structured.probe, name)))
        self.assertEqual(probe.FIELD_REGISTRY, structured.probe.FIELD_REGISTRY)
        for case in structured.MODEL_CASES:
            spec, sub, _ = self.normalized(case)
            previous_spec = structured.probe.normalize_spec(probe.canonical(self.fixture[case]["spec"]))
            previous_sub = structured.probe.normalize_submission(probe.canonical(self.fixture[case]["submission"]), previous_spec)
            self.assertEqual((spec, sub), (previous_spec, previous_sub))
            self.assertEqual(probe.content_fingerprint(spec, sub), structured.probe.content_fingerprint(previous_spec, previous_sub))
            self.assertEqual(probe.normalize_submission(probe.canonical(sub), spec), sub)

    def test_unknown_finding_and_prompt_are_unchanged_except_empty_basis_field(self):
        for case in ["positive", "falseCautionOtherSource"]:
            spec, sub, raw = self.normalized(case)
            _, materials = probe.verified_inline_sources(sub, raw)
            responses = scripted_outputs(self.fixture[case], case)
            for criterion, claim, response in zip(spec["criteria"], sub["claims"], responses):
                if claim["claim_type"] == "unknown_disclosure":
                    self.assertEqual(probe.build_model_prompt(spec, sub, criterion, claim, materials), structured.probe.build_model_prompt(spec, sub, criterion, claim, materials))
                    actual, error = probe.decode_model_finding(response, criterion, claim, sub, materials)
                    old, old_error = structured.probe.decode_model_finding(response, criterion, claim, sub, materials)
                    self.assertEqual((error, old_error), ("", ""))
                    self.assertEqual(actual.pop("basis_scope_source_indices"), [])
                    self.assertEqual(actual, old)

    def test_joint_basis_is_code_derived_not_per_source_support_or_model_citations(self):
        spec, sub, raw = self.normalized()
        _, materials = probe.verified_inline_sources(sub, raw)
        criterion, claim = spec["criteria"][0], sub["claims"][0]
        for result in probe.REVIEW_RESULTS:
            finding, error = probe.decode_model_finding({"result": result, "reason": "Whole basis reviewed."}, criterion, claim, sub, materials)
            self.assertEqual(error, "")
            self.assertEqual(finding["basis_scope_source_indices"], [0, 1])
            self.assertEqual(finding["evidence_indices"], [])
            self.assertEqual(finding["validity"], result)
        for value in [
            {"result": "ESTABLISHED", "reason": "No model references.", "evidence_indices": [0]},
            {"validity": "CONTRADICTED", "reason": "Old label is not this policy."},
        ]:
            self.assertTrue(probe.decode_model_finding(value, criterion, claim, sub, materials)[1])
        prompt = probe.build_model_prompt(spec, sub, criterion, claim, materials)
        self.assertIn("BASIS AS A WHOLE", prompt)
        self.assertIn("NOT a claim that each source separately supports each assertion", prompt)
        self.assertIn("Do not select, add, remove or output citation indices", prompt)

    def test_strict_allowed_complete_four_prompts_are_byte_identical(self):
        prompts = []
        for case in ["positive", "strictUnknown"]:
            spec, sub, raw = self.normalized(case)
            _, materials = probe.verified_inline_sources(sub, raw)
            prompts.append([probe.build_model_prompt(spec, sub, criterion, claim, materials) for criterion, claim in zip(spec["criteria"], sub["claims"])])
        self.assertEqual(prompts[0], prompts[1])

    def test_legal_negative_result_is_immediately_used_without_outcome_retry(self):
        self.queue("negative")
        value = self.independent("negative")
        self.assertEqual(value["findings"][0]["validity"], "NOT_ESTABLISHED")
        self.assertEqual(value["findings"][0]["status"], "NOT_ESTABLISHED")
        self.assertEqual(value["verdict"], "INSUFFICIENT_EVIDENCE")
        self.assertEqual(len(self.prompts), 4)

    def test_repair_cannot_upgrade_legal_negative_result(self):
        self.outputs = [
            {"result": "NOT_ESTABLISHED", "reason": "MODEL_FREE_TEXT_NEVER_REPLAYED", "extra": True},
            {"result": "ESTABLISHED", "reason": "Forbidden outcome change."},
        ]
        with self.assertRaisesRegex(UserError, "changed original result"):
            self.independent()
        self.assertEqual(len(self.prompts), 2)
        self.assertIn("PRESERVE_RESULT: NOT_ESTABLISHED", self.prompts[1])
        self.assertNotIn("MODEL_FREE_TEXT_NEVER_REPLAYED", self.prompts[1])

    def test_global_repair_budget_and_found_state_preservation_are_not_weakened(self):
        self.queue()
        valid = copy.deepcopy(self.outputs[0])
        self.outputs[0]["extra"] = True
        self.outputs.insert(1, valid)
        self.outputs[2]["field_checks"][0]["evidence_indices"] = [0]
        with self.assertRaisesRegex(UserError, "global repair budget"):
            self.independent()
        self.assertEqual(len(self.prompts), 3)
        self.setUp()
        invalid = scripted_outputs(self.fixture["falseCautionOtherSource"], "falseCautionOtherSource")[0]
        invalid["field_checks"][0]["evidence_indices"] = ["1"]
        changed = copy.deepcopy(invalid)
        changed["field_checks"][0].update(state="NOT_ESTABLISHED", evidence_indices=[])
        self.outputs = [invalid, changed]
        with self.assertRaisesRegex(UserError, "changed original field state"):
            self.independent("falseCautionOtherSource")

    def test_provider_errors_do_not_retry_and_original_reason_boundary_remains(self):
        self.outputs = [OSError("Provider failure")]
        with self.assertRaises(OSError):
            self.independent()
        self.assertEqual(len(self.prompts), 1)
        spec, sub, raw = self.normalized()
        _, materials = probe.verified_inline_sources(sub, raw)
        for reason in ["a" * 150, "A multiline\nreason remains within bytes."]:
            value, error = probe.decode_model_finding({"result": "NOT_ESTABLISHED", "reason": reason}, spec["criteria"][0], sub["claims"][0], sub, materials)
            self.assertEqual(error, "")
            self.assertEqual(value["reason"], reason)
        self.assertTrue(probe.decode_model_finding({"result": "NOT_ESTABLISHED", "reason": "x" * 801}, spec["criteria"][0], sub["claims"][0], sub, materials)[1])

    def test_full_projection_cannot_hide_basis_or_sufficiency_difference(self):
        def corrupt(leader, validator):
            self.assertFalse(validator({"calldata": {}}))
            real = leader()
            bad_basis = copy.deepcopy(real)
            bad_basis["findings"][0]["basis_scope_source_indices"] = [1]
            self.assertFalse(validator(Returned(bad_basis)))
            bad_unknown = copy.deepcopy(real)
            bad_unknown["findings"][1]["basis_scope_source_indices"] = [0, 1]
            self.assertFalse(validator(Returned(bad_unknown)))
            changed = copy.deepcopy(real)
            changed["findings"][3].update(validity="NOT_ESTABLISHED", status="NOT_ESTABLISHED", delivery_status="INSUFFICIENT")
            self.assertEqual(changed["verdict"], real["verdict"])
            self.assertFalse(validator(Returned(changed)))
            raise UserError("Full sufficiency projection mismatch")
        gl.vm.run_nondet_default = corrupt
        self.queue("negative", times=2)
        with self.assertRaisesRegex(UserError, "projection mismatch"):
            self.deploy_offline("negative")
        self.assertEqual(len(self.prompts), 8)

    def test_bad_bytes_and_optional_policy_are_rejected_before_model(self):
        value = copy.deepcopy(self.fixture["positive"])
        value["materials"][1] += "\n"
        with self.assertRaises(UserError):
            self.deploy_offline(payload=value)
        value = copy.deepcopy(self.fixture["positive"])
        value["spec"]["criteria"][3]["required"] = False
        with self.assertRaisesRegex(UserError, "Optional-criterion"):
            self.deploy_offline(payload=value)
        self.assertEqual(self.prompts, [])
        self.assertEqual(self.gets, 0)

    def test_safety_markers_and_readonly_diagnostic_surface(self):
        self.queue(times=2)
        self.deploy_offline()
        markers = [json.loads(line.removeprefix("RR_SUFFICIENCY_PROBE_JSON ")) for line in self.stdout.getvalue().splitlines()]
        self.assertEqual(len(markers), 3)
        for marker in markers[:2]:
            self.assertEqual((marker["model_calls"], marker["format_repairs"]), (4, 0))
            self.assertIn("basis_scope_source_indices", marker["projection"]["findings"][0])
            self.assertNotIn("reason", probe.canonical(marker))
        self.assertEqual(markers[2]["equal"], True)
        tree = ast.parse(PROBE_PATH.read_text(encoding="utf-8"))
        self.assertFalse(any(isinstance(node, ast.Attribute) and node.attr in {"web", "request", "write", "transfer", "send", "appeal"} for node in ast.walk(tree)))
        contract = next(node for node in tree.body if isinstance(node, ast.ClassDef))
        self.assertEqual([node.name for node in contract.body if isinstance(node, ast.FunctionDef)], ["__init__", "get_receipt", "get_assessment"])


if __name__ == "__main__":
    unittest.main()
