"""Offline controlled-output probe parity checks. No semantic or GenVM claims."""
import contextlib
import copy
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import sys
from types import SimpleNamespace
import test_contract as base

ROOT = Path(__file__).resolve().parents[2]


def main():
    module_spec = importlib.util.spec_from_file_location("generated_v3_probe", sys.argv[1])
    module = importlib.util.module_from_spec(module_spec)
    module_spec.loader.exec_module(module)
    fixture = json.loads(Path(sys.argv[2]).read_text(encoding="utf-8"))
    plan = json.loads(Path(sys.argv[3]).read_text(encoding="utf-8"))
    bodies = {
        "Ownable.sol": (ROOT / "artifacts/live/Ownable.sol").read_bytes(),
        "Context.sol": (ROOT / "artifacts/bradbury/Context.sol").read_bytes(),
    }
    checks = 0
    fixture_hashes = {}
    for item in plan["expected"]:
        spec = module.normalize_spec(json.dumps(fixture[item["spec"]]))
        if item.get("normalizationReject"):
            calls = {"web": 0, "model": 0}
            def forbidden(*args, **kwargs):
                raise AssertionError("Normalization-rejection case entered a provider")
            base.gl.nondet.web = SimpleNamespace(request=forbidden)
            base.gl.nondet.exec_prompt = forbidden
            with contextlib.redirect_stdout(io.StringIO()):
                try:
                    module.ResearchReceiptV3Probe(json.dumps(fixture[item["spec"]]), json.dumps(fixture[item["submission"]]), item["id"])
                    raise AssertionError("Unbound report body was accepted")
                except base.UserError as error:
                    assert str(error) == "report_body must exactly join submitted statements in locked criterion order"
            fixture_hashes[item["id"]] = {"spec_hash": module.digest(spec), "normalizationRejected": True}
            checks += 1
            continue
        submission = module.normalize_submission(json.dumps(fixture[item["submission"]]), spec)
        if item.get("normalizationMatches"):
            comparison = module.normalize_submission(json.dumps(fixture[item["normalizationMatches"]]), spec)
            assert submission == comparison
        expected_by_id = dict(zip([row["id"] for row in spec["criteria"]], item["statuses"]))
        calls = {"web": 0, "model": 0, "validator": 0}

        def fetch(url, *, method):
            assert method == "GET"
            calls["web"] += 1
            return SimpleNamespace(status=200, body=bodies[url.rsplit("/", 1)[-1]])

        def prompt(value, *, response_format):
            assert response_format == "json"
            calls["model"] += 1
            task = json.loads(value.split("EVIDENCE_JSON:\n", 1)[1].split("\nFORMAT_REPAIR_ERROR_CODE:", 1)[0])
            criterion = task["criterion"]["id"]
            if plan["policyVersion"] == "research-receipt/4":
                assert "report_body" not in task
                assert set(task) == {"protocol", "chain", "as_of", "criterion", "claim", "sources"}
                for other in submission["claims"]:
                    if other["criterion_id"] != criterion:
                        assert other["statement"] not in value
            return {"status": expected_by_id[criterion], "reason": "Controlled offline provider value.", "evidence_indices": task["claim"]["evidence_indices"][:1]}

        def run(leader, validator):
            result = leader()
            calls["validator"] += 1
            assert validator(base.Returned(copy.deepcopy(result))) is True
            return result

        base.gl.nondet.web = SimpleNamespace(request=fetch)
        base.gl.nondet.exec_prompt = prompt
        base.gl.vm.run_nondet_default = run
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            module.ResearchReceiptV3Probe(json.dumps(fixture[item["spec"]]), json.dumps(fixture[item["submission"]]), item["id"])
        events = [json.loads(line.split(" ", 1)[1]) for line in output.getvalue().splitlines() if line.startswith("RR_V3_PROBE_JSON ")]
        fixture_event = next(event for event in events if event["stage"] == "fixture")
        assert fixture_event["spec_hash"] == module.digest(spec)
        assert fixture_event["submission_hash"] == module.digest(submission)
        fixture_hashes[item["id"]] = {"spec_hash": module.digest(spec), "submission_hash": module.digest(submission)}
        for phase in ("leader", "validator"):
            event = next(event for event in events if event["phase"] == phase and event["stage"] == "independent_complete")
            assert [row["status"] for row in event["projection"]["findings"]] == item["statuses"], item["id"]
            assert [row["delivery_status"] for row in event["projection"]["findings"]] == item["delivery"], item["id"]
            assert event["projection"]["verdict"] == item["verdict"], item["id"]
            if "modelCalls" in item:
                assert event["model_calls"] == item["modelCalls"]
            assert event["format_repairs"] == 0
        assert "Controlled offline provider value." not in output.getvalue()
        assert calls["validator"] == 1
        checks += 1

    # Invalid-output repair is globally bounded; I/O errors are never retried.
    spec = module.normalize_spec(json.dumps(fixture["spec"]))
    submission = module.normalize_submission(json.dumps(fixture["positive"]), spec)
    calls = {"model": 0, "web": 0}
    def malformed(value, **kwargs):
        calls["model"] += 1
        return {"status": "SUPPORTED", "evidence_indices": [99], "reason": "not logged"}
    base.gl.nondet.exec_prompt = malformed
    with contextlib.redirect_stdout(io.StringIO()):
        try:
            module.probe_v3_assessment(spec, submission, "leader")
            raise AssertionError("Malformed model output accepted")
        except base.UserError:
            pass
    assert calls["model"] == 2
    checks += 1
    def io_error(value, **kwargs):
        calls["model"] += 1
        raise RuntimeError("Do not log generic provider errors")
    calls["model"] = 0
    base.gl.nondet.exec_prompt = io_error
    with contextlib.redirect_stdout(io.StringIO()):
        try:
            module.probe_v3_assessment(spec, submission, "leader")
            raise AssertionError("I/O exception swallowed")
        except RuntimeError:
            pass
    assert calls["model"] == 1
    checks += 1
    print(json.dumps({"caseParityChecks": len(plan["expected"]), "totalChecks": checks, "controlledModelOutputs": True, "fixtureHashes": fixture_hashes, "networkRequests": 0}))


if __name__ == "__main__":
    main()
