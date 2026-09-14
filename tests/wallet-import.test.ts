import { describe, expect, it, vi } from 'vitest';
import { HDKey } from '@scure/bip32';
import {
  addressToScriptHash,
  deriveAddresses,
  verifyWalletAddresses,
} from '../src/Domain/Wallet/wallet';

// Published BIP84 account vector (CC0); references in docs/references.md.
const zpub =
  'zpub6rFR7y4Q2AijBEqTUquhVz398htDFrtymD9xYYfG1m4wAcvPhXNfE3EfH1r1ADqtfSdVCToUG868RvUUkgDKf31mGDtKsAYz2oz2AGutZYs';
const otherAccount =
  'xpub6BgBgsespWvERF3LHQu6CnqdvfEvtMcQjYrcRzx53QJjSxarj2afYWcLteoGVky7D3UKDP9QyrLprQ3VCECoY49yfdDEHGCtMMj92pReUsQ';

describe('imported wallet ownership claims', () => {
  it('accepts authoritative BIP84 receive/change addresses in arbitrary order', () => {
    const addresses = [
      { address: 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu', index: 0, branch: 0 as const },
      { address: 'bc1qnjg0jd8228aq7egyzacy8cys3knf9xvrerkf9g', index: 1, branch: 0 as const },
      { address: 'bc1q8c6fshw2dlwun7ekn9qwf37cu2rn755upcp6el', index: 0, branch: 1 as const },
    ]
      .map((item) => ({
        ...item,
        scripthash: addressToScriptHash(item.address, 'mainnet'),
        path: `account/${item.branch}/${item.index}`,
      }))
      .reverse();
    expect(() => verifyWalletAddresses(zpub, 'mainnet', 'p2wpkh', addresses)).not.toThrow();
  });

  it('rejects an address from another account even with matching hash and plausible path', () => {
    const foreign = deriveAddresses(otherAccount, 'mainnet', 'p2wpkh', 0, 0, 1);
    expect(addressToScriptHash(foreign[0].address, 'mainnet')).toBe(foreign[0].scripthash);
    expect(() => verifyWalletAddresses(zpub, 'mainnet', 'p2wpkh', foreign)).toThrow(
      'does not match',
    );
  });

  it('checks sparse maximum indexes without scanning intervening children', () => {
    const addresses = [
      ...deriveAddresses(zpub, 'mainnet', 'p2wpkh', 0, 0, 1),
      ...deriveAddresses(zpub, 'mainnet', 'p2wpkh', 0, 0x7fffffff, 1),
      ...deriveAddresses(zpub, 'mainnet', 'p2wpkh', 1, 0x7ffffffe, 1),
    ];
    const spy = vi.spyOn(HDKey.prototype, 'deriveChild');
    try {
      verifyWalletAddresses(zpub, 'mainnet', 'p2wpkh', addresses);
      expect(spy).toHaveBeenCalledTimes(5); // Two branch parents and three actual children.
    } finally {
      spy.mockRestore();
    }
  });

  it('rejects duplicate paths and modified derivation metadata', () => {
    const [address] = deriveAddresses(zpub, 'mainnet', 'p2wpkh', 0, 0, 1);
    expect(() => verifyWalletAddresses(zpub, 'mainnet', 'p2wpkh', [address, address])).toThrow(
      'duplicate',
    );
    expect(() =>
      verifyWalletAddresses(zpub, 'mainnet', 'p2wpkh', [{ ...address, path: 'account/1/0' }]),
    ).toThrow('does not match');
    expect(() =>
      verifyWalletAddresses(zpub, 'mainnet', 'p2wpkh', [{ ...address, index: 0x80000000 }]),
    ).toThrow('Invalid');
    expect(() => verifyWalletAddresses(zpub, 'mainnet', 'p2tr', [])).toThrow('requires');
  });
});
