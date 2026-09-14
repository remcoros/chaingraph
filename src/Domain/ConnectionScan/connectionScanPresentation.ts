import {
  SCAN_STATUS_ONLY_REASONS,
  type ScanFinding,
  type ScanResult,
  type ScanRun,
} from './connectionScan';

export type ScanResultFinding =
  | ScanFinding
  | 'upstream-connection'
  | 'downstream-connection'
  | 'shared-ancestor'
  | 'shared-descendant';
export type ScanResultCategory = 'connection' | 'branch' | 'endpoint' | 'issue';

/** Name the relation the user can reveal, rather than the search frontier that found it. */
export function scanRelationPresentation(result: ScanResult):
  | {
      title: string;
      description: string;
      branches?: [string, string];
      branchLabel?: 'input' | 'output';
      meeting?: string;
    }
  | undefined {
  if (result.kind !== 'connection') return;
  const direction = result.scanDirection ?? result.directions[0];
  let divergence = 0;
  while (
    divergence < result.path.length &&
    result.path[divergence] === result.context?.path[divergence]
  )
    divergence++;
  const meeting =
    result.meetingNode ??
    result.path.slice(divergence).find((id) => result.context?.path.slice(divergence).includes(id));
  if (result.context) {
    const first = result.path[1];
    const second = result.context.path[1];
    if (
      result.path[0]?.startsWith('tx:') &&
      first?.startsWith('out:') &&
      second?.startsWith('out:') &&
      first !== second &&
      result.directions[0] === result.context.directions[0]
    ) {
      const branchLabel = result.directions[0] === 'upstream' ? 'input' : 'output';
      return {
        title: branchLabel === 'input' ? 'Input reconnection' : 'Output reconnection',
        description: `These ${branchLabel} branches reconnect.`,
        branches: [first, second],
        branchLabel,
        meeting,
      };
    }
    return { title: 'Reconnection', description: 'A second route links these nodes.', meeting };
  }
  if (result.relationship === 'shared-ancestor')
    return {
      title: 'Shared ancestor',
      description: 'Both nodes trace back to this meeting point.',
      meeting: result.meetingNode,
    };
  if (result.relationship === 'shared-descendant')
    return {
      title: 'Shared descendant',
      description: 'Both nodes lead to this meeting point.',
      meeting: result.meetingNode,
    };
  return direction === 'upstream'
    ? { title: 'Funding path', description: 'The target is upstream of the source.' }
    : { title: 'Spending path', description: 'The target is downstream of the source.' };
}

/** Secondary explanation for the finding icon, kept out of the card's reading flow. */
export function scanResultTooltip(result: ScanResult): string {
  const relation = scanRelationPresentation(result);
  if (result.context) {
    if (relation?.branchLabel)
      return `Two ${relation.branchLabel} branches of this transaction connect through another observed path. Add reveals the complete loop.`;
    return 'A newly found path and existing transaction links form a loop between these nodes. Add reveals the complete connection.';
  }
  switch (resultFinding(result)) {
    case 'upstream-connection':
      return 'Following transaction inputs from the source reaches this target. Each step is supported by an observed transaction.';
    case 'downstream-connection':
      return 'Following outputs and their spending transactions from the source reaches this target. Each step is supported by an observed transaction.';
    case 'shared-ancestor':
      return 'The source and target trace back to a shared transaction or output. The path shows both branches and where they meet.';
    case 'shared-descendant':
      return 'The source and target lead to a shared spending transaction or output. The path shows both branches and where they meet.';
    case 'many-inputs':
      return "This transaction reached the scan's limit on the number of inputs to follow. This branch was not expanded; add the path to inspect its inputs.";
    case 'many-outputs':
      return "This transaction reached the scan's limit on the number of outputs to follow. This branch was not expanded; add the path to inspect its outputs.";
    case 'coinbase':
      return 'This branch ends at a coinbase transaction, which creates the block reward. It has no earlier transaction inputs to follow.';
    case 'unspendable':
      return 'This output uses OP_RETURN, which cannot be spent. There is no spending transaction to follow.';
    case 'unspent':
      return `This output was verified as unspent at the recorded check${result.includesMempool ? ', including the mempool' : ''}. It may have been spent since then.`;
    case 'transaction-unavailable':
      return 'The transaction needed for the next step could not be loaded, so this branch could not continue. Recheck to try that lookup again.';
    case 'spend-unknown':
      return 'The scan could not verify a spending transaction or confirm that this output was unspent. Recheck to try again.';
    case 'lookup-failed':
      return result.issueCode === 'timeout'
        ? 'The lookup for the next step timed out. Recheck to try again.'
        : result.issueCode === 'invalid-response'
          ? 'The next lookup returned data that could not be verified. Recheck to try again.'
          : 'The lookup for the next step failed. Recheck to try again.';
    case 'conflicting-evidence':
      return 'Transaction observations disagree, so this path cannot be accepted in full. Only the verified steps before the conflict can be added.';
    default:
      return 'A stopping point reached while following transaction links from the source.';
  }
}

/** Normalize legacy path records without promoting run limits into node findings. */
export function resultFinding(result: ScanResult): ScanResultFinding | undefined {
  if (result.reason && SCAN_STATUS_ONLY_REASONS.includes(result.reason)) return undefined;
  if (result.kind === 'connection') {
    if (result.relationship === 'shared-ancestor' || result.relationship === 'shared-descendant')
      return result.relationship;
    const direction = result.scanDirection ?? result.directions[0];
    return direction ? `${direction}-connection` : undefined;
  }
  if (result.finding) return result.finding;
  const direction = result.scanDirection ?? result.directions[0];
  if (result.reason === 'fan-out')
    return direction === 'upstream'
      ? 'many-inputs'
      : direction === 'downstream'
        ? 'many-outputs'
        : undefined;
  if (result.reason === 'unknown')
    return result.endpoint.startsWith('out:') && direction === 'downstream'
      ? 'spend-unknown'
      : 'transaction-unavailable';
  if (result.reason === 'failure') return 'lookup-failed';
  return undefined;
}

export function resultCategory(result: ScanResult): ScanResultCategory {
  const finding = resultFinding(result);
  if (
    finding === 'upstream-connection' ||
    finding === 'downstream-connection' ||
    finding === 'shared-ancestor' ||
    finding === 'shared-descendant'
  )
    return 'connection';
  if (finding === 'many-inputs' || finding === 'many-outputs') return 'branch';
  if (finding === 'unspent' || finding === 'coinbase' || finding === 'unspendable')
    return 'endpoint';
  return 'issue';
}

/** Keep dismissals across snapshots and put connections before branches, issues and endpoints. */
export function presentScanRun(run: ScanRun, dismissed: ReadonlySet<string>): ScanRun {
  const rank: Record<ScanResultCategory, number> = {
    connection: 0,
    branch: 1,
    issue: 2,
    endpoint: 3,
  };
  return {
    ...run,
    results: run.results
      .filter((result) => resultFinding(result) !== undefined)
      .filter(
        (result) =>
          run.settings.targetScope === 'custom' ||
          result.kind !== 'connection' ||
          result.relationship === 'shared-ancestor' ||
          result.relationship === 'shared-descendant' ||
          !!result.context ||
          result.bridge === true,
      )
      .map((result) => (dismissed.has(result.id) ? { ...result, dismissed: true } : result))
      .sort((a, b) => rank[resultCategory(a)] - rank[resultCategory(b)]),
  };
}

export interface ScanStatus {
  label: string;
  tone: 'running' | 'complete' | 'warning' | 'error';
}

/** Configured branch boundaries complete normally; whole-run stops stay explicit. */
export function scanStatus(run: ScanRun, running: boolean): ScanStatus {
  if (running) return { label: 'Scanning…', tone: 'running' };
  if (run.status === 'failed') return { label: 'Scan failed.', tone: 'error' };
  if (run.status === 'cancelled' || run.stopReasons.includes('cancelled'))
    return { label: 'Scan cancelled.', tone: 'warning' };
  if (run.status === 'interrupted' || run.status === 'running')
    return { label: 'Scan interrupted.', tone: 'warning' };
  if (run.stopReasons.includes('backend-unavailable'))
    return { label: 'Scan stopped: backend unavailable', tone: 'warning' };
  if (run.stopReasons.includes('rate-limited'))
    return { label: 'Scan stopped: request limit reached', tone: 'warning' };
  if (run.stopReasons.includes('time'))
    return { label: 'Scan stopped: time limit reached', tone: 'warning' };
  if (run.stopReasons.includes('transactions'))
    return { label: 'Scan stopped: transaction limit reached', tone: 'warning' };
  if (run.stopReasons.includes('results'))
    return { label: 'Scan stopped: result limit reached', tone: 'warning' };
  if (run.stopReasons.includes('offline'))
    return { label: 'Scan completed: offline coverage only', tone: 'warning' };
  if (run.stopReasons.includes('failure') || run.stopReasons.includes('unknown'))
    return { label: 'Scan completed: some paths unavailable', tone: 'warning' };
  return { label: 'Scan completed.', tone: 'complete' };
}

export function scanStatusLabel(run: ScanRun, running: boolean): string {
  return scanStatus(run, running).label;
}
