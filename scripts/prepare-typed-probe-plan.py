"""Offline prelock only: stubs load pure normalizers, never execute a model."""
import hashlib
import importlib.util
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'tests/python'))
import test_contract  # installs the explicitly stubbed GenVM types, no test execution

source_file = 'contracts/research_receipt_typed_probe.py'
source_bytes = (ROOT / source_file).read_bytes()
sha = lambda data: hashlib.sha256(data).hexdigest()
if len(sys.argv) != 2 or sys.argv[1] != sha(source_bytes):
    raise SystemExit('Explicit independently reviewed source SHA-256 is required')
fixture_file = 'artifacts/bradbury/typed-probe-input.json'
fixture_bytes = (ROOT / fixture_file).read_bytes()
assert sha(fixture_bytes) == 'd83ad1fc3877a6dc72ff5f2719ab8ff3ce0abaf253d490a9d5c5551732ec7aa9'
assert fixture_bytes == (ROOT / 'tests/fixtures/bradbury-typed-probe-input.json').read_bytes()
module_spec = importlib.util.spec_from_file_location('typed_plan_normalizers', ROOT / source_file)
probe = importlib.util.module_from_spec(module_spec)
module_spec.loader.exec_module(probe)
fixtures = json.loads(fixture_bytes)
matrix = {
    'positive': (['VALID'] * 4, [[0, 1]] * 4),
    'negative': (['CONTRADICTED', 'VALID', 'VALID', 'VALID'], [[0], [0, 1], [0, 1], [0, 1]]),
    'strictUnknown': (['VALID'] * 4, [[0, 1]] * 4),
    'falseCautionOtherSource': (['CONTRADICTED', 'VALID', 'VALID', 'VALID'], [[1], [0, 1], [0, 1], [0, 1]]),
    'unknownWithPromise': (['VALID', 'NOT_ESTABLISHED', 'VALID', 'VALID'], [[0, 1], [], [0, 1], [0, 1]]),
    'contradictionWithUnknown': (['CONTRADICTED', 'VALID', 'VALID', 'VALID'], [[0], [0, 1], [0, 1], [0, 1]]),
    'boundaryIncomplete': (['VALID', 'VALID', 'VALID', 'NOT_ESTABLISHED'], [[0, 1], [0, 1], [0, 1], []]),
    'unknownAsFactual': (['VALID', 'VALID', 'NOT_ESTABLISHED', 'VALID'], [[0, 1], [0, 1], [], [0, 1]]),
}
expected = []
normalized = {}
for name, (validities, refs) in matrix.items():
    payload = fixtures[name]
    spec = probe.normalize_spec(probe.canonical(payload['spec']))
    submission = probe.normalize_submission(probe.canonical(payload['submission']), spec)
    probe.require_four_tasks(spec, submission)
    checks, materials = probe.verified_inline_sources(submission, tuple(payload['materials']))
    findings = []
    for i, (criterion, claim) in enumerate(zip(spec['criteria'], submission['claims'])):
        finding, error = probe.decode_model_finding({'validity': validities[i], 'evidence_indices': refs[i], 'reason': 'Prelocked expected classification, not an observed model result.'}, criterion, claim, submission, materials)
        assert not error, (name, criterion['id'], error)
        findings.append(finding)
    assessment = {'findings': findings, 'source_checks': checks, 'verdict': probe.aggregate_verdict(spec, findings)}
    probe.validate_assessment(assessment, spec, submission, tuple(payload['materials']))
    normalized[name] = (spec, submission, materials)
    expected.append({'id': name, 'contentHash': probe.content_fingerprint(submission), 'expectedReceipt': {'probe_version': probe.PROBE_VERSION, 'spec_hash': probe.digest(spec), 'submission_hash': probe.digest(submission), 'assessment': probe.stable_projection(assessment)}})
for criterion, claim in zip(normalized['positive'][0]['criteria'], normalized['positive'][1]['claims']):
    strict_criterion = next(c for c in normalized['strictUnknown'][0]['criteria'] if c['id'] == criterion['id'])
    strict_claim = next(c for c in normalized['strictUnknown'][1]['claims'] if c['criterion_id'] == criterion['id'])
    assert probe.criterion_prompt(*normalized['positive'][:2], criterion, claim, normalized['positive'][2]) == probe.criterion_prompt(*normalized['strictUnknown'][:2], strict_criterion, strict_claim, normalized['strictUnknown'][2])
payload = fixtures['falsePermissionsAsBoundary']
try:
    probe.normalize_submission(probe.canonical(payload['submission']), probe.normalize_spec(probe.canonical(payload['spec'])))
except test_contract.UserError:
    pass
else:
    raise AssertionError('False factual permission assertion must not be relabelled as boundary')
plan = {
    'format': 'research-receipt/typed-review-probe-plan/1',
    'frozenBeforeExecutionAt': datetime.now(timezone.utc).isoformat(),
    'sourceFile': source_file, 'sourceSha256': sha(source_bytes), 'probeVersion': probe.PROBE_VERSION,
    'fixtureFile': fixture_file, 'fixtureSha256': sha(fixture_bytes),
    'feeProfileSha256': sha((ROOT / 'src/fee-profile.json').read_bytes()),
    'simulationOrder': ['positive', 'negative', 'falseCautionOtherSource', 'unknownWithPromise', 'boundaryIncomplete'],
    'committeeOrder': ['positive', 'negative'], 'expected': expected,
    'executionLimits': {'genCalls': 10, 'pairsPerCase': 1, 'committeeDeployments': 2, 'automaticRetries': 0, 'httpCallsPerIndependentExecution': 0, 'initialModelCallsPerIndependentExecution': 4, 'maximumGlobalFormatRepairsPerIndependentExecution': 1, 'activeAppeals': 0, 'topUps': 0},
    'gates': ['All offline guards and independent review pass before simulations.', 'Every prior simulation must match the entire prelocked projection; any failure stops all following cases and committee deployments.', 'Strict/allow unknown share identical model prompts and differ only in deterministic delivery; no extra sampling.', 'Committee positive then negative, once each, only after all five pairs pass; stop on first failure.', 'Committee proof requires accepted finalized RETURN, source/sender/constructor/inclusion identity and complete latest-final receipt equality.'],
    'migration': ['Separate new typed schema; original v5 source, failed fixture, expected oracle and attempts remain unchanged.', 'Unknown-disclosure scope explicitly covers both submitted source files, including sources omitted from selected author citations.', 'Boundary requirement explicitly enumerates derived overrides, proxies, actual deployments and safety/return guarantees; BOUNDARY_DISCLOSED is not an underlying factual-safety finding.', 'Valid corpus-wide unknown disclosure must cite every reviewed material; legal citation sets are sorted without adding or removing members.'],
    'offlineOnlyControls': ['falsePermissionsAsBoundary normalization rejects before model execution', 'unknownAsFactual cannot satisfy factual requested evidence', 'contradictionWithUnknown retains contradiction precedence', 'bad inline bytes reject before models', 'claim-type-only changes preserve content fingerprint', 'strict/allow prompt byte equality', 'invalid citations and changed validity during format repair fail closed'],
    'limits': ['Unsigned gen_call pairs are real model executions, not on-chain committee consensus.', 'Independent committee deployments do not prove production lifecycle or broad model reliability.', 'Private validator configuration and timeout causes remain unknown; allocations are not calibrated resource bounds.', 'Any later production schema must independently bind typed spec/submission, immutable snapshot and client export/resume state, then pass a new complete E2E suite.'],
}
target = ROOT / 'docs/evidence/typed-probe-plan.json'
with target.open('x', encoding='utf-8', newline='\n') as output:
    output.write(json.dumps(plan, ensure_ascii=False, indent=2) + '\n')
print(json.dumps({'prepared': True, 'sourceSha256': sha(source_bytes), 'fixtureSha256': sha(fixture_bytes), 'planSha256': sha(target.read_bytes()), 'cases': len(expected), 'modelCalls': 0, 'networkRequests': 0}))
