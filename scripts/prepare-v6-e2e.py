"""Prelock the V6 business lifecycle suite without RPC, models, keys or signing.

--check-only uses explicit preview references, generates no UUIDs and writes no
fixture/plan. --prepare is a separate reviewed action and creates three new files
exclusively. Both modes derive expected policy outputs before any real execution.
"""
import argparse
import copy
from datetime import datetime, timezone
import hashlib
import importlib.util
import json
from pathlib import Path
import re
import sys
import uuid

ROOT = Path(__file__).resolve().parents[1]
CANONICAL_FILE = "contracts/research_receipt_v6_candidate.py"
CANONICAL_SHA = "9cff3a90a45daee031bf3fb893857bcb53cb07bc6501b86fecc955ce021b4a19"
DEPLOYMENT_FILE = "contracts/research_receipt_v6_compact.py"
DEPLOYMENT_SHA = "e053f1b4250b6a0e7717722c54dfe97717a5d341b374d9404d7b5b2c057e1fcb"
BASE_FILE = "tests/fixtures/bradbury-structured-probe-input.json"
BASE_SHA = "73703b4f60883ae6c51eeca9dd42a4dc945e97d020d88e6616af10679982b0d9"
CATALOG_FILE = "src/field-catalog.json"
CATALOG_SHA = "755b155c7c5d1bd0f193c96721246980393bfa86bbedb57e4017b00e3d9e30a5"
BUILD_FILE = "artifacts/v6-compact-builds/20261105T134640.219250Z-e053f1b4250b.json"
BUILD_SHA = "5c82e5651cca998c37805560b8707cef7218549942c14a22e053df42c6485131"
FEE_FILE = "src/fee-profile.json"
FEE_SHA = "df9be739a22efd5460db67d6bbb688d0bec87f56f7d163582e4269960ede7415"
SESSION_FILE = "artifacts/bradbury/session-0x29eb14d10ec2e406e5d1419ed08d803b8b18ab70.json"
INPUT_FILE = "artifacts/bradbury/v6-e2e-input.json"
TEST_INPUT_FILE = "tests/fixtures/bradbury-v6-input.json"
PLAN_FILE = "docs/evidence/v6-validation-plan.json"
ORDER_NAMES = ("correction", "badHash", "authorOther", "strictAudit", "falseCaution", "unsupportedPromise", "boundaryIncomplete", "optionalRevision", "sixValid")


def sha(value):
    return hashlib.sha256(value).hexdigest()


def checked_file(path, expected=None):
    raw = (ROOT / path).read_bytes()
    if expected is not None and sha(raw) != expected:
        raise AssertionError("Frozen commitment changed: " + path)
    return raw


def load_contract(path, name):
    module_spec = importlib.util.spec_from_file_location(name, ROOT / path)
    module = importlib.util.module_from_spec(module_spec)
    module_spec.loader.exec_module(module)
    return module


def public_actors():
    # Read only these public address fields from the persisted public session;
    # no private-key field is accessed, exported or needed by this planner.
    session = json.loads((ROOT / SESSION_FILE).read_text(encoding="utf-8"))
    assert isinstance(session.get("transactions"), list), "Known signer history is required"
    actors = {role: session.get("actors", {}).get(role) for role in ("owner", "author", "outsider")}
    assert all(isinstance(value, str) and re.fullmatch(r"0x[0-9a-fA-F]{40}", value) for value in actors.values())
    assert len({value.lower() for value in actors.values()}) == 3
    assert session.get("sessionAddress", "").lower() == actors["owner"].lower() == "0x29eb14d10ec2e406e5d1419ed08d803b8b18ab70"
    return actors


def migrate_spec(rr, source, author, client_ref):
    spec = copy.deepcopy(source)
    spec.update(author=author.lower(), client_ref=client_ref, catalog_version=rr.CATALOG_VERSION)
    for criterion in spec["criteria"]:
        if "unknown_disclosure" in criterion["allowed_claim_types"]:
            criterion["text"] = rr.derive_criterion_text(criterion["requested_field_ids"])
        else:
            criterion["requested_field_ids"] = []
    return rr.normalize_spec(rr.canonical(spec))


def migrate_submission(rr, source, spec, version):
    sub = copy.deepcopy(source)
    sub["report_version"] = version
    by_id = {item["criterion_id"]: item for item in sub["claims"]}
    sub["claims"] = [by_id[item["id"]] for item in spec["criteria"] if item["id"] in by_id]
    assert all(claim["statement"] == by_id[claim["criterion_id"]]["statement"] for claim in sub["claims"] if claim["claim_type"] != "unknown_disclosure")
    sub["report_body"] = "\n".join(rr.render_claim_statement(spec, claim) for claim in sub["claims"])
    return rr.normalize_submission(rr.canonical(sub), spec)


def manually_expected(rr, key, order_id, revision, spec, submission, material_texts):
    checks, materials, material_descriptors = [], [], []
    for index, (source, material) in enumerate(zip(submission["sources"], material_texts)):
        body = material.encode("utf-8")
        actual = sha(body)
        verified = actual == source["sha256"] and len(body) == source["byte_length"]
        assert verified or key == "badHash"
        checks.append({"index": index, "status": "VERIFIED" if verified else "HASH_MISMATCH", "sha256": actual})
        materials.append(material if verified else None)
        material_descriptors.append({"index": index, "fetched_sha256": actual, "fetched_byte_length": len(body), "stored_material": {"sha256": actual, "byte_length": len(body)} if verified else None})
    order = {"id": order_id, "spec": spec, "spec_hash": rr.digest(spec), "policy_version": rr.POLICY_VERSION}
    record = {"order_id": order_id, "revision": revision, "submission": submission, "submission_hash": rr.digest(submission), "content_hash": rr.content_fingerprint(spec, submission)}
    binding = rr.snapshot_binding(order, record)
    snapshot = {"snapshot_version": rr.SNAPSHOT_VERSION, "binding": binding, "source_checks": checks, "materials": materials}
    snapshot["snapshot_hash"] = rr.digest(snapshot)
    rr.validate_snapshot(snapshot, binding, submission)
    verified_indices = {index for index, material in enumerate(materials) if material is not None}
    claims = {claim["criterion_id"]: claim for claim in submission["claims"]}
    findings, initial_calls = [], 0
    for criterion in spec["criteria"]:
        claim = claims.get(criterion["id"])
        finding = {"criterion_id": criterion["id"], "claim_type": None if claim is None else claim["claim_type"], "validity": None, "status": "MISSING", "delivery_status": "INSUFFICIENT", "evidence_indices": [], "basis_scope_source_indices": [], "scope_source_indices": [], "field_checks": [], "reason": "Prelocked policy oracle; reason wording is not an exact-match expectation."}
        if claim is None:
            findings.append(finding)
            continue
        unknown = claim["claim_type"] == "unknown_disclosure"
        selected = list(range(len(submission["sources"]))) if unknown else list(claim["evidence_indices"])
        finding["scope_source_indices" if unknown else "basis_scope_source_indices"] = selected
        if not selected or any(index not in verified_indices for index in selected):
            finding["status"] = "SOURCE_UNAVAILABLE"
            findings.append(finding)
            continue
        initial_calls += 1
        if unknown:
            finding.update(validity="VALID", status="SCOPED_UNKNOWN", delivery_status="FULFILLED" if criterion["evidence_requirement"] == "scoped_unknown_allowed" else "INSUFFICIENT")
            finding["field_checks"] = [{"field_id": field_id, "state": "NOT_ESTABLISHED", "evidence_indices": []} for field_id in criterion["requested_field_ids"]]
            if key == "falseCaution" and criterion["id"] == "permissions":
                assert criterion["requested_field_ids"] == ["default_context_sender"]
                finding.update(validity="CONTRADICTED", status="CONTRADICTED", delivery_status="CONTRADICTED", evidence_indices=[1])
                finding["field_checks"] = [{"field_id": "default_context_sender", "state": "FOUND", "evidence_indices": [1]}]
        else:
            finding.update(validity="ESTABLISHED", status="BOUNDARY_DISCLOSED" if claim["claim_type"] == "boundary_disclosure" else "SUPPORTED", delivery_status="FULFILLED")
            insufficient = (key == "negative" and criterion["id"] == "permissions") or (key == "unsupportedPromise" and criterion["id"] == "withdrawals") or (key == "boundaryIncomplete" and criterion["id"] == "limitations") or (key == "optionalUnsupported" and criterion["id"] == "license_marker")
            if insufficient:
                finding.update(validity="NOT_ESTABLISHED", status="NOT_ESTABLISHED", delivery_status="INSUFFICIENT")
        findings.append(finding)
    verdicts = {"negative": "INSUFFICIENT_EVIDENCE", "positive": "ACCEPTED", "badHash": "INSUFFICIENT_EVIDENCE", "strictAudit": "INSUFFICIENT_EVIDENCE", "falseCaution": "NOT_ACCEPTED", "unsupportedPromise": "INSUFFICIENT_EVIDENCE", "boundaryIncomplete": "INSUFFICIENT_EVIDENCE", "optionalUnsupported": "REVISION_REQUIRED", "optionalOmitted": "ACCEPTED", "sixValid": "ACCEPTED"}
    assessment = {"snapshot_hash": snapshot["snapshot_hash"], "source_checks": checks, "findings": findings, "verdict": verdicts[key]}
    rr.validate_assessment(assessment, spec, submission, snapshot, binding)
    metadata = {"order_id": order_id, "revision": revision, "policy_version": rr.POLICY_VERSION, "spec_hash": order["spec_hash"], "submission_hash": record["submission_hash"], "content_hash": record["content_hash"], "snapshot_hash": snapshot["snapshot_hash"], "scope": "Delivery acceptance against locked public evidence; not investment advice or a safety certification."}
    return {"id": key, "orderId": order_id, "revision": revision, "specHash": order["spec_hash"], "submissionHash": record["submission_hash"], "contentHash": record["content_hash"], "sources": copy.deepcopy(submission["sources"]), "snapshot": {"snapshot_version": rr.SNAPSHOT_VERSION, "binding": binding, "source_checks": checks, "snapshot_hash": snapshot["snapshot_hash"], "materialCommitments": material_descriptors}, "assessment": {"projection": rr.stable_projection(assessment), "rawFindings": findings, "deterministicMetadata": metadata, "assessedAtRule": "Must equal the assessment transaction datetime; not an invented pre-execution value", "reasonRule": "Nonempty, <=800 UTF-8 bytes, no NUL. Placeholder reasons above are NOT compared with actual model prose."}, "modelCallsPerIndependentExecution": {"initial": initial_calls, "maximumGlobalFormatRepairs": 1, "maximum": initial_calls + (1 if initial_calls else 0), "httpRequests": 0}}


def offline_replay(module, stubs, fixture, cases, expected, material_texts):
    """Exercise the planned sequence using explicit scripts, NOT actual models.

    This validates state/guards and the predeclared oracle shape. Returning a
    scripted expected judgment is not evidence that any real model will agree.
    """
    from types import SimpleNamespace
    contract, outputs, traces = None, [], []
    source_bodies = {source["url"]: material.encode("utf-8") for source, material in zip(fixture["correctionPositive"]["sources"], material_texts)}
    counts = {"cases": 0, "scriptedModelStubInvocations": 0, "scriptedHTTPStubInvocations": 0}
    by_context = {item["id"]: item for item in expected}
    def mock_http(url, *, method):
        assert method == "GET"
        counts["scriptedHTTPStubInvocations"] += 1
        return SimpleNamespace(status=200, body=source_bodies[url])
    def mock_model(prompt, *, response_format):
        assert response_format == "json" and outputs
        counts["scriptedModelStubInvocations"] += 1
        traces.append(prompt)
        return copy.deepcopy(outputs.pop(0))
    def mock_consensus(leader, validator):
        value = leader()
        assert validator(stubs.Returned(copy.deepcopy(value))), "Offline independent-validator control flow rejected scripted oracle"
        return value
    stubs.gl.nondet.web = SimpleNamespace(request=mock_http)
    stubs.gl.nondet.exec_prompt = mock_model
    stubs.gl.vm.run_nondet_default = mock_consensus
    for case in cases:
        stubs.gl.message.sender_address = fixture["actors"]["owner"]
        if case["op"] == "deploy":
            contract = module.ResearchReceipt()
            for name in ("orders", "order_ids", "revisions", "evidence_snapshots", "assessments"):
                setattr(contract, name, {})
            assert contract.get_order_count() == 0 and contract.get_policy_version() == module.POLICY_VERSION
            counts["cases"] += 1
            continue
        assert contract is not None
        request = case["request"]
        args = copy.deepcopy(request.get("args")) if case["inputCase"] is None else [*request["prefixArgs"], module.canonical(fixture[case["inputCase"]])]
        before = copy.deepcopy(contract.__dict__)
        oracle = case["readbackOracle"]
        if case["method"] == "evaluate" and not case["expectedError"]:
            findings = by_context[oracle["expectedContext"]]["assessment"]["rawFindings"]
            scripted = [{"field_checks": item["field_checks"], "reason": item["reason"]} if item["claim_type"] == "unknown_disclosure" else {"result": item["validity"], "reason": item["reason"]} for item in findings if item["status"] not in ("MISSING", "SOURCE_UNAVAILABLE")]
            outputs.extend(copy.deepcopy(scripted) + copy.deepcopy(scripted))
        try:
            returned = getattr(contract, case["method"])(*args)
        except stubs.UserError as error:
            assert case["expectedError"] and case["expectedError"] in str(error), (case["name"], str(error))
            assert contract.__dict__ == before, "Expected ERROR changed state: " + case["name"]
        else:
            assert not case["expectedError"], "Expected guard was accepted: " + case["name"]
            order_id = oracle["orderId"]
            order = json.loads(contract.get_order(order_id))
            if case["method"] == "create_order":
                assert returned == order_id == contract.get_order_count()
                assert order["spec_hash"] == oracle["specHash"] and order["status"] == "OPEN" and order["revision_count"] == 0
            elif case["method"] == "submit_revision":
                assert returned == oracle["revision"] == order["revision_count"]
                revision = json.loads(contract.get_revision(order_id, returned))
                for key, expected_key in (("submission_hash", "submissionHash"), ("content_hash", "contentHash"), ("previous_submission_hash", "previousSubmissionHash")):
                    assert revision[key] == oracle[expected_key]
                assert order["status"] == "SUBMITTED"
            elif case["method"] == "verify_evidence":
                snapshot = json.loads(contract.get_evidence_snapshot(order_id, args[1]))
                assert snapshot["snapshot_hash"] == oracle["snapshot"]["snapshot_hash"] and snapshot["binding"] == oracle["snapshot"]["binding"]
                assert snapshot["source_checks"] == oracle["snapshot"]["source_checks"]
                assert contract.get_assessment(order_id, args[1]) == "" and order["status"] == "SUBMITTED"
            elif case["method"] == "evaluate":
                assessment = json.loads(contract.get_assessment(order_id, args[1]))
                assert module.stable_projection(assessment) == oracle["assessment"]["projection"]
                assert all(assessment[key] == value for key, value in oracle["assessment"]["deterministicMetadata"].items())
                assert order["status"] == oracle["status"]
        assert not outputs, "Scripted model output consumption mismatch: " + case["name"]
        counts["cases"] += 1
    assert counts == {"cases": 51, "scriptedModelStubInvocations": 78, "scriptedHTTPStubInvocations": 40}, counts
    return counts, traces, contract.__dict__


def build_plan(prepare):
    for file, expected in ((CANONICAL_FILE, CANONICAL_SHA), (DEPLOYMENT_FILE, DEPLOYMENT_SHA), (BASE_FILE, BASE_SHA), (CATALOG_FILE, CATALOG_SHA), (BUILD_FILE, BUILD_SHA), (FEE_FILE, FEE_SHA)):
        checked_file(file, expected)
    sys.path.insert(0, str(ROOT / "tests/python"))
    import test_contract as stubs
    def forbidden(*args, **kwargs):
        raise AssertionError("Offline planner cannot perform a model/provider/network/consensus call")
    stubs.gl.nondet.exec_prompt = forbidden
    stubs.gl.nondet.web = type("NoNetwork", (), {"request": staticmethod(forbidden)})()
    stubs.gl.vm.run_nondet_default = forbidden
    rr = load_contract(CANONICAL_FILE, "v6_canonical_prelock_helpers")
    deployed = load_contract(DEPLOYMENT_FILE, "v6_deployment_prelock_helpers")
    assert rr.POLICY_VERSION == deployed.POLICY_VERSION == "research-receipt/6"
    assert json.loads(checked_file(CATALOG_FILE)) == rr.field_catalog() == deployed.field_catalog()
    build = json.loads(checked_file(BUILD_FILE))
    assert build["source_sha256"] == CANONICAL_SHA and build["output_sha256"] == DEPLOYMENT_SHA and build["verification"]["exit_code"] == 0
    assert all(build[key] is True for key in ("full_ast_type_comments_equal", "ordered_str_bytes_values_and_utf8_bytes_equal", "runner_first_two_lines_bytes_identical"))
    actors = public_actors()
    original = json.loads(checked_file(BASE_FILE))
    material_texts = original["positive"]["materials"]
    raw_sources = original["positive"]["submission"]["sources"]
    assert len(material_texts) == len(raw_sources) == 2
    for material, source in zip(material_texts, raw_sources):
        body = material.encode("utf-8")
        assert sha(body) == source["sha256"] and len(body) == source["byte_length"]
    refs = {name: str(uuid.uuid4()) if prepare else "v6-check-order-" + str(index).zfill(4) for index, name in enumerate(ORDER_NAMES, 1)}
    fixture = {"format": "research-receipt/v6-business-input/1", "policyVersion": rr.POLICY_VERSION, "actors": actors, "orderIds": {name: index for index, name in enumerate(ORDER_NAMES, 1)}}
    definitions = {"correction": "positive", "badHash": "positive", "authorOther": "positive", "strictAudit": "strictUnknown", "falseCaution": "falseCautionOtherSource", "unsupportedPromise": "unsupportedPromiseAsFactual", "boundaryIncomplete": "boundaryIncomplete", "optionalRevision": "positive", "sixValid": "positive"}
    for name in ORDER_NAMES:
        author = actors["author"] if name == "authorOther" else actors["owner"]
        spec = migrate_spec(rr, original[definitions[name]]["spec"], author, refs[name])
        if name in ("optionalRevision", "sixValid"):
            spec["criteria"].extend([
                {"id": "license_marker", "text": "State the SPDX license identifier declared in committed source 0.", "required": False, "evidence_requirement": "fact_required", "verification_kind": "evidence_review", "allowed_claim_types": ["factual_assertion"], "requested_field_ids": []},
                {"id": "context_return", "text": "State the return value of the default Context._msgSender() implementation in committed source 1.", "required": False, "evidence_requirement": "fact_required", "verification_kind": "evidence_review", "allowed_claim_types": ["factual_assertion"], "requested_field_ids": []},
            ])
            spec = rr.normalize_spec(rr.canonical(spec))
        fixture[name + "Spec"] = spec
    fixture["correctionNegative"] = migrate_submission(rr, original["negative"]["submission"], fixture["correctionSpec"], "v6-negative-1")
    fixture["correctionPositive"] = migrate_submission(rr, original["positive"]["submission"], fixture["correctionSpec"], "v6-positive-2")
    fixture["replaySameContent"] = dict(fixture["correctionNegative"], report_version="v6-replay-label-only")
    fixture["revisionAfterAccepted"] = dict(fixture["correctionPositive"], report_version="v6-post-accept")
    for name in ("badHash", "authorOther", "strictAudit", "falseCaution", "unsupportedPromise", "boundaryIncomplete"):
        fixture[name + "Submission"] = migrate_submission(rr, original[definitions[name]]["submission"], fixture[name + "Spec"], "v6-" + name + "-1")
    fixture["badHashSubmission"]["sources"][0]["sha256"] = "0" * 64
    optional = migrate_submission(rr, original["positive"]["submission"], fixture["optionalRevisionSpec"], "v6-optional-unsupported-1")
    optional["claims"].append({"criterion_id": "license_marker", "claim_type": "factual_assertion", "statement": "Committed source 0 declares SPDX-License-Identifier: MIT, and users can exit immediately without any waiting or restrictions.", "evidence_indices": [0]})
    optional["report_body"] = "\n".join(rr.render_claim_statement(fixture["optionalRevisionSpec"], claim) for claim in optional["claims"])
    fixture["optionalUnsupportedSubmission"] = rr.normalize_submission(rr.canonical(optional), fixture["optionalRevisionSpec"])
    fixture["optionalOmittedSubmission"] = migrate_submission(rr, original["positive"]["submission"], fixture["optionalRevisionSpec"], "v6-optional-omitted-2")
    six = migrate_submission(rr, original["positive"]["submission"], fixture["sixValidSpec"], "v6-six-valid-1")
    six["claims"].extend([
        {"criterion_id": "license_marker", "claim_type": "factual_assertion", "statement": "Committed source 0 declares SPDX-License-Identifier: MIT.", "evidence_indices": [0]},
        {"criterion_id": "context_return", "claim_type": "factual_assertion", "statement": "In the default Context source, _msgSender() returns msg.sender.", "evidence_indices": [1]},
    ])
    six["report_body"] = "\n".join(rr.render_claim_statement(fixture["sixValidSpec"], claim) for claim in six["claims"])
    fixture["sixValidSubmission"] = rr.normalize_submission(rr.canonical(six), fixture["sixValidSpec"])
    fixture["legacyUnknownWithPromise"] = copy.deepcopy(fixture["badHashSubmission"])
    legacy = next(claim for claim in original["legacyUnknownWithPromise"]["submission"]["claims"] if claim["criterion_id"] == "withdrawals")
    fixture["legacyUnknownWithPromise"]["claims"][1] = copy.deepcopy(legacy)
    fixture["legacyUnknownWithPromise"]["report_version"] = "v6-guard-legacy"
    fixture["wrongPermissionsAsBoundary"] = copy.deepcopy(fixture["badHashSubmission"])
    fixture["wrongPermissionsAsBoundary"]["claims"][0]["claim_type"] = "boundary_disclosure"
    fixture["wrongPermissionsAsBoundary"]["report_version"] = "v6-guard-type"
    fixture["unboundBodyPromise"] = copy.deepcopy(fixture["badHashSubmission"])
    fixture["unboundBodyPromise"].update(report_version="v6-guard-body", report_body=fixture["badHashSubmission"]["report_body"] + " Immediate exit and returns are guaranteed.")
    for guard in ("legacyUnknownWithPromise", "wrongPermissionsAsBoundary", "unboundBodyPromise"):
        for module in (rr, deployed):
            try:
                module.normalize_submission(module.canonical(fixture[guard]), fixture["badHashSpec"])
            except stubs.UserError:
                pass
            else:
                raise AssertionError("Unsafe guard was accepted: " + guard)
    contexts = [
        ("negative", 1, 1, "correctionSpec", "correctionNegative"), ("positive", 1, 2, "correctionSpec", "correctionPositive"),
        ("badHash", 2, 1, "badHashSpec", "badHashSubmission"), ("strictAudit", 4, 1, "strictAuditSpec", "strictAuditSubmission"),
        ("falseCaution", 5, 1, "falseCautionSpec", "falseCautionSubmission"), ("unsupportedPromise", 6, 1, "unsupportedPromiseSpec", "unsupportedPromiseSubmission"),
        ("boundaryIncomplete", 7, 1, "boundaryIncompleteSpec", "boundaryIncompleteSubmission"),
        ("optionalUnsupported", 8, 1, "optionalRevisionSpec", "optionalUnsupportedSubmission"), ("optionalOmitted", 8, 2, "optionalRevisionSpec", "optionalOmittedSubmission"),
        ("sixValid", 9, 1, "sixValidSpec", "sixValidSubmission"),
    ]
    expected = []
    for key, order_id, revision, spec_key, sub_key in contexts:
        spec, submission = fixture[spec_key], fixture[sub_key]
        assert rr.normalize_submission(rr.canonical(submission), spec) == submission
        assert deployed.normalize_spec(deployed.canonical(spec)) == spec
        assert deployed.normalize_submission(deployed.canonical(submission), spec) == submission
        assert rr.content_fingerprint(spec, submission) == deployed.content_fingerprint(spec, submission)
        item = manually_expected(rr, key, order_id, revision, spec, submission, material_texts)
        item.update(specInputCase=spec_key, submissionInputCase=sub_key)
        expected.append(item)
    assert [item["modelCallsPerIndependentExecution"]["initial"] for item in expected] == [4, 4, 0, 4, 4, 4, 4, 5, 4, 6]
    by_context = {item["id"]: item for item in expected}
    assert rr.content_fingerprint(fixture["correctionSpec"], fixture["replaySameContent"]) == by_context["negative"]["contentHash"]
    assert rr.digest(fixture["replaySameContent"]) != by_context["negative"]["submissionHash"]
    # Policy flag must not leak into any of the four model prompts.
    for index in range(4):
        a, b = fixture["correctionSpec"], fixture["strictAuditSpec"]
        x, y = fixture["correctionPositive"], fixture["strictAuditSubmission"]
        materials = dict(enumerate(material_texts))
        assert rr.build_model_prompt(a, x, a["criteria"][index], x["claims"][index], materials) == rr.build_model_prompt(b, y, b["criteria"][index], y["claims"][index], materials)
    cases = []
    def add(name, method, order_id=None, input_case=None, args=None, error=None, context=None, phase="remainingSuite", before=None, unchanged_order_count=None):
        op = "deploy" if method is None else "write"
        request = {"op": op, "role": "owner"}
        if op == "deploy":
            request.update(file=DEPLOYMENT_FILE, args=[])
        else:
            request["method"] = method
            if input_case is not None:
                request.update(inputFile=INPUT_FILE, case=input_case, prefixArgs=[] if method == "create_order" else [order_id])
            else:
                request["args"] = args
        expectation = {"requiresFinalized": True, "requiresConsensusAccepted": True, "executionResult": "ERROR" if error else "RETURN", "requiresVerifiedEventInclusion": True, "requiresSourceSenderMethodAndArgsIdentity": True}
        readback = {"orderId": order_id, "expectedContext": context}
        if method is None:
            readback.update(orderCount=0, policyVersion=rr.POLICY_VERSION, catalogFileSha256=CATALOG_SHA, catalogGetterCanonicalSha256=rr.digest(rr.field_catalog()), catalogCanonicalObject=rr.field_catalog(), zeroArgumentConstructor=True)
        elif method == "create_order" and not error:
            readback.update(returnedOrderId=order_id, orderCount=order_id, status="OPEN", revisionCount=0, specHash=rr.digest(fixture[input_case]), owner=actors["owner"].lower(), author=fixture[input_case]["author"])
        elif method == "submit_revision" and not error:
            e = by_context[context]
            readback.update(revision=e["revision"], revisionCount=e["revision"], status="SUBMITTED", specHash=e["specHash"], submissionHash=e["submissionHash"], contentHash=e["contentHash"], previousSubmissionHash=by_context["negative"]["submissionHash"] if context == "positive" else by_context["optionalUnsupported"]["submissionHash"] if context == "optionalOmitted" else "", currentSnapshot="", currentAssessment="")
        elif method == "verify_evidence" and not error:
            readback.update(status="SUBMITTED", snapshot=by_context[context]["snapshot"], assessment="")
        elif method == "evaluate" and not error:
            readback.update(status=by_context[context]["assessment"]["projection"]["verdict"], assessment=by_context[context]["assessment"], snapshotHash=by_context[context]["snapshot"]["snapshot_hash"])
        if error:
            readback.update(rollback=True, unchangedContext=before, orderCount=unchanged_order_count,
                beforeAfterEqualReads=[{"method": "get_order", "args": [order_id]}, {"method": "get_order_count", "args": []}, {"method": "get_evidence_snapshot", "args": [order_id, 1 if before != "positive" else 2]}, {"method": "get_assessment", "args": [order_id, 1 if before != "positive" else 2]}])
            if before not in ("noRevision", None):
                revision = 2 if before == "positive" else 1
                readback["beforeAfterEqualReads"].append({"method": "get_revision", "args": [order_id, revision]})
            if before in by_context:
                readback.update(revisionCount=by_context[before]["revision"], expectedExistingSnapshotHash=by_context[before]["snapshot"]["snapshot_hash"], expectedExistingAssessmentProjection=by_context[before]["assessment"]["projection"])
            elif before == "submittedNegative":
                readback.update(revisionCount=1, currentSnapshot="", currentAssessment="", expectedSubmissionHash=by_context["negative"]["submissionHash"])
            elif before == "noRevision":
                readback.update(revisionCount=0, status="OPEN", currentSnapshot="", currentAssessment="", absentRevision={"method": "get_revision", "args": [order_id, 1], "expectedError": "Revision not found"})
        cases.append({"sequence": len(cases) + 1, "name": name, "phase": phase, "op": op, "method": method, "role": "owner", "inputCase": input_case, "prefixArgs": request.get("prefixArgs"), "args": request.get("args"), "request": request, "expectedTransaction": expectation, "expectedError": error, "readbackOracle": readback, "modelCallsPerIndependentExecution": {"initial": 0, "maximumGlobalFormatRepairs": 0, "httpRequests": 0} if method != "evaluate" or error else by_context[context]["modelCallsPerIndependentExecution"]})
        if method == "verify_evidence" and not error:
            cases[-1]["modelCallsPerIndependentExecution"]["httpRequests"] = 2
    add("deployment", None, phase="firstGate")
    add("createCorrection", "create_order", 1, "correctionSpec", phase="firstGate")
    add("submitNegative", "submit_revision", 1, "correctionNegative", context="negative", phase="firstGate")
    add("evaluateBeforeEvidence", "evaluate", 1, args=[1, 1], error="Verify evidence before assessment", before="submittedNegative", phase="firstGate", unchanged_order_count=1)
    add("verifyNegative", "verify_evidence", 1, args=[1, 1], context="negative", phase="firstGate")
    add("duplicateVerify", "verify_evidence", 1, args=[1, 1], error="already has an immutable evidence snapshot", before="negative", phase="firstGate", unchanged_order_count=1)
    # At duplicateVerify an assessment has not been written yet.
    cases[-1]["readbackOracle"].pop("expectedExistingAssessmentProjection")
    cases[-1]["readbackOracle"]["currentAssessment"] = ""
    add("evaluateNegative", "evaluate", 1, args=[1, 1], context="negative", phase="firstGate")
    add("replaySameContent", "submit_revision", 1, "replaySameContent", error="Research content already appeared", before="negative", phase="firstGate", unchanged_order_count=1)
    add("submitPositive", "submit_revision", 1, "correctionPositive", context="positive", phase="firstGate")
    add("verifyPositive", "verify_evidence", 1, args=[1, 2], context="positive", phase="firstGate")
    add("evaluatePositive", "evaluate", 1, args=[1, 2], context="positive", phase="firstGate")
    add("evaluateAgain", "evaluate", 1, args=[1, 2], error="already has an assessment", before="positive", phase="firstGate", unchanged_order_count=1)
    add("revisionAfterAccepted", "submit_revision", 1, "revisionAfterAccepted", error="Accepted orders are closed", before="positive", phase="firstGate", unchanged_order_count=1)
    def normal_order(name, order_id, spec_key, submission_key, context):
        add("create" + name, "create_order", order_id, spec_key)
        add("submit" + name, "submit_revision", order_id, submission_key, context=context)
        add("verify" + name, "verify_evidence", order_id, args=[order_id, 1], context=context)
        add("evaluate" + name, "evaluate", order_id, args=[order_id, 1], context=context)
    normal_order("BadHash", 2, "badHashSpec", "badHashSubmission", "badHash")
    add("createOtherAuthor", "create_order", 3, "authorOtherSpec")
    add("ownerSubmitWrongAuthor", "submit_revision", 3, "authorOtherSubmission", error="Only the locked author", before="noRevision", unchanged_order_count=3)
    add("verifyNoRevision", "verify_evidence", 3, args=[3, 1], error="Only the current submitted revision", before="noRevision", unchanged_order_count=3)
    add("duplicateClientRef", "create_order", 3, "authorOtherSpec", error="client_ref already exists", before="noRevision", unchanged_order_count=3)
    normal_order("StrictAudit", 4, "strictAuditSpec", "strictAuditSubmission", "strictAudit")
    for guard, error in (("legacyUnknownWithPromise", "Missing or unsupported fields"), ("wrongPermissionsAsBoundary", "Author claim type is not allowed"), ("unboundBodyPromise", "report_body must exactly join")):
        add(guard, "submit_revision", 2, guard, error=error, before="badHash", unchanged_order_count=4)
    normal_order("FalseCaution", 5, "falseCautionSpec", "falseCautionSubmission", "falseCaution")
    normal_order("UnsupportedPromise", 6, "unsupportedPromiseSpec", "unsupportedPromiseSubmission", "unsupportedPromise")
    normal_order("BoundaryIncomplete", 7, "boundaryIncompleteSpec", "boundaryIncompleteSubmission", "boundaryIncomplete")
    normal_order("OptionalUnsupported", 8, "optionalRevisionSpec", "optionalUnsupportedSubmission", "optionalUnsupported")
    add("submitOptionalOmitted", "submit_revision", 8, "optionalOmittedSubmission", context="optionalOmitted")
    add("verifyOptionalOmitted", "verify_evidence", 8, args=[8, 2], context="optionalOmitted")
    add("evaluateOptionalOmitted", "evaluate", 8, args=[8, 2], context="optionalOmitted")
    normal_order("SixValid", 9, "sixValidSpec", "sixValidSubmission", "sixValid")
    assert len(cases) == len({case["name"] for case in cases}) == 51
    assert all(case["role"] == "owner" for case in cases)
    assert len([case for case in cases if case["expectedError"]]) == 11
    assert len([case for case in cases if case["method"] == "evaluate" and not case["expectedError"]]) == len(expected) == 10
    canonical_replay = offline_replay(rr, stubs, fixture, cases, expected, material_texts)
    compact_replay = offline_replay(deployed, stubs, fixture, cases, expected, material_texts)
    assert canonical_replay == compact_replay, "Canonical/actual-deployment artifact lifecycle traces or state differ"
    prior_files = ("docs/evidence/sufficiency-probe-plan.json", "docs/evidence/sufficiency-probe-simulations.json", "docs/evidence/compact-probe-transport-plan.json", "docs/evidence/structured-probe-simulations.json", "docs/evidence/typed-probe-simulations.json", "artifacts/bradbury/sufficiency-probe/positive-deployment-intent.json", "artifacts/bradbury/sufficiency-probe/gas-rejection-nonce-1793881748397.json", "artifacts/bradbury/sufficiency-probe/compact-transport-check.json")
    previous = [{"file": file, "sha256": sha(checked_file(file)), "reinterpretedAsV6Passing": False} for file in prior_files]
    simulation = json.loads(checked_file("docs/evidence/sufficiency-probe-simulations.json"))
    assert simulation["allPlannedPairsPassed"] is True and simulation["genCallsStarted"] == 10 and simulation["chainTransactionsSent"] == 0
    serialized = (json.dumps(fixture, ensure_ascii=False, indent=2) + "\n").encode("utf-8")
    plan = {"format": "research-receipt/v6-prelocked-business-plan/1", "policyVersion": rr.POLICY_VERSION, "mode": "prepared" if prepare else "check-only-preview", "frozenBeforeExecutionAt": datetime.now(timezone.utc).isoformat() if prepare else None,
        "sourceCommitment": {"file": CANONICAL_FILE, "sha256": CANONICAL_SHA}, "deploymentSourceCommitment": {"file": DEPLOYMENT_FILE, "sha256": DEPLOYMENT_SHA, "byteLength": len(checked_file(DEPLOYMENT_FILE))}, "catalogCommitment": {"file": CATALOG_FILE, "sha256": CATALOG_SHA, "version": rr.CATALOG_VERSION}, "buildCommitment": {"file": BUILD_FILE, "sha256": BUILD_SHA, "algorithm": build["algorithm"], "toolSha256": build["tool_sha256"], "algorithmDependencySha256": build["algorithm_dependency_sha256"]},
        "fixtureFile": INPUT_FILE, "fixtureSha256": sha(serialized), "publicFixtureFile": TEST_INPUT_FILE, "originalFixtureCommitment": {"file": BASE_FILE, "sha256": BASE_SHA}, "feeProfileCommitment": {"file": FEE_FILE, "sha256": FEE_SHA}, "plannerSha256": sha(Path(__file__).read_bytes()), "actorCommitment": {"source": "Public actors fields adjacent to transactions in the retained signer session; keys never accessed", "actors": actors, "sha256": rr.digest(actors), "allSigningRoles": "owner", "normalOrderAuthor": actors["owner"].lower(), "separateAuthorGuardOrder": 3, "separateAuthor": actors["author"].lower()},
        "orderIds": fixture["orderIds"], "expectedOrderCount": 9, "requiredSignedCaseCount": 51, "expectedErrorCaseCount": 11, "expectedSuccessfulCaseCount": 40, "cases": cases, "expected": expected, "sourceMaterialCommitments": [{"index": index, "url": source["url"], "sha256": source["sha256"], "byte_length": source["byte_length"]} for index, source in enumerate(raw_sources)],
        "executionProfile": {"leaderTimeunitsAllocation": "600", "validatorTimeunitsAllocation": "600", "executionBudgetPerRound": "10000000000000000", "appealRounds": "0", "rotations": [3], "maximumInitialLeaders": 4, "activeAppeals": 0, "topUps": 0, "automaticRetries": 0, "maximumInitialModelCallsPerIndependentAssessment": 6, "maximumGlobalFormatRepairsPerIndependentAssessment": 1, "maximumModelCallsPerIndependentAssessment": 7, "calibratedWorstCase": False, "singleCommitteeClaim": False},
        "gates": ["Independently review and freeze the actual compact source, canonical equivalence, exact input bytes, fee profile, actors, UUID refs and this plan before any signature.", "Official schema plus a single default unsigned deployment estimate for this actual compact artifact must pass; on failure stop this transport path without changing guards or retrying compression.", "One zero-argument deployment only: verified finalized accepted RETURN, exact source/sender/empty args/non-leader-only/inclusion identity and zero baseline/order count plus both getters before order creation.", "Execute cases 1..13 only first. Negative revision must read back INSUFFICIENT_EVIDENCE, then genuine corrected revision ACCEPTED, with full snapshot/assessment projections and immutable revision-1 history before opening cases 14..51.", "Every actual order ID must equal 1..9 as prelocked. Stop on a different ID; do not reassign IDs or recompute an oracle from chain observations.", "Any model-oracle mismatch, nonaccepted consensus, timeout or UNDETERMINED stops remaining writes. Do not resample or silently resubmit; preserve every attempted hash/unknown send outcome and inspect history.", "Expected ERROR transactions must themselves finalize with accepted consensus, verified inclusion, exact target/args/sender identity and before/after readback equality. A request rejected before any hash is not that signed-case proof.", "All ten assessments compare all nine finding fields, field checks, basis/scope, nulls, source checks, verdict and snapshot hash. Reasons are structurally checked and do not select an oracle.", "Source verification performs two GETs and zero models per independent execution; model assessment performs zero HTTP, including failed source and missing optional branches. Initial model counts are per independent side, not a claim about total private committee executions.", "Only after all 51 case proofs and independent readback audit may publication/default deployment and ZIP be considered. No Portal form is filled or submitted by this plan."],
        "firstGate": {"caseSequences": list(range(1, 14)), "remainingSuiteRequires": ["evaluateNegative", "evaluatePositive", "evaluateAgain", "revisionAfterAccepted"], "automaticContinuation": False},
        "migration": ["This is a new V6 business lifecycle plan, not an edit to the frozen diagnostic or failed deployment plans.", "The V6 code-owned catalog version, natural question criterion text and label-rendered unknown body are an explicit schema/text migration. Factual statements and the two source materials are retained byte-for-byte except the new optional factual controls and deliberate malformed guards.", "Catalog fields are unique, same-group and independent of criterion ID; factual-only/custom boundary criteria have no field IDs. Strict/allow is not exposed to model prompts.", "The old b931 five successful unsigned pairs support its limited diagnostic policy only; they are not V6 business or public committee passes.", "The blocked nonzero-constructor original and compact transport attempts, their inputs, actual errors and plans remain unchanged. This zero-argument staged V6 lifecycle replaces the previously proposed isolated-constructor committee phase; it does not mark that phase complete.", "Optional submitted facts must be sufficiently established. Any submitted optional insufficiency, failed source or strict unknown requires revision; an omitted optional item is MISSING/null and may be ignored. Required items retain their stronger veto."],
        "priorEvidence": previous,
        "offlineOnlyCoverage": ["The 34 canonical V6 and 39 compact equivalence tests use stubs, not real GenVM/model proof.", "One criterion, six criteria, empty claims/sources, source encodings/limits, actor/current-revision checks, five-revision bound, nonadjacent content replay, malformed leaders, full projection tampering and global repair/result preservation are local controls, not additional signed cases in this 51-case suite.", "A single immutable snapshot includes failures. Transient unavailability is locked for that revision; this suite does not add source retries or an abandon mechanism.", "The initial 6+1 model allowance and 600/600 fee allocations are development limits, not measured production worst-case calibration."],
        "offlineSequenceReplay": {"canonical": canonical_replay[0], "compact": compact_replay[0], "modelJudgments": "Manually scripted predeclared outputs, not observed semantic performance", "statesAndPromptTracesEqual": True},
        "ready": False, "chainWritesPerformedByPlanner": 0, "modelCallsPerformedByPlanner": 0, "networkRequestsPerformedByPlanner": 0}
    return fixture, serialized, plan


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--check-only", action="store_true")
    mode.add_argument("--prepare", action="store_true")
    parser.add_argument("--reviewed-source-sha")
    args = parser.parse_args()
    if args.prepare and args.reviewed_source_sha != DEPLOYMENT_SHA:
        parser.error("--prepare requires the explicitly reviewed actual deployment source SHA")
    fixture, serialized, plan = build_plan(args.prepare)
    summary = {"offlineCheckPassed": True, "prepared": args.prepare, "planWritten": False, "finalUUIDsGenerated": args.prepare, "sourceSha256": CANONICAL_SHA, "deploymentSourceSha256": DEPLOYMENT_SHA, "signedCases": len(plan["cases"]), "successfulCases": plan["expectedSuccessfulCaseCount"], "expectedErrors": plan["expectedErrorCaseCount"], "logicalOrders": 9, "snapshotsAndAssessments": len(plan["expected"]), "initialModelCountsPerIndependentAssessment": [item["modelCallsPerIndependentExecution"]["initial"] for item in plan["expected"]], "modelCalls": 0, "networkRequests": 0, "scriptedOfflineSequenceReplay": plan["offlineSequenceReplay"], "caseNames": [item["name"] for item in plan["cases"]]}
    if args.prepare:
        paths = [ROOT / file for file in (INPUT_FILE, TEST_INPUT_FILE, PLAN_FILE)]
        if any(path.exists() for path in paths):
            raise SystemExit("Refuse to overwrite any previously prepared V6 input or plan")
        data = [serialized, serialized, (json.dumps(plan, ensure_ascii=False, indent=2) + "\n").encode("utf-8")]
        for path, raw in zip(paths, data):
            with path.open("xb") as file:
                file.write(raw)
        summary.update(planWritten=True, fixtureSha256=sha(serialized), planSha256=sha(data[2]))
    else:
        summary.update(previewReferencesOnly=True, previewFixtureSha256=sha(serialized))
    print(json.dumps(summary, ensure_ascii=False, sort_keys=True))


if __name__ == "__main__":
    main()
