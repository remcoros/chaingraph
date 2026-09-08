import type { Annotation, Network, Transaction, Workspace, WorkspaceTag } from './types';
import { outputNodeId, txNodeId } from './types';
import { newWorkspace, parseWorkspace } from './workspace';

export interface WorkspaceTemplate {
  readonly id: string;
  readonly network: Network;
  readonly name: string;
  readonly description: string;
  readonly summary: string;
  readonly icon: string;
  readonly sources: readonly { readonly title: string; readonly url: string }[];
}

const equalSeed = '323df21f0b0756f98336437aa3d2fb87e02b59f1946b714a7b09df04d429dec2';
const equalSpender = '015d9cf0a12057d009395710611c65109f36b3eaefa3a694594bf243c097f404';
const messageSeed = '8bae12b5f4c088d940733dcd1455efc6a3a69cf9340e17a981286d3778615684';
const spentSeed = 'd4e564d295233f62603f7a7e9527acf88f6e467985868f15339887285d64bb1a';
const spentSpender = '8cfd7566b77a32519b7f9054c879ce73628255fb6171e431ba5134c114cd1044';
const fanoutSeed = 'cc159432ffb7a166abeccc79800e9616a09ea9ac6937080c2ca37b38671970e5';
const chainSource = (network: Network, txid: string, title = 'Transaction on mempool.space') => ({
  title,
  url: `https://mempool.space/${network === 'testnet4' ? 'testnet4/' : ''}tx/${txid}`,
});

/** Lightweight catalog. Chain snapshots are imported only when creating a copy. */
export const WORKSPACE_TEMPLATES: readonly WorkspaceTemplate[] = [
  {
    id: 'mainnet-equal-outputs',
    network: 'mainnet',
    name: 'Equal outputs and a spending hop',
    description:
      'Compare five equal outputs and one verified successor. Labels and tags separate observed amounts and outpoints from ownership hypotheses.',
    summary: 'Five equal outputs, a nine-input successor, and their direct input data.',
    icon: '🔬',
    sources: [
      chainSource('mainnet', equalSeed),
      chainSource('mainnet', equalSpender, 'Known successor on mempool.space'),
    ],
  },
  {
    id: 'mainnet-op-return',
    network: 'mainnet',
    name: 'An on-chain message',
    description:
      'Inspect a zero-value OP_RETURN output beside a P2PKH output. The annotations explain the script without attributing its message to a person.',
    summary: 'One input, two outputs, and the funding transaction.',
    icon: '📝',
    sources: [chainSource('mainnet', messageSeed)],
  },
  {
    id: 'testnet4-spent-output',
    network: 'testnet4',
    name: 'Follow an exact spent output',
    description:
      'Trace a testnet4 output from its funding transaction to a loaded spender. Bookmarks and a path tag mark the exact observed connection.',
    summary: 'Three transactions covering a parent, an output, and its spender.',
    icon: '🔗',
    sources: [
      chainSource('testnet4', spentSeed),
      chainSource('testnet4', spentSpender, 'Known spender on mempool.space'),
    ],
  },
  {
    id: 'testnet4-fan-out',
    network: 'testnet4',
    name: 'Explore 53 outputs',
    description:
      'Compare a testnet4 fan-out containing P2WSH, P2WPKH and data outputs. Tags group script observations without assuming payment or change roles.',
    summary: 'One input, 53 outputs, and the funding transaction.',
    icon: '⑂',
    sources: [chainSource('testnet4', fanoutSeed)],
  },
];

interface Snapshot {
  network: string;
  retrievedAt: string;
  roots: string[];
  transactions: Record<string, Transaction>;
}

async function loadSnapshot(id: string): Promise<Snapshot> {
  switch (id) {
    case 'mainnet-equal-outputs':
      return (await import('./templateData/mainnet-equal-outputs.json')).default;
    case 'mainnet-op-return':
      return (await import('./templateData/mainnet-op-return.json')).default;
    case 'testnet4-spent-output':
      return (await import('./templateData/testnet4-spent-output.json')).default;
    case 'testnet4-fan-out':
      return (await import('./templateData/testnet4-fan-out.json')).default;
    default:
      throw new Error('Unknown workspace template.');
  }
}

/** Creates ordinary editable workspace data. Call in a worker, like vault validation. */
export async function createTemplateWorkspace(
  id: string,
  name?: string,
  description?: string,
): Promise<Workspace> {
  const template = WORKSPACE_TEMPLATES.find((entry) => entry.id === id);
  if (!template) throw new Error('Unknown workspace template.');
  const snapshot = await loadSnapshot(id);
  if (snapshot.network !== template.network) throw new Error('Template network mismatch.');
  const workspace = newWorkspace(name ?? template.name, template.network);
  workspace.description = description ?? template.description;
  workspace.transactions = snapshot.transactions;

  // Retain complete parent observations while displaying only the referenced outputs.
  const roots = new Set(snapshot.roots);
  workspace.inputContext = {};
  for (const root of snapshot.roots) {
    for (const input of snapshot.transactions[root].vin) {
      if (!input.txid || input.vout === undefined || roots.has(input.txid)) continue;
      const outputs = (workspace.inputContext[input.txid] ??= []);
      if (!outputs.includes(input.vout)) outputs.push(input.vout);
    }
  }
  workspace.contextTransactionIds = Object.keys(workspace.inputContext);
  workspace.tags = [];
  const annotate = (
    nodeId: string,
    label: string,
    note: string,
    icon: string,
    bookmarked = false,
  ) => {
    const annotation: Annotation = { label, note, icon, bookmarked };
    workspace.annotations[nodeId] = annotation;
  };
  const tag = (name: string, color: string, description: string, nodeIds: string[]) => {
    const entry: WorkspaceTag = { id: crypto.randomUUID(), name, color, description, nodeIds };
    workspace.tags!.push(entry);
  };
  const snapshotNote = `Public chain snapshot retrieved ${snapshot.retrievedAt}. Confirmation counts are historical observations. Missing spending data does not establish current unspent status.`;
  let selected = txNodeId(snapshot.roots[0]);

  if (id === 'mainnet-equal-outputs') {
    annotate(
      txNodeId(equalSeed),
      'Five equal outputs',
      `Five inputs fund five outputs of 5,000,000 sats. Equal amounts do not establish participants or ownership. ${snapshotNote}`,
      '🔬',
      true,
    );
    annotate(
      txNodeId(equalSpender),
      'Observed successor',
      'Input index 1 spends output 2 of the five-equal-output transaction. This transaction has nine inputs and four outputs, including two equal outputs. Compare the equal-value groups before following individual outputs; common-input grouping remains a hypothesis.',
      '🔗',
      true,
    );
    for (let n = 0; n < 5; n++) {
      annotate(
        outputNodeId(equalSeed, n),
        `Equal output ${n}`,
        n === 2
          ? '5,000,000 sats. The loaded successor consumes this exact outpoint at input index 1.'
          : '5,000,000 sats. This amount matches the other four outputs. No spender is included for this output in this template.',
        n === 2 ? '🔗' : '◇',
        n === 2,
      );
    }
    annotate(
      outputNodeId(equalSpender, 2),
      'Repeated successor amount',
      '9,136,520 sats, equal to successor output 3. Matching values alone do not identify an owner or a unique path through the transaction.',
      '◇',
    );
    tag(
      'Equal-value observations',
      '#38bdf8',
      'Five outputs with the same observed amount; no ownership grouping.',
      Array.from({ length: 5 }, (_, n) => outputNodeId(equalSeed, n)),
    );
    tag(
      'Verified spending hop',
      '#a78bfa',
      'An exact outpoint relationship present in the loaded transaction inputs.',
      [outputNodeId(equalSeed, 2), txNodeId(equalSpender)],
    );
    tag('Successor equal pair', '#fbbf24', 'Two successor outputs of 9,136,520 sats.', [
      outputNodeId(equalSpender, 2),
      outputNodeId(equalSpender, 3),
    ]);
  } else if (id === 'mainnet-op-return') {
    selected = outputNodeId(messageSeed, 0);
    annotate(
      txNodeId(messageSeed),
      'Message transaction',
      `One input funds a zero-value data output and a 200,000-sat P2PKH output. ${snapshotNote}`,
      '📝',
      true,
    );
    annotate(
      selected,
      'OP_RETURN text',
      'Zero-value output with OP_RETURN followed by a 19-byte text payload. Open Scripts and raw transaction to inspect the saved script and decoded text. The message itself does not establish authorship or identity.',
      '📝',
      true,
    );
    annotate(
      outputNodeId(messageSeed, 1),
      'P2PKH output',
      '200,000 sats sent to a P2PKH script. The template does not identify this output as payment or change.',
      '◇',
    );
    tag('Data output', '#a78bfa', 'Observed OP_RETURN script; no attribution of the message.', [
      selected,
    ]);
    tag(
      'Spendable script form',
      '#38bdf8',
      'P2PKH script form. This tag does not claim current UTXO status.',
      [outputNodeId(messageSeed, 1)],
    );
  } else if (id === 'testnet4-spent-output') {
    selected = outputNodeId(spentSeed, 1);
    annotate(
      txNodeId(spentSeed),
      'Creating transaction',
      `One input and two P2WPKH outputs. The immediate parent and one known spender are included. ${snapshotNote}`,
      '📍',
      true,
    );
    annotate(
      selected,
      'Follow output 1',
      '447,915,285 sats. Input index 0 of the loaded spending transaction references this exact outpoint. Follow the spending arrow to inspect that transaction.',
      '🔗',
      true,
    );
    annotate(
      txNodeId(spentSpender),
      'Verified spender',
      'Input index 0 consumes the bookmarked output 1. This is an observed transaction relationship, without a claim about who controls either transaction.',
      '🔗',
      true,
    );
    annotate(
      outputNodeId(spentSeed, 0),
      'Other output',
      '243,039 sats. No spending transaction for this output is included; its current UTXO status is unknown from this snapshot.',
      '◇',
    );
    tag(
      'Observed path',
      '#38bdf8',
      'Creating transaction, exact spent outpoint, and its known spender.',
      [txNodeId(spentSeed), selected, txNodeId(spentSpender)],
    );
  } else {
    selected = outputNodeId(fanoutSeed, 0);
    annotate(
      txNodeId(fanoutSeed),
      '53-output fan-out',
      `One input and 53 outputs: 51 P2WSH outputs, one P2WPKH output, and one OP_RETURN output. ${snapshotNote}`,
      '⑂',
      true,
    );
    annotate(
      selected,
      'Start with output 0',
      '6,000,000,000 testnet4 sats in a P2WSH output. Follow one selected output at a time. The template includes no spending transactions for this fan-out.',
      '📍',
      true,
    );
    annotate(
      outputNodeId(fanoutSeed, 51),
      'Different script form',
      '19,498,000,000 testnet4 sats in a P2WPKH output. A different script type does not establish a payment or change role.',
      '◇',
      true,
    );
    annotate(
      outputNodeId(fanoutSeed, 52),
      'Data output',
      'Zero-value OP_RETURN output with an 80-byte text payload. Inspect its script to compare data and spendable script forms.',
      '📝',
      true,
    );
    tag(
      'P2WSH outputs',
      '#38bdf8',
      'Outputs 0 through 50 share a script type. This does not group their owners.',
      Array.from({ length: 51 }, (_, n) => outputNodeId(fanoutSeed, n)),
    );
    tag('P2WPKH output', '#fbbf24', 'One observed P2WPKH script, with no inferred payment role.', [
      outputNodeId(fanoutSeed, 51),
    ]);
    tag('Data output', '#a78bfa', 'One observed OP_RETURN output.', [outputNodeId(fanoutSeed, 52)]);
  }
  workspace.view = {
    ...workspace.view,
    showLabels: true,
    showTags: true,
    showIcons: true,
    selectionId: selected,
    leftTab: 'bookmarks',
    rightTab: 'inspect',
    prefetchDepth: 0,
    transactionFlow: { transactionId: snapshot.roots[0], open: true },
  };
  // Validation also deep-copies the module-cached snapshot, so copies share no mutable data.
  return parseWorkspace(workspace);
}
