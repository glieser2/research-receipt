"""Compact artifact equivalence under offline stubs, not VM/semantic proof.

Eleven original behavior tests run against the artifact. The original twelfth
test's inspect.getsource verbatim assertion is deliberately NOT run: whitespace
changes are the purpose of this artifact. Full AST/constants and explicit
normalizer/hash/prompt/receipt equivalence replace that textual assertion.
"""
import ast
import copy
import hashlib
import importlib.util
import inspect
import json
from pathlib import Path
from unittest.mock import patch

import test_sufficiency_probe as original

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "contracts/research_receipt_sufficiency_probe.py"
COMPACT = ROOT / "contracts/research_receipt_sufficiency_probe_compact.py"
GENERATOR = ROOT / "scripts/generate-compact-probe.py"
FROZEN = original.probe


def load_module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


artifact = load_module("research_receipt_sufficiency_probe_compact", COMPACT)
generator = load_module("generate_compact_probe", GENERATOR)


class CompactProbeTests(original.SufficiencyProbeTests):
    # Explicitly inapplicable, not counted or reported as a passing text test.
    test_normalization_render_fingerprint_registry_and_unknown_code_are_verbatim = None

    def setUp(self):
        for name, value in [("probe", artifact), ("PROBE_PATH", COMPACT)]:
            context = patch.object(original, name, value)
            context.start()
            self.addCleanup(context.stop)
        super().setUp()

    def normalized_with(self, module, case):
        payload = self.fixture[case]
        spec = module.normalize_spec(module.canonical(payload["spec"]))
        sub = module.normalize_submission(module.canonical(payload["submission"]), spec)
        return spec, sub, tuple(payload["materials"])

    def test_full_type_comment_ast_and_runner_bytes_are_equal(self):
        raw, compact = SOURCE.read_bytes(), COMPACT.read_bytes()
        self.assertEqual(hashlib.sha256(raw).hexdigest(), generator.SOURCE_SHA256)
        self.assertEqual(raw.splitlines(keepends=True)[:2], compact.splitlines(keepends=True)[:2])
        self.assertEqual(generator.tree_dump(raw.decode("utf-8")), generator.tree_dump(compact.decode("utf-8")))
        self.assertEqual(generator.compact_source(raw), compact)
        self.assertLess(len(compact), len(raw))
        self.assertEqual(generator.source_dependency_check(raw)["source_line_introspection_dependency_hits"], [])
        compile(compact, str(COMPACT), "exec")

    def test_all_ordered_str_bytes_constants_and_exact_utf8_are_equal(self):
        before = generator.ordered_constants(SOURCE.read_text(encoding="utf-8"))
        after = generator.ordered_constants(COMPACT.read_text(encoding="utf-8"))
        self.assertEqual(before, after)
        self.assertTrue(before)
        for kind, value, data in after:
            if kind == "str":
                self.assertEqual(value.encode("utf-8"), bytes.fromhex(data))
            else:
                self.assertEqual(bytes.fromhex(value), bytes.fromhex(data))

    def test_original_verbatim_source_assertion_is_inapplicable_and_replaced(self):
        self.assertIsNone(type(self).test_normalization_render_fingerprint_registry_and_unknown_code_are_verbatim)
        self.assertNotEqual(inspect.getsource(FROZEN.normalize_submission), inspect.getsource(artifact.normalize_submission))
        for name in ["normalize_spec", "normalize_submission", "render_claim_statement", "effective_claim_references", "content_fingerprint", "verified_inline_sources", "unknown_prompt", "decode_unknown_finding", "preserved_field_states"]:
            self.assertEqual(generator.tree_dump(inspect.getsource(getattr(FROZEN, name))), generator.tree_dump(inspect.getsource(getattr(artifact, name))))

    def test_seven_normalizers_render_body_hash_fingerprint_and_four_prompts_equal(self):
        for case in original.structured.MODEL_CASES:
            with self.subTest(case=case):
                spec, sub, raw = self.normalized_with(FROZEN, case)
                other_spec, other_sub, other_raw = self.normalized_with(artifact, case)
                self.assertEqual((spec, sub, raw), (other_spec, other_sub, other_raw))
                for value in (spec, sub):
                    self.assertEqual(FROZEN.canonical(value).encode("utf-8"), artifact.canonical(value).encode("utf-8"))
                    self.assertEqual(FROZEN.digest(value), artifact.digest(value))
                self.assertEqual(FROZEN.content_fingerprint(spec, sub), artifact.content_fingerprint(other_spec, other_sub))
                self.assertEqual(sub["report_body"], other_sub["report_body"])
                self.assertEqual(artifact.normalize_submission(artifact.canonical(other_sub), other_spec), other_sub)
                checks, materials = FROZEN.verified_inline_sources(sub, raw)
                self.assertEqual((checks, materials), artifact.verified_inline_sources(other_sub, other_raw))
                for criterion, claim in zip(spec["criteria"], sub["claims"]):
                    self.assertEqual(FROZEN.render_claim_statement(spec, claim), artifact.render_claim_statement(other_spec, claim))
                    self.assertEqual(FROZEN.build_model_prompt(spec, sub, criterion, claim, materials).encode("utf-8"), artifact.build_model_prompt(other_spec, other_sub, criterion, claim, materials).encode("utf-8"))

    def test_complete_receipt_assessment_prompt_markers_and_zero_http_equal(self):
        from contextlib import redirect_stdout
        for case in original.structured.MODEL_CASES:
            runs = []
            for module in (FROZEN, artifact):
                self.prompts, self.outputs, self.phase_calls = [], [], []
                self.stdout.seek(0)
                self.stdout.truncate(0)
                self.queue(case, times=2)
                with redirect_stdout(self.stdout):
                    instance = module.ResearchReceiptSufficiencyProbe(json.dumps(self.fixture[case], ensure_ascii=True))
                runs.append((instance.get_receipt(), instance.get_assessment(), copy.deepcopy(self.prompts), self.stdout.getvalue(), self.phase_calls))
            self.assertEqual(runs[0], runs[1], case)
            self.assertEqual(runs[0][-1], [4, 4])
            self.assertEqual(self.gets, 0)

    def test_format_repair_trace_and_projection_equal(self):
        from contextlib import redirect_stdout
        results = []
        for module in (FROZEN, artifact):
            self.outputs = original.scripted_outputs(self.fixture["positive"], "positive")
            first = copy.deepcopy(self.outputs[0])
            self.outputs[0]["extra"] = True
            self.outputs.insert(1, first)
            self.prompts = []
            with redirect_stdout(self.stdout):
                result = module.independent_assessment(*self.normalized_with(module, "positive"))
            results.append((result, copy.deepcopy(self.prompts), module.stable_projection(result)))
        self.assertEqual(results[0], results[1])
        self.assertEqual(len(results[0][1]), 5)
        self.assertEqual(self.gets, 0)

    def test_no_model_or_http_added_and_diagnostic_surface_unchanged(self):
        tree = ast.parse(COMPACT.read_text(encoding="utf-8"), type_comments=True)
        self.assertFalse(any(isinstance(node, ast.Name) and node.id in {"eval", "exec", "compile", "open", "__file__", "inspect"} for node in ast.walk(tree)))
        contract = next(node for node in tree.body if isinstance(node, ast.ClassDef))
        self.assertEqual([node.name for node in contract.body if isinstance(node, ast.FunctionDef)], ["__init__", "get_receipt", "get_assessment"])


if __name__ == "__main__":
    import unittest
    unittest.main()
