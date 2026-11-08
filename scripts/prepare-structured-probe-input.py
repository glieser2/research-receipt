"""Prepare new structural inputs without executing models or modifying old fixtures."""
import copy
import hashlib
import importlib.util
import json
import sys
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'tests/python'))
import test_contract  # explicit GenVM stubs only
old_bytes = (ROOT / 'tests/fixtures/bradbury-typed-probe-input.json').read_bytes()
assert hashlib.sha256(old_bytes).hexdigest() == 'd83ad1fc3877a6dc72ff5f2719ab8ff3ce0abaf253d490a9d5c5551732ec7aa9'
old = json.loads(old_bytes)
module_spec = importlib.util.spec_from_file_location('structured_fixture_helpers', ROOT / 'contracts/research_receipt_structured_probe.py')
probe = importlib.util.module_from_spec(module_spec)
module_spec.loader.exec_module(probe)
FIELDS = {
    'permissions': ['default_ownable_controls', 'default_context_sender', 'default_upgrade_entry'],
    'withdrawals': ['withdrawal_waiting_period', 'instant_exit_conditions'],
    'audit': ['audit_coverage', 'audit_version'],
    'limitations': [],
}
def add_fields(payload):
    for criterion in payload['spec']['criteria']:
        criterion['requested_field_ids'] = list(FIELDS[criterion['id']])
    return payload
def unknown(criterion_id):
    return {'criterion_id': criterion_id, 'claim_type': 'unknown_disclosure', 'disclosure_version': 'scoped-unknown/1', 'scope': 'all_committed_sources'}
def body(payload):
    spec = probe.normalize_spec(probe.canonical(payload['spec']))
    by_id = {c['criterion_id']: c for c in payload['submission']['claims']}
    payload['submission']['report_body'] = '\n'.join(probe.render_claim_statement(spec, by_id[c['id']]) for c in spec['criteria'])
    return payload
inputs = {}
for name in ['positive', 'negative', 'strictUnknown']:
    row = add_fields(copy.deepcopy(old[name]))
    row['submission']['claims'] = [unknown(c['criterion_id']) if c['claim_type'] == 'unknown_disclosure' else c for c in row['submission']['claims']]
    inputs[name] = body(row)
row = copy.deepcopy(inputs['positive'])
criterion = row['spec']['criteria'][0]
criterion['requested_field_ids'] = ['default_context_sender']
criterion['text'] = '核查提交的固定commit版Context默认_msgSender()返回值；材料已经给出答案时不得将它标为未知。'
row['submission']['claims'][0] = unknown('permissions')
inputs['falseCautionOtherSource'] = body(row)
row = copy.deepcopy(inputs['positive'])
row['submission']['claims'][1] = {'criterion_id': 'withdrawals', 'claim_type': 'factual_assertion', 'statement': old['unknownWithPromise']['submission']['claims'][1]['statement'], 'evidence_indices': [0, 1]}
inputs['unsupportedPromiseAsFactual'] = body(row)
row = copy.deepcopy(inputs['positive'])
row['submission']['claims'][3]['statement'] = '本报告有局限性。'
inputs['boundaryIncomplete'] = body(row)
row = copy.deepcopy(inputs['positive'])
row['submission']['claims'][2] = {'criterion_id': 'audit', 'claim_type': 'factual_assertion', 'statement': old['positive']['submission']['claims'][2]['statement'], 'evidence_indices': [0, 1]}
inputs['unknownAsFactual'] = body(row)
# Preserve the old authored submission verbatim; only supply the new buyer schema
# so rejection tests the forbidden unknown fields rather than missing spec fields.
inputs['legacyUnknownWithPromise'] = add_fields(copy.deepcopy(old['unknownWithPromise']))
row = copy.deepcopy(inputs['positive'])
row['submission']['claims'][1]['promise'] = '因此该协议用户能够随时即时退出。'
inputs['extraPromiseField'] = row
row = copy.deepcopy(inputs['positive'])
row['submission']['report_body'] += '\n因此该协议用户能够随时即时退出。'
inputs['unboundBodyPromise'] = row
serialized = (json.dumps(inputs, ensure_ascii=False, indent=2) + '\n').encode('utf-8')
assert len(serialized) <= 131072, 'The fixed diagnostic fixture must fit the existing input-file limit'
for target in ['artifacts/bradbury/structured-probe-input.json', 'tests/fixtures/bradbury-structured-probe-input.json']:
    with (ROOT / target).open('xb') as output:
        output.write(serialized)
print(json.dumps({'prepared': True, 'fixtureSha256': hashlib.sha256(serialized).hexdigest(), 'bytes': len(serialized), 'cases': list(inputs), 'modelCalls': 0, 'networkRequests': 0}))
