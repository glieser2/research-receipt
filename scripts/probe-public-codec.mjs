// Pure decoding of unsigned public gen_call diagnostic responses. No RPC or signing.
import { createHash } from 'node:crypto';
import { abi } from 'genlayer-js';
export const sha256 = value => createHash('sha256').update(value).digest('hex');
export const hexBytes = value => typeof value === 'string' && /^(?:0x)?(?:[0-9a-fA-F]{2})+$/.test(value) ? Buffer.from(value.replace(/^0x/, ''), 'hex') : null;
const field = (value, key) => value instanceof Map ? value.get(key) : value?.[key];
const plain = value => value instanceof Map ? Object.fromEntries([...value].map(([key, item]) => [key, plain(item)])) : value instanceof Uint8Array ? { byteLength: value.length, sha256: sha256(value) } : Array.isArray(value) ? value.map(plain) : typeof value === 'bigint' ? value.toString() : value;
const safeKeys = new Set(['probe_version','phase','stage','case_id','index','byte_length','expected_byte_length','sha256','criterion_id','status','delivery_status','evidence_indices','reason_bytes','error_code','error_type','projection','equal','spec_hash','submission_hash','content_hash','verdict','model_calls','web_calls','format_repairs']);
export function trustedMarkers(stdout) {
  const result = [];
  for (const line of String(stdout || '').split(/\r?\n/)) {
    if (!line.startsWith('RR_V3_PROBE_JSON ') || line.length > 16384) continue;
    try {
      const value = JSON.parse(line.slice('RR_V3_PROBE_JSON '.length));
      if (value.probe_version !== 'research-receipt-v3-probe/1' || !['constructor','leader','validator'].includes(value.phase) || typeof value.stage !== 'string') continue;
      result.push(Object.fromEntries(Object.entries(value).filter(([key]) => safeKeys.has(key))));
    } catch { /* Arbitrary stdout is never copied into evidence. */ }
  }
  return result;
}
export function publicDataSummary(value) {
  const bytes = hexBytes(value);
  if (!bytes) return { nonemptyHex: false, decoded: false };
  try {
    const outer = abi.calldata.decode(bytes), outputs = field(outer, 'nd_outs');
    return { nonemptyHex: true, byteLength: bytes.length, sha256: sha256(bytes), decoded: true, outputCount: Array.isArray(outputs) ? outputs.length : null };
  } catch { return { nonemptyHex: true, byteLength: bytes.length, sha256: sha256(bytes), decoded: false }; }
}
export function publicResponse(response) {
  return { status: response?.status ? { code: response.status.code, messageByteLength: Buffer.byteLength(String(response.status.message || '')), messageSha256: sha256(String(response.status.message || '')) } : null,
    nondetDisagreementCallNo: response?.nondetDisagreementCallNo ?? null, syncedBlock: response?.syncedBlock ?? null,
    rawPublicFields: { data: hexBytes(response?.data) || response?.data === '' ? response.data : null, leaderPublicData: hexBytes(response?.leaderPublicData) || response?.leaderPublicData === '' ? response.leaderPublicData : null },
    publicData: publicDataSummary(response?.leaderPublicData), markers: trustedMarkers(response?.stdout), stdoutBytes: typeof response?.stdout === 'string' ? Buffer.byteLength(response.stdout) : null };
}
const sensitive = value => {
  if (typeof value === 'string') return /(?:authorization|bearer\s+\S+|(?:api[_-]?key|password|secret|token|private[_-]?key)\s*[:=]|sk-[A-Za-z0-9]{12})/i.test(value);
  const entries = value instanceof Map ? [...value] : value && typeof value === 'object' ? Object.entries(value) : [];
  return entries.some(([key,item]) => /^(?:cfg|config|credentials?|api[_-]?key|authorization|password|secret|token|private[_-]?key)$/i.test(String(key)) || sensitive(item));
};
const ownErrors = /^(?:Model output rejected(?: after format(?:-repair budget| repair))?: RR_MODEL_[A-Z_]+|Assessment verdict does not follow the locked policy|Delivery status does not follow the locked evidence requirement)$/;
function errorView(value, key = '', depth = 0) {
  if (depth > 12) return { omitted: 'depth' };
  if (typeof value === 'string') {
    if (ownErrors.test(value)) return { ownUserError: value };
    if (['UserError','NameError','TypeError','ValueError','AttributeError','KeyError','Forbidden','BudgetExceeded'].includes(value)) return value;
    if (['module_name','func','file','name'].includes(key) && /^[A-Za-z0-9_.<>/ -]{1,160}$/.test(value)) return value;
    return { type: 'string', byteLength: Buffer.byteLength(value), sha256: sha256(value) };
  }
  if (value instanceof Uint8Array) return { type: 'bytes', byteLength: value.length, sha256: sha256(value) };
  if (value instanceof Map) return Object.fromEntries([...value].map(([name,item]) => [name,errorView(item,name,depth+1)]));
  if (Array.isArray(value)) return value.map(item => errorView(item,key,depth+1));
  return plain(value);
}
export function publicError(error) {
  const message = typeof error?.message === 'string' ? error.message : '';
  let kind = message.match(/VMResult\{Kind:(0x[0-9a-fA-F]+)/)?.[1] || null, bytes;
  const list = message.match(/(?:ReturnData|Data):\[\](?:uint8|byte)\{([^}]*)\}/)?.[1];
  if (list !== undefined) {
    const values = list.split(',').map(item => item.trim()).filter(Boolean);
    if (values.every(item => /^(?:0x[0-9a-fA-F]{1,2}|\d{1,3})$/.test(item) && Number(item) <= 255)) bytes = Buffer.from(values.map(Number));
  }
  const nested = error?.data?.vmResult || error?.data?.vm_result || error?.data?.VMResult;
  if (!bytes && nested) { bytes = hexBytes(nested.Data ?? nested.ReturnData ?? nested.data); kind = nested.Kind ?? nested.kind ?? kind; }
  const result = { rpcCode: error?.code ?? null, messageByteLength: Buffer.byteLength(message), messageSha256: sha256(message), publicFields: error?.data && typeof error.data === 'object' ? publicResponse(error.data) : null, vmResult: { kind, decoded: false } };
  if (bytes) {
    Object.assign(result.vmResult, { byteLength: bytes.length, sha256: sha256(bytes) });
    try {
      const decoded = abi.calldata.decode(bytes); result.vmResult.decoded = true;
      if (sensitive(decoded)) result.vmResult.filtered = 'configuration or credential-shaped fields excluded';
      else Object.assign(result.vmResult, { rawDataHex: `0x${bytes.toString('hex')}`, decodedWhitelist: errorView(decoded) });
    } catch { result.vmResult.filtered = 'unknown binary codec; only hash and byte length retained'; }
  }
  return result;
}
