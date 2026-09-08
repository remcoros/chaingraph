import { outputNodeId } from '../types';
import { outputAddress } from '../workspace';
import type { Transaction } from '../types';
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
    'Find exact repeated positive amounts and highlight each matching group separately. Useful for studying ambiguity and repeated payments.',
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
            `Exactly ${outputs.length} spendable outputs share ${formatAmount(amount)}. Only these outputs are highlighted. Repeated amounts can arise from batching, collaborative transactions or other activity. This is neither a CoinJoin identification nor a Boltzmann linkability probability. Compare the remaining outputs and input history.`,
            outputs.map((output) => outputNodeId(tx.txid, output.n)),
            [tx.txid],
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
  name: 'Common-input ownership',
  group: 'Privacy patterns',
  kind: 'hypothesis',
  description:
    'Build tentative input groups with explicit collaboration exclusions. Inspect supporting transactions before treating a group as a wallet.',
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
    const scriptsByAddress = new Map<string, string>();
    for (const tx of context.transactions)
      for (const input of referencedInputs(context.workspace, tx)) {
        const address = input.output && outputAddress(input.output),
          script = input.output?.scriptPubKey.hex;
        if (address && script !== undefined) scriptsByAddress.set(address, script.toLowerCase());
      }
    let eligible = 0,
      skippedEqual = 0,
      skippedSmall = 0,
      alreadyOneScript = 0,
      missingParents = 0;
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
      const inputs = referencedInputs(context.workspace, tx);
      if (inputs.length < 2) {
        skippedSmall++;
        continue;
      }
      const members = inputs.map((input) => {
        if (!input.output) missingParents++;
        const address = input.output && outputAddress(input.output);
        const script =
          input.output?.scriptPubKey.hex?.toLowerCase() ??
          (address ? scriptsByAddress.get(address) : undefined);
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
      .sort((a, b) => [...a.nodes].sort()[0].localeCompare([...b.nodes].sort()[0]))
      .map((group, index) => {
        const nodeIds = [...group.nodes].sort(),
          txids = [...group.txids].sort();
        return finding(
          context,
          'cioh',
          nodeIds.join('|'),
          'hypothesis',
          `Tentative input group ${index + 1}: ${nodeIds.length} outputs`,
          `${nodeIds.length} referenced outputs were co-spent across ${txids.length} transactions in this scope, with transitive grouping through known addresses or scripts. ${skipEqual ? `Transactions with ${threshold}+ equal outputs were skipped (${skippedEqual} skipped in this run).` : 'Equal-output exclusion was disabled for this run.'} PayJoin and other collaboration can invalidate this grouping. ${missingParents ? `${missingParents} input references in this run have missing parent data; those links use outpoints and cannot establish address-level continuity. ` : ''}Load the supporting transactions and compare your own labels. This does not establish a person's identity.`,
          nodeIds,
          txids,
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
        { label: 'Missing parent references', value: missingParents },
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
    'Locate addresses repeated on outputs within the chosen scope. Separate repeats in one transaction from reuse across transactions.',
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
        group.nodes.push(outputNodeId(tx.txid, output.n));
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
          `Address repeated on ${group.nodes.length} outputs`,
          `${address} appears on ${group.nodes.length} outputs across ${group.txids.size} transaction${group.txids.size === 1 ? '' : 's'} in the scoped loaded history. ${group.txids.size === 1 ? 'These repeats occur within one transaction.' : 'The same address recurs in separate transactions.'} Outputs may already be spent; the occurrence count is not a balance. Inspect the linked outputs and label their context.`,
          group.nodes,
          [...group.txids],
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
