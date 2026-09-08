import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import {
  outputNodeId,
  type AnalysisFinding,
  type Transaction,
  type TxOutput,
  type Workspace,
} from '../types';

export type AnalysisScope = 'graph' | 'selection';
export type AnalysisKind = 'observation' | 'hypothesis' | 'incomplete';
export type AnalysisOptions = Record<string, number | string | boolean>;
export interface AnalysisParameter {
  id: string;
  label: string;
  type: 'number' | 'select' | 'boolean';
  defaultValue: number | string | boolean;
  min?: number;
  max?: number;
  step?: number;
  choices?: readonly { value: string; label: string }[];
  help?: string;
}
export interface AnalysisRunReport {
  toolId: string;
  findings: AnalysisFinding[];
  scopeTxids: string[];
  summary: string;
  emptyReason?: string;
  stats: { label: string; value: number }[];
}
export interface AnalysisTool {
  id: string;
  name: string;
  description: string;
  group: 'Privacy patterns' | 'Value and structure' | 'Imported wallets';
  kind: Exclude<AnalysisKind, 'incomplete'>;
  parameters: readonly AnalysisParameter[];
  source: { title: string; url: string };
  run: (workspace: Workspace, txids?: string[], options?: AnalysisOptions) => AnalysisFinding[];
  analyze: (workspace: Workspace, txids?: string[], options?: AnalysisOptions) => AnalysisRunReport;
}
export interface AnalysisContext {
  workspace: Workspace;
  transactions: Transaction[];
  createdAt: string;
  options: AnalysisOptions;
}
export type ToolDefinition = Omit<AnalysisTool, 'run' | 'analyze'> & {
  execute: (context: AnalysisContext) => Omit<AnalysisRunReport, 'toolId' | 'scopeTxids'>;
};

export function defineTool(definition: ToolDefinition): AnalysisTool {
  const { execute, ...metadata } = definition;
  const analyze: AnalysisTool['analyze'] = (workspace, txids, options = {}) => {
    const ids = txids === undefined ? undefined : new Set(txids);
    const transactions = Object.values(workspace.transactions)
      .filter((tx) => ids === undefined || ids.has(tx.txid))
      .sort((a, b) => a.txid.localeCompare(b.txid));
    const report = execute({
      workspace,
      transactions,
      options,
      createdAt: new Date().toISOString(),
    });
    return {
      ...report,
      emptyReason: report.findings.length ? undefined : report.emptyReason,
      toolId: metadata.id,
      scopeTxids: transactions.map((tx) => tx.txid),
      ...(!transactions.length
        ? {
            emptyReason:
              'No loaded transactions are in this scope. Load a transaction or change the scope.',
          }
        : {}),
    };
  };
  return {
    ...metadata,
    analyze,
    run: (workspace, txids, options) => analyze(workspace, txids, options).findings,
  };
}
export function defaultsFor(tool: AnalysisTool): AnalysisOptions {
  return Object.fromEntries(tool.parameters.map((p) => [p.id, p.defaultValue]));
}
export function numberOption(
  options: AnalysisOptions,
  key: string,
  fallback: number,
  min: number,
  max: number,
  integer = true,
): number {
  const value = options[key] ?? fallback;
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value < min ||
    value > max ||
    (integer && !Number.isSafeInteger(value))
  ) {
    throw new Error(
      `${key} must be ${integer ? 'an integer' : 'a number'} between ${min} and ${max}.`,
    );
  }
  return value;
}
export function booleanOption(options: AnalysisOptions, key: string, fallback: boolean): boolean {
  const value = options[key] ?? fallback;
  if (typeof value !== 'boolean') throw new Error(`${key} must be enabled or disabled.`);
  return value;
}
export function choiceOption<T extends string>(
  options: AnalysisOptions,
  key: string,
  fallback: T,
  choices: readonly T[],
): T {
  const value = options[key] ?? fallback;
  if (typeof value !== 'string' || !choices.includes(value as T))
    throw new Error(`Choose a supported ${key} option.`);
  return value as T;
}
export function isDataOutput(output: TxOutput): boolean {
  return (
    output.scriptPubKey.type === 'nulldata' ||
    output.scriptPubKey.hex?.toLowerCase().startsWith('6a') === true
  );
}
export const spendableOutputs = (tx: Transaction) =>
  tx.vout.filter((output) => !isDataOutput(output));
export const isCoinbase = (tx: Transaction) => tx.vin.some((input) => input.coinbase !== undefined);
export function satoshiValue(value: number): bigint | undefined {
  const rounded = Math.round(value * 100_000_000);
  const wholeSatoshis =
    Math.abs(value - Number(value.toFixed(8))) <= Number.EPSILON * Math.max(1, Math.abs(value));
  return Number.isFinite(value) && value >= 0 && Number.isSafeInteger(rounded) && wholeSatoshis
    ? BigInt(rounded)
    : undefined;
}
export const formatAmount = (value: bigint) =>
  `${value.toLocaleString('en-US')} sat${value === 1n ? '' : 's'}`;
export function stableKey(value: string): string {
  return bytesToHex(sha256(new TextEncoder().encode(value)));
}
export function finding(
  context: AnalysisContext,
  tool: string,
  key: string,
  kind: AnalysisKind,
  title: string,
  description: string,
  nodeIds: string[],
  txids: string[],
  scopeTxids = txids,
): AnalysisFinding {
  return {
    id: `${tool}:${stableKey(key)}`,
    algorithm: `${tool}-v2`,
    kind,
    title,
    description,
    nodeIds: [...new Set(nodeIds)],
    txids: [...new Set(txids)],
    scopeTxids: [...new Set(scopeTxids)],
    createdAt: context.createdAt,
  };
}
export function referencedInputs(workspace: Workspace, tx: Transaction) {
  return tx.vin
    .filter((input) => input.txid !== undefined && input.vout !== undefined)
    .map((input) => ({
      txid: input.txid!,
      vout: input.vout!,
      nodeId: outputNodeId(input.txid!, input.vout!),
      output: workspace.transactions[input.txid!]?.vout.find((output) => output.n === input.vout),
    }));
}
