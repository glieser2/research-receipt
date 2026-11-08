"""Deterministic plumbing tests, NOT model accuracy or a semantic matrix oracle.

The legacy report fixture may require scope clarification; all provider booleans
here are controlled test inputs. No network, GenVM deployment, or LLM runs occur.
"""
import contextlib
import copy
import hashlib
import importlib.util
import io
import json
from pathlib import Path
from types import SimpleNamespace
import unittest
import test_contract as base

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("candidate_probe", ROOT / "contracts/research_receipt_candidate_probe.py")
probe = importlib.util.module_from_spec(spec)
spec.loader.exec_module(probe)


class CandidateProbeTests(unittest.TestCase):
    def setUp(self):
        fixture = json.loads((ROOT / "tests/fixtures/candidate-validation-structural.json").read_text(encoding="utf-8"))
        self.spec = probe.normalize_spec(json.dumps(fixture["spec"]))
        self.submission = probe.normalize_submission(json.dumps(fixture["positive"]), self.spec)
        self.body = (ROOT / "tests/fixtures/ownable-3e6c8639.sol").read_bytes()
        self.assertEqual(hashlib.sha256(self.body).hexdigest(), self.submission["sources"][0]["sha256"])
        self.assertEqual(len(self.body), 3102)
        self.ids = [row["id"] for row in self.spec["criteria"]]
        self.candidate = {"findings": [{"criterion_id": item, "status": "SUPPORTED", "evidence_indices": [0], "reason": "Diagnostic seed; not sent to the verifier model."} for item in self.ids], "source_checks": [{"index": 0, "status": "VERIFIED", "sha256": hashlib.sha256(self.body).hexdigest()}], "verdict": "ACCEPTED"}
        self.prompts = []
        self.fetches = []
        self.responses = []
        self.all_true = {"checks": [{"criterion_id": item, "matches": True} for item in self.ids]}
        def fetch(url, *, method):
            self.fetches.append((url, method))
            return SimpleNamespace(status=200, body=self.body)
        def prompt(value, response_format=None):
            self.prompts.append(value)
            self.assertEqual(response_format, "json")
            response = self.responses.pop(0) if self.responses else self.all_true
            if isinstance(response, Exception):
                raise response
            return copy.deepcopy(response)
        base.gl.nondet.web = SimpleNamespace(request=fetch)
        base.gl.nondet.exec_prompt = prompt

    def verify(self, candidate=None, submission=None):
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            result = probe.cv_verify(self.spec, submission or self.submission, candidate or self.candidate, "C1")
        events = [json.loads(line[len("RR_CANDIDATE_JSON "):]) for line in output.getvalue().splitlines() if line.startswith("RR_CANDIDATE_JSON ")]
        return result, events

    def test_complete_boolean_agreement_uses_one_batched_call(self):
        result, events = self.verify()
        self.assertIs(result, True)
        self.assertEqual(len(self.prompts), 1)
        self.assertEqual(len(self.fetches), 1)
        self.assertEqual(events[-1]["model_calls"], 1)
        self.assertEqual(events[-1]["checks"], self.all_true["checks"])

    def test_valid_false_is_terminal_without_format_repair(self):
        response = copy.deepcopy(self.all_true)
        response["checks"][0]["matches"] = False
        self.responses = [response, self.all_true]
        result, events = self.verify()
        self.assertIs(result, False)
        self.assertEqual(len(self.prompts), 1)
        self.assertEqual(events[-1]["format_repairs"], 0)

    def test_out_of_bounds_candidate_rejects_before_model_or_fetch(self):
        self.candidate["findings"][0]["evidence_indices"] = [99]
        result, events = self.verify()
        self.assertIs(result, False)
        self.assertEqual(self.prompts, [])
        self.assertEqual(self.fetches, [])
        self.assertEqual(events[-1]["code"], "RR_CANDIDATE_REFERENCE_INVALID")

    def test_insufficient_empty_refs_still_supplies_all_claim_material(self):
        self.candidate["findings"][0].update(status="INSUFFICIENT_EVIDENCE", evidence_indices=[])
        self.candidate["verdict"] = "INSUFFICIENT_EVIDENCE"
        self.verify()
        task = json.loads(self.prompts[0].split("VERIFICATION_INPUT_JSON:\n", 1)[1])
        row = task["criteria_to_verify"][0]
        self.assertEqual(row["candidate"]["evidence_indices"], [])
        self.assertEqual(row["verification_material_indices"], [0])
        self.assertEqual(task["independently_verified_sources"][0]["content"].encode("utf-8"), self.body)
        self.assertEqual(len(task["criteria_to_verify"]), 4)

    def test_leader_reason_and_overall_verdict_never_enter_model_payload(self):
        for row in self.candidate["findings"]:
            row["reason"] = "LEADER_REASON_SENTINEL_DO_NOT_SEND"
        self.verify()
        self.assertNotIn("LEADER_REASON_SENTINEL_DO_NOT_SEND", self.prompts[0])
        task = json.loads(self.prompts[0].split("VERIFICATION_INPUT_JSON:\n", 1)[1])
        self.assertNotIn("verdict", task)
        for row in task["criteria_to_verify"]:
            self.assertEqual(set(row["candidate"]), {"status", "evidence_indices"})

    def test_missing_duplicate_extra_nonboolean_and_reordered_checks_fail_schema(self):
        malformed = [
            {"checks": self.all_true["checks"][:-1]},
            {"checks": [self.all_true["checks"][0]] * 4},
            {"checks": self.all_true["checks"], "extra": True},
            {"checks": [{"criterion_id": item, "matches": 1} for item in self.ids]},
            {"checks": list(reversed(self.all_true["checks"]))},
        ]
        for value in malformed:
            with self.subTest(value=value):
                checks, code = probe.cv_decode(value, self.ids)
                self.assertIsNone(checks)
                self.assertTrue(code)

    def test_only_one_global_format_repair_and_no_previous_output_injection(self):
        self.responses = ["PREVIOUS_OUTPUT_SENTINEL", self.all_true]
        result, events = self.verify()
        self.assertIs(result, True)
        self.assertEqual(len(self.prompts), 2)
        self.assertNotIn("PREVIOUS_OUTPUT_SENTINEL", self.prompts[1])
        self.assertTrue(self.prompts[1].startswith(self.prompts[0]))
        self.assertEqual(events[-1]["format_repairs"], 1)
        self.prompts.clear()
        self.responses = [{"bad": 1}, {"still_bad": 2}, self.all_true]
        result, events = self.verify()
        self.assertIs(result, False)
        self.assertEqual(len(self.prompts), 2)

    def test_model_io_is_not_retried(self):
        self.responses = [RuntimeError("not printed"), self.all_true]
        result, events = self.verify()
        self.assertIs(result, False)
        self.assertEqual(len(self.prompts), 1)
        self.assertEqual(events[-1]["stage"], "model_io_or_execution_error")

    def test_source_io_is_not_retried_or_counted_as_semantic_verification(self):
        def broken(url, *, method):
            self.fetches.append((url, method))
            raise RuntimeError("not printed")
        base.gl.nondet.web.request = broken
        result, events = self.verify()
        self.assertIs(result, False)
        self.assertEqual(len(self.fetches), 1)
        self.assertEqual(self.prompts, [])
        self.assertEqual(events[-1]["stage"], "sources_mismatch")

    def test_deterministic_missing_rows_are_fully_covered_without_a_model(self):
        submission = copy.deepcopy(self.submission)
        submission.update(sources=[], claims=[])
        candidate = {"findings": [{"criterion_id": item, "status": "INSUFFICIENT_EVIDENCE", "evidence_indices": [], "reason": "No submitted claim."} for item in self.ids], "source_checks": [], "verdict": "INSUFFICIENT_EVIDENCE"}
        result, events = self.verify(candidate, submission)
        self.assertIs(result, True)
        self.assertEqual(self.prompts, [])
        coverage = next(item for item in events if item["stage"] == "coverage")
        self.assertEqual(coverage["deterministic_ids"], self.ids)
        candidate["verdict"] = "ACCEPTED"
        self.assertIs(self.verify(candidate, submission)[0], False)

    def test_hash_mismatch_requires_insufficient_rows_and_no_model(self):
        submission = copy.deepcopy(self.submission)
        submission["sources"][0]["sha256"] = "0" * 64
        candidate = {"findings": [{"criterion_id": item, "status": "INSUFFICIENT_EVIDENCE", "evidence_indices": [], "reason": "Hash mismatch."} for item in self.ids], "source_checks": [{"index": 0, "status": "HASH_MISMATCH", "sha256": hashlib.sha256(self.body).hexdigest()}], "verdict": "INSUFFICIENT_EVIDENCE"}
        result, events = self.verify(candidate, submission)
        self.assertIs(result, True)
        self.assertEqual(self.prompts, [])

    def test_candidate_id_order_and_aggregate_cannot_be_forged(self):
        candidate = copy.deepcopy(self.candidate)
        candidate["findings"][0], candidate["findings"][1] = candidate["findings"][1], candidate["findings"][0]
        self.assertIs(self.verify(candidate)[0], False)
        self.assertEqual(self.prompts, [])
        candidate = copy.deepcopy(self.candidate)
        candidate["verdict"] = "NOT_ACCEPTED"
        self.assertIs(self.verify(candidate)[0], False)


if __name__ == "__main__":
    unittest.main()
