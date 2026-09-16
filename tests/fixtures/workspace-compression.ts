import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { newWorkspace } from '../../src/Domain/Workspace/workspace';
import type { Workspace } from '../../src/Domain/Workspace/workspaceTypes';
import { largeWalletFixture } from './wallet-performance';

/** Public BIP84 addresses, synthetic history, deterministic hash-like transaction IDs. */
export function compressionWalletFixture(
  addressCount: number,
  transactionsPerAddress: number,
): Workspace {
  const workspace = largeWalletFixture(addressCount, transactionsPerAddress);
  workspace.id = '40000000-0000-4000-8000-000000000004';
  workspace.createdAt = '2026-09-10T00:00:00.000Z';
  workspace.name = 'Synthetic workspace compression benchmark';
  // Long zero prefixes make unrealistic compression fixtures. Hash fixed public labels instead.
  const ids = new Map(
    Object.keys(workspace.transactions).map((id) => [
      id,
      bytesToHex(sha256(new TextEncoder().encode(`public-compression-fixture:${id}`))),
    ]),
  );
  workspace.transactions = Object.fromEntries(
    Object.entries(workspace.transactions).map(([id, tx]) => {
      const txid = ids.get(id)!;
      return [
        txid,
        {
          ...tx,
          txid,
          vin: tx.vin.map((input) =>
            input.txid
              ? {
                  ...input,
                  txid: ids.get(input.txid)!,
                }
              : input,
          ),
        },
      ];
    }),
  );
  for (const wallet of workspace.wallets) {
    for (const address of wallet.addresses) {
      address.history = address.history?.map((entry) => ({
        ...entry,
        tx_hash: ids.get(entry.tx_hash)!,
      }));
    }
  }
  for (const [index, txid] of Object.keys(workspace.transactions).entries()) {
    if (index % 5 !== 0) continue;
    workspace.annotations[`tx:${txid}`] = {
      label: `Synthetic receipt ${index}`,
      note: 'Public benchmark fixture. Synthetic transaction observations are not real chain evidence.',
      icon: '',
      bookmarked: index % 10 === 0,
    };
  }
  return workspace;
}

export function tinyCompressionFixture(): Workspace {
  const workspace = newWorkspace('Tiny public fixture', 'mainnet');
  workspace.id = '50000000-0000-4000-8000-000000000005';
  workspace.createdAt = '2026-09-10T00:00:00.000Z';
  return workspace;
}

/** Deterministic high-entropy binary probe, deliberately not a JSON workspace. */
export function incompressibleFixture(): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(65536);
  for (let offset = 0; offset < bytes.length; offset += 32) {
    bytes.set(sha256(new TextEncoder().encode(`public-incompressible-probe:${offset}`)), offset);
  }
  return bytes;
}
