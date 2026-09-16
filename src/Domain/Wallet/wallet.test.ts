import { describe, expect, it, vi } from 'vitest';
import { HDKey } from '@scure/bip32';
import { base58check } from '@scure/base';
import { sha256 } from '@noble/hashes/sha2.js';
import {
  addressToScriptHash,
  deriveAddresses,
  inspectExtendedPublicKey,
  verifyWalletAddresses,
} from './wallet';

// Public mathematical test fixtures from BIP84 (CC0), BIP86/BIP32 (BSD-2-Clause),
// BIP49 (public domain), and SLIP132 (CC-BY-SA-4.0). Sources: docs/references.md.
const zpub =
  'zpub6rFR7y4Q2AijBEqTUquhVz398htDFrtymD9xYYfG1m4wAcvPhXNfE3EfH1r1ADqtfSdVCToUG868RvUUkgDKf31mGDtKsAYz2oz2AGutZYs';
const taprootXpub =
  'xpub6BgBgsespWvERF3LHQu6CnqdvfEvtMcQjYrcRzx53QJjSxarj2afYWcLteoGVky7D3UKDP9QyrLprQ3VCECoY49yfdDEHGCtMMj92pReUsQ';
const xpub =
  'xpub6BosfCnifzxcFwrSzQiqu2DBVTshkCXacvNsWGYJVVhhawA7d4R5WSWGFNbi8Aw6ZRc1brxMyWMzG3DSSSSoekkudhUd9yLb6qx39T9nMdj';
const ypub =
  'ypub6Ww3ibxVfGzLrAH1PNcjyAWenMTbbAosGNB6VvmSEgytSER9azLDWCxoJwW7Ke7icmizBMXrzBx9979FfaHxHcrArf3zbeJJJUZPf663zsP';
const upub =
  'upub5EFU65HtV5TeiSHmZZm7FUffBGy8UKeqp7vw43jYbvZPpoVsgU93oac7Wk3u6moKegAEWtGNF8DehrnHtv21XXEMYRUocHqguyjknFHYfgY';
const base58 = base58check(sha256);
function reversion(key: string, version: number): string {
  const bytes = base58.decode(key);
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).setUint32(0, version);
  return base58.encode(bytes);
}

describe('watch-only wallet derivation', () => {
  it('matches BIP84 receive and change vectors', () => {
    expect(deriveAddresses(zpub, 'mainnet', 'p2wpkh', 0, 0, 2).map((item) => item.address)).toEqual(
      ['bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu', 'bc1qnjg0jd8228aq7egyzacy8cys3knf9xvrerkf9g'],
    );
    expect(deriveAddresses(zpub, 'mainnet', 'p2wpkh', 1, 0, 1)[0].address).toBe(
      'bc1q8c6fshw2dlwun7ekn9qwf37cu2rn755upcp6el',
    );
    expect(deriveAddresses(zpub, 'mainnet', 'p2wpkh', 0, 1, 1)[0].path).toBe('account/0/1');
  });

  it('matches BIP86 Taproot receive and change vectors including key tweaking', () => {
    expect(
      deriveAddresses(taprootXpub, 'mainnet', 'p2tr', 0, 0, 2).map((item) => item.address),
    ).toEqual([
      'bc1p5cyxnuxmeuwuvkwfem96lqzszd02n6xdcjrs20cac6yqjjwudpxqkedrcr',
      'bc1p4qhjn9zdvkux4e44uhx8tc55attvtyu358kutcqkudyccelu0was9fqzwh',
    ]);
    expect(deriveAddresses(taprootXpub, 'mainnet', 'p2tr', 1, 0, 1)[0].address).toBe(
      'bc1p3qkhfews2uk44qtvauqyr2ttdsw7svhkl9nkm9s9c3x4ax5h60wqwruhk7',
    );
  });

  it('matches SLIP132 legacy/nested and BIP49 testnet vectors', () => {
    expect(deriveAddresses(xpub, 'mainnet', 'p2pkh', 0, 0, 1)[0].address).toBe(
      '1LqBGSKuX5yYUonjxT5qGfpUsXKYYWeabA',
    );
    expect(deriveAddresses(ypub, 'mainnet', 'p2sh-p2wpkh', 0, 0, 1)[0].address).toBe(
      '37VucYSaXLCAsxYyAPfbSi9eh4iEcbShgf',
    );
    expect(deriveAddresses(upub, 'testnet4', 'p2sh-p2wpkh', 0, 0, 1)[0].address).toBe(
      '2Mww8dCYPUpKHofjgcXcBCEGmniw9CoaiD2',
    );
  });

  it('verifies BIP32 public-only non-hardened derivation vector', () => {
    const parent = HDKey.fromExtendedKey(
      'xpub6D4BDPcP2GT577Vvch3R8wDkScZWzQzMMUm3PWbmWvVJrZwQY4VUNgqFJPMM3No2dFDFGTsxxpG5uJh7n7epu4trkrX7x7DogT5Uv6fcLW5',
    );
    expect(parent.privateKey).toBeNull();
    expect(parent.deriveChild(2).publicExtendedKey).toBe(
      'xpub6FHa3pjLCk84BayeJxFW2SP4XRrFd1JYnxeLeU8EqN3vDfZmbqBqaGJAyiLjTAwm6ZLRQUMv1ZACTj37sR62cfN7fe5JnJ7dh8zL4fiyLHV',
    );
  });

  it('uses the Electrum protocol script-hash byte order', () => {
    expect(addressToScriptHash('1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa', 'mainnet')).toBe(
      '8b01df4e368ea28f8dc0423bcf7a4923e3a12d307c875e47a0cfbf90b5c39161',
    );
  });

  it('handles tpub/vpub and testnet4 address encodings', () => {
    const tpub = reversion(taprootXpub, 0x043587cf);
    const vpub = reversion(zpub, 0x045f1cf6);
    expect(deriveAddresses(tpub, 'testnet4', 'p2tr', 0, 0, 1)[0].address).toMatch(/^tb1p/);
    const taproot = deriveAddresses(tpub, 'testnet4', 'p2tr', 0, 0, 1)[0];
    expect(addressToScriptHash(taproot.address, 'testnet4')).toBe(taproot.scripthash);
    expect(deriveAddresses(vpub, 'testnet4', 'p2wpkh', 0, 0, 1)[0].address).toMatch(/^tb1q/);
    expect(inspectExtendedPublicKey(vpub, 'testnet4')).toEqual({
      prefix: 'vpub',
      account: 0,
      suggestedScriptType: 'p2wpkh',
    });
    expect(inspectExtendedPublicKey(xpub, 'mainnet').suggestedScriptType).toBeUndefined();
  });

  it('rejects cross-network keys, addresses, and mismatched SLIP132 script hints', () => {
    expect(() => inspectExtendedPublicKey(zpub, 'testnet4')).toThrow('belongs to mainnet');
    expect(() => inspectExtendedPublicKey(upub, 'mainnet')).toThrow('belongs to testnet4');
    expect(() => addressToScriptHash('1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa', 'testnet4')).toThrow(
      'Invalid address',
    );
    const testAddress = deriveAddresses(
      reversion(zpub, 0x045f1cf6),
      'testnet4',
      'p2wpkh',
      0,
      0,
      1,
    )[0].address;
    expect(() => addressToScriptHash(testAddress, 'mainnet')).toThrow('Invalid address');
    expect(() => deriveAddresses(zpub, 'mainnet', 'p2tr', 0, 0, 1)).toThrow('requires p2wpkh');
  });

  it('rejects private material, malformed keys, root keys, and unbounded derivation', () => {
    expect(() =>
      inspectExtendedPublicKey(
        'xprv9s21ZrQH143K3QTDL4LXw2F7HEK3wJUD2nW2nRk4stbPy6cq3jPPqjiChkVvvNKmPGJxWUtg6LnF5kejMRNNU3TGtRBeJgk33yuGBxrMPHi',
        'mainnet',
      ),
    ).toThrow('Private keys');
    expect(() =>
      inspectExtendedPublicKey(
        'xpub661MyMwAqRbcEYS8w7XLSVeEsBXy79zSzH1J8vCdxAZningWLdN3zgtU6LBpB85b3D2yc8sfvZU521AAwdZafEz7mnzBBsz4wKY5fTtTQBm',
        'mainnet',
      ),
    ).toThrow('Private keys');
    expect(() =>
      inspectExtendedPublicKey(
        'xpub661MyMwAqRbcFtXgS5sYJABqqG9YLmC4Q1Rdap9gSE8NqtwybGhePY2gZ29ESFjqJoCu1Rupje8YtGqsefD265TMg7usUDFdp6W1EGMcet8',
        'mainnet',
      ),
    ).toThrow('depth 3');
    expect(() => inspectExtendedPublicKey(zpub.slice(0, -1) + '1', 'mainnet')).toThrow('checksum');
    expect(() => deriveAddresses(xpub, 'mainnet', 'p2pkh', 0, 0, 1001)).toThrow('1–1000');
    expect(() => deriveAddresses(xpub, 'mainnet', 'p2pkh', 0, 0x7fffffff, 2)).toThrow(
      'non-hardened',
    );
    expect(() => deriveAddresses(xpub, 'mainnet', 'p2pkh', 0, -1, 20)).toThrow('non-hardened');
  });
});

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
    const foreign = deriveAddresses(taprootXpub, 'mainnet', 'p2wpkh', 0, 0, 1);
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
