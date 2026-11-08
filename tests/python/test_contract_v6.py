"""V6 deterministic business/security controls with GenVM/model stubs only.

These do not prove real storage, fees, committees, model accuracy or E2E success.
The frozen diagnostic input is read unchanged; V6 text/schema migration is explicit.
"""
import ast
import copy
import hashlib
import importlib.util
import inspect
import json
from pathlib import Path
from types import SimpleNamespace
import unittest

import test_contract as base
import test_sufficiency_probe as sufficiency

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "contracts/research_receipt_v6_candidate.py"
module_spec = importlib.util.spec_from_file_location("research_receipt_v6_candidate", SOURCE)
rr = importlib.util.module_from_spec(module_spec)
module_spec.loader.exec_module(rr)
gl, UserError, Returned = base.gl, base.UserError, base.Returned


def v6_snapshot_vector():
    """Independent Python vector for the client's explicitly shared input."""
    body = "owner only\n证据"
    sha = hashlib.sha256(body.encode("utf-8")).hexdigest()
    spec = rr.normalize_spec(rr.canonical({"title": "Snapshot\n绑定", "protocol": "Example", "chain": "Ethereum", "as_of": "2026-11-04", "author": "0x" + "c" * 40, "client_ref": "snapshot-vector-0001", "allowed_hosts": ["raw.githubusercontent.com"], "source_roots": ["raw.githubusercontent.com/example/repo/"], "catalog_version": rr.CATALOG_VERSION, "criteria": [{"id": "custom_owner", "text": "State the owner authorization.", "required": True, "evidence_requirement": "fact_required", "verification_kind": "evidence_review", "allowed_claim_types": ["factual_assertion"], "requested_field_ids": []}]}))
    source = {"url": "https://raw.githubusercontent.com/example/repo/" + "a" * 40 + "/test.txt", "sha256": sha, "byte_length": len(body.encode("utf-8"))}
    sub = rr.normalize_submission(rr.canonical({"report_title": "Delivery", "report_version": "v1", "report_body": "The source says owner only.", "sources": [source], "claims": [{"criterion_id": "custom_owner", "claim_type": "factual_assertion", "statement": "The source says owner only.", "evidence_indices": [0]}]}), spec)
    order = {"id": 1, "policy_version": rr.POLICY_VERSION, "spec": spec, "spec_hash": rr.digest(spec)}
    record = {"order_id": 1, "revision": 1, "submission": sub, "submission_hash": rr.digest(sub), "content_hash": rr.content_fingerprint(spec, sub)}
    snapshot = {"snapshot_version": rr.SNAPSHOT_VERSION, "binding": rr.snapshot_binding(order, record), "source_checks": [{"index": 0, "status": "VERIFIED", "sha256": sha}], "materials": [body]}
    return {"spec_hash": order["spec_hash"], "submission_hash": record["submission_hash"], "content_hash": record["content_hash"], "snapshot_hash": rr.digest(snapshot)}


class ContractV6Tests(unittest.TestCase):
    def setUp(self):
        self.fixture = json.loads(sufficiency.FIXTURE_PATH.read_text(encoding="utf-8"))
        gl.message.sender_address = base.OWNER
        self.contract = rr.ResearchReceipt()
        for name in ("orders", "order_ids", "revisions", "evidence_snapshots", "assessments"):
            setattr(self.contract, name, {})
        self.fetches, self.prompts, self.outputs, self.sources = [], [], [], {}

        def fetch(url, *, method):
            self.assertEqual(method, "GET")
            self.fetches.append(url)
            value = self.sources.get(url, (404, b""))
            if isinstance(value, Exception):
                raise value
            return SimpleNamespace(status=value[0], body=value[1])

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
            value = leader()
            if not validator(Returned(copy.deepcopy(value))):
                raise UserError("Independent validator rejected leader")
            return value

        gl.nondet.web = SimpleNamespace(request=fetch)
        gl.nondet.exec_prompt = model
        gl.vm.run_nondet_default = run
        self.run = run

    def payload(self, case="positive"):
        value = copy.deepcopy(self.fixture[case])
        value["spec"]["catalog_version"] = rr.CATALOG_VERSION
        for criterion in value["spec"]["criteria"]:
            if "unknown_disclosure" in criterion["allowed_claim_types"]:
                criterion["text"] = rr.derive_criterion_text(criterion["requested_field_ids"])
            else:
                criterion["requested_field_ids"] = []
        if case not in sufficiency.structured.REJECT_CASES:
            value["submission"]["report_body"] = "\n".join(rr.render_claim_statement(value["spec"], claim) for claim in value["submission"]["claims"])
        return value

    def normalize(self, payload=None, case="positive"):
        value = payload or self.payload(case)
        spec = rr.normalize_spec(rr.canonical(value["spec"]))
        return spec, rr.normalize_submission(rr.canonical(value["submission"]), spec)

    def install_sources(self, value):
        self.sources = {source["url"]: (200, material.encode("utf-8")) for source, material in zip(value["submission"]["sources"], value["materials"])}

    def queue(self, case="positive", times=1):
        for _ in range(times):
            self.outputs.extend(sufficiency.scripted_outputs(self.fixture[case], case))

    def setup_revision(self, payload=None, case="positive"):
        value = payload or self.payload(case)
        self.install_sources(value)
        gl.message.sender_address = base.OWNER
        order_id = self.contract.create_order(rr.canonical(value["spec"]))
        gl.message.sender_address = value["spec"]["author"]
        self.contract.submit_revision(order_id, rr.canonical(value["submission"]))
        return order_id

    def context(self, payload=None, case="positive"):
        value = payload or self.payload(case)
        spec, sub = self.normalize(value)
        self.install_sources(value)
        order = {"id": 1, "policy_version": rr.POLICY_VERSION, "spec": spec, "spec_hash": rr.digest(spec)}
        record = {"order_id": 1, "revision": 1, "submission": sub, "submission_hash": rr.digest(sub), "content_hash": rr.content_fingerprint(spec, sub)}
        binding = rr.snapshot_binding(order, record)
        evidence = rr.validate_evidence(rr.fetch_evidence(sub), sub)
        snapshot = {"snapshot_version": rr.SNAPSHOT_VERSION, "binding": binding, **evidence}
        snapshot["snapshot_hash"] = rr.digest(snapshot)
        return spec, sub, snapshot, binding

    def test_zero_argument_constructor_getters_and_exported_canonical_catalog(self):
        self.assertEqual(list(inspect.signature(rr.ResearchReceipt.__init__).parameters), ["self"])
        self.assertEqual(self.contract.get_policy_version(), "research-receipt/6")
        self.assertEqual(self.contract.get_order_count(), 0)
        raw = (ROOT / "src/field-catalog.json").read_text(encoding="utf-8")
        self.assertEqual(self.contract.get_field_catalog(), raw.removesuffix("\n"))
        catalog = json.loads(raw)
        self.assertEqual(catalog["version"], rr.CATALOG_VERSION)
        self.assertEqual(len(catalog["fields"]), 7)
        self.assertTrue(all(set(item) == {"id", "label", "group", "question", "allowed_claim_types"} for item in catalog["fields"]))
        self.assertEqual((self.prompts, self.fetches), ([], []))

    def test_independent_python_client_snapshot_vector(self):
        self.assertEqual(v6_snapshot_vector(), {
            "spec_hash": "98dce0846ac4d401c4fb34a86bd5ba4126b07b30c547de53eb2ad69b51b25c2d",
            "submission_hash": "4a0e4adc54becb76eb7a4fcec990841217b4bcfabd2e8cf5a63a435cbfbd479a",
            "content_hash": "983dc8ee020e07a5312846a0068abc3239b2b1f2913e6e8622e3a438325dc47a",
            "snapshot_hash": "fe87ff7b1d4ece482d635bd26fc81a5824d8dfa1ac8b193a345993c510fe20d8",
        })

    def test_catalog_version_and_standard_text_are_not_author_or_buyer_overridable(self):
        for change in ("missing", "version", "text", "padding", "question"):
            value = self.payload()
            if change == "missing":
                del value["spec"]["catalog_version"]
            elif change == "version":
                value["spec"]["catalog_version"] = "attacker/1"
            else:
                criterion = value["spec"]["criteria"][1]
                criterion["text"] += " " if change == "padding" else "; safety and immediate exit are guaranteed"
            with self.subTest(change=change), self.assertRaises(UserError):
                self.normalize(value)
        for requirement in rr.EVIDENCE_REQUIREMENTS:
            value = self.payload()
            value["spec"]["criteria"][1]["evidence_requirement"] = requirement
            spec, _ = self.normalize(value)
            self.assertEqual(spec["criteria"][1]["text"], rr.derive_criterion_text(spec["criteria"][1]["requested_field_ids"]))

    def test_catalog_group_is_independent_of_criterion_id_and_can_split_fields(self):
        value = self.payload()
        original = value["spec"]["criteria"][1]
        a, b = copy.deepcopy(original), copy.deepcopy(original)
        for item, criterion_id, field in [(a, "waiting", "withdrawal_waiting_period"), (b, "exit", "instant_exit_conditions")]:
            item.update(id=criterion_id, requested_field_ids=[field], text=rr.derive_criterion_text([field]))
        value["spec"]["criteria"] = [a, b]
        value["submission"]["claims"] = [{"criterion_id": item["id"], "claim_type": "unknown_disclosure", "disclosure_version": rr.DISCLOSURE_VERSION, "scope": rr.DISCLOSURE_SCOPE} for item in (a, b)]
        value["submission"]["report_body"] = "\n".join(rr.render_claim_statement(value["spec"], item) for item in value["submission"]["claims"])
        spec, sub = self.normalize(value)
        self.assertEqual([item["id"] for item in spec["criteria"]], ["waiting", "exit"])
        self.assertEqual(len(sub["claims"]), 2)
        for fields in [[], ["audit_version", "instant_exit_conditions"], ["audit_version", "audit_version"], ["unregistered"]]:
            bad = self.payload()
            bad["spec"]["criteria"][1]["requested_field_ids"] = fields
            with self.subTest(fields=fields), self.assertRaises(UserError):
                self.normalize(bad)

    def test_custom_factual_and_boundary_require_empty_field_lists_and_locked_types(self):
        for index in (0, 3):
            value = self.payload()
            value["spec"]["criteria"][index]["requested_field_ids"] = ["audit_version"]
            with self.assertRaises(UserError):
                self.normalize(value)
        value = self.payload()
        value["submission"]["claims"][0]["claim_type"] = "boundary_disclosure"
        with self.assertRaisesRegex(UserError, "not allowed"):
            self.normalize(value)
        for allowed in [[], ["factual_assertion", "factual_assertion"], ["boundary_disclosure"], ["unknown_disclosure", "INVALID"]]:
            value = self.payload()
            value["spec"]["criteria"][0]["allowed_claim_types"] = allowed
            with self.assertRaises(UserError):
                self.normalize(value)

    def test_strict_allow_four_prompts_equal_and_model_core_verbatim(self):
        prompts = []
        for case in ("positive", "strictUnknown"):
            spec, sub, snapshot, _ = self.context(case=case)
            materials = dict(enumerate(snapshot["materials"]))
            prompts.append([rr.build_model_prompt(spec, sub, criterion, claim, materials) for criterion, claim in zip(spec["criteria"], sub["claims"])])
        self.assertEqual(prompts[0], prompts[1])
        for name in ("unknown_prompt", "decode_unknown_finding", "preserved_field_states", "sufficiency_prompt", "decode_sufficiency_finding", "decode_model_finding", "preserved_result"):
            self.assertEqual(inspect.getsource(getattr(rr, name)), inspect.getsource(getattr(sufficiency.probe, name)))
        self.assertEqual(rr.FIELD_REGISTRY, sufficiency.probe.FIELD_REGISTRY)

    def test_normalized_body_and_claims_are_idempotent_ordered_and_bound(self):
        value = self.payload()
        value["submission"]["claims"].reverse()
        spec, sub = self.normalize(value)
        self.assertEqual([item["criterion_id"] for item in sub["claims"]], [item["id"] for item in spec["criteria"]])
        self.assertEqual(rr.normalize_submission(rr.canonical(sub), spec), sub)
        self.assertIn("提现等待期", sub["report_body"])
        self.assertNotIn("withdrawal_waiting_period", sub["report_body"])
        for addition in ("\n", " Instant exit is guaranteed.", "\x00"):
            bad = self.payload()
            bad["submission"]["report_body"] += addition
            with self.assertRaises(UserError):
                self.normalize(bad)

    def test_unknown_four_key_schema_rejects_legacy_prose_and_extra_promises(self):
        for case in sufficiency.structured.REJECT_CASES:
            with self.subTest(case=case), self.assertRaises(UserError):
                self.normalize(self.payload(case))
        for key in ("statement", "notes", "evidence_indices", "unknown_field_ids", "promise"):
            value = self.payload()
            value["submission"]["claims"][1][key] = "Free author promise"
            with self.assertRaises(UserError):
                self.normalize(value)
        self.assertEqual(self.prompts, [])

    def test_indices_and_origin_root_commit_boundaries_remain_strict(self):
        for refs in ([True], [0.0], ["0"], [0, 0], [-1], [2]):
            value = self.payload()
            value["submission"]["claims"][0]["evidence_indices"] = refs
            with self.subTest(refs=refs), self.assertRaises(UserError):
                self.normalize(value)
        source = self.payload()["submission"]["sources"][0]["url"]
        for url in [source.replace("https://", "http://"), source.replace("raw.githubusercontent.com", "user@raw.githubusercontent.com"), source.replace("raw.githubusercontent.com", "127.0.0.1"), source + "?x=1", source + "#x", source.replace("raw.githubusercontent.com", "raw.githubusercontent.com:443"), source.replace("OpenZeppelin/", "other/"), source.replace("contracts/access/", "contracts/../access/"), source.replace("3e6c86392c97fbc30d3d20a378a6f58beba08eba", "main")]:
            value = self.payload()
            value["submission"]["sources"][0]["url"] = url
            with self.subTest(url=url), self.assertRaises(UserError):
                self.normalize(value)

    def test_content_fingerprint_ignores_only_labels_types_and_remapped_source_order(self):
        value = self.payload()
        criterion = value["spec"]["criteria"][1]
        criterion["allowed_claim_types"] = ["unknown_disclosure", "factual_assertion"]
        spec, sub = self.normalize(value)
        changed = copy.deepcopy(sub)
        changed["report_title"], changed["report_version"] = "New title", "2"
        claim = changed["claims"][1]
        changed["claims"][1] = {"criterion_id": claim["criterion_id"], "claim_type": "factual_assertion", "statement": rr.render_claim_statement(spec, claim), "evidence_indices": [0, 1]}
        self.assertNotEqual(rr.digest(sub), rr.digest(changed))
        self.assertEqual(rr.content_fingerprint(spec, sub), rr.content_fingerprint(spec, changed))
        changed["sources"].reverse()
        for claim in changed["claims"]:
            if claim["claim_type"] != "unknown_disclosure":
                claim["evidence_indices"] = sorted(1 - index for index in claim["evidence_indices"])
        self.assertEqual(rr.content_fingerprint(spec, sub), rr.content_fingerprint(spec, changed))

    def test_staged_business_seven_controls_full_assessment_and_zero_http_evaluation(self):
        for case, old in sufficiency.structured.MODEL_CASES.items():
            with self.subTest(case=case):
                self.setUp()
                order = self.setup_revision(case=case)
                self.contract.verify_evidence(order, 1)
                self.assertEqual(len(self.fetches), 4)
                self.queue(case, times=2)
                self.contract.evaluate(order, 1)
                self.assertEqual(len(self.fetches), 4)
                self.assertEqual(len(self.prompts), 8)
                assessment = json.loads(self.contract.get_assessment(order, 1))
                snapshot = json.loads(self.contract.get_evidence_snapshot(order, 1))
                self.assertEqual(assessment["verdict"], "INSUFFICIENT_EVIDENCE" if case == "negative" else old["verdict"])
                self.assertEqual(assessment["snapshot_hash"], snapshot["snapshot_hash"])
                self.assertEqual(assessment["source_checks"], snapshot["source_checks"])
                self.assertEqual(assessment["policy_version"], rr.POLICY_VERSION)
                for finding in assessment["findings"]:
                    self.assertEqual(len(finding), 10)

    def test_optional_missing_is_ignored_but_submitted_insufficient_requires_revision(self):
        for kind in ("missing", "strict", "factual", "boundary"):
            value = self.payload()
            for criterion in value["spec"]["criteria"][1:]:
                criterion["required"] = False
            if kind == "missing":
                value["submission"]["claims"] = value["submission"]["claims"][:1]
            elif kind == "strict":
                value["spec"]["criteria"][2]["evidence_requirement"] = "fact_required"
            elif kind == "factual":
                value["spec"]["criteria"][0]["required"] = False
                value["spec"]["criteria"][1]["required"] = True
            value["submission"]["report_body"] = "\n".join(rr.render_claim_statement(value["spec"], item) for item in value["submission"]["claims"])
            spec, sub, snapshot, binding = self.context(value)
            outputs = sufficiency.scripted_outputs(self.fixture["positive"], "positive")
            if kind == "missing":
                outputs = outputs[:1]
            elif kind == "factual":
                outputs[0] = {"result": "NOT_ESTABLISHED", "reason": "Insufficient optional fact."}
            elif kind == "boundary":
                outputs[3] = {"result": "NOT_ESTABLISHED", "reason": "Incomplete boundary."}
            self.outputs = outputs
            result = rr.independent_assessment(spec, sub, snapshot, binding)
            self.assertEqual(result["verdict"], "ACCEPTED" if kind == "missing" else "REVISION_REQUIRED")
            if kind == "missing":
                self.assertTrue(all(item["claim_type"] is None and item["validity"] is None and item["status"] == "MISSING" for item in result["findings"][1:]))

    def test_required_failure_does_not_skip_submitted_optional_and_optional_contradiction(self):
        value = self.payload("falseCautionOtherSource")
        for item in value["spec"]["criteria"]:
            item["required"] = item["id"] != "permissions"
        spec, sub, snapshot, binding = self.context(value)
        self.queue("falseCautionOtherSource")
        result = rr.independent_assessment(spec, sub, snapshot, binding)
        self.assertEqual(result["verdict"], "REVISION_REQUIRED")
        value = self.payload("negative")
        for item in value["spec"]["criteria"][1:]:
            item["required"] = False
        spec, sub, snapshot, binding = self.context(value)
        self.queue("negative")
        result = rr.independent_assessment(spec, sub, snapshot, binding)
        self.assertEqual(len(result["findings"]), 4)
        self.assertEqual(result["verdict"], "INSUFFICIENT_EVIDENCE")
        self.assertEqual(len(self.prompts), 8)

    def test_failed_source_snapshot_is_immutable_and_cannot_be_rescued_by_models(self):
        order = self.setup_revision()
        first = self.payload()["submission"]["sources"][0]["url"]
        self.sources[first] = (200, b"tampered")
        self.contract.verify_evidence(order, 1)
        saved = self.contract.get_evidence_snapshot(order, 1)
        self.assertEqual(json.loads(saved)["source_checks"][0]["status"], "HASH_MISMATCH")
        with self.assertRaisesRegex(UserError, "immutable"):
            self.contract.verify_evidence(order, 1)
        self.install_sources(self.payload())
        self.contract.evaluate(order, 1)
        result = json.loads(self.contract.get_assessment(order, 1))
        self.assertEqual(result["verdict"], "INSUFFICIENT_EVIDENCE")
        self.assertTrue(all(item["status"] == "SOURCE_UNAVAILABLE" and item["validity"] is None for item in result["findings"]))
        self.assertEqual(self.prompts, [])
        self.assertEqual(self.contract.get_evidence_snapshot(order, 1), saved)

    def test_unknown_requires_every_source_even_if_other_claim_uses_only_good_source(self):
        value = self.payload("negative")
        spec, sub = self.normalize(value)
        self.install_sources(value)
        self.sources[sub["sources"][1]["url"]] = (404, b"")
        order = {"id": 1, "spec": spec, "spec_hash": rr.digest(spec), "policy_version": rr.POLICY_VERSION}
        record = {"order_id": 1, "revision": 1, "submission": sub, "submission_hash": rr.digest(sub), "content_hash": rr.content_fingerprint(spec, sub)}
        binding = rr.snapshot_binding(order, record)
        snapshot = {"snapshot_version": rr.SNAPSHOT_VERSION, "binding": binding, **rr.fetch_evidence(sub)}
        snapshot["snapshot_hash"] = rr.digest(snapshot)
        self.outputs = [{"result": "NOT_ESTABLISHED", "reason": "Exact false permission."}]
        result = rr.independent_assessment(spec, sub, snapshot, binding)
        self.assertEqual(len(self.prompts), 1)
        self.assertEqual(result["findings"][1]["status"], "SOURCE_UNAVAILABLE")
        self.assertEqual(result["findings"][1]["scope_source_indices"], [0, 1])
        self.assertEqual(result["findings"][0]["basis_scope_source_indices"], [0])

    def test_snapshot_binding_and_material_tampering_rejected_before_model(self):
        spec, sub, snapshot, binding = self.context()
        for target in ("policy_version", "order_id", "revision", "spec_hash", "submission_hash", "content_hash", "sources"):
            altered = copy.deepcopy(snapshot)
            altered["binding"][target] = [] if target == "sources" else "changed"
            altered["snapshot_hash"] = rr.digest({key: value for key, value in altered.items() if key != "snapshot_hash"})
            with self.subTest(target=target), self.assertRaises(UserError):
                rr.independent_assessment(spec, sub, altered, binding)
        for alteration in ("material", "null", "status", "hash", "unused"):
            altered = copy.deepcopy(snapshot)
            if alteration == "material":
                altered["materials"][0] += "x"
            elif alteration == "null":
                altered["materials"][0] = None
            elif alteration == "status":
                altered["source_checks"][0]["status"] = "UNAVAILABLE"
            elif alteration == "hash":
                altered["source_checks"][0]["sha256"] = "a" * 64
            else:
                altered["materials"].append("hidden material")
            altered["snapshot_hash"] = rr.digest({key: value for key, value in altered.items() if key != "snapshot_hash"})
            with self.subTest(alteration=alteration), self.assertRaises(UserError):
                rr.independent_assessment(spec, sub, altered, binding)
        self.assertEqual(self.prompts, [])

    def test_false_verified_leader_and_malformed_return_are_not_trusted(self):
        order = self.setup_revision()
        def malicious(leader, validator):
            self.assertFalse(validator({"calldata": {}}))
            result = leader()
            result["materials"][0] += "forgery"
            self.assertFalse(validator(Returned(result)))
            raise UserError("Rejected forged source proof")
        gl.vm.run_nondet_default = malicious
        with self.assertRaisesRegex(UserError, "forged source"):
            self.contract.verify_evidence(order, 1)
        self.assertEqual(self.contract.get_evidence_snapshot(order, 1), "")
        self.assertEqual(self.prompts, [])

    def test_snapshot_preconditions_permissions_and_repeat_assessment(self):
        order = self.setup_revision()
        with self.assertRaisesRegex(UserError, "Verify evidence"):
            self.contract.evaluate(order, 1)
        gl.message.sender_address = base.THIRD
        for method in (self.contract.verify_evidence, self.contract.evaluate):
            with self.assertRaisesRegex(UserError, "owner or locked author"):
                method(order, 1)
        gl.message.sender_address = base.OWNER
        self.contract.verify_evidence(order, 1)
        self.queue(times=2)
        self.contract.evaluate(order, 1)
        saved = self.contract.get_assessment(order, 1)
        for method in (self.contract.verify_evidence, self.contract.evaluate):
            with self.assertRaises(UserError):
                method(order, 1)
        self.assertEqual(self.contract.get_assessment(order, 1), saved)

    def test_complete_projection_rejects_scope_basis_field_and_validity_tampering(self):
        spec, sub, snapshot, binding = self.context()
        self.queue()
        result = rr.independent_assessment(spec, sub, snapshot, binding)
        for field, replacement in [("basis_scope_source_indices", [1]), ("evidence_indices", [0]), ("scope_source_indices", [0, 1]), ("claim_type", "boundary_disclosure"), ("validity", "NOT_ESTABLISHED"), ("delivery_status", "INSUFFICIENT")]:
            bad = copy.deepcopy(result)
            bad["findings"][0][field] = replacement
            with self.subTest(field=field), self.assertRaises(UserError):
                rr.validate_assessment(bad, spec, sub, snapshot, binding)
            self.assertNotEqual(rr.stable_projection(result), rr.stable_projection(bad))
        for field in ("scope_source_indices", "field_checks", "basis_scope_source_indices"):
            bad = copy.deepcopy(result)
            bad["findings"][1][field] = [0] if field != "field_checks" else []
            with self.assertRaises(UserError):
                rr.validate_assessment(bad, spec, sub, snapshot, binding)

    def test_validator_independently_reassesses_all_nine_fields_not_just_overall(self):
        order = self.setup_revision(case="negative")
        self.contract.verify_evidence(order, 1)
        outputs = sufficiency.scripted_outputs(self.fixture["negative"], "negative")
        self.outputs = copy.deepcopy(outputs) + copy.deepcopy(outputs)
        self.outputs[-1] = {"result": "NOT_ESTABLISHED", "reason": "Independent boundary disagreement."}
        with self.assertRaisesRegex(UserError, "validator rejected"):
            self.contract.evaluate(order, 1)
        self.assertEqual(len(self.prompts), 8)
        self.assertEqual(self.contract.get_assessment(order, 1), "")

    def test_format_repair_budget_preserves_legal_results_and_unknown_states(self):
        spec, sub, snapshot, binding = self.context()
        self.outputs = [{"result": "NOT_ESTABLISHED", "reason": "secret-free-text", "extra": True}, {"result": "ESTABLISHED", "reason": "Illegal upgrade."}]
        with self.assertRaisesRegex(UserError, "changed original result"):
            rr.independent_assessment(spec, sub, snapshot, binding)
        self.assertNotIn("secret-free-text", self.prompts[1])
        spec, sub, snapshot, binding = self.context(case="falseCautionOtherSource")
        original = sufficiency.scripted_outputs(self.fixture["falseCautionOtherSource"], "falseCautionOtherSource")[0]
        original["field_checks"][0]["evidence_indices"] = ["1"]
        changed = copy.deepcopy(original)
        changed["field_checks"][0].update(state="NOT_ESTABLISHED", evidence_indices=[])
        self.outputs = [original, changed]
        with self.assertRaisesRegex(UserError, "changed original field state"):
            rr.independent_assessment(spec, sub, snapshot, binding)

    def test_global_single_repair_and_provider_error_limits(self):
        spec, sub, snapshot, binding = self.context()
        self.queue()
        first = copy.deepcopy(self.outputs[0])
        self.outputs[0]["extra"] = True
        self.outputs.insert(1, first)
        self.outputs[2]["field_checks"][0]["evidence_indices"] = [0]
        with self.assertRaisesRegex(UserError, "global repair budget"):
            rr.independent_assessment(spec, sub, snapshot, binding)
        self.assertEqual(len(self.prompts), 3)
        self.prompts, self.outputs = [], [OSError("provider unavailable")]
        with self.assertRaises(OSError):
            rr.independent_assessment(spec, sub, snapshot, binding)
        self.assertEqual(len(self.prompts), 1)

    def test_max_six_initial_calls_plus_one_global_repair(self):
        value = self.payload()
        first = value["spec"]["criteria"][0]
        claim = value["submission"]["claims"][0]
        value["spec"]["criteria"] = [dict(first, id="fact" + str(i)) for i in range(6)]
        value["submission"]["claims"] = [dict(claim, criterion_id="fact" + str(i)) for i in range(6)]
        value["submission"]["report_body"] = "\n".join(item["statement"] for item in value["submission"]["claims"])
        spec, sub, snapshot, binding = self.context(value)
        good = {"result": "ESTABLISHED", "reason": "Offline scripted complete fact."}
        self.outputs = [dict(good, extra=True)] + [copy.deepcopy(good) for _ in range(6)]
        result = rr.independent_assessment(spec, sub, snapshot, binding)
        self.assertEqual(result["verdict"], "ACCEPTED")
        self.assertEqual(len(self.prompts), 7)

    def test_missing_zero_source_and_failed_finding_metadata_cannot_be_forged(self):
        value = self.payload()
        value["submission"].update(claims=[], report_body="", sources=[])
        spec, sub, snapshot, binding = self.context(value)
        result = rr.independent_assessment(spec, sub, snapshot, binding)
        self.assertTrue(all(item["status"] == "MISSING" and item["validity"] is None for item in result["findings"]))
        bad = copy.deepcopy(result)
        bad["findings"][0].update(claim_type="factual_assertion", validity="ESTABLISHED", status="SUPPORTED", delivery_status="FULFILLED")
        with self.assertRaises(UserError):
            rr.validate_assessment(bad, spec, sub, snapshot, binding)
        self.assertEqual(self.prompts, [])

    def test_revision_lifecycle_replay_history_and_cross_revision_snapshot_guards(self):
        order = self.setup_revision(case="negative")
        with self.assertRaisesRegex(UserError, "previous revision"):
            self.contract.submit_revision(order, rr.canonical(self.payload()["submission"]))
        self.contract.verify_evidence(order, 1)
        first_snapshot = self.contract.get_evidence_snapshot(order, 1)
        self.queue("negative", times=2)
        self.contract.evaluate(order, 1)
        relabel = self.payload("negative")["submission"]
        relabel.update(report_title="Retitled", report_version="new-label")
        with self.assertRaisesRegex(UserError, "already appeared"):
            self.contract.submit_revision(order, rr.canonical(relabel))
        corrected = self.payload()["submission"]
        corrected["report_version"] = "corrected-v2"
        self.assertEqual(self.contract.submit_revision(order, rr.canonical(corrected)), 2)
        for method in (self.contract.verify_evidence, self.contract.evaluate):
            with self.assertRaisesRegex(UserError, "current"):
                method(order, 1)
        self.contract.evidence_snapshots[str(order) + ":2"] = first_snapshot
        with self.assertRaisesRegex(UserError, "binding"):
            self.contract.evaluate(order, 2)
        del self.contract.evidence_snapshots[str(order) + ":2"]
        self.contract.verify_evidence(order, 2)
        self.queue(times=2)
        self.contract.evaluate(order, 2)
        self.assertEqual(json.loads(self.contract.get_order(order))["status"], "ACCEPTED")
        self.assertEqual(self.contract.get_evidence_snapshot(order, 1), first_snapshot)
        with self.assertRaisesRegex(UserError, "closed"):
            self.contract.submit_revision(order, rr.canonical(relabel))

    def test_client_ref_ownership_required_boolean_dates_and_bounded_revisions(self):
        value = self.payload()
        for modifier in ("all_optional", "too_many", "duplicate_id", "bool_required", "future"):
            bad = copy.deepcopy(value)
            if modifier == "all_optional":
                for item in bad["spec"]["criteria"]:
                    item["required"] = False
            elif modifier == "too_many":
                bad["spec"]["criteria"] *= 2
            elif modifier == "duplicate_id":
                bad["spec"]["criteria"][1]["id"] = bad["spec"]["criteria"][0]["id"]
            elif modifier == "bool_required":
                bad["spec"]["criteria"][0]["required"] = 1
            else:
                bad["spec"]["as_of"] = "2099-01-01"
            with self.subTest(modifier=modifier), self.assertRaises(UserError):
                self.contract.create_order(rr.canonical(bad["spec"]))
        order = self.contract.create_order(rr.canonical(value["spec"]))
        self.assertEqual(self.contract.get_order_id(value["spec"]["client_ref"]), order)
        with self.assertRaisesRegex(UserError, "client_ref"):
            self.contract.create_order(rr.canonical(value["spec"]))
        with self.assertRaisesRegex(UserError, "locked author"):
            self.contract.submit_revision(order, rr.canonical(value["submission"]))
        record = json.loads(self.contract.get_order(order))
        record["revision_count"] = 5
        self.contract.orders[str(order)] = rr.canonical(record)
        gl.message.sender_address = value["spec"]["author"]
        with self.assertRaisesRegex(UserError, "limit"):
            self.contract.submit_revision(order, rr.canonical(value["submission"]))

    def test_reason_byte_bound_and_legal_negative_do_not_use_repair(self):
        spec, sub, snapshot, binding = self.context(case="negative")
        self.queue("negative")
        self.outputs[0]["reason"] = "a" * 150 + "\nvalid multiline"
        result = rr.independent_assessment(spec, sub, snapshot, binding)
        self.assertEqual(len(self.prompts), 4)
        self.assertEqual(result["findings"][0]["status"], "NOT_ESTABLISHED")
        finding, error = rr.decode_model_finding({"result": "ESTABLISHED", "reason": "x" * 801}, spec["criteria"][0], sub["claims"][0], sub, dict(enumerate(snapshot["materials"])))
        self.assertIsNone(finding)
        self.assertTrue(error)

    def test_all_failure_source_states_have_null_material_and_cannot_fake_verified(self):
        value = self.payload()
        spec, sub = self.normalize(value)
        url = sub["sources"][0]["url"]
        for expected, body in [("UNAVAILABLE", (503, b"")), ("UNAVAILABLE", OSError("offline")), ("TOO_LARGE", (200, b"x" * (rr.MAX_SOURCE_BYTES + 1))), ("HASH_MISMATCH", (200, b"changed")), ("INVALID_ENCODING", (200, b"\xff"))]:
            self.install_sources(value)
            current = copy.deepcopy(sub)
            if expected == "INVALID_ENCODING":
                current["sources"][0].update(sha256=hashlib.sha256(b"\xff").hexdigest(), byte_length=1)
            self.sources[url] = body
            evidence = rr.validate_evidence(rr.fetch_evidence(current), current)
            self.assertEqual(evidence["source_checks"][0]["status"], expected)
            self.assertIsNone(evidence["materials"][0])
            bad = copy.deepcopy(evidence)
            bad["materials"][0] = "hidden unverified text"
            with self.assertRaises(UserError):
                rr.validate_evidence(bad, current)
            bad = copy.deepcopy(evidence)
            bad["source_checks"][0]["status"] = "VERIFIED"
            with self.assertRaises(UserError):
                rr.validate_evidence(bad, current)

    def test_submitted_optional_bad_source_requires_revision_after_good_required_fact(self):
        value = self.payload("negative")
        for item in value["spec"]["criteria"][1:]:
            item["required"] = False
        spec, sub, snapshot, binding = self.context(value)
        snapshot["source_checks"][1] = {"index": 1, "status": "UNAVAILABLE", "sha256": ""}
        snapshot["materials"][1] = None
        snapshot["snapshot_hash"] = rr.digest({key: item for key, item in snapshot.items() if key != "snapshot_hash"})
        self.outputs = [{"result": "ESTABLISHED", "reason": "Stub establishes the selected required fact."}]
        result = rr.independent_assessment(spec, sub, snapshot, binding)
        self.assertEqual(result["findings"][0]["status"], "SUPPORTED")
        self.assertEqual([item["status"] for item in result["findings"][1:]], ["SOURCE_UNAVAILABLE"] * 3)
        self.assertEqual(result["verdict"], "REVISION_REQUIRED")
        self.assertEqual(len(self.prompts), 1)

    def test_five_revision_bound_nonadjacent_replay_and_history_are_preserved(self):
        value = self.payload("negative")
        order = self.setup_revision(value)
        first_submission = copy.deepcopy(value["submission"])
        history = []
        for revision in range(1, 6):
            if revision > 1:
                value["submission"]["report_version"] = "v" + str(revision)
                # This is a deliberate offline lifecycle control, not advice to
                # evade structural replay with semantically equivalent prose.
                value["submission"]["claims"][3]["statement"] += " Additional tested scope " + str(revision) + "."
                value["submission"]["report_body"] = "\n".join(rr.render_claim_statement(value["spec"], item) for item in value["submission"]["claims"])
                self.assertEqual(self.contract.submit_revision(order, rr.canonical(value["submission"])), revision)
            self.contract.verify_evidence(order, revision)
            self.queue("negative", times=2)
            self.contract.evaluate(order, revision)
            history.append(self.contract.get_assessment(order, revision))
            if revision == 2:
                replay = copy.deepcopy(first_submission)
                replay["report_version"] = "replay-v3"
                with self.assertRaisesRegex(UserError, "already appeared"):
                    self.contract.submit_revision(order, rr.canonical(replay))
                self.assertEqual(json.loads(self.contract.get_order(order))["revision_count"], 2)
        value["submission"]["report_version"] = "v6"
        with self.assertRaisesRegex(UserError, "limit"):
            self.contract.submit_revision(order, rr.canonical(value["submission"]))
        self.assertEqual([self.contract.get_assessment(order, revision) for revision in range(1, 6)], history)

    def test_reason_only_validator_difference_is_not_a_decision_difference(self):
        order = self.setup_revision()
        self.contract.verify_evidence(order, 1)
        first = sufficiency.scripted_outputs(self.fixture["positive"], "positive")
        second = copy.deepcopy(first)
        for item in second:
            item["reason"] = "A different independently generated reason."
        self.outputs = first + second
        self.contract.evaluate(order, 1)
        self.assertEqual(json.loads(self.contract.get_assessment(order, 1))["verdict"], "ACCEPTED")

    def test_duplicate_json_keys_max_size_empty_root_and_boolean_limits_fail_closed(self):
        spec = self.payload()["spec"]
        raw = rr.canonical(spec)
        with self.assertRaisesRegex(UserError, "Duplicate"):
            rr.normalize_spec(raw[:-1] + ',"catalog_version":"attacker"}')
        with self.assertRaisesRegex(UserError, "byte limit"):
            rr.normalize_spec(" " * 12289)
        for roots in ([], ["raw.githubusercontent.com/owner/../"], ["raw.githubusercontent.com/owner/repo/", "raw.githubusercontent.com/owner/repo/"]):
            bad = copy.deepcopy(spec)
            bad["source_roots"] = roots
            with self.assertRaises(UserError):
                rr.normalize_spec(rr.canonical(bad))
        for length in (True, 0, rr.MAX_SOURCE_BYTES + 1):
            bad = self.payload()
            bad["submission"]["sources"][0]["byte_length"] = length
            with self.assertRaises(UserError):
                self.normalize(bad)

    def test_snapshot_context_recomputes_spec_submission_and_content_hashes(self):
        spec, sub = self.normalize()
        order = {"id": 1, "policy_version": rr.POLICY_VERSION, "spec": spec, "spec_hash": rr.digest(spec)}
        record = {"order_id": 1, "revision": 1, "submission": sub, "submission_hash": rr.digest(sub), "content_hash": rr.content_fingerprint(spec, sub)}
        for target in ("spec_hash", "submission_hash", "content_hash", "policy_version", "order_id"):
            changed_order, changed_record = copy.deepcopy(order), copy.deepcopy(record)
            (changed_order if target in ("spec_hash", "policy_version") else changed_record)[target] = "forged"
            with self.subTest(target=target), self.assertRaises(UserError):
                rr.snapshot_binding(changed_order, changed_record)

    def test_business_api_has_no_funds_inline_author_materials_or_extra_evaluation_path(self):
        tree = ast.parse(SOURCE.read_text(encoding="utf-8"), type_comments=True)
        contract = next(item for item in tree.body if isinstance(item, ast.ClassDef))
        public_names = [item.name for item in contract.body if isinstance(item, ast.FunctionDef) and item.decorator_list]
        self.assertEqual(public_names, ["create_order", "submit_revision", "verify_evidence", "evaluate", "get_policy_version", "get_field_catalog", "get_order", "get_revision", "get_evidence_snapshot", "get_assessment", "get_order_count", "get_order_id"])
        self.assertFalse(any(isinstance(item, ast.Attribute) and item.attr in {"transfer", "send", "appeal", "topup"} for item in ast.walk(tree)))
        assessment = next(item for item in tree.body if isinstance(item, ast.FunctionDef) and item.name == "independent_assessment")
        self.assertFalse(any(isinstance(item, ast.Attribute) and item.attr in {"web", "request"} for item in ast.walk(assessment)))


if __name__ == "__main__":
    unittest.main()
