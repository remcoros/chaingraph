import { outpointReference, transactionReference } from '../../entityReferences';
import { type TxOutput, outputAddress, outputScriptHash } from '../../../Bitcoin';
import { toolGroups } from '../toolGroups';

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
  group: toolGroups.importedWallets,
  displayOrder: 10,
  kind: 'observation',
  description:
    'Find transactions whose inputs or outputs match more than one wallet you have imported. This can reveal connections between your wallet records, including coins spent together. It also flags overlapping imports, where the same coins appear in more than one wallet record.',
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
    const names = new Map(
      context.workspace.wallets.definitions.map((wallet) => [wallet.id, wallet.name]),
    );
    function add(map: Map<string, Set<string>>, key: string, id: string) {
      const set = map.get(key) ?? new Set<string>();
      set.add(id);
      map.set(key, set);
    }
    for (const wallet of context.workspace.wallets.definitions)
      for (const address of wallet.addresses) {
        add(addresses, address.address, wallet.id);
        add(scripts, address.scripthash, wallet.id);
      }
    function matches(output?: TxOutput) {
      const ids = new Set<string>();
      if (!output) return ids;
      const address = output.scriptPubKey.hex === undefined ? outputAddress(output) : undefined;
      for (const id of addresses.get(address ?? '') ?? []) ids.add(id);
      const hash = outputScriptHash(output, context.workspace.network);
      for (const id of scripts.get(hash ?? '') ?? []) ids.add(id);
      return ids;
    }
    const findings = [];
    let overlapping = 0,
      missingPrevouts = 0;
    for (const tx of context.transactions) {
      const refs = isCoinbase(tx) ? [] : referencedInputs(context.workspace, tx, context.prevouts);
      missingPrevouts += refs.filter(
        (input) => input.resolution.status === 'missing' || input.resolution.status === 'conflict',
      ).length;
      const inputs = refs.map((input) => ({
        nodeId: input.nodeId,
        ids: matches(
          input.resolution.status === 'loaded' || input.resolution.status === 'attached'
            ? input.resolution.output
            : undefined,
        ),
      }));
      const outputs = spendableOutputs(tx).map((output) => ({
        nodeId: outpointReference(tx.txid, output.n),
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
          `Inputs match ${inputWallets.size} imported wallets; outputs match ${outputWallets.size}. Matching records: ${[...wallets].map((id) => names.get(id)).join(', ')}. ${overlap ? 'Some derived addresses or scripts appear in multiple imports; these are not necessarily distinct participants. ' : ''}Matches use your already derived addresses and scripts. They do not identify owners or assign inputs to outputs. Compare the linked records and your labels.`,
          candidates.filter((record) => record.ids.size).map((record) => record.nodeId),
          [
            tx.txid,
            ...refs
              .filter(
                (input) =>
                  input.resolution.status === 'loaded' || input.resolution.status === 'attached',
              )
              .map((input) => input.txid),
          ],
          [transactionReference(tx.txid)],
          [tx.txid],
          !overlap && inputWallets.size > 1 ? 'distinct-wallet-inputs' : undefined,
          {
            summary: overlap
              ? 'Some of the same addresses or scripts are included in more than one imported wallet. These records may describe the same coins.'
              : inputWallets.size > 1
                ? 'This transaction spends coins matching different imported wallets. It connects those wallet records on the public blockchain, without identifying their owners.'
                : 'Addresses or scripts from different imported wallets appear in this transaction. That alone does not tell us who paid whom.',
            guidance: overlap
              ? {
                  kind: 'tip',
                  text: 'Check whether you imported the same wallet, or part of it, more than once. Do not treat overlapping records as separate balances or people.',
                }
              : {
                  kind: 'tip',
                  text: 'Compare the wallet names and your labels to understand the connection. If the wallets represent separate sources, keep that context when reviewing future transfers.',
                },
          },
        ),
      );
    }
    return {
      findings,
      summary: `${findings.length} transactions touch multiple imported wallet records; ${overlapping} have overlapping import coverage.`,
      emptyReason:
        context.workspace.wallets.definitions.length < 2
          ? 'Import and scan at least two wallets to compare their derived address coverage.'
          : 'No transaction in this scope matches multiple imported wallets under this mode. Missing input data and unscanned wallet addresses limit this comparison.',
      stats: [
        { label: 'Imported wallets', value: context.workspace.wallets.definitions.length },
        { label: 'Known addresses', value: addresses.size },
        { label: 'Matching transactions', value: findings.length },
        { label: 'Overlapping coverage', value: overlapping },
        { label: 'Missing previous-output details', value: missingPrevouts },
      ],
    };
  },
});
