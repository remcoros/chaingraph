import { describe, expect, it } from 'vitest';
import { createWorkspace } from '../../createWorkspace';
import { CURRENT_WORKSPACE_VERSION } from '../../workspace';
import { parseWorkspace } from '../Codec/parseWorkspace';
import { migrateWorkspace, WorkspaceSchemaVersionError } from './workspaceMigrations';
import { laboratoryWorkspace } from '../../../../../tests/fixtures/laboratory';
import { address as bitcoinAddress } from 'bitcoinjs-lib';
import { legacyWorkspace } from '../../../../../tests/fixtures/legacyWorkspace';

describe('decrypted workspace schema boundary', () => {
  it('migrates a versionless backup without changing its original data', () => {
    const current = laboratoryWorkspace();
    const legacy = legacyWorkspace(current);
    const original = structuredClone(legacy);
    const parsed = parseWorkspace(legacy);
    expect(parsed).toEqual(current);
    expect(parsed.version).toBe(CURRENT_WORKSPACE_VERSION);
    expect(legacy).toEqual(original);
    expect(Object.hasOwn(legacy, 'version')).toBe(false);
    parsed.annotations.entities[Object.keys(parsed.annotations.entities)[0]].note =
      'Edited after unlock';
    expect(legacy).toEqual(original);
  });

  it('keeps current backups and repeated migrations stable', () => {
    const current = laboratoryWorkspace();
    expect(migrateWorkspace(current)).toBe(current);
    const parsed = parseWorkspace(current);
    expect(parsed).toEqual(current);
    expect(parseWorkspace(parsed)).toEqual(parsed);
    expect(createWorkspace('Public fixture', 'testnet4').version).toBe(CURRENT_WORKSPACE_VERSION);
  });

  it('preserves every field at the migration boundary', () => {
    const legacy = { name: 'Public fixture', custom: { preserved: true } };
    expect(migrateWorkspace(legacy)).toMatchObject({
      ...legacy,
      version: CURRENT_WORKSPACE_VERSION,
    });
    expect(legacy).toEqual({ name: 'Public fixture', custom: { preserved: true } });
  });

  it.each([
    null,
    0,
    CURRENT_WORKSPACE_VERSION + 1,
    -1,
    1.5,
    '1',
    undefined,
    {},
    ['private fixture detail'],
  ])('rejects an explicit unsupported schema version without exposing its value: %j', (version) => {
    const original = { ...createWorkspace('Public fixture', 'mainnet'), version };
    const snapshot = structuredClone(original);
    let failure: unknown;
    try {
      parseWorkspace(original);
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(WorkspaceSchemaVersionError);
    expect(failure).toMatchObject({
      code: 'unsupported-workspace-version',
      message:
        'Unsupported workspace schema version. Open it with a compatible Chaingraph version.',
    });
    expect(original).toEqual(snapshot);
  });

  it('validates migrated data before use, including the Bitcoin network', () => {
    const legacy = legacyWorkspace(createWorkspace('Public fixture', 'mainnet'));
    expect(() => parseWorkspace({ ...legacy, network: 'testnet' })).toThrow();
    expect(() => parseWorkspace({ ...legacy, name: '' })).toThrow();
    expect(() => parseWorkspace({ name: 'Incomplete legacy workspace' })).toThrow();
    for (const invalid of [null, [], 1, 'workspace'])
      expect(() => parseWorkspace(invalid)).toThrow();
  });

  it('round-trips optional address balance and UTXO observations at schema v5', () => {
    const workspace = createWorkspace('Address observations', 'mainnet');
    const target = bitcoinAddress.toBech32(new Uint8Array(20).fill(9), 0, 'bc');
    workspace.chainData.addressBalances = {
      [target]: {
        network: 'mainnet',
        confirmedSats: 100_000,
        unconfirmedSats: 0,
        checkedAt: new Date().toISOString(),
      },
    };
    workspace.chainData.addressUtxos = {
      [target]: {
        network: 'mainnet',
        utxos: [{ txid: 'a'.repeat(64), vout: 0, valueSats: 100_000, height: 10 }],
        checkedAt: new Date().toISOString(),
      },
    };
    const parsed = parseWorkspace(workspace);
    expect(parsed.version).toBe(CURRENT_WORKSPACE_VERSION);
    expect(parsed.chainData.addressBalances?.[target].confirmedSats).toBe(100_000);
    expect(parsed.chainData.addressUtxos?.[target].utxos[0]).toMatchObject({
      txid: 'a'.repeat(64),
      valueSats: 100_000,
    });
  });

  it.each([1, 2, 3, 4] as const)(
    'migrates a flat v%s document without inventing observation times',
    (version) => {
      const current = laboratoryWorkspace();
      const legacy = legacyWorkspace(current, version);
      const before = structuredClone(legacy);
      expect(parseWorkspace(legacy)).toEqual(current);
      expect(legacy).toEqual(before);
      expect(JSON.stringify(migrateWorkspace(legacy))).not.toContain('checkedAt');
    },
  );

  it.each([2, 3, 4, 5, 6] as const)(
    'rejects missing v%s graph membership before accepting the document',
    (version) => {
      const current = createWorkspace('Public migration fixture', 'mainnet');
      const payload =
        version === 5 || version === 6
          ? { ...current, version }
          : legacyWorkspace(current, version);
      delete payload.view.graphNodeIds;
      expect(() => parseWorkspace(payload)).toThrow('explicit graph entity membership');
    },
  );
});
