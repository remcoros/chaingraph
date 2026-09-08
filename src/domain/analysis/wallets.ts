import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import { outputNodeId, type TxOutput } from '../types';
import { outputAddress } from '../workspace';
import {
  choiceOption,
  defineTool,
  finding,
  isCoinbase,
  referencedInputs,
  spendableOutputs,
} from './shared';

export const walletTool = defineTool({
  id: 'wallet-intersections',
  name: 'Imported-wallet intersections',
  group: 'Imported wallets',
  kind: 'observation',
  description:
    'Find transactions touching derived addresses from multiple imported wallets. Distinguish shared import coverage from different wallet records co-spending.',
  source: {
    title: 'BIP32: hierarchical deterministic wallet derivation',
    url: 'https://github.com/bitcoin/bips/blob/master/bip-0032.mediawiki',
  },
  parameters: [
    {
      id: 'walletMode',
      label: 'Match',
      type: 'select',
      defaultValue: 'all',
      choices: [
        { value: 'all', label: 'Any inputs or outputs' },
        { value: 'co-spent', label: 'Inputs from multiple wallets' },
      ],
    },
  ],
  execute(context) {
    const mode = choiceOption(context.options, 'walletMode', 'all', ['all', 'co-spent']);
    const addresses = new Map<string, Set<string>>(),
      scripts = new Map<string, Set<string>>();
    const names = new Map(context.workspace.wallets.map((wallet) => [wallet.id, wallet.name]));
    function add(map: Map<string, Set<string>>, key: string, id: string) {
      const set = map.get(key) ?? new Set<string>();
      set.add(id);
      map.set(key, set);
    }
    for (const wallet of context.workspace.wallets)
      for (const address of wallet.addresses) {
        add(addresses, address.address, wallet.id);
        add(scripts, address.scripthash, wallet.id);
      }
    function matches(output?: TxOutput) {
      const ids = new Set<string>();
      if (!output) return ids;
      const address = outputAddress(output);
      for (const id of addresses.get(address ?? '') ?? []) ids.add(id);
      const hex = output.scriptPubKey.hex;
      if (hex !== undefined && /^(?:[0-9a-fA-F]{2})*$/.test(hex)) {
        const hash = bytesToHex(sha256(hexToBytes(hex)).reverse());
        for (const id of scripts.get(hash) ?? []) ids.add(id);
      }
      return ids;
    }
    const findings = [];
    let overlapping = 0,
      missingParents = 0;
    for (const tx of context.transactions) {
      const refs = isCoinbase(tx) ? [] : referencedInputs(context.workspace, tx);
      missingParents += refs.filter((input) => !input.output).length;
      const inputs = refs.map((input) => ({ nodeId: input.nodeId, ids: matches(input.output) }));
      const outputs = spendableOutputs(tx).map((output) => ({
        nodeId: outputNodeId(tx.txid, output.n),
        ids: matches(output),
      }));
      const candidates = mode === 'co-spent' ? inputs : [...inputs, ...outputs];
      const wallets = new Set(candidates.flatMap((record) => [...record.ids]));
      if (wallets.size < 2) continue;
      const overlap = candidates.some((record) => record.ids.size > 1);
      if (overlap) overlapping++;
      const inputWallets = new Set(inputs.flatMap((record) => [...record.ids]));
      const outputWallets = new Set(outputs.flatMap((record) => [...record.ids]));
      findings.push(
        finding(
          context,
          'wallet-intersections',
          tx.txid,
          'observation',
          overlap
            ? `${wallets.size} imported wallets have overlapping coverage`
            : `${wallets.size} imported wallets touch this transaction`,
          `Matching wallet records: ${[...wallets].map((id) => names.get(id)).join(', ')}. Inputs match ${inputWallets.size} imported wallets; outputs match ${outputWallets.size}. ${overlap ? 'At least one output belongs to the derived coverage of multiple imports; these are not necessarily distinct participants. ' : ''}Matches use only already derived addresses or locking scripts. This does not identify real owners or assign particular inputs to particular outputs. Check wallet scan coverage and load missing previous transactions.`,
          candidates.filter((record) => record.ids.size).map((record) => record.nodeId),
          [tx.txid, ...refs.filter((input) => input.output).map((input) => input.txid)],
          [tx.txid],
        ),
      );
    }
    return {
      findings,
      summary: `${findings.length} transactions touch multiple imported wallet records; ${overlapping} have overlapping import coverage.`,
      emptyReason:
        context.workspace.wallets.length < 2
          ? 'Import and scan at least two wallets to compare their derived address coverage.'
          : 'No transaction in this scope matches multiple imported wallets under this mode. Derive or scan more addresses and load previous transactions to expand known coverage.',
      stats: [
        { label: 'Imported wallets', value: context.workspace.wallets.length },
        { label: 'Known addresses', value: addresses.size },
        { label: 'Matching transactions', value: findings.length },
        { label: 'Overlapping coverage', value: overlapping },
        { label: 'Missing parent references', value: missingParents },
      ],
    };
  },
});
