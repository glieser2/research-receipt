"""Prelock a distinct structured-disclosure experiment; no network/model calls."""
import hashlib
import importlib.util
import json
import sys
from datetime import datetime, timezone
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'tests/python'))
import test_contract
sha = lambda data: hashlib.sha256(data).hexdigest()
source_file = 'contracts/research_receipt_structured_probe.py'
source_bytes = (ROOT / source_file).read_bytes()
if len(sys.argv) not in (2, 3) or sys.argv[1] != sha(source_bytes) or (len(sys.argv) == 3 and sys.argv[2] != '--check-only'):
    raise SystemExit('Explicit independently reviewed source SHA-256 is required')
fixture_file = 'artifacts/bradbury/structured-probe-input.json'
fixture_bytes = (ROOT / fixture_file).read_bytes()
assert sha(fixture_bytes) == '73703b4f60883ae6c51eeca9dd42a4dc945e97d020d88e6616af10679982b0d9'
assert fixture_bytes == (ROOT / 'tests/fixtures/bradbury-structured-probe-input.json').read_bytes()
assert sha((ROOT / 'contracts/research_receipt_typed_probe.py').read_bytes()) == 'db275c89e769e158e93db9632a2f0a61f5284e7d0048a064be372196293b77f3'
assert sha((ROOT / 'contracts/research_receipt.py').read_bytes()) == '60b89ea573ca9abba76c4432c0ae38195c5405e85bad7f492b77000d9b6b9d65'
module_spec = importlib.util.spec_from_file_location('structured_prelock_helpers', ROOT / source_file)
probe = importlib.util.module_from_spec(module_spec)
module_spec.loader.exec_module(probe)
fixtures = json.loads(fixture_bytes)
cases = ['positive', 'negative', 'strictUnknown', 'falseCautionOtherSource', 'unsupportedPromiseAsFactual', 'boundaryIncomplete', 'unknownAsFactual']
expected, normalized = [], {}
for name in cases:
    payload = fixtures[name]
    spec = probe.normalize_spec(probe.canonical(payload['spec']))
    submission = probe.normalize_submission(probe.canonical(payload['submission']), spec)
    assert probe.normalize_submission(probe.canonical(submission), spec) == submission
    checks, materials = probe.verified_inline_sources(submission, tuple(payload['materials']))
    findings = []
    for criterion, claim in zip(spec['criteria'], submission['claims']):
        finding = {'criterion_id': criterion['id'], 'claim_type': claim['claim_type'], 'validity': 'VALID', 'status': 'SUPPORTED', 'delivery_status': 'FULFILLED', 'evidence_indices': list(claim.get('evidence_indices', [])), 'scope_source_indices': [], 'field_checks': [], 'reason': 'Prelocked expected classification, not an observed model result.'}
        if claim['claim_type'] == 'unknown_disclosure':
            finding['scope_source_indices'] = [0, 1]
            finding['field_checks'] = [{'field_id': field_id, 'state': 'NOT_ESTABLISHED', 'evidence_indices': []} for field_id in criterion['requested_field_ids']]
            finding['status'] = 'SCOPED_UNKNOWN'
            finding['evidence_indices'] = []
            if name == 'falseCautionOtherSource' and criterion['id'] == 'permissions':
                finding.update(validity='CONTRADICTED', status='CONTRADICTED', delivery_status='CONTRADICTED', evidence_indices=[1])
                finding['field_checks'] = [{'field_id': 'default_context_sender', 'state': 'FOUND', 'evidence_indices': [1]}]
            elif criterion['evidence_requirement'] != 'scoped_unknown_allowed':
                finding['delivery_status'] = 'INSUFFICIENT'
        elif claim['claim_type'] == 'boundary_disclosure':
            finding['status'] = 'BOUNDARY_DISCLOSED'
        if name == 'negative' and criterion['id'] == 'permissions':
            finding.update(validity='CONTRADICTED', status='CONTRADICTED', delivery_status='CONTRADICTED', evidence_indices=[0])
        if (name == 'unsupportedPromiseAsFactual' and criterion['id'] == 'withdrawals') or (name == 'boundaryIncomplete' and criterion['id'] == 'limitations') or (name == 'unknownAsFactual' and criterion['id'] == 'audit'):
            finding.update(validity='NOT_ESTABLISHED', status='NOT_ESTABLISHED', delivery_status='INSUFFICIENT', evidence_indices=[])
        findings.append(finding)
    verdict = 'NOT_ACCEPTED' if any(f['delivery_status'] == 'CONTRADICTED' for f in findings) else 'INSUFFICIENT_EVIDENCE' if any(f['delivery_status'] == 'INSUFFICIENT' for f in findings) else 'ACCEPTED'
    assessment = {'findings': findings, 'source_checks': checks, 'verdict': verdict}
    probe.validate_assessment(assessment, spec, submission, tuple(payload['materials']))
    normalized[name] = spec, submission, materials
    expected.append({'id': name, 'contentHash': probe.content_fingerprint(spec, submission), 'expectedReceipt': {'probe_version': probe.PROBE_VERSION, 'spec_hash': probe.digest(spec), 'submission_hash': probe.digest(submission), 'assessment': probe.stable_projection(assessment)}})
for name in ['legacyUnknownWithPromise', 'extraPromiseField', 'unboundBodyPromise']:
    payload = fixtures[name]
    try:
        probe.normalize_submission(probe.canonical(payload['submission']), probe.normalize_spec(probe.canonical(payload['spec'])))
    except test_contract.UserError:
        pass
    else:
        raise AssertionError('Unsafe input must be rejected without a model: ' + name)
for i in range(4):
    spec, submission, materials = normalized['positive']
    strict_spec, strict_submission, strict_materials = normalized['strictUnknown']
    assert probe.build_model_prompt(spec, submission, spec['criteria'][i], submission['claims'][i], materials) == probe.build_model_prompt(strict_spec, strict_submission, strict_spec['criteria'][i], strict_submission['claims'][i], strict_materials)
prior_file = 'docs/evidence/typed-probe-simulations.json'
prior_bytes = (ROOT / prior_file).read_bytes()
assert json.loads(prior_bytes)['allPlannedPairsPassed'] is False
plan = {
    'format': 'research-receipt/structured-disclosure-probe-plan/1', 'frozenBeforeExecutionAt': datetime.now(timezone.utc).isoformat(),
    'sourceFile': source_file, 'sourceSha256': sha(source_bytes), 'probeVersion': probe.PROBE_VERSION,
    'fixtureFile': fixture_file, 'fixtureSha256': sha(fixture_bytes), 'feeProfileSha256': sha((ROOT / 'src/fee-profile.json').read_bytes()),
    'priorFailedExperiment': {'file': prior_file, 'sha256': sha(prior_bytes), 'reinterpretedAsPassing': False},
    'simulationOrder': ['positive', 'negative', 'falseCautionOtherSource', 'unsupportedPromiseAsFactual', 'boundaryIncomplete'], 'committeeOrder': ['positive', 'negative'], 'expected': expected,
    'executionLimits': {'genCalls': 10, 'pairsPerCase': 1, 'committeeDeployments': 2, 'automaticRetries': 0, 'httpCallsPerIndependentExecution': 0, 'initialModelCallsPerIndependentExecution': 4, 'maximumGlobalFormatRepairsPerIndependentExecution': 1, 'activeAppeals': 0, 'topUps': 0},
    'gates': ['Independent review and offline guards pass before simulation.', 'Exactly one pair per prelocked case in fixed order; any oracle, format or comparison failure stops following simulations and all committee deployments.', 'Only after all five pairs pass: positive then negative committee deployment, once each; stop on first failed deployment.', 'Finalized accepted RETURN is required along with source/sender/constructor/non-leader-only/inclusion identity and exact complete receipt plus assessment projection.'],
    'migration': ['A new structural experiment, not a prompt retry or retrospective change to the failed typed oracle.', 'Buyer commits IDs from a code-owned question registry; this diagnostic registry is limited and is not a claim of general product coverage.', 'Author unknown claims have exactly four keys; no free statement, notes, targets or chosen citations. Generated body must match exactly, with no cleaning of old promises.', 'Unknown models assess every locked field against all pinned materials. FOUND requires actual citations; NOT_ESTABLISHED has empty citations. Scope and actual citations are separate full-projection fields.', 'Any FOUND field prevents the complete field set from being classified unknown; all NOT_ESTABLISHED is scoped uncertainty, not author abstention or proof of an underlying fact.', 'False-caution criterion explicitly locks only default_context_sender; its new question and generated body differ from the old free-text case.', 'Factual and boundary review semantics and their actual references remain unchanged; their new field/scope arrays are empty.'],
    'offlineOnlyControls': ['Legacy unknown promise payload, extra promise field and unbound report-body promise are rejected before any model.', 'Unknown schema rejects free statement/notes, author field selections, forged scope and version.', 'Buyer field sets reject missing/duplicate/unregistered IDs or free question text.', 'Normalization is idempotent; fingerprint uses effective rendered content and source scope while submission hash retains typed input.', 'Invalid source bytes reject before models; format repair is global once and preserves any legal field states and factual validity.', 'Strict/allow unknown model prompts are identical; only deterministic delivery differs.'],
    'limits': ['gen_call is unsigned simulation, not on-chain committee consensus or business lifecycle E2E.', 'Code-generated text prevents this unknown-input promise carrier but does not prove that sources lack answers; independent model review remains necessary.', 'Factual/boundary model reliability and prompt-injection resistance are not guaranteed.', 'Provider identity, private validator behavior and timeout causes are unknown; 600/600 allocations are not a measured worst-case calibration.', 'A production schema must separately bind buyer spec, author payload, immutable snapshot, field outcomes and pending/resume state, then pass the complete new business suite.'],
}
if '--check-only' in sys.argv:
    print(json.dumps({'offlineCheckPassed': True, 'sourceSha256': sha(source_bytes), 'cases': len(expected), 'modelCalls': 0, 'networkRequests': 0, 'planWritten': False}))
    raise SystemExit(0)
target = ROOT / 'docs/evidence/structured-probe-plan.json'
with target.open('x', encoding='utf-8', newline='\n') as output:
    output.write(json.dumps(plan, ensure_ascii=False, indent=2) + '\n')
print(json.dumps({'prepared': True, 'sourceSha256': sha(source_bytes), 'fixtureSha256': sha(fixture_bytes), 'planSha256': sha(target.read_bytes()), 'cases': len(expected), 'modelCalls': 0, 'networkRequests': 0}))
