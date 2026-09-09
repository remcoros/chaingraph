import { describe, expect, it } from 'vitest';
import { walletFlowVisibility } from '../src/domain/walletFlowVisibility';
import type { WalletReviewFlowEntry } from '../src/domain/walletReviewContext';

const rows = (count: number): WalletReviewFlowEntry[] =>
  Array.from({ length: count }, (_, n) => ({
    id: `out:${'a'.repeat(64)}:${n}`,
    address: `address-${n}`,
    ownership: 'external',
    selected: false,
    missing: false,
  }));

describe('compact wallet flow relationships', () => {
  for (const side of ['input', 'output']) {
    it(`keeps offscreen edited and owned ${side}s in transaction order`, () => {
      const entries = rows(11).map((entry, n) =>
        side === 'input' ? { ...entry, id: `out:${n.toString(16).padStart(64, '0')}:0` } : entry,
      );
      entries[9].address = 'source';
      entries[9].selected = true;
      entries[10].ownership = 'wallet';
      const result = walletFlowVisibility(entries, 'addr:source');
      expect(result.visible.map((entry) => entry.id)).toEqual([entries[9].id, entries[10].id]);
      expect(result).toMatchObject({ total: 11, hidden: 9, owned: 1, hiddenOwned: 0 });
      expect(walletFlowVisibility(entries, entries[9].id).visible).toEqual(result.visible);
    });
  }

  it('preserves a distinct selection as well as the current edit target and wallet match', () => {
    const entries = rows(11);
    entries[7].selected = true;
    entries[10].ownership = 'wallet';
    expect(walletFlowVisibility(entries, entries[9].id).visible).toEqual(
      entries.slice(7).filter((_, i) => i !== 1),
    );
  });

  it('bounds many wallet and same-address matches with explicit hidden counts', () => {
    const entries = rows(500);
    for (const entry of entries.slice(100, 300)) {
      entry.address = 'source';
      entry.selected = true;
    }
    for (const entry of entries.slice(300)) entry.ownership = 'wallet';
    const collapsed = walletFlowVisibility(entries, 'addr:source');
    expect(collapsed.visible).toEqual([entries[100], entries[101], entries[300], entries[301]]);
    expect(collapsed).toMatchObject({
      total: 500,
      hidden: 496,
      owned: 200,
      hiddenOwned: 198,
      hiddenContext: 198,
    });
    expect(walletFlowVisibility(entries, 'addr:source')).toEqual(collapsed);
    const expanded = walletFlowVisibility(entries, 'addr:source', 20);
    expect(expanded.visible).toHaveLength(20);
    expect(expanded.hidden + expanded.visible.length).toBe(500);
  });

  it('keeps first rows without any known wallet match and retains late edit context', () => {
    const entries = rows(11);
    expect(walletFlowVisibility(entries).visible).toEqual(entries.slice(0, 2));
    expect(walletFlowVisibility(entries, entries[10].id).visible).toEqual([
      entries[0],
      entries[10],
    ]);
    expect(walletFlowVisibility([])).toMatchObject({ visible: [], total: 0, hidden: 0, owned: 0 });
  });

  it('uses two representatives when all rows belong to the wallet', () => {
    const entries = rows(500).map((entry) => ({ ...entry, ownership: 'wallet' as const }));
    const result = walletFlowVisibility(entries);
    expect(result.visible).toEqual(entries.slice(0, 2));
    expect(result).toMatchObject({ owned: 500, hidden: 498, hiddenOwned: 498 });
  });

  it('deduplicates canonical IDs and a row that is both selected and owned', () => {
    const entries = rows(3);
    entries[2].selected = true;
    entries[2].ownership = 'wallet';
    const result = walletFlowVisibility([...entries, { ...entries[2] }], entries[2].id);
    expect(result.visible.map((entry) => entry.id)).toEqual([entries[0].id, entries[2].id]);
    expect(result).toMatchObject({ total: 3, hidden: 1, owned: 1, hiddenOwned: 0 });
  });

  it('projects late input enrichment without losing edit context or inventing ownership', () => {
    const entries = rows(11);
    entries[10] = { ...entries[10], ownership: 'unknown', missing: true, address: undefined };
    expect(walletFlowVisibility(entries, entries[9].id).visible).toEqual([entries[0], entries[9]]);
    const enriched = entries.map((entry, i) =>
      i === 10 ? { ...entry, ownership: 'wallet' as const, missing: false } : entry,
    );
    expect(walletFlowVisibility(enriched, entries[9].id).visible).toEqual(enriched.slice(9));
    expect(walletFlowVisibility(entries, entries[9].id).owned).toBe(0);
  });

  it('does not deduplicate unresolved inputs sharing a placeholder transaction ID', () => {
    const entries = rows(11).map((entry) => ({
      ...entry,
      id: `tx:${'a'.repeat(64)}`,
      missing: true,
      ownership: 'unknown' as const,
    }));
    expect(walletFlowVisibility(entries)).toMatchObject({ total: 11, hidden: 9, owned: 0 });
  });
});
