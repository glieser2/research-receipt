export interface CatalogField { id: string; group: string; label: string; question: string; allowed_claim_types: string[] }
export const POLICY_V6: 'research-receipt/6';
export const CATALOG_VERSION: 'research-receipt/field-catalog/1';
export const UNKNOWN_DISCLOSURE_VERSION: 'scoped-unknown/1';
export const FIELD_CATALOG: { version: string; fields: CatalogField[] };
export function deriveCriterionText(ids: string[]): string;
export function validateV6Criteria(criteria: unknown, version?: string): unknown;
export function renderV6ClaimStatement(spec: any, claim: any): string;
export function validateV6Submission(spec: any, submission: any, options?: { allowEmptyReferences?: boolean }): unknown;
