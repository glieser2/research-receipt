export interface EvidenceSourceCheck { index: number; status: 'VERIFIED' | 'UNAVAILABLE' | 'TOO_LARGE' | 'HASH_MISMATCH' | 'INVALID_ENCODING'; sha256: string }
export interface EvidenceSnapshotSummary { snapshotHash: string; sourceChecks: EvidenceSourceCheck[]; allVerified: boolean }
export function canonicalEvidenceJson(value: unknown): string;
export function sha256EvidenceBytes(bytes: Uint8Array): Promise<string>;
export function hashEvidenceJson(value: unknown): Promise<string>;
export function evidenceContentFingerprint(submission: unknown, spec?: unknown): Promise<string>;
export function validateEvidenceRecord(input: { order: unknown; revision: unknown; expectedRevision: number }): Promise<{ sources: { url: string; sha256: string; byte_length: number }[] }>;
export function validateEvidenceSnapshot(input: { snapshot: unknown; order: unknown; revision: unknown; expectedRevision: number; assessment?: unknown }): Promise<EvidenceSnapshotSummary>;
