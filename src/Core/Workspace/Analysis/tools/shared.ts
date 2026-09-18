import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { outpointReference } from '../../entityReferences';
import type { AnalysisFinding } from '../finding';
import type { Workspace } from '../../workspace';
import type { AnalysisToolGroup } from '../toolGroups';

import {
  type Transaction,
  indexPreviousOutputs,
  resolvePreviousOutput,
  type PreviousOutputIndex,
} from '../../../ChainData';
import { isProvablyUnspendable, type TxOutput } from '../../../Bitcoin';

import { formatBitcoinAmount } from '../../../Formatting';

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
export interface AnalysisTool<Id extends string = string> {
  id: Id;
  name: string;
  description: string;
  group: AnalysisToolGroup;
  displayOrder: number;
  kind: Exclude<AnalysisKind, 'incomplete'>;
  parameters: readonly AnalysisParameter[];
  source: { title: string; url: string };
  run: (workspace: Workspace, txids?: string[], options?: AnalysisOptions) => AnalysisFinding[];
  analyze: (workspace: Workspace, txids?: string[], options?: AnalysisOptions) => AnalysisRunReport;
}
export interface AnalysisContext {
  workspace: Workspace;
  transactions: Transaction[];
  prevouts: PreviousOutputIndex;
  createdAt: string;
  options: AnalysisOptions;
}
export type ToolDefinition<Id extends string = string> = Omit<
  AnalysisTool<Id>,
  'run' | 'analyze'
> & {
  execute: (context: AnalysisContext) => Omit<AnalysisRunReport, 'toolId' | 'scopeTxids'>;
};

export function defineTool<const Id extends string>(
  definition: ToolDefinition<Id>,
): AnalysisTool<Id> {
  const { execute, ...metadata } = definition;
  const analyze: AnalysisTool<Id>['analyze'] = (workspace, txids, options = {}) => {
    const ids = txids === undefined ? undefined : new Set(txids);
    const transactions = Object.values(workspace.chainData.transactions)
      .filter((tx) => ids === undefined || ids.has(tx.txid))
      .sort((a, b) => a.txid.localeCompare(b.txid));
    const report = execute({
      workspace,
      transactions,
      prevouts: indexPreviousOutputs({
        network: workspace.network,
        transactions: workspace.chainData.transactions,
      }),
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
  return output.scriptPubKey.type === 'nulldata' || isProvablyUnspendable(output);
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
export const formatAmount = formatBitcoinAmount;
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
  reviewRule?: AnalysisFinding['reviewRule'],
  explanation?: { summary: string; guidance?: AnalysisFinding['guidance'] },
): AnalysisFinding {
  return {
    id: `${tool}:${stableKey(key)}`,
    algorithm: `${tool}-v2`,
    ...(reviewRule ? { reviewRule } : {}),
    kind,
    title,
    description: explanation?.summary ?? description,
    ...(explanation ? { details: description, guidance: explanation.guidance } : {}),
    nodeIds: [...new Set(nodeIds)],
    txids: [...new Set(txids)],
    scopeTxids: [...new Set(scopeTxids)],
    createdAt: context.createdAt,
  };
}
export function referencedInputs(
  workspace: Workspace,
  tx: Transaction,
  prevouts: PreviousOutputIndex = indexPreviousOutputs({
    network: workspace.network,
    transactions: workspace.chainData.transactions,
  }),
) {
  return tx.vin
    .filter((input) => input.txid !== undefined && input.vout !== undefined)
    .map((input) => ({
      txid: input.txid!,
      vout: input.vout!,
      nodeId: outpointReference(input.txid!, input.vout!),
      resolution: resolvePreviousOutput(
        { network: workspace.network, transactions: workspace.chainData.transactions },
        input,
        prevouts,
      ),
    }));
}
