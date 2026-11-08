export interface ConsensusTransaction {
  statusName?: string;
  txExecutionResultName?: string;
  lifecycle?: { state?: string; outcome?: string } | null;
  resultName?: string;
  result?: number | string | bigint | null;
}
export function consensusAccepted(transaction: ConsensusTransaction | null | undefined): boolean;
export function executionSucceeded(transaction: ConsensusTransaction | null | undefined): boolean;
export function executionReverted(transaction: ConsensusTransaction | null | undefined): boolean;
export function finalizedUndetermined(transaction: ConsensusTransaction | null | undefined): boolean;
