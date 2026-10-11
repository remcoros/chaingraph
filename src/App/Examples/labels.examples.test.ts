import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { createTemplateWorkspace, hasPublicDemoWallet } from './workspaceTemplates';
import { base58check } from '@scure/base';
import { sha256 } from '@noble/hashes/sha2.js';
import { parseExtendedPublicKey } from '../../Core/Bitcoin';
import { createWorkspace } from '../../Core/Workspace/createWorkspace';
import { parseWorkspace } from '../../Core/Workspace/Persistence';
import {
  applyLabelImport,
  defaultLabelImportOptions,
  defaultLabelExportOptions,
  inspectLabels,
  planLabelImport,
  planLabelExport,
  type LabelProfile,
} from '../../Core/Workspace/Annotations/labels';

const fixture = (name: string) =>
  readFile(new URL(`../../../public/examples/bip329/${name}.jsonl`, import.meta.url), 'utf8');
const funding = '9f3dbe0da718398178955cbe386813f8f6ed709f525fb5bf2885ba3545276ed3';
const address = 'bc1q8c6fshw2dlwun7ekn9qwf37cu2rn755upcp6el';

describe('shipped BIP329 files with the public wallet example', () => {
  it('identifies the loaded demo by full account key and script, independent of names or encoding', async () => {
    const workspace = await createTemplateWorkspace('mainnet-public-wallet');
    const wallet = workspace.wallets.definitions[0];
    expect(hasPublicDemoWallet(workspace)).toBe(true);
    expect(hasPublicDemoWallet(createWorkspace(workspace.name, 'mainnet'))).toBe(false);
    const reencoded = {
      ...workspace,
      name: 'Renamed workspace',
      wallets: {
        ...workspace.wallets,
        definitions: [
          {
            ...wallet,
            name: 'Renamed wallet',
            key: parseExtendedPublicKey(wallet.key, 'mainnet').bip32Key,
          },
        ],
      },
    };
    expect(hasPublicDemoWallet(reencoded)).toBe(true);
    expect(hasPublicDemoWallet({ ...reencoded, network: 'testnet4' })).toBe(false);
    const withWallet = (key: string, scriptType = wallet.scriptType) => ({
      ...workspace,
      wallets: { ...workspace.wallets, definitions: [{ ...wallet, key, scriptType }] },
    });
    expect(hasPublicDemoWallet(withWallet(wallet.key, 'p2pkh'))).toBe(false);
    expect(hasPublicDemoWallet(withWallet('invalid'))).toBe(false);
    const codec = base58check(sha256);
    const altered = codec.decode(wallet.key);
    altered[13] ^= 1; // Different chain code, but the public key and fingerprint remain identical.
    const otherKey = codec.encode(altered);
    expect(parseExtendedPublicKey(otherKey, 'mainnet').node.fingerprint).toBe(
      parseExtendedPublicKey(wallet.key, 'mainnet').node.fingerprint,
    );
    expect(hasPublicDemoWallet(withWallet(otherKey))).toBe(false);
    expect(
      hasPublicDemoWallet({ ...workspace, wallets: { ...workspace.wallets, definitions: [] } }),
    ).toBe(false);
  });
  it.each<LabelProfile>(['generic', 'sparrow', 'btcpay', 'bluewallet', 'keeper'])(
    'applies the %s fixture with valid wallet-scoped metadata',
    async (profile) => {
      const workspace = await createTemplateWorkspace('mainnet-public-wallet');
      const scope = { kind: 'wallet' as const, walletId: workspace.wallets.definitions[0].id };
      const inspection = inspectLabels(await fixture(profile), workspace.network);
      const plan = planLabelImport(workspace, inspection, {
        ...defaultLabelImportOptions(workspace.network, scope),
        profile,
        existingText: 'replace',
      });
      expect(plan.changes.length).toBeGreaterThan(0);
      expect(plan.unmatched).toBe(0);
      expect(plan.issues.some((issue) => issue.reason === 'scope')).toBe(false);
      expect(plan.issues.some((issue) => issue.reason === 'malformed')).toBe(false);
      const imported = applyLabelImport(workspace, plan);
      expect(parseWorkspace(imported)).toEqual(imported);
      expect(imported.wallets.definitions[0].name).toBe(workspace.wallets.definitions[0].name);
      if (profile === 'btcpay') {
        expect(
          imported.annotations.tags
            ?.filter((tag) => tag.nodeIds.includes(`tx:${funding}`))
            .map((tag) => tag.name),
        ).toEqual(['demo-business', 'demo-reviewed']);
        expect(imported.annotations.entities[`tx:${funding}`]).toEqual(
          workspace.annotations.entities[`tx:${funding}`],
        );
      } else if (profile === 'bluewallet' || profile === 'keeper') {
        expect(imported.annotations.entities[`tx:${funding}`].label).toBe(
          workspace.annotations.entities[`tx:${funding}`].label,
        );
        expect(imported.annotations.entities[`tx:${funding}`].note).not.toBe(
          workspace.annotations.entities[`tx:${funding}`].note,
        );
        if (profile === 'keeper')
          expect(
            imported.annotations.tags
              ?.filter((tag) => tag.nodeIds.includes(`addr:${address}`))
              .map((tag) => tag.name),
          ).toEqual(['demo-business', 'demo-reviewed']);
      }
      const exported = planLabelExport(imported, { ...defaultLabelExportOptions(scope), profile });
      expect(exported.blocked).toBeUndefined();
      expect(exported.recordCount).toBeGreaterThan(0);
      expect(inspectLabels(exported.content, workspace.network).issues).toEqual([]);
      const again = planLabelImport(imported, inspectLabels(exported.content, workspace.network), {
        ...defaultLabelImportOptions(workspace.network, scope),
        profile,
      });
      expect(again.changes).toEqual([]);
    },
  );
  it('shows physical-line recovery, conflicts and length/clear choices in the review fixture', async () => {
    const workspace = await createTemplateWorkspace('mainnet-public-wallet');
    const inspection = inspectLabels(await fixture('review-cases'), workspace.network);
    expect(inspection.issues.find((issue) => issue.reason === 'malformed')?.line).toBe(10);
    expect(inspection.issues.some((issue) => issue.reason === 'wrong-network')).toBe(true);
    const options = {
      ...defaultLabelImportOptions(workspace.network),
      existingText: 'replace' as const,
    };
    const plan = planLabelImport(workspace, inspection, options);
    expect(plan.issues.filter((issue) => issue.reason === 'conflict')).toHaveLength(2);
    expect(plan.issues.some((issue) => issue.reason === 'length')).toBe(true);
    expect(plan.next.annotations.entities[`addr:${address}`].label).toHaveLength(255);
    expect(plan.unmatched).toBe(1);
    const reviewed = planLabelImport(workspace, inspection, {
      ...options,
      shorten: true,
      applyClears: true,
      conflicts: 'first',
    });
    expect(reviewed.next.annotations.entities[`out:${funding}:0`].label).toHaveLength(255);
    expect(reviewed.next.annotations.entities[`tx:${funding}`].label).toBe('Conflict A');
    expect(parseWorkspace(applyLabelImport(workspace, reviewed))).toEqual(reviewed.next);
    const scoped = planLabelImport(workspace, inspection, {
      ...options,
      scope: { kind: 'wallet', walletId: workspace.wallets.definitions[0].id },
    });
    expect(scoped.unmatched).toBe(0);
    expect(
      scoped.issues.some(
        (issue) => issue.reason === 'scope' && issue.id === `tx:${'f'.repeat(64)}`,
      ),
    ).toBe(true);
  });
});
