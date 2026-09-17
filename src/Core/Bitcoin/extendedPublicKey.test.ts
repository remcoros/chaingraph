import { describe, expect, it, vi } from 'vitest';
import { HARDENED_OFFSET } from '@scure/bip32';
import {
  derivePublicChild,
  isExtendedPublicKey,
  parseExtendedPublicKey,
} from './extendedPublicKey';

// Public BIP32 test vectors; sources and licensing are recorded in docs/references.md.
const root =
  'xpub661MyMwAqRbcFtXgS5sYJABqqG9YLmC4Q1Rdap9gSE8NqtwybGhePY2gZ29ESFjqJoCu1Rupje8YtGqsefD265TMg7usUDFdp6W1EGMcet8';
const parent =
  'xpub6D4BDPcP2GT577Vvch3R8wDkScZWzQzMMUm3PWbmWvVJrZwQY4VUNgqFJPMM3No2dFDFGTsxxpG5uJh7n7epu4trkrX7x7DogT5Uv6fcLW5';

describe('Bitcoin public-key primitives without account-wallet policy', () => {
  it('accepts a valid root public key rather than requiring an account', () => {
    expect(parseExtendedPublicKey(root, 'mainnet').node.depth).toBe(0);
    expect(isExtendedPublicKey(root)).toBe(true);
  });

  it('derives native child index 2, outside the app receive/change branch policy', () => {
    const key = parseExtendedPublicKey(parent, 'mainnet').node;
    expect(derivePublicChild(key, 2).publicExtendedKey).toBe(
      'xpub6FHa3pjLCk84BayeJxFW2SP4XRrFd1JYnxeLeU8EqN3vDfZmbqBqaGJAyiLjTAwm6ZLRQUMv1ZACTj37sR62cfN7fe5JnJ7dh8zL4fiyLHV',
    );
    expect(derivePublicChild(key, 1001).index).toBe(1001);
  });

  it.each([-1, 0.5, HARDENED_OFFSET, Number.NaN])(
    'rejects invalid public child index %s',
    (index) => {
      expect(() => derivePublicChild(parseExtendedPublicKey(root, 'mainnet').node, index)).toThrow(
        'non-hardened',
      );
    },
  );

  it('rejects a silently skipped BIP32 child instead of assigning it the wrong path', () => {
    const key = parseExtendedPublicKey(root, 'mainnet').node;
    const child = derivePublicChild(key, 3);
    const spy = vi.spyOn(key, 'deriveChild').mockReturnValue(child);
    try {
      expect(() => derivePublicChild(key, 2)).toThrow('skipped');
    } finally {
      spy.mockRestore();
    }
  });

  it('rejects wrong-network and malformed public keys', () => {
    expect(() => parseExtendedPublicKey(root, 'testnet4')).toThrow('belongs to mainnet');
    expect(isExtendedPublicKey(root.slice(0, -1) + '1')).toBe(false);
    expect(isExtendedPublicKey('x'.repeat(10000))).toBe(false);
  });
});
