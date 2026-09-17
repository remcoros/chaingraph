import { outpointReference } from '../../entityReferences';
import { outputAddress, outputScriptHex } from '../../../Bitcoin';
import type { Transaction } from '../../../ChainData';

import {
  booleanOption,
  defineTool,
  finding,
  formatAmount,
  isCoinbase,
  numberOption,
  referencedInputs,
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
  group: 'Privacy patterns',
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

export const ciohTool = defineTool({
  id: 'cioh',
  name: 'Co-spent inputs',
  group: 'Privacy patterns',
  kind: 'hypothesis',
  description:
    'Find coins spent together in a transaction, then connect those groups where the same address or spending script appears again. This can suggest coins controlled by one wallet, but transactions made jointly by several people can create the same links.',
  source: {
    title: 'BIP78: why PayJoin breaks common-input ownership',
    url: 'https://github.com/bitcoin/bips/blob/master/bip-0078.mediawiki',
  },
  parameters: [
    {
      id: 'skipEqualOutputs',
      label: 'Skip equal-output candidates',
      type: 'boolean',
      defaultValue: true,
      help: 'A limited precaution, not a complete CoinJoin or PayJoin detector.',
    },
    {
      id: 'equalOutputThreshold',
      label: 'Equal-output skip threshold',
      type: 'number',
      defaultValue: 3,
      min: 2,
      max: 1000,
    },
  ],
  execute(context) {
    const skipEqual = booleanOption(context.options, 'skipEqualOutputs', true);
    const threshold = numberOption(context.options, 'equalOutputThreshold', 3, 2, 1000);
    const union = new Map<string, string>();
    const nodes = new Map<string, Set<string>>(),
      evidence = new Map<string, Set<string>>();
    const unavailableNodes = new Set<string>();
    let eligible = 0,
      skippedEqual = 0,
      skippedSmall = 0,
      alreadyOneScript = 0,
      missingPrevouts = 0;
    function root(key: string): string {
      let current = key;
      while (union.has(current) && union.get(current) !== current) current = union.get(current)!;
      let next = key;
      while (union.has(next) && union.get(next) !== current) {
        const parent = union.get(next)!;
        union.set(next, current);
        next = parent;
      }
      return current;
    }
    for (const tx of context.transactions) {
      if (isCoinbase(tx) || tx.vin.length < 2) {
        skippedSmall++;
        continue;
      }
      if (skipEqual && equalOutputCount(tx) >= threshold) {
        skippedEqual++;
        continue;
      }
      const inputs = referencedInputs(context.workspace, tx, context.prevouts);
      if (inputs.length < 2) {
        skippedSmall++;
        continue;
      }
      const members = inputs.map((input) => {
        const output =
          input.resolution.status === 'loaded' || input.resolution.status === 'attached'
            ? input.resolution.output
            : undefined;
        if (!output) {
          missingPrevouts++;
          unavailableNodes.add(input.nodeId);
        }
        const address = output && outputAddress(output);
        const script = output && outputScriptHex(output, context.workspace.network);
        return {
          ...input,
          key:
            script !== undefined ? `script:${script}` : address ? `addr:${address}` : input.nodeId,
        };
      });
      if (new Set(members.map((member) => member.key)).size < 2) {
        alreadyOneScript++;
        continue;
      }
      eligible++;
      for (const member of members) {
        const a = root(member.key),
          b = root(members[0].key);
        if (a !== b) union.set(a < b ? b : a, a < b ? a : b);
        const group = nodes.get(member.key) ?? new Set<string>();
        group.add(member.nodeId);
        nodes.set(member.key, group);
        const proof = evidence.get(member.key) ?? new Set<string>();
        proof.add(tx.txid);
        evidence.set(member.key, proof);
      }
    }
    const groups = new Map<string, { nodes: Set<string>; txids: Set<string> }>();
    for (const [key, memberNodes] of nodes) {
      const leader = root(key),
        group = groups.get(leader) ?? { nodes: new Set<string>(), txids: new Set<string>() };
      for (const node of memberNodes) group.nodes.add(node);
      for (const txid of evidence.get(key) ?? []) group.txids.add(txid);
      groups.set(leader, group);
    }
    const findings = [...groups.values()]
      .map((group) => {
        const nodeIds = [...group.nodes].sort();
        return {
          nodeIds,
          txids: [...group.txids].sort(),
          firstNodeId: nodeIds[0]!,
        };
      })
      .sort((a, b) => a.firstNodeId.localeCompare(b.firstNodeId))
      .map(({ nodeIds, txids }) => {
        const unavailable = nodeIds.filter((id) => unavailableNodes.has(id)).length;
        return finding(
          context,
          'cioh',
          nodeIds.join('|'),
          'hypothesis',
          txids.length === 1
            ? `${nodeIds.length} amounts spent together`
            : `Possible connection across ${txids.length} transactions`,
          `${nodeIds.length} outputs are linked by co-spending across ${txids.length} transaction${txids.length === 1 ? '' : 's'}, including connections through shared addresses or scripts. ${skipEqual ? `Transactions with ${threshold}+ equal outputs were excluded.` : 'Equal-output exclusion was disabled.'} PayJoin and other collaborative transactions can still invalidate the assumption of shared ownership. ${unavailable ? `${unavailable} output${unavailable === 1 ? '' : 's'} in this group ${unavailable === 1 ? 'lacks' : 'lack'} usable previous-output details. ` : ''}Compare the supporting transactions and your labels before treating this as one wallet.`,
          nodeIds,
          txids,
          txids,
          undefined,
          {
            summary:
              txids.length === 1
                ? `${nodeIds.length} previously received amounts were spent together. Observers may assume they belong to one wallet, but CoinJoin and PayJoin can break that assumption.`
                : `${txids.length} transactions connect these amounts through co-spending and shared addresses or scripts. This suggests a possible wallet connection, not proof of shared ownership.`,
            guidance: {
              kind: 'privacy',
              text: 'If you want to keep different sources of bitcoin separate, combining them in one ordinary transaction creates a public connection. Labels and your wallet’s coin control can help you keep track.',
            },
          },
        );
      });
    return {
      findings,
      summary: `${eligible} transactions contributed input groups; ${skippedEqual} equal-output candidates were skipped.`,
      emptyReason: skippedEqual
        ? `No groups remain after excluding ${skippedEqual} equal-output candidates and transactions without multiple distinct input scripts or outpoints.`
        : 'No co-spend of multiple distinct input scripts or outpoints was found in this scope.',
      stats: [
        { label: 'Transactions in scope', value: context.transactions.length },
        { label: 'Contributing transactions', value: eligible },
        { label: 'Equal-output candidates skipped', value: skippedEqual },
        { label: 'Coinbase / insufficient inputs', value: skippedSmall },
        { label: 'Already one script', value: alreadyOneScript },
        { label: 'Missing previous-output details', value: missingPrevouts },
      ],
    };
  },
});

export const reuseTool = defineTool({
  id: 'address-reuse',
  name: 'Address reuse',
  group: 'Privacy patterns',
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
