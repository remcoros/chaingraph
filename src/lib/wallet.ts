import { HDKey, HARDENED_OFFSET } from '@scure/bip32';
import { base58check } from '@scure/base';
import { sha256 } from '@noble/hashes/sha2.js';
import { ripemd160 } from '@noble/hashes/legacy.js';
import { bytesToHex, concatBytes } from '@noble/hashes/utils.js';
import { schnorr, secp256k1 } from '@noble/curves/secp256k1.js';
import { address as bitcoinAddress, networks } from 'bitcoinjs-lib';

export type WalletNetwork = 'mainnet' | 'testnet4';
export type WalletScriptType = 'p2pkh' | 'p2sh-p2wpkh' | 'p2wpkh' | 'p2tr';
export interface DerivedAddress {
  address: string;
  scripthash: string;
  /** Path relative to the imported account key; its ancestors cannot be verified. */
  path: string;
  index: number;
  branch: 0 | 1;
}

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

function bitcoinNetwork(network: WalletNetwork) {
  if (network !== 'mainnet' && network !== 'testnet4')
    throw new Error('Unsupported Bitcoin network.');
  // Testnet4 retains testnet address and extended-key encodings (BIP94).
  return network === 'mainnet' ? networks.bitcoin : networks.testnet;
}

function parseKey(key: string, network: WalletNetwork) {
  bitcoinNetwork(network);
  if (typeof key !== 'string' || key.length < 100 || key.length > 120)
    throw new Error('Enter an account extended public key.');
  let raw: Uint8Array;
  try {
    raw = base58.decode(key);
  } catch {
    throw new Error('Invalid extended public key checksum or encoding.');
  }
  if (raw.length !== 78) throw new Error('Invalid extended public key length.');
  const version = new DataView(raw.buffer, raw.byteOffset, raw.byteLength).getUint32(0);
  if (raw[45] === 0 || versions.some((item) => item.private === version))
    throw new Error('Private keys are not accepted. Import a watch-only public key.');
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
  if (node.depth !== 3 || node.index < HARDENED_OFFSET)
    throw new Error("Import an account-level public key at depth 3 (for example m/84'/0'/0').");
  return { node, encoding };
}

export function validateExtendedPublicKey(key: string, network: WalletNetwork): void {
  parseKey(key, network);
}

export function inspectExtendedPublicKey(
  key: string,
  network: WalletNetwork,
): { prefix: string; account: number; suggestedScriptType: WalletScriptType | undefined } {
  const { node, encoding } = parseKey(key, network);
  return {
    prefix: encoding.prefix,
    account: node.index - HARDENED_OFFSET,
    suggestedScriptType: encoding.script,
  };
}

function hash160(bytes: Uint8Array): Uint8Array {
  return ripemd160(sha256(bytes));
}
function scriptHash(script: Uint8Array): string {
  return bytesToHex(sha256(script).reverse());
}

export function addressToScriptHash(address: string, network: WalletNetwork): string {
  const net = bitcoinNetwork(network);
  if (typeof address !== 'string' || address.length > 100)
    throw new Error('Invalid Bitcoin address.');
  try {
    if (/^(bc|tb|bcrt)1/i.test(address)) {
      const decoded = bitcoinAddress.fromBech32(address);
      if (
        decoded.prefix !== net.bech32 ||
        decoded.version < 0 ||
        decoded.version > 16 ||
        decoded.data.length < 2 ||
        decoded.data.length > 40 ||
        (decoded.version === 0 && ![20, 32].includes(decoded.data.length))
      )
        throw new Error('Invalid witness address.');
      return scriptHash(
        concatBytes(
          new Uint8Array([decoded.version === 0 ? 0 : 0x50 + decoded.version, decoded.data.length]),
          decoded.data,
        ),
      );
    }
    return scriptHash(bitcoinAddress.toOutputScript(address, net));
  } catch {
    throw new Error(`Invalid address for ${network}.`);
  }
}

function outputScript(publicKey: Uint8Array, scriptType: WalletScriptType): Uint8Array {
  const pubkeyHash = hash160(publicKey);
  switch (scriptType) {
    case 'p2pkh':
      return concatBytes(
        new Uint8Array([0x76, 0xa9, 0x14]),
        pubkeyHash,
        new Uint8Array([0x88, 0xac]),
      );
    case 'p2wpkh':
      return concatBytes(new Uint8Array([0, 0x14]), pubkeyHash);
    case 'p2sh-p2wpkh':
      return concatBytes(
        new Uint8Array([0xa9, 0x14]),
        hash160(concatBytes(new Uint8Array([0, 0x14]), pubkeyHash)),
        new Uint8Array([0x87]),
      );
    case 'p2tr': {
      // BIP86: lift_x selects even Y before the BIP341 TapTweak commitment.
      const xOnly = publicKey.slice(1);
      const point = secp256k1.Point.fromBytes(concatBytes(new Uint8Array([2]), xOnly));
      const tweak = BigInt(`0x${bytesToHex(schnorr.utils.taggedHash('TapTweak', xOnly))}`);
      if (tweak >= secp256k1.Point.CURVE().n) throw new Error('Invalid Taproot tweak.');
      const output = tweak === 0n ? point : point.add(secp256k1.Point.BASE.multiply(tweak));
      output.assertValidity();
      return concatBytes(new Uint8Array([0x51, 0x20]), output.toBytes(true).slice(1));
    }
    default:
      throw new Error('Unsupported wallet script type.');
  }
}

export function deriveAddresses(
  key: string,
  network: WalletNetwork,
  scriptType: WalletScriptType,
  branch: 0 | 1,
  start: number,
  count: number,
): DerivedAddress[] {
  const { node, encoding } = parseKey(key, network);
  if (!['p2pkh', 'p2sh-p2wpkh', 'p2wpkh', 'p2tr'].includes(scriptType))
    throw new Error('Choose an explicit wallet script type.');
  if (encoding.script && encoding.script !== scriptType)
    throw new Error(`${encoding.prefix} requires ${encoding.script}.`);
  if (
    (branch !== 0 && branch !== 1) ||
    !Number.isSafeInteger(start) ||
    start < 0 ||
    !Number.isSafeInteger(count) ||
    count < 1 ||
    count > 1000 ||
    start + count > HARDENED_OFFSET
  ) {
    throw new Error(
      'Derive 1–1000 non-hardened addresses from receive branch 0 or change branch 1.',
    );
  }
  return deriveRange(node.deriveChild(branch), network, scriptType, branch, start, count);
}

function deriveRange(
  parent: HDKey,
  network: WalletNetwork,
  scriptType: WalletScriptType,
  branch: 0 | 1,
  start: number,
  count: number,
): DerivedAddress[] {
  const result: DerivedAddress[] = [];
  for (let index = start; index < start + count; index++) {
    const child = parent.deriveChild(index);
    // A rare invalid BIP32 child is skipped by the library; never mislabel its path.
    if (parent.index !== branch || child.index !== index)
      throw new Error('BIP32 skipped an invalid child; adjust the requested derivation range.');
    const script = outputScript(child.publicKey!, scriptType);
    const address =
      scriptType === 'p2tr'
        ? bitcoinAddress.toBech32(script.slice(2), 1, bitcoinNetwork(network).bech32)
        : bitcoinAddress.fromOutputScript(script, bitcoinNetwork(network));
    result.push({
      address,
      scripthash: scriptHash(script),
      path: `account/${branch}/${index}`,
      index,
      branch,
    });
  }
  return result;
}

/** Verify imported ownership claims with work proportional to the supplied addresses,
 * never to the largest child index. Account and branch keys are parsed once. */
export function verifyWalletAddresses(
  key: string,
  network: WalletNetwork,
  scriptType: WalletScriptType,
  addresses: readonly DerivedAddress[],
): void {
  if (!Array.isArray(addresses) || addresses.length > 10000)
    throw new Error('Wallet address verification exceeds the import limit.');
  const { node, encoding } = parseKey(key, network);
  if (!['p2pkh', 'p2sh-p2wpkh', 'p2wpkh', 'p2tr'].includes(scriptType))
    throw new Error('Choose an explicit wallet script type.');
  if (encoding.script && encoding.script !== scriptType)
    throw new Error(`${encoding.prefix} requires ${encoding.script}.`);
  const ordered = [...addresses].sort((a, b) => a.branch - b.branch || a.index - b.index);
  for (let i = 0; i < ordered.length; i++) {
    const item = ordered[i];
    if (
      (item.branch !== 0 && item.branch !== 1) ||
      !Number.isSafeInteger(item.index) ||
      item.index < 0 ||
      item.index >= HARDENED_OFFSET ||
      (i > 0 && item.branch === ordered[i - 1].branch && item.index === ordered[i - 1].index)
    )
      throw new Error('Invalid or duplicate wallet address derivation path.');
  }
  const parents = new Map<0 | 1, HDKey>();
  for (let start = 0; start < ordered.length;) {
    const first = ordered[start];
    let end = start + 1;
    while (
      end < ordered.length &&
      end - start < 1000 &&
      ordered[end].branch === first.branch &&
      ordered[end].index === first.index + end - start
    )
      end++;
    let parent = parents.get(first.branch);
    if (!parent) {
      parent = node.deriveChild(first.branch);
      parents.set(first.branch, parent);
    }
    const expected = deriveRange(
      parent,
      network,
      scriptType,
      first.branch,
      first.index,
      end - start,
    );
    for (let offset = 0; offset < expected.length; offset++) {
      const actual = ordered[start + offset],
        derived = expected[offset];
      if (
        actual.address !== derived.address ||
        actual.scripthash !== derived.scripthash ||
        actual.path !== derived.path
      )
        throw new Error(
          'Wallet address does not match its recorded public key and derivation path.',
        );
    }
    start = end;
  }
}
