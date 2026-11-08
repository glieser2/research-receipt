"""Frozen V6 versus v1 compact artifact: offline equivalence, not transport proof.

All 34 V6 business controls run against the compact contract. Within the original
mixed prompt/source test, inspect.getsource byte identity is explicitly N/A and
replaced by full function AST equivalence; prompt bytes are still compared.
"""
import ast
import copy
import hashlib
import importlib.util
import inspect
import json
from pathlib import Path
from unittest.mock import patch

import test_contract_v6 as original

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "contracts/research_receipt_v6_candidate.py"
COMPACT = ROOT / "contracts/research_receipt_v6_compact.py"
GENERATOR = ROOT / "scripts/generate-v6-compact.py"
CANONICAL = original.rr


def load_module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


artifact = load_module("research_receipt_v6_compact", COMPACT)
generator = load_module("generate_v6_compact", GENERATOR)
previous_generator = load_module("frozen_v1_compact_generator", generator.ALGORITHM_TOOL)


class CompactV6Tests(original.ContractV6Tests):
    def setUp(self):
        for name, value in (("rr", artifact), ("SOURCE", COMPACT)):
            context = patch.object(original, name, value)
            context.start()
            self.addCleanup(context.stop)
        super().setUp()

    def test_strict_allow_four_prompts_equal_and_model_core_verbatim(self):
        # The original source-byte assertion is N/A after compaction. No claim
        # is made that an inspect.getsource textual comparison passed.
        prompts = []
        for case in ("positive", "strictUnknown"):
            spec, sub, snapshot, _ = self.context(case=case)
            materials = dict(enumerate(snapshot["materials"]))
            prompts.append([artifact.build_model_prompt(spec, sub, criterion, claim, materials).encode("utf-8") for criterion, claim in zip(spec["criteria"], sub["claims"])])
        self.assertEqual(prompts[0], prompts[1])
        for name in ("unknown_prompt", "decode_unknown_finding", "preserved_field_states", "sufficiency_prompt", "decode_sufficiency_finding", "decode_model_finding", "preserved_result"):
            self.assertEqual(generator.tree_dump(inspect.getsource(getattr(artifact, name))), generator.tree_dump(inspect.getsource(getattr(CANONICAL, name))))
        self.assertEqual(artifact.FIELD_REGISTRY, CANONICAL.FIELD_REGISTRY)
        self.assertNotEqual(inspect.getsource(artifact.unknown_prompt), inspect.getsource(CANONICAL.unknown_prompt))

    def test_fixed_v1_algorithm_dependency_and_minifier_ast_are_unchanged(self):
        self.assertEqual(hashlib.sha256(generator.ALGORITHM_TOOL.read_bytes()).hexdigest(), generator.ALGORITHM_TOOL_SHA256)
        self.assertEqual(generator.ALGORITHM, previous_generator.ALGORITHM)
        for name in ("sha256", "tree_dump", "ordered_constants", "pair_tokens", "source_dependency_check"):
            self.assertEqual(inspect.getsource(getattr(generator, name)), inspect.getsource(getattr(previous_generator, name)))
        # Only the input fingerprint guard's diagnostic message changes; the
        # compacting operation and verification checks use the identical AST.
        current = ast.parse(inspect.getsource(generator.compact_source))
        previous = ast.parse(inspect.getsource(previous_generator.compact_source))
        for tree in (current, previous):
            tree.body[0].body[0].body[0].exc.args[0].value = "FROZEN_INPUT_FINGERPRINT_MISMATCH"
        self.assertEqual(ast.dump(current, include_attributes=False), ast.dump(previous, include_attributes=False))

    def test_full_ast_all_ordered_constants_and_runner_bytes_equal(self):
        before, after = SOURCE.read_bytes(), COMPACT.read_bytes()
        self.assertEqual(hashlib.sha256(before).hexdigest(), generator.SOURCE_SHA256)
        self.assertEqual(generator.compact_source(before), after)
        self.assertEqual(before.splitlines(keepends=True)[:2], after.splitlines(keepends=True)[:2])
        self.assertEqual(generator.tree_dump(before.decode("utf-8")), generator.tree_dump(after.decode("utf-8")))
        self.assertEqual(generator.ordered_constants(before.decode("utf-8")), generator.ordered_constants(after.decode("utf-8")))
        self.assertEqual(generator.source_dependency_check(before)["source_line_introspection_dependency_hits"], [])
        self.assertLess(len(after), len(before))
        compile(after, str(COMPACT), "exec")

    def test_normalizers_catalog_render_and_all_four_prompt_bytes_equal(self):
        self.assertEqual(artifact.field_catalog(), CANONICAL.field_catalog())
        self.assertEqual(artifact.canonical(artifact.field_catalog()).encode("utf-8"), CANONICAL.canonical(CANONICAL.field_catalog()).encode("utf-8"))
        for case in original.sufficiency.structured.MODEL_CASES:
            value = self.payload(case)
            spec = CANONICAL.normalize_spec(CANONICAL.canonical(value["spec"]))
            sub = CANONICAL.normalize_submission(CANONICAL.canonical(value["submission"]), spec)
            actual_spec, actual_sub = self.normalize(value)
            self.assertEqual((actual_spec, actual_sub), (spec, sub))
            self.assertEqual(artifact.digest(actual_spec), CANONICAL.digest(spec))
            self.assertEqual(artifact.digest(actual_sub), CANONICAL.digest(sub))
            self.assertEqual(artifact.content_fingerprint(actual_spec, actual_sub), CANONICAL.content_fingerprint(spec, sub))
            materials = dict(enumerate(value["materials"]))
            for criterion, claim in zip(spec["criteria"], sub["claims"]):
                self.assertEqual(artifact.render_claim_statement(spec, claim), CANONICAL.render_claim_statement(spec, claim))
                self.assertEqual(artifact.build_model_prompt(spec, sub, criterion, claim, materials).encode("utf-8"), CANONICAL.build_model_prompt(spec, sub, criterion, claim, materials).encode("utf-8"))

    def test_seven_complete_business_model_traces_snapshot_hashes_and_state_equal(self):
        for case in original.sufficiency.structured.MODEL_CASES:
            results = []
            for module in (CANONICAL, artifact):
                self.setUp()
                self.contract = module.ResearchReceipt()
                for name in ("orders", "order_ids", "revisions", "evidence_snapshots", "assessments"):
                    setattr(self.contract, name, {})
                order = self.setup_revision(case=case)
                self.contract.verify_evidence(order, 1)
                fetch_count = len(self.fetches)
                self.queue(case, times=2)
                self.contract.evaluate(order, 1)
                self.assertEqual(len(self.fetches), fetch_count)
                results.append(({name: copy.deepcopy(getattr(self.contract, name)) for name in ("orders", "order_ids", "revisions", "evidence_snapshots", "assessments")}, copy.deepcopy(self.fetches), copy.deepcopy(self.prompts)))
            self.assertEqual(results[0], results[1], case)

    def test_format_repair_model_trace_and_full_projection_equal(self):
        results = []
        for module in (CANONICAL, artifact):
            self.setUp()
            spec, sub, snapshot, binding = self.context()
            self.queue()
            first = copy.deepcopy(self.outputs[0])
            self.outputs[0]["extra"] = True
            self.outputs.insert(1, first)
            self.prompts = []
            before_fetches = len(self.fetches)
            result = module.independent_assessment(spec, sub, snapshot, binding)
            self.assertEqual(len(self.fetches), before_fetches)
            results.append((result, module.stable_projection(result), copy.deepcopy(self.prompts)))
        self.assertEqual(results[0], results[1])
        self.assertEqual(len(results[0][2]), 5)


if __name__ == "__main__":
    import unittest
    unittest.main()
