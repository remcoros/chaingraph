import { useEffect, useRef, useState } from 'react';
import {
  analysisScanScope,
  mergeScanFindings,
  scanAnalysis,
  scanDefaults,
  type AnalysisScan,
} from '../../../../Domain/Analysis/analysisScan';
import { walletEvidenceChanged } from '../../../../Domain/Wallet/walletActivity';
import { short, type Wallet, type Workspace } from '../../../../Domain/types';
import type { WalletRow } from '../../../../Domain/Wallet/walletWorkbenchRows';

export function walletAnalysisScope(workspace: Workspace, wallet: Wallet, row?: WalletRow) {
  if (row?.relationshipDirection)
    return {
      kind: row.kind,
      label: `${row.relationshipDirection === 'source' ? 'Source' : 'Destination'} ${short(row.address ?? row.identifier)}`,
      explanation: 'Loaded one-hop transaction contexts for this address in the selected wallet.',
      txids: row.contextTransactionIds.filter((id) => !!workspace.transactions[id]),
    };
  return analysisScanScope(
    workspace,
    row
      ? {
          id: row.nodeId,
          kind: row.kind,
          label: workspace.annotations[row.nodeId]?.label ?? '',
          address: row.address,
          txid: row.txid,
          vout: row.kind === 'output' ? Number(row.nodeId.split(':')[2]) : undefined,
        }
      : undefined,
    row ? undefined : wallet,
  );
}

export function walletAnalysisSummary(scan: AnalysisScan): string {
  const failed = scan.reports.filter((report) => report.status === 'error').length;
  return `${scan.findings.length} findings${failed ? ` · ${failed} tool${failed === 1 ? '' : 's'} failed` : ''}`;
}

interface WalletAnalysisOptions {
  workspace: Workspace;
  wallet: Wallet;
  active: boolean;
  onChange: (update: (current: Workspace) => Workspace) => void;
  onComplete?: (scan: AnalysisScan) => void;
}

async function runWalletAnalysisRequest(
  row: WalletRow | undefined,
  latest: { current: WalletAnalysisOptions },
  pending: { current: AbortController | undefined },
  setScan: (scan: AnalysisScan) => void,
  setLoading: (loading: boolean) => void,
  setMessage: (message: string) => void,
  setError: (error: string) => void,
) {
  if (!latest.current.active) return;
  pending.current?.abort();
  pending.current = undefined;
  setLoading(false);
  const snapshot = latest.current;
  const scope = walletAnalysisScope(snapshot.workspace, snapshot.wallet, row);
  setError('');
  if (!scope.txids.length) {
    setError('No loaded transactions in this scope. Load its context first.');
    return;
  }
  const controller = new AbortController();
  pending.current = controller;
  setLoading(true);
  setMessage('Scanning loaded data');
  try {
    const result = await scanAnalysis(snapshot.workspace, scope, scanDefaults(), controller.signal);
    if (
      controller.signal.aborted ||
      !latest.current.active ||
      latest.current.workspace.id !== snapshot.workspace.id ||
      latest.current.wallet.id !== snapshot.wallet.id ||
      latest.current.workspace.network !== snapshot.workspace.network ||
      latest.current.workspace.transactions !== snapshot.workspace.transactions ||
      walletEvidenceChanged(snapshot.workspace.wallets, latest.current.workspace.wallets)
    )
      return;
    latest.current.onChange((current) => ({
      ...current,
      findings: mergeScanFindings(current.findings, result),
    }));
    setScan(result);
    setMessage(walletAnalysisSummary(result));
    latest.current.onComplete?.(result);
  } catch (cause) {
    if (!controller.signal.aborted) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Scan could not finish. Existing findings were kept.',
      );
      setMessage('Scan failed');
    }
  } finally {
    if (pending.current === controller) {
      pending.current = undefined;
      setLoading(false);
    }
  }
}

export function useWalletAnalysis(options: WalletAnalysisOptions) {
  const latest = useRef(options);
  useEffect(() => {
    latest.current = options;
  });
  const pending = useRef<AbortController | undefined>(undefined);
  const [scan, setScan] = useState<AnalysisScan>();
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const evidence = useRef(options.workspace);
  useEffect(() => {
    const previous = evidence.current;
    evidence.current = options.workspace;
    const changed =
      previous.id !== options.workspace.id ||
      previous.network !== options.workspace.network ||
      previous.transactions !== options.workspace.transactions ||
      walletEvidenceChanged(previous.wallets, options.workspace.wallets);
    if (pending.current && (!options.active || changed)) {
      pending.current.abort();
      pending.current = undefined;
      setLoading(false);
      setMessage('Scan cancelled');
    } else if (scan && changed) {
      setMessage('Data changed · Scan again');
    }
  }, [options.active, options.workspace, scan]);
  useEffect(() => () => pending.current?.abort(), []);

  async function run(row?: WalletRow) {
    await runWalletAnalysisRequest(row, latest, pending, setScan, setLoading, setMessage, setError);
  }
  return { run, scan, loading, message, error };
}
