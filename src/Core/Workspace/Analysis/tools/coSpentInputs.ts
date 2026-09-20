import { outputAddress, outputScriptHex } from '../../../Bitcoin';
import { toolGroups } from '../toolGroups';
import { equalOutputCount } from './equalOutputs';
import {
  booleanOption,
  defineTool,
  finding,
  isCoinbase,
  numberOption,
  referencedInputs,
} from './shared';

export const ciohTool = defineTool({
  id: 'cioh',
  name: 'Co-spent inputs',
  group: toolGroups.privacyPatterns,
  displayOrder: 20,
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
          nodeIds,
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
