import { outpointReference } from '../../entityReferences';
import type { Transaction } from '../../../ChainData';
import { toolGroups } from '../toolGroups';

import {
  defineTool,
  finding,
  formatAmount,
  isCoinbase,
  numberOption,
  satoshiValue,
  spendableOutputs,
} from './shared';

export function equalOutputGroups(tx: Transaction) {
  const groups = new Map<bigint, typeof tx.vout>();
  for (const output of spendableOutputs(tx)) {
    const value = satoshiValue(output.value);
    if (value === undefined || value === 0n) continue;
    const group = groups.get(value) ?? [];
    group.push(output);
    groups.set(value, group);
  }
  return groups;
}

export function equalOutputCount(tx: Transaction): number {
  let largest = 0;
  for (const group of equalOutputGroups(tx).values()) largest = Math.max(largest, group.length);
  return largest;
}

export const equalOutputTool = defineTool({
  id: 'equal-outputs',
  name: 'Equal-output detection',
  group: toolGroups.privacyPatterns,
  displayOrder: 10,
  kind: 'observation',
  description:
    'Find outputs in the same transaction that contain exactly the same amount of bitcoin. Each matching group is highlighted so you can compare it. Equal amounts can occur in ordinary payments or transactions made jointly by several people; they do not identify which input funded which output.',
  source: {
    title: 'Boltzmann transaction linkability research',
    url: 'https://github.com/Samourai-Wallet/boltzmann',
  },
  parameters: [
    {
      id: 'minEqualOutputs',
      label: 'Minimum equal outputs',
      type: 'number',
      defaultValue: 3,
      min: 2,
      max: 1000,
      help: 'Data outputs and zero-value outputs are excluded.',
    },
    {
      id: 'minInputs',
      label: 'Minimum inputs',
      type: 'number',
      defaultValue: 2,
      min: 1,
      max: 1000,
    },
  ],
  execute(context) {
    const minimum = numberOption(context.options, 'minEqualOutputs', 3, 2, 1000);
    const inputs = numberOption(context.options, 'minInputs', 2, 1, 1000);
    const findings = [];
    let eligible = 0,
      matchingOutputs = 0;
    for (const tx of context.transactions) {
      if (isCoinbase(tx) || tx.vin.length < inputs) continue;
      eligible++;
      for (const [amount, outputs] of equalOutputGroups(tx)) {
        if (outputs.length < minimum) continue;
        matchingOutputs += outputs.length;
        findings.push(
          finding(
            context,
            'equal-outputs',
            `${tx.txid}:${amount}`,
            'observation',
            `${outputs.length} equal outputs of ${formatAmount(amount)}`,
            `${outputs.length} spendable outputs share ${formatAmount(amount)}. Batching and collaborative transactions can both produce repeated amounts; this does not identify a CoinJoin. Compare the highlighted outputs with the remaining outputs and input history.`,
            outputs.map((output) => outpointReference(tx.txid, output.n)),
            [tx.txid],
            [tx.txid],
            undefined,
            {
              summary: `${outputs.length} outputs have exactly the same amount. This can happen with repeated payments or collaborative transactions; equal amounts alone do not identify a CoinJoin.`,
              guidance: {
                kind: 'tip',
                text: 'Matching amounts do not show which input funded which output. Compare the rest of the transaction before drawing conclusions about payments.',
              },
            },
          ),
        );
      }
    }
    return {
      findings,
      summary: `${eligible} eligible transactions checked; ${findings.length} equal-amount groups found.`,
      emptyReason: `No transaction in this scope has at least ${inputs} inputs and ${minimum} equal positive, spendable outputs.`,
      stats: [
        { label: 'Transactions in scope', value: context.transactions.length },
        { label: 'Eligible transactions', value: eligible },
        { label: 'Matching outputs', value: matchingOutputs },
      ],
    };
  },
});
