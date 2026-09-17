import { formatBitcoinAmount } from '../../Core/Formatting';
import mainnetBatchOutputsUrl from './templateData/mainnet-batch-outputs.json?url';
import mainnetEqualOutputsUrl from './templateData/mainnet-equal-outputs.json?url';
import mainnetLargeValuePathUrl from './templateData/mainnet-large-value-path.json?url';
import mainnetOpReturnUrl from './templateData/mainnet-op-return.json?url';
import mainnetPublicWalletUrl from './templateData/mainnet-public-wallet.json?url';
import mainnetWabisabiUrl from './templateData/mainnet-wabisabi.json?url';
import testnet4FanOutUrl from './templateData/testnet4-fan-out.json?url';
import testnet4MixedPathUrl from './templateData/testnet4-mixed-path.json?url';
import testnet4SpentOutputUrl from './templateData/testnet4-spent-output.json?url';
import { TAG_COLOR, type TagColor } from '../Controls/Metadata/tagColors';
import type { Annotation, WorkspaceTag } from '../../Core/Workspace/Annotations/annotations';
import type { Wallet } from '../../Core/Workspace/Wallets/wallets';
import type { Workspace } from '../../Core/Workspace/workspace';
import { outpointReference, transactionReference } from '../../Core/Workspace/entityReferences';

import { type Network, sats } from '../../Core/Bitcoin';
import type { Transaction } from '../../Core/ChainData';

import { createWorkspace } from '../../Core/Workspace/createWorkspace';
import { parseWorkspace } from '../../Core/Workspace/Persistence';
import { transactionNodeIds } from '../Workspace/GraphState/visibility';

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
const largeSeed = 'a6d697a25266ce3c78774fd1d75f896b7af522ada209b0f6228ea497bc49a46d';
const largeParent = '17a0d14d4ec50f3384e1c9c6eac7a67345b4c1946a518ab2d943a6d71fe5266e';
const batchSeed = '3d81a6b95903dd457d45a2fc998acc42fe96f59ef01157bdcbc331fe451c8d9e';
const wabisabiSeed = 'fb596c9f675471019c60e984b569f9020dac3b2822b16396042b50c890b45e5e';
const mixedSeed = 'b92eb2d8abf81a25197bacde9845eea3d711bd6edf25e1e8975d731271dd83eb';
const mixedSpender = 'e0d797ca417b3c39e64677da7be5591f7c5e5d945743e9046efdbb10fd8ba76f';
const chainSource = (network: Network, txid: string, title = 'Transaction on mempool.space') => ({
  title,
  url: `https://mempool.space/${network === 'testnet4' ? 'testnet4/' : ''}tx/${txid}`,
});

/** Lightweight catalog. Chain snapshots are loaded only when creating a copy. */
export const WORKSPACE_TEMPLATES: readonly WorkspaceTemplate[] = [
  {
    id: 'mainnet-equal-outputs',
    network: 'mainnet',
    name: 'Whirlpool: five equal outputs',
    description:
      'Explore a published Whirlpool example with five inputs and five equal outputs, then follow one verified successor. Labels and tags keep amount observations separate from ownership hypotheses.',
    summary: 'Five equal outputs, a nine-input successor, and their direct input data.',
    icon: '🔬',
    sources: [
      chainSource('mainnet', equalSeed),
      {
        title: 'Published Whirlpool example',
        url: 'https://github.com/Copexit/am-i-exposed/blob/3dd81a0dcf9fb4fedd6db6871e5e74315a50531f/src/lib/analysis/heuristics/__tests__/fixtures/api-responses/whirlpool-coinjoin.json',
      },
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
    id: 'mainnet-large-value-path',
    network: 'mainnet',
    name: 'Follow the largest output',
    description: `Compare a ${formatBitcoinAmount(340_000_000_000)} output with a ${formatBitcoinAmount(59_849_955_894)} output. Follow a loaded funding hop, size nodes by value and hide small amounts to see the dominant flow.`,
    summary: 'Fifteen inputs, a large split, and a highlighted funding hop.',
    icon: '🐋',
    sources: [
      chainSource('mainnet', largeSeed),
      chainSource('mainnet', largeParent, 'Loaded funding hop'),
    ],
  },
  {
    id: 'mainnet-batch-outputs',
    network: 'mainnet',
    name: 'One input, 143 outputs',
    description:
      'Explore a large fan-out without losing the main flow. Filter small amounts, compare four script types and use bookmarks to jump between the largest and smallest outputs.',
    summary: 'A 143-output transaction with amount and script tags.',
    icon: '📤',
    sources: [chainSource('mainnet', batchSeed)],
  },
  {
    id: 'mainnet-wabisabi',
    network: 'mainnet',
    name: 'A large WabiSabi CoinJoin',
    description:
      'Explore 327 inputs and 279 outputs in a public WabiSabi example. Compare repeated amounts, filter the smaller outputs and trace individual outpoints without treating common inputs as one owner.',
    summary: '327 inputs, 279 outputs, equal-value groups and full input data.',
    icon: '🌀',
    sources: [
      chainSource('mainnet', wabisabiSeed),
      {
        title: 'WabiSabi discovery fixture',
        url: 'https://github.com/Copexit/am-i-exposed/blob/3dd81a0dcf9fb4fedd6db6871e5e74315a50531f/src/lib/analysis/heuristics/__tests__/fixtures/api-responses/wabisabi-coinjoin.json',
      },
    ],
  },
  {
    id: 'mainnet-public-wallet',
    network: 'mainnet',
    name: 'Explore a public demo wallet',
    description:
      'Explore the public BIP84 test wallet used by am-i-exposed. Follow saved wallet outputs and continue its bounded scan from Wallets. The test seed is public: never send funds to these addresses.',
    summary: 'Public test zpub, wallet highlights and two spending paths. Never deposit.',
    icon: '👛',
    sources: [
      {
        title: 'am-i-exposed public wallet example',
        url: 'https://github.com/Copexit/am-i-exposed/blob/main/src/lib/constants.ts',
      },
      {
        title: 'BIP84 public test vector',
        url: 'https://github.com/bitcoin/bips/blob/master/bip-0084.mediawiki#test-vectors',
      },
    ],
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
    icon: '📤',
    sources: [chainSource('testnet4', fanoutSeed)],
  },
  {
    id: 'testnet4-mixed-path',
    network: 'testnet4',
    name: 'From mixed scripts to a spend',
    description: `Follow a P2WSH output of ${formatBitcoinAmount(1_018_062)} into its ${formatBitcoinAmount(1_000_000)} successor. Compare the large sibling output and OP_RETURN, then tag the exact path through both transactions.`,
    summary: 'Two inputs, three script forms, and a verified spending hop.',
    icon: '🧭',
    sources: [
      chainSource('testnet4', mixedSeed),
      chainSource('testnet4', mixedSpender, 'Verified successor'),
    ],
  },
];

interface Snapshot {
  network: string;
  retrievedAt: string;
  roots: string[];
  transactions: Record<string, Transaction>;
  workspaceVersion?: number;
  wallet?: Omit<Wallet, 'id'>;
}

interface SnapshotSource {
  readonly assetUrl: string;
  readonly filePath: string;
}

const SNAPSHOT_SOURCES: Record<string, SnapshotSource> = {
  'mainnet-equal-outputs': {
    assetUrl: mainnetEqualOutputsUrl,
    filePath: './templateData/mainnet-equal-outputs.json',
  },
  'mainnet-op-return': {
    assetUrl: mainnetOpReturnUrl,
    filePath: './templateData/mainnet-op-return.json',
  },
  'testnet4-spent-output': {
    assetUrl: testnet4SpentOutputUrl,
    filePath: './templateData/testnet4-spent-output.json',
  },
  'testnet4-fan-out': {
    assetUrl: testnet4FanOutUrl,
    filePath: './templateData/testnet4-fan-out.json',
  },
  'mainnet-large-value-path': {
    assetUrl: mainnetLargeValuePathUrl,
    filePath: './templateData/mainnet-large-value-path.json',
  },
  'mainnet-batch-outputs': {
    assetUrl: mainnetBatchOutputsUrl,
    filePath: './templateData/mainnet-batch-outputs.json',
  },
  'mainnet-wabisabi': {
    assetUrl: mainnetWabisabiUrl,
    filePath: './templateData/mainnet-wabisabi.json',
  },
  'mainnet-public-wallet': {
    assetUrl: mainnetPublicWalletUrl,
    filePath: './templateData/mainnet-public-wallet.json',
  },
  'testnet4-mixed-path': {
    assetUrl: testnet4MixedPathUrl,
    filePath: './templateData/testnet4-mixed-path.json',
  },
};

const snapshotCache = new Map<string, Promise<Snapshot>>();

function parseSnapshot(text: string): Snapshot {
  const raw = JSON.parse(text) as Snapshot;
  // Bundled snapshots predate native transaction status. Feed their declared
  // document generation through the same migration/validation as saved workspaces.
  const document = createWorkspace('Template snapshot', raw.network as Network);
  const parsed = parseWorkspace({
    ...document,
    version: raw.workspaceVersion ?? 5,
    chainData: { ...document.chainData, transactions: raw.transactions },
  });
  return { ...raw, transactions: parsed.chainData.transactions };
}

async function fetchSnapshot(assetUrl: string): Promise<Snapshot> {
  const response = await fetch(assetUrl);
  if (!response.ok)
    throw new Error(`Unable to load workspace template snapshot (${response.status}).`);
  return parseSnapshot(await response.text());
}

async function readSnapshotFile(filePath: string): Promise<Snapshot> {
  const { readFile } = await import('node:fs/promises');
  return parseSnapshot(await readFile(new URL(filePath, import.meta.url), 'utf8'));
}

async function loadSnapshot(id: string): Promise<Snapshot> {
  const source = SNAPSHOT_SOURCES[id];
  if (!source) throw new Error('Unknown workspace template.');
  const cacheKey = import.meta.env.SSR ? source.filePath : source.assetUrl;
  const cached = snapshotCache.get(cacheKey);
  if (cached) return cached;
  const snapshot = (
    import.meta.env.SSR ? readSnapshotFile(source.filePath) : fetchSnapshot(source.assetUrl)
  ).catch((error: unknown) => {
    snapshotCache.delete(cacheKey);
    throw error;
  });
  snapshotCache.set(cacheKey, snapshot);
  return snapshot;
}

/** A starting canvas, independent of loaded evidence and later manual expansion. */
function initialTemplateGraph(workspace: Workspace, roots: string[], selected: string): string[] {
  const nodes = new Set([...roots.map(transactionReference), selected]);
  // Every example opens on the complete input and output set of its root
  // transactions. Each one is curated around comparing that whole width, so a
  // partial opening would hide the point rather than tidy the canvas.
  for (const id of roots)
    for (const side of ['inputs', 'outputs'] as const)
      for (const node of transactionNodeIds(workspace.chainData.transactions[id], side))
        nodes.add(node);
  // The wallet example also annotates a context parent's additional sibling. Show
  // its creator to connect that sibling to the already visible funding outpoint.
  for (const node of Object.keys(workspace.annotations.entities)) {
    if (nodes.has(node) || !node.startsWith('out:')) continue;
    nodes.add(node);
    nodes.add(transactionReference(node.split(':')[1]));
  }
  return [...nodes];
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
  const workspace = createWorkspace(name ?? template.name, template.network);
  workspace.description = description ?? template.description;
  workspace.chainData.transactions = snapshot.transactions;

  // Scope the display of parents that the snapshot loads in full. Parents recorded
  // only as attached input prevouts carry no further outputs to scope.
  const roots = new Set(snapshot.roots);
  workspace.view.inputContext = {};
  for (const root of snapshot.roots) {
    for (const input of snapshot.transactions[root].vin) {
      if (!input.txid || input.vout === undefined || roots.has(input.txid)) continue;
      if (!snapshot.transactions[input.txid]) continue;
      const outputs = (workspace.view.inputContext[input.txid] ??= []);
      if (!outputs.includes(input.vout)) outputs.push(input.vout);
    }
  }
  workspace.chainData.contextTransactionIds = Object.keys(workspace.view.inputContext);
  workspace.annotations.tags = [];
  const annotate = (
    nodeId: string,
    label: string,
    note: string,
    icon: string,
    bookmarked = false,
  ) => {
    const annotation: Annotation = { label, note, icon, bookmarked };
    workspace.annotations.entities[nodeId] = annotation;
  };
  const tag = (name: string, color: TagColor, description: string, nodeIds: string[]) => {
    const entry: WorkspaceTag = { id: crypto.randomUUID(), name, color, description, nodeIds };
    workspace.annotations.tags!.push(entry);
  };
  const snapshotNote = `Public chain snapshot retrieved ${snapshot.retrievedAt}. Confirmation counts are historical observations. Missing spending data does not establish current unspent status.`;
  let selected = transactionReference(snapshot.roots[0]);

  if (id === 'mainnet-equal-outputs') {
    annotate(
      transactionReference(equalSeed),
      'Five equal outputs',
      `Five inputs fund five outputs of ${formatBitcoinAmount(5_000_000)}. Equal amounts do not establish participants or ownership. ${snapshotNote}`,
      '🔬',
      true,
    );
    annotate(
      transactionReference(equalSpender),
      'Observed successor',
      'Input index 1 spends output 2 of the five-equal-output transaction. This transaction has nine inputs and four outputs, including two equal outputs. Compare the equal-value groups before following individual outputs; common-input grouping remains a hypothesis.',
      '🔗',
      true,
    );
    for (let n = 0; n < 5; n++) {
      annotate(
        outpointReference(equalSeed, n),
        `Equal output ${n}`,
        n === 2
          ? `${formatBitcoinAmount(5_000_000)}. The loaded successor consumes this exact outpoint at input index 1.`
          : `${formatBitcoinAmount(5_000_000)}. This amount matches the other four outputs. No spender is included for this output in this template.`,
        n === 2 ? '🔗' : '◇',
        n === 2,
      );
    }
    annotate(
      outpointReference(equalSpender, 2),
      'Repeated successor amount',
      `${formatBitcoinAmount(9_136_520)}, equal to successor output 3. Matching values alone do not identify an owner or a unique path through the transaction.`,
      '◇',
    );
    tag(
      'Equal-value observations',
      TAG_COLOR.cyan,
      'Five outputs with the same observed amount; no ownership grouping.',
      Array.from({ length: 5 }, (_, n) => outpointReference(equalSeed, n)),
    );
    tag(
      'Verified spending hop',
      TAG_COLOR.lavender,
      'An exact outpoint relationship present in the loaded transaction inputs.',
      [outpointReference(equalSeed, 2), transactionReference(equalSpender)],
    );
    tag(
      'Successor equal pair',
      TAG_COLOR.gold,
      `Two successor outputs of ${formatBitcoinAmount(9_136_520)}.`,
      [outpointReference(equalSpender, 2), outpointReference(equalSpender, 3)],
    );
  } else if (id === 'mainnet-op-return') {
    selected = outpointReference(messageSeed, 0);
    annotate(
      transactionReference(messageSeed),
      'Message transaction',
      `One input funds a zero-value data output and a P2PKH output of ${formatBitcoinAmount(200_000)}. ${snapshotNote}`,
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
      outpointReference(messageSeed, 1),
      'P2PKH output',
      `${formatBitcoinAmount(200_000)} sent to a P2PKH script. The template does not identify this output as payment or change.`,
      '◇',
    );
    tag(
      'Data output',
      TAG_COLOR.lavender,
      'Observed OP_RETURN script; no attribution of the message.',
      [selected],
    );
    tag(
      'Spendable script form',
      TAG_COLOR.cyan,
      'P2PKH script form. This tag does not claim current UTXO status.',
      [outpointReference(messageSeed, 1)],
    );
  } else if (id === 'testnet4-spent-output') {
    selected = outpointReference(spentSeed, 1);
    annotate(
      transactionReference(spentSeed),
      'Creating transaction',
      `One input and two P2WPKH outputs. The immediate parent and one known spender are included. ${snapshotNote}`,
      '📍',
      true,
    );
    annotate(
      selected,
      'Follow output 1',
      `${formatBitcoinAmount(447_915_285)}. Input index 0 of the loaded spending transaction references this exact outpoint. Follow the spending arrow to inspect that transaction.`,
      '🔗',
      true,
    );
    annotate(
      transactionReference(spentSpender),
      'Verified spender',
      'Input index 0 consumes the bookmarked output 1. This is an observed transaction relationship, without a claim about who controls either transaction.',
      '🔗',
      true,
    );
    annotate(
      outpointReference(spentSeed, 0),
      'Other output',
      `${formatBitcoinAmount(243_039)}. No spending transaction for this output is included; its current UTXO status is unknown from this snapshot.`,
      '◇',
    );
    tag(
      'Observed path',
      TAG_COLOR.cyan,
      'Creating transaction, exact spent outpoint, and its known spender.',
      [transactionReference(spentSeed), selected, transactionReference(spentSpender)],
    );
  } else if (id === 'testnet4-fan-out') {
    selected = outpointReference(fanoutSeed, 0);
    annotate(
      transactionReference(fanoutSeed),
      '53-output fan-out',
      `One input and 53 outputs: 51 P2WSH outputs, one P2WPKH output, and one OP_RETURN output. ${snapshotNote}`,
      '📤',
      true,
    );
    annotate(
      selected,
      'Start with output 0',
      `${formatBitcoinAmount(6_000_000_000)} on testnet4 in a P2WSH output. Follow one selected output at a time. The template includes no spending transactions for this fan-out.`,
      '📍',
      true,
    );
    annotate(
      outpointReference(fanoutSeed, 51),
      'Different script form',
      `${formatBitcoinAmount(19_498_000_000)} on testnet4 in a P2WPKH output. A different script type does not establish a payment or change role.`,
      '◇',
      true,
    );
    annotate(
      outpointReference(fanoutSeed, 52),
      'Data output',
      'Zero-value OP_RETURN output with an 80-byte text payload. Inspect its script to compare data and spendable script forms.',
      '📝',
      true,
    );
    tag(
      'P2WSH outputs',
      TAG_COLOR.cyan,
      'Outputs 0 through 50 share a script type. This does not group their owners.',
      Array.from({ length: 51 }, (_, n) => outpointReference(fanoutSeed, n)),
    );
    tag(
      'P2WPKH output',
      TAG_COLOR.gold,
      'One observed P2WPKH script, with no inferred payment role.',
      [outpointReference(fanoutSeed, 51)],
    );
    tag('Data output', TAG_COLOR.lavender, 'One observed OP_RETURN output.', [
      outpointReference(fanoutSeed, 52),
    ]);
  }
  if (id === 'mainnet-large-value-path') {
    selected = outpointReference(largeSeed, 1);
    annotate(
      transactionReference(largeSeed),
      'Fifteen inputs, two outputs',
      `Compare the two output amounts using Size by value. Several inputs come from transactions with small sibling outputs; use amount filters to simplify the graph. The inputs do not prove one owner. ${snapshotNote}`,
      '🐋',
      true,
    );
    annotate(
      selected,
      `${formatBitcoinAmount(340_000_000_000)} output`,
      `${formatBitcoinAmount(340_000_000_000)} in a P2WSH output, about 85% of the transaction output value. Its size does not identify a recipient or establish a payment role.`,
      '🐋',
      true,
    );
    annotate(
      outpointReference(largeSeed, 0),
      `${formatBitcoinAmount(59_849_955_894)} output`,
      `${formatBitcoinAmount(59_849_955_894)} in a P2WPKH output. Compare the size and script with output 1. A smaller amount or different script is not proof of change.`,
      '◇',
      true,
    );
    annotate(
      transactionReference(largeParent),
      'Loaded funding hop',
      'This transaction creates output 1, consumed by input 0 of the fifteen-input transaction. Follow the exact arrow forward; its other outputs are visible for comparison.',
      '🔗',
      true,
    );
    annotate(
      outpointReference(largeParent, 1),
      'Verified input connection',
      'The downstream transaction references this exact outpoint at input 0. This link is an observation, without assigning its value to a particular downstream output.',
      '🔗',
      true,
    );
    tag(
      'Dominant output',
      TAG_COLOR.gold,
      'Largest observed output, with no ownership attribution.',
      [selected],
    );
    tag(
      'Verified funding hop',
      TAG_COLOR.cyan,
      'Exact parent outpoint and consuming transaction.',
      [
        transactionReference(largeParent),
        outpointReference(largeParent, 1),
        transactionReference(largeSeed),
      ],
    );
  } else if (id === 'mainnet-batch-outputs') {
    const outputs = snapshot.transactions[batchSeed].vout;
    const ranked = [...outputs].sort((a, b) => sats(b.value) - sats(a.value));
    selected = outpointReference(batchSeed, ranked[0].n);
    annotate(
      transactionReference(batchSeed),
      '143-output fan-out',
      `One input funds 143 outputs across four script types. Try the amount filter in the flow panel and independently in the graph. Fan-out alone does not prove an exchange withdrawal batch. ${snapshotNote}`,
      '📤',
      true,
    );
    for (const [output, label, icon] of [
      [ranked[0], 'Largest output', '🐋'],
      [ranked[ranked.length - 1], 'Smallest output', '🔎'],
    ] as const) {
      annotate(
        outpointReference(batchSeed, output.n),
        label,
        `${formatBitcoinAmount(sats(output.value))}. Use this bookmark to compare the extremes before applying an amount filter. No payment or change role has been assigned.`,
        icon,
        true,
      );
    }
    const small = outputs.filter((output) => sats(output.value) < 10_000);
    tag(
      `Below ${formatBitcoinAmount(10_000)}`,
      TAG_COLOR.gold,
      'Amount comparison group, not a dust-attack attribution.',
      small.map((output) => outpointReference(batchSeed, output.n)),
    );
    for (const [type, label, color] of [
      ['witness_v0_keyhash', 'P2WPKH', TAG_COLOR.cyan],
      ['witness_v0_scripthash', 'P2WSH', TAG_COLOR.lavender],
      ['scripthash', 'P2SH', TAG_COLOR.forest],
      ['pubkeyhash', 'P2PKH', TAG_COLOR.rose],
    ] as const) {
      tag(
        label,
        color,
        'Shared script form does not establish common ownership.',
        outputs
          .filter((output) => output.scriptPubKey.type === type)
          .map((output) => outpointReference(batchSeed, output.n)),
      );
    }
  } else if (id === 'mainnet-wabisabi') {
    const transaction = snapshot.transactions[wabisabiSeed];
    annotate(
      transactionReference(wabisabiSeed),
      'WabiSabi example: compare amounts',
      `327 inputs and 279 outputs. The discovery source identifies this as a WabiSabi CoinJoin; the saved data independently verifies its transaction structure, not participant identities. Try the independent amount filters and follow one outpoint at a time. ${snapshotNote}`,
      '🌀',
      true,
    );
    const groups = new Map<number, number[]>();
    for (const output of transaction.vout) {
      const amount = sats(output.value);
      const indices = groups.get(amount) ?? [];
      indices.push(output.n);
      groups.set(amount, indices);
    }
    const ranked = [...groups]
      .filter(([, indices]) => indices.length > 1)
      .sort((a, b) => b[1].length - a[1].length);
    const colors = [TAG_COLOR.cyan, TAG_COLOR.lavender, TAG_COLOR.gold, TAG_COLOR.forest];
    for (const [index, [amount, indices]] of ranked.slice(0, 4).entries()) {
      const amountText = formatBitcoinAmount(amount);
      tag(
        `${amountText} × ${indices.length}`,
        colors[index],
        'Repeated output amount, not a common-owner group or proof of a unique input-to-output mapping.',
        indices.map((n) => outpointReference(wabisabiSeed, n)),
      );
      annotate(
        outpointReference(wabisabiSeed, indices[0]),
        `${amountText} group`,
        `One of ${indices.length} outputs with this exact amount. Matching values create multiple plausible paths through the transaction; selecting one does not establish where any particular input went.`,
        '◇',
        true,
      );
    }
    const largest = transaction.vout.reduce((best, output) =>
      output.value > best.value ? output : best,
    );
    annotate(
      outpointReference(wabisabiSeed, largest.n),
      'Largest output',
      `${formatBitcoinAmount(sats(largest.value))}. Compare its amount with the tagged equal-value groups. Neither size nor uniqueness identifies an owner or a payment role.`,
      '🐋',
      true,
    );
  } else if (id === 'mainnet-public-wallet') {
    if (!snapshot.wallet) throw new Error('Public wallet template is missing its wallet data.');
    const wallet = { ...snapshot.wallet, id: crypto.randomUUID() };
    workspace.wallets.definitions = [wallet];
    const addressBranches = new Map(
      wallet.addresses.map((address) => [address.address, address.branch]),
    );
    const matched: [string[], string[]] = [[], []];
    for (const transaction of Object.values(snapshot.transactions)) {
      for (const output of transaction.vout) {
        const branch = output.scriptPubKey.address
          ? addressBranches.get(output.scriptPubKey.address)
          : undefined;
        if (branch === undefined) continue;
        const node = outpointReference(transaction.txid, output.n);
        matched[branch].push(node);
        // Context parents expose only referenced outputs. Promote matched wallet outputs
        // so every wallet tag and bookmark is initially available in the graph.
        if (
          workspace.view.inputContext?.[transaction.txid] &&
          !workspace.view.inputContext[transaction.txid].includes(output.n)
        )
          workspace.view.inputContext[transaction.txid].push(output.n);
        annotate(
          node,
          branch === 0 ? 'Demo wallet receive output' : 'Demo wallet change-branch output',
          `${formatBitcoinAmount(sats(output.value))} to an address derived from the intentionally published demo zpub at branch ${branch}. This establishes a key derivation match, not the identity of a person. A change derivation branch is not proof of the economic purpose of this output.`,
          '👛',
          matched[branch].length <= 2,
        );
      }
    }
    for (const [branch, nodes] of matched.entries()) {
      if (nodes.length)
        tag(
          branch === 0 ? 'Demo wallet: receive branch' : 'Demo wallet: change branch',
          branch === 0 ? TAG_COLOR.cyan : TAG_COLOR.lavender,
          'Outputs matching addresses derived from the published demo key. The bundled scan is bounded and incomplete.',
          nodes,
        );
    }
    for (const [index, root] of snapshot.roots.entries()) {
      const transaction = snapshot.transactions[root];
      const consumesWalletOutput = transaction.vin.some((input) => {
        if (!input.txid || input.vout === undefined) return false;
        const address = snapshot.transactions[input.txid]?.vout[input.vout]?.scriptPubKey.address;
        return address !== undefined && addressBranches.has(address);
      });
      annotate(
        transactionReference(root),
        `Demo wallet ${consumesWalletOutput ? 'spending' : 'funding'} hop ${index + 1}`,
        `This transaction ${consumesWalletOutput ? 'spends an output at' : 'funds'} a saved address derived from the public BIP84 test zpub. The test seed is public: never deposit funds here. Open Wallets to inspect or continue discovery; the bundled address set and history are a bounded sample, not the full wallet balance. ${snapshotNote}`,
        '👛',
        true,
      );
    }
  } else if (id === 'testnet4-mixed-path') {
    selected = outpointReference(mixedSeed, 0);
    annotate(
      transactionReference(mixedSeed),
      'Three script forms',
      `Two inputs fund a P2WSH output, a zero-value data output and a large P2WPKH sibling. Compare their amounts before tracing the bookmarked output. ${snapshotNote}`,
      '🧭',
      true,
    );
    annotate(
      selected,
      `Follow ${formatBitcoinAmount(1_018_062)}`,
      'This P2WSH outpoint is consumed by input 0 of the loaded successor. Click the spending arrow to follow its exact connection.',
      '🔗',
      true,
    );
    annotate(
      transactionReference(mixedSpender),
      'One-input successor',
      `The observed input of ${formatBitcoinAmount(1_018_062)} funds one P2WPKH output of ${formatBitcoinAmount(1_000_000)}. The difference of ${formatBitcoinAmount(18_062)} is the transaction fee.`,
      '🔗',
      true,
    );
    annotate(
      outpointReference(mixedSpender, 0),
      `${formatBitcoinAmount(1_000_000)} destination output`,
      'The next observed output on this path. No further spending transaction is included, so this snapshot does not establish a final destination or current UTXO status.',
      '📍',
      true,
    );
    annotate(
      outpointReference(mixedSeed, 1),
      'OP_RETURN output',
      'Zero-value data output. Inspect its saved script and decoded data; the payload does not prove authorship.',
      '📝',
    );
    annotate(
      outpointReference(mixedSeed, 2),
      'Large sibling output',
      `${formatBitcoinAmount(4_998_981_938)} in a P2WPKH script. Its larger amount is not proof of change. No successor for this sibling is included.`,
      '🐋',
      true,
    );
    tag(
      'Verified spending path',
      TAG_COLOR.cyan,
      'Exact outpoint relationship and successor output, without owner attribution.',
      [selected, transactionReference(mixedSpender), outpointReference(mixedSpender, 0)],
    );
    tag(
      'Compare sibling amounts',
      TAG_COLOR.gold,
      'The two nonzero outputs of the creating transaction.',
      [selected, outpointReference(mixedSeed, 2)],
    );
    tag('Data output', TAG_COLOR.lavender, 'Observed OP_RETURN script.', [
      outpointReference(mixedSeed, 1),
    ]);
  }
  workspace.view = {
    ...workspace.view,
    sizeBy: id === 'mainnet-large-value-path' ? 'value' : workspace.view.sizeBy,
    highlightMode: id === 'mainnet-public-wallet' ? 'wallets' : workspace.view.highlightMode,
    showLabels: true,
    showTags: true,
    showIcons: true,
    selectionId: selected,
    graphNodeIds: initialTemplateGraph(workspace, snapshot.roots, selected),
    panels: {
      left: { tab: id === 'mainnet-public-wallet' ? 'wallets' : 'bookmarks' },
      right: { tab: 'inspect' },
      flow: { transactionId: snapshot.roots[0], height: 'expanded' },
    },
    prefetchDepth: 0,
  };
  // Validation also deep-copies the module-cached snapshot, so copies share no mutable data.
  return parseWorkspace(workspace);
}
