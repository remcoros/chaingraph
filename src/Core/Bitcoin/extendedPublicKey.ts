import { HDKey, HARDENED_OFFSET } from '@scure/bip32';
import { base58check } from '@scure/base';
import { sha256 } from '@noble/hashes/sha2.js';
import { bitcoinNetwork, type Network } from './network';
const versions = [
  {
    public: 0x0488b21e,
    private: 0x0488ade4,
    network: 'mainnet',
    prefix: 'xpub',
    script: undefined,
  },
  {
    public: 0x049d7cb2,
    private: 0x049d7878,
    network: 'mainnet',
    prefix: 'ypub',
    script: 'p2sh-p2wpkh',
  },
  { public: 0x04b24746, private: 0x04b2430c, network: 'mainnet', prefix: 'zpub', script: 'p2wpkh' },
  {
    public: 0x043587cf,
    private: 0x04358394,
    network: 'testnet4',
    prefix: 'tpub',
    script: undefined,
  },
  {
    public: 0x044a5262,
    private: 0x044a4e28,
    network: 'testnet4',
    prefix: 'upub',
    script: 'p2sh-p2wpkh',
  },
  {
    public: 0x045f1cf6,
    private: 0x045f18bc,
    network: 'testnet4',
    prefix: 'vpub',
    script: 'p2wpkh',
  },
] as const;
const base58 = base58check(sha256);

export function parseExtendedPublicKey(key: string, network: Network) {
  bitcoinNetwork(network);
  if (typeof key !== 'string' || key.length < 100 || key.length > 120)
    throw new Error('Expected an extended public key.');
  let raw: Uint8Array;
  try {
    raw = base58.decode(key);
  } catch {
    throw new Error('Invalid extended public key checksum or encoding.');
  }
  if (raw.length !== 78) throw new Error('Invalid extended public key length.');
  const version = new DataView(raw.buffer, raw.byteOffset, raw.byteLength).getUint32(0);
  if (raw[45] === 0 || versions.some((item) => item.private === version))
    throw new Error('Private keys are not extended public keys.');
  const encoding = versions.find((item) => item.public === version);
  if (!encoding)
    throw new Error('Unsupported extended public key. Use xpub/ypub/zpub or tpub/upub/vpub.');
  if (encoding.network !== network)
    throw new Error(`This ${encoding.prefix} belongs to ${encoding.network}, not ${network}.`);
  let node: HDKey;
  try {
    node = HDKey.fromExtendedKey(key, encoding);
  } catch {
    throw new Error('Invalid extended public key data.');
  }
  if (node.privateKey || !node.publicKey)
    throw new Error('Only extended public keys are accepted.');
  return { node, encoding };
}

/** Recognized public encodings and valid BIP32 payloads, independent of account depth. */
export function isExtendedPublicKey(key: unknown): boolean {
  if (typeof key !== 'string' || key.length < 100 || key.length > 120) return false;
  try {
    const raw = base58.decode(key);
    if (raw.length !== 78) return false;
    const version = new DataView(raw.buffer, raw.byteOffset, raw.byteLength).getUint32(0);
    const encoding = versions.find((item) => item.public === version);
    if (!encoding) return false;
    parseExtendedPublicKey(key, encoding.network);
    return true;
  } catch {
    return false;
  }
}

/** Derive exactly the requested public child; never silently relabel a skipped BIP32 index. */
export function derivePublicChild(parent: HDKey, index: number): HDKey {
  if (parent.privateKey || !parent.publicKey)
    throw new Error('Expected a public-only BIP32 parent.');
  if (!Number.isSafeInteger(index) || index < 0 || index >= HARDENED_OFFSET)
    throw new Error('Public derivation requires a non-hardened child index.');
  const child = parent.deriveChild(index);
  if (child.index !== index)
    throw new Error('BIP32 skipped an invalid child; adjust the requested derivation range.');
  return child;
}
