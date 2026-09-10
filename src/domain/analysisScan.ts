import {
  analysisTools,
  defaultsFor,
  type AnalysisOptions,
  type AnalysisRunReport,
} from './analysis';
import { type AnalysisFinding, type GraphNode, type Wallet, type Workspace, short } from './types';
import { listWalletTransactions } from './walletRecords';
import { addressToScriptHash } from '../lib/wallet';

export interface ScanScope {
  kind: 'transaction' | 'output' | 'address' | 'wallet' | 'workspace';
  label: string;
  explanation: string;
  txids: string[];
}
export type ScanOptions = Record<string, AnalysisOptions>;
export interface ScanToolReport {
  toolId: string;
  status: 'complete' | 'skipped' | 'error';
  message: string;
  report?: AnalysisRunReport;
}
export interface AnalysisScan {
  scope: ScanScope;
  options: ScanOptions;
  reports: ScanToolReport[];
  findings: AnalysisFinding[];
  runAt: string;
  evidenceTransactions?: Workspace['transactions'];
}

export type AnalysisScopeMode = 'context' | 'workspace' | `wallet:${string}`;

/** Workspace is the default. Explicit wallets ignore graph selection, and a
 * removed wallet keeps an empty scope rather than broadening the scan.
 */
export function analysisScopeChoice(
  workspace: Workspace,
  choice: string | undefined,
  selected?: GraphNode,
  wallet?: Wallet,
) {
  const walletId = choice?.startsWith('wallet:') ? choice.slice('wallet:'.length) : undefined;
  const mode: AnalysisScopeMode =
    choice === 'context' || choice === 'workspace'
      ? choice
      : walletId
        ? `wallet:${walletId}`
        : 'workspace';
  const scopeWallet = walletId
    ? workspace.wallets.find((entry) => entry.id === walletId)
    : undefined;
  const walletUnavailable = mode.startsWith('wallet:') && !scopeWallet;
  const selection = analysisScanScope(workspace, selected, wallet);
  const hasSelection = selection.kind !== 'workspace';
  const selectionLabel = hasSelection
    ? `Selection (${selection.kind[0].toUpperCase() + selection.kind.slice(1)})`
    : 'Selection (None)';
  const scope: ScanScope =
    mode === 'workspace'
      ? analysisScanScope(workspace)
      : mode.startsWith('wallet:')
        ? scopeWallet
          ? analysisScanScope(workspace, undefined, scopeWallet)
          : {
              kind: 'wallet',
              label: 'Wallet unavailable',
              explanation: 'This wallet is no longer in this workspace. Choose another scope.',
              txids: [],
            }
        : hasSelection
          ? selection
          : {
              ...selection,
              label: 'No current selection',
              explanation: 'Select a wallet or graph entity, or choose Workspace.',
              txids: [],
            };
  return { mode, selectionLabel, hasSelection, scope, walletUnavailable };
}

/** Graph filters and manual visibility never limit analysis observations. */
export function analysisScanScope(
  workspace: Workspace,
  selected?: GraphNode,
  wallet?: Wallet,
): ScanScope {
  const loaded = (ids: string[]) =>
    [...new Set(ids)].filter((id) => workspace.transactions[id]).sort();
  if (selected?.kind === 'transaction')
    return {
      kind: 'transaction',
      label: `Transaction ${short(selected.txid ?? '')}`,
      explanation: 'This transaction, using loaded or attached previous-output data.',
      txids: loaded(selected.txid ? [selected.txid] : []),
    };
  if (selected?.kind === 'output')
    return {
      kind: 'output',
      label: `Output ${short(selected.txid ?? '')}:${selected.vout ?? '?'}`,
      explanation: 'Creating transaction and loaded spenders of this exact output.',
      txids: loaded([
        ...(selected.txid ? [selected.txid] : []),
        ...Object.values(workspace.transactions)
          .filter((tx) =>
            tx.vin.some(
              (input) =>
                selected.txid !== undefined &&
                selected.vout !== undefined &&
                input.txid === selected.txid &&
                input.vout === selected.vout,
            ),
          )
          .map((tx) => tx.txid),
      ]),
    };
  if (selected?.kind === 'address') {
    let txids: string[] = [];
    try {
      const address = selected.address ?? selected.id.replace(/^addr:/, '');
      const scripthash = addressToScriptHash(address, workspace.network);
      const context: Wallet = {
        id: 'analysis-address',
        name: 'Address context',
        key: '',
        color: '',
        scriptType: 'p2wpkh',
        addresses: [{ address, scripthash, path: '', index: 0, branch: 0 }],
      };
      txids = loaded(listWalletTransactions(workspace, context).map((record) => record.txid));
    } catch {
      /* Invalid or cross-network addresses have no eligible scope. */
    }
    return {
      kind: 'address',
      label: `Address ${short(selected.address ?? selected.id.replace(/^addr:/, ''))}`,
      explanation:
        'Loaded transactions receiving to or spending from this address. This is a partial address history.',
      txids,
    };
  }
  if (wallet)
    return {
      kind: 'wallet',
      label: `Wallet ${wallet.name}`,
      explanation:
        'Loaded transactions associated with verified derived wallet addresses. Unloaded history and undiscovered addresses are not scanned.',
      txids: loaded(listWalletTransactions(workspace, wallet).map((record) => record.txid)),
    };
  return {
    kind: 'workspace',
    label: 'Workspace',
    explanation:
      'All loaded transactions, including hidden and filtered graph records. Loaded parents supply input evidence.',
    txids: Object.keys(workspace.transactions).sort(),
  };
}

export function scanDefaults(): ScanOptions {
  return Object.fromEntries(analysisTools.map((tool) => [tool.id, defaultsFor(tool)]));
}

/** One bounded local pass through the registry, with cancellation between tools.
 * Each existing tool is synchronous; cancellation cannot interrupt its inner loop.
 * No network calls or workspace mutations occur here.
 */
export async function scanAnalysis(
  workspace: Workspace,
  scope: ScanScope,
  options: ScanOptions = scanDefaults(),
  signal?: AbortSignal,
): Promise<AnalysisScan> {
  const reports: ScanToolReport[] = [];
  const resolvedOptions: ScanOptions = {};
  for (const tool of analysisTools) {
    signal?.throwIfAborted();
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    signal?.throwIfAborted();
    resolvedOptions[tool.id] = { ...defaultsFor(tool), ...options[tool.id] };
    if (!scope.txids.length) {
      reports.push({
        toolId: tool.id,
        status: 'skipped',
        message:
          'No loaded transactions in this scope. Load the relevant transaction in Graph, then scan again.',
      });
      continue;
    }
    try {
      const report = tool.analyze(workspace, scope.txids, resolvedOptions[tool.id]);
      const unavailable = tool.id === 'wallet-intersections' && workspace.wallets.length < 2;
      reports.push({
        toolId: tool.id,
        status: unavailable ? 'skipped' : 'complete',
        message: report.emptyReason ?? report.summary,
        report,
      });
    } catch {
      reports.push({
        toolId: tool.id,
        status: 'error',
        message:
          'This analysis could not run. Check its parameter ranges and scan again. Other analyses still ran.',
      });
    }
  }
  signal?.throwIfAborted();
  return {
    scope: { ...scope, txids: [...scope.txids] },
    options: resolvedOptions,
    reports,
    findings: reports.flatMap((item) => item.report?.findings ?? []),
    runAt: new Date().toISOString(),
    evidenceTransactions: workspace.transactions,
  };
}

/** Preserve unrelated results and explicit exclusions only for unchanged evidence. */
export function mergeScanFindings(
  previous: AnalysisFinding[],
  scan: AnalysisScan,
): AnalysisFinding[] {
  const scope = new Set(scan.scope.txids);
  const completed = scan.reports
    .filter((report) => report.status !== 'error')
    .map((report) => report.toolId);
  const freshIds = new Set(scan.findings.map((finding) => finding.id));
  const sameIds = (a: string[], b: string[]) =>
    JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
  return [
    ...previous.filter(
      (finding) =>
        !freshIds.has(finding.id) &&
        !(
          completed.some((id) => finding.algorithm.startsWith(`${id}-`)) &&
          (finding.scopeTxids ?? finding.txids).some((id) => scope.has(id))
        ),
    ),
    ...scan.findings.map((finding) => {
      const old = previous.find(
        (item) => item.id === finding.id && item.algorithm === finding.algorithm,
      );
      return old &&
        old.kind === finding.kind &&
        old.reviewRule === finding.reviewRule &&
        old.title === finding.title &&
        old.description === finding.description &&
        old.details === finding.details &&
        old.guidance?.kind === finding.guidance?.kind &&
        old.guidance?.text === finding.guidance?.text &&
        sameIds(old.nodeIds, finding.nodeIds) &&
        sameIds(old.txids, finding.txids)
        ? { ...finding, excluded: old.excluded }
        : finding;
    }),
  ];
}
