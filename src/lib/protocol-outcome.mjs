// Shared, dependency-free browser/CLI predicate. VM return is not consensus.
export function consensusAccepted(transaction) {
  if (transaction?.lifecycle?.outcome !== 'accepted') return false;
  const hasName = typeof transaction.resultName === 'string';
  const hasNumber = transaction.result !== undefined && transaction.result !== null;
  if (hasName && transaction.resultName !== 'MAJORITY_AGREE') return false;
  if (hasNumber && transaction.result !== 1 && transaction.result !== '1' && transaction.result !== 1n) return false;
  return hasName || hasNumber;
}
export const executionSucceeded = transaction => transaction?.statusName === 'FINALIZED' && consensusAccepted(transaction) && transaction.txExecutionResultName === 'FINISHED_WITH_RETURN';
export const executionReverted = transaction => transaction?.statusName === 'FINALIZED' && consensusAccepted(transaction) && transaction.txExecutionResultName === 'FINISHED_WITH_ERROR';
export function finalizedUndetermined(transaction) {
  if (transaction?.statusName !== 'FINALIZED' || transaction.lifecycle?.outcome !== 'undetermined') return false;
  const hasName = typeof transaction.resultName === 'string';
  const hasNumber = transaction.result !== undefined && transaction.result !== null;
  const byName = transaction.resultName === 'NO_MAJORITY' ? 5 : transaction.resultName === 'MAJORITY_DISAGREE' ? 2 : null;
  const byNumber = [5, '5', 5n].includes(transaction.result) ? 5 : [2, '2', 2n].includes(transaction.result) ? 2 : null;
  if ((hasName && byName === null) || (hasNumber && byNumber === null)) return false;
  return (hasName || hasNumber) && (!hasName || !hasNumber || byName === byNumber);
}
