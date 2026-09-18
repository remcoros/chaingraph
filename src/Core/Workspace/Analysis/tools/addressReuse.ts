import { outpointReference } from '../../entityReferences';
import { outputAddress } from '../../../Bitcoin';
import { toolGroups } from '../toolGroups';
import { booleanOption, defineTool, finding, numberOption, spendableOutputs } from './shared';

export const reuseTool = defineTool({
  id: 'address-reuse',
  name: 'Address reuse',
  group: toolGroups.privacyPatterns,
  displayOrder: 30,
  kind: 'observation',
  description:
    'Find addresses that appear on more than one output, either within a single transaction or across several transactions. Reusing a receiving address makes separate payments easier to connect. The results show where the address appears so you can review those connections.',
  source: {
    title: 'A Fistful of Bitcoins: address clustering research',
    url: 'https://cseweb.ucsd.edu/~smeiklejohn/files/imc13.pdf',
  },
  parameters: [
    {
      id: 'minOccurrences',
      label: 'Minimum output occurrences',
      type: 'number',
      defaultValue: 2,
      min: 2,
      max: 1000,
    },
    {
      id: 'acrossTransactionsOnly',
      label: 'Require different transactions',
      type: 'boolean',
      defaultValue: false,
    },
  ],
  execute(context) {
    const minimum = numberOption(context.options, 'minOccurrences', 2, 2, 1000);
    const separateTransactions = booleanOption(context.options, 'acrossTransactionsOnly', false);
    const groups = new Map<string, { nodes: string[]; txids: Set<string> }>();
    let unaddressed = 0;
    for (const tx of context.transactions)
      for (const output of spendableOutputs(tx)) {
        const address = outputAddress(output);
        if (!address) {
          unaddressed++;
          continue;
        }
        const group = groups.get(address) ?? { nodes: [], txids: new Set<string>() };
        group.nodes.push(outpointReference(tx.txid, output.n));
        group.txids.add(tx.txid);
        groups.set(address, group);
      }
    const findings = [...groups]
      .filter(
        ([, group]) =>
          group.nodes.length >= minimum && (!separateTransactions || group.txids.size >= 2),
      )
      .map(([address, group]) =>
        finding(
          context,
          'address-reuse',
          address,
          'observation',
          group.txids.size > 1
            ? `The same address appears in ${group.txids.size} transactions`
            : `The same address appears ${group.nodes.length} times in one transaction`,
          `${address} appears on ${group.nodes.length} outputs across ${group.txids.size} transaction${group.txids.size === 1 ? '' : 's'} in the scoped loaded history. ${group.txids.size === 1 ? 'These repeats occur within one transaction.' : 'The same address recurs in separate transactions.'} Outputs may already be spent; the occurrence count is not a balance. Inspect the linked outputs and label their context.`,
          group.nodes,
          [...group.txids],
          [...group.txids],
          group.txids.size > 1 ? 'repeated-address' : undefined,
          {
            summary:
              group.txids.size > 1
                ? 'Anyone viewing these transactions can see that they use the same address, making the activity easier to connect.'
                : 'Several outputs use the same address within this transaction. This is not evidence of repeated receiving activity across separate transactions.',
            guidance:
              group.txids.size > 1
                ? {
                    kind: 'tip',
                    text: 'When receiving bitcoin, use a fresh receiving address from your wallet for each payment. This reduces obvious links between payments.',
                  }
                : {
                    kind: 'tip',
                    text: 'Check the transaction’s purpose and your labels before treating these outputs as separate payments.',
                  },
          },
        ),
      );
    return {
      findings,
      summary: `${groups.size} addresses checked in scoped loaded history; ${findings.length} repeated addresses found.`,
      emptyReason: `No address occurs on at least ${minimum} scoped outputs${separateTransactions ? ' across different transactions' : ''}. Outputs without decoded addresses cannot be compared by this tool.`,
      stats: [
        { label: 'Transactions in scope', value: context.transactions.length },
        { label: 'Addresses checked', value: groups.size },
        { label: 'Outputs without addresses', value: unaddressed },
      ],
    };
  },
});
