import type { Annotation } from './annotations';
import type { Workspace } from '../workspace';

import { addressToScriptHash, isExtendedPublicKey, type Network } from '../../Bitcoin';

export function exportLabels(w: Workspace): string {
  const lines: string[] = [];
  for (const [id, a] of Object.entries(w.annotations.entities)) {
    if (!a.label) continue;
    const split = id.indexOf(':');
    const prefix = id.slice(0, split),
      ref = id.slice(split + 1);
    const type = (
      { tx: 'tx', out: 'output', addr: 'addr', xpub: 'xpub' } as Record<string, string>
    )[['tx', 'out', 'addr', 'xpub'].includes(prefix) ? prefix : ''];
    if (type) lines.push(JSON.stringify({ type, ref, label: a.label }));
  }
  for (const wallet of w.wallets.definitions)
    lines.push(JSON.stringify({ type: 'xpub', ref: wallet.key, label: wallet.name }));
  return lines.join('\n');
}
function isKnownAddress(ref: string): boolean {
  return (['mainnet', 'testnet4'] as Network[]).some((network) => {
    try {
      addressToScriptHash(ref, network);
      return true;
    } catch {
      return false;
    }
  });
}

export function importLabels(content: string): {
  annotations: Record<string, Annotation>;
  skipped: number;
} {
  if (content.length > 5_000_000) throw new Error('Label file exceeds 5 MB.');
  const annotations: Record<string, Annotation> = {};
  let skipped = 0;
  // Tolerate one UTF-8 byte-order mark; some editors prepend it to JSON Lines.
  const lines = content
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .filter((l) => l.trim());
  if (lines.length > 10000) throw new Error('Label file exceeds 10,000 records.');
  for (let i = 0; i < lines.length; i++) {
    let item;
    try {
      item = JSON.parse(lines[i]);
    } catch {
      throw new Error(`Invalid JSON on label line ${i + 1}.`);
    }
    const prefix = (
      { tx: 'tx', output: 'out', addr: 'addr', xpub: 'xpub' } as Record<string, string>
    )[
      item && typeof item.type === 'string' && ['tx', 'output', 'addr', 'xpub'].includes(item.type)
        ? item.type
        : ''
    ];
    // Unknown BIP329 types (pubkey, input, spscan, future records) are ignored.
    if (!prefix) {
      skipped++;
      continue;
    }
    // BIP329 labels are optional: an omitted label must leave the existing
    // value unchanged. An explicit string (including empty, which clears the
    // label) is honored.
    if (item.label === undefined) {
      skipped++;
      continue;
    }
    if (
      typeof item.label !== 'string' ||
      item.label.length > 200 ||
      typeof item.ref !== 'string' ||
      item.ref.length > 150
    )
      throw new Error(`Invalid label on line ${i + 1}.`);
    let ref: string = item.ref;
    if (item.type === 'tx') {
      if (!/^[0-9a-f]{64}$/i.test(ref)) throw new Error(`Invalid reference on line ${i + 1}.`);
      ref = ref.toLowerCase();
    } else if (item.type === 'output') {
      const outpoint = /^([0-9a-f]{64}):(\d+)$/i.exec(ref);
      if (!outpoint || Number(outpoint[2]) > 0xffffffff)
        throw new Error(`Invalid reference on line ${i + 1}.`);
      ref = `${outpoint[1].toLowerCase()}:${Number(outpoint[2])}`;
    } else if (item.type === 'xpub') {
      // BIP329 defines no private key types; never retain private key material.
      if (!isExtendedPublicKey(ref)) throw new Error(`Invalid reference on line ${i + 1}.`);
    } else if (item.type === 'addr') {
      if (!isKnownAddress(ref)) throw new Error(`Invalid reference on line ${i + 1}.`);
      if (/^(?:bc|tb)1/i.test(ref)) ref = ref.toLowerCase();
    }
    annotations[`${prefix}:${ref}`] = {
      label: item.label,
      note: '',
      icon: '',
      bookmarked: false,
    };
  }
  return { annotations, skipped };
}
