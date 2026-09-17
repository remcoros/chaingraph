import { sha256 } from '@noble/hashes/sha2.js';
import { ripemd160 } from '@noble/hashes/legacy.js';
import { bytesToHex, concatBytes, hexToBytes } from '@noble/hashes/utils.js';
import { schnorr, secp256k1 } from '@noble/curves/secp256k1.js';
import { address as bitcoinAddress, script as bitcoinScript } from 'bitcoinjs-lib';
import { bitcoinNetwork, type Network } from './network';
export type ScriptType = 'p2pkh' | 'p2sh-p2wpkh' | 'p2wpkh' | 'p2tr';
export interface ScriptInspection {
  hex?: string;
  asm?: string;
  error?: string;
}
function hash160(bytes: Uint8Array): Uint8Array {
  return ripemd160(sha256(bytes));
}
export function scriptHash(script: Uint8Array): string {
  return bytesToHex(sha256(script).reverse());
}

/** Electrum's SHA256 locking-script hash, encoded from validated script hex. */
export function scriptHashHex(hex: string): string {
  try {
    return scriptHash(hexToBytes(hex));
  } catch {
    throw new Error('Invalid Bitcoin script hex.');
  }
}

/** A display-oriented assembly decode. It never executes or validates a script. */
export function inspectScript(hex: string | undefined): ScriptInspection {
  if (hex === undefined) return {};
  if (hex.length > 8_000_000 || !/^(?:[0-9a-fA-F]{2})*$/.test(hex))
    return { error: 'Invalid or oversized script hex.' };
  try {
    return { hex, asm: bitcoinScript.toASM(hexToBytes(hex)) || '(empty script)' };
  } catch {
    return {
      hex,
      error: 'Malformed push data: opcodes cannot be decoded. Original hex is preserved.',
    };
  }
}

/** Encode an address as its exact locking script for this network. */
export function addressToScript(address: string, network: Network): Uint8Array {
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
      return concatBytes(
        new Uint8Array([decoded.version === 0 ? 0 : 0x50 + decoded.version, decoded.data.length]),
        decoded.data,
      );
    }
    return bitcoinAddress.toOutputScript(address, net);
  } catch {
    throw new Error(`Invalid address for ${network}.`);
  }
}

/** Decode a whole-address locking script. Non-address scripts remain unavailable. */
export function scriptToAddress(script: Uint8Array, network: Network): string | undefined {
  const net = bitcoinNetwork(network);
  const opcode = script[0];
  const version =
    opcode === 0
      ? 0
      : opcode !== undefined && opcode >= 0x51 && opcode <= 0x60
        ? opcode - 0x50
        : undefined;
  const length = script[1];
  if (
    version !== undefined &&
    length !== undefined &&
    length >= 2 &&
    length <= 40 &&
    script.length === length + 2 &&
    (version !== 0 || length === 20 || length === 32)
  )
    return bitcoinAddress.toBech32(script.slice(2), version, net.bech32);
  try {
    return bitcoinAddress.fromOutputScript(script, net);
  } catch {
    return undefined;
  }
}

export function addressToScriptHash(address: string, network: Network): string {
  return scriptHash(addressToScript(address, network));
}

export function outputScript(publicKey: Uint8Array, scriptType: ScriptType): Uint8Array {
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
      throw new Error('Unsupported public-key script type.');
  }
}
