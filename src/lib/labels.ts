import type { Annotation, Workspace } from '../domain/types';
export function exportLabels(w: Workspace): string {
  const lines: string[] = [];
  for (const [id, a] of Object.entries(w.annotations)) {
    if (!a.label) continue;
    const split = id.indexOf(':');
    const prefix = id.slice(0, split),
      ref = id.slice(split + 1);
    const type = (
      { tx: 'tx', out: 'output', addr: 'addr', xpub: 'xpub' } as Record<string, string>
    )[['tx', 'out', 'addr', 'xpub'].includes(prefix) ? prefix : ''];
    if (type) lines.push(JSON.stringify({ type, ref, label: a.label }));
  }
  for (const wallet of w.wallets)
    lines.push(JSON.stringify({ type: 'xpub', ref: wallet.key, label: wallet.name }));
  return lines.join('\n');
}
export function importLabels(content: string): {
  annotations: Record<string, Annotation>;
  skipped: number;
} {
  if (content.length > 5_000_000) throw new Error('Label file exceeds 5 MB.');
  const annotations: Record<string, Annotation> = {};
  let skipped = 0;
  const lines = content.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length > 10000) throw new Error('Label file exceeds 10,000 records.');
  for (let i = 0; i < lines.length; i++) {
    let item;
    try {
      item = JSON.parse(lines[i]);
    } catch {
      throw new Error(`Invalid JSON on label line ${i + 1}.`);
    }
    if (
      !item ||
      typeof item.label !== 'string' ||
      item.label.length > 200 ||
      typeof item.ref !== 'string' ||
      item.ref.length > 150
    )
      throw new Error(`Invalid label on line ${i + 1}.`);
    const prefix = (
      { tx: 'tx', output: 'out', addr: 'addr', xpub: 'xpub' } as Record<string, string>
    )[
      typeof item.type === 'string' && ['tx', 'output', 'addr', 'xpub'].includes(item.type)
        ? item.type
        : ''
    ];
    if (!prefix) {
      skipped++;
      continue;
    }
    if (
      (item.type === 'tx' && !/^[0-9a-f]{64}$/.test(item.ref)) ||
      (item.type === 'output' && !/^[0-9a-f]{64}:\d+$/.test(item.ref))
    )
      throw new Error(`Invalid reference on line ${i + 1}.`);
    annotations[`${prefix}:${item.ref}`] = {
      label: item.label,
      note: '',
      icon: '',
      bookmarked: false,
    };
  }
  return { annotations, skipped };
}
