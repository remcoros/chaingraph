import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import { address as bitcoinAddress } from 'bitcoinjs-lib';
import { bitcoinNetwork, type Network } from './network';
import { sats } from './amount';
import type { TxOutput } from './transaction';
export function outputScriptHex(output: TxOutput, network: Network): string | undefined {
  if (output.scriptPubKey.hex !== undefined) return output.scriptPubKey.hex.toLowerCase();
  const reported =
    output.scriptPubKey.address ??
    (output.scriptPubKey.addresses?.length === 1 ? output.scriptPubKey.addresses[0] : undefined);
  if (!reported) return undefined;
  try {
    return bytesToHex(bitcoinAddress.toOutputScript(reported, bitcoinNetwork(network)));
  } catch {
    return undefined;
  }
}

export function outputScriptHash(output: TxOutput, network: Network): string | undefined {
  try {
    const hex = outputScriptHex(output, network);
    return hex === undefined ? undefined : bytesToHex(sha256(hexToBytes(hex)).reverse());
  } catch {
    return undefined;
  }
}

export function previousOutputsConflict(
  left: TxOutput,
  right: TxOutput,
  network: Network,
): boolean {
  if (sats(left.value) !== sats(right.value)) return true;
  const leftType = left.scriptPubKey.type,
    rightType = right.scriptPubKey.type;
  if (
    leftType &&
    rightType &&
    leftType !== 'nonstandard' &&
    rightType !== 'nonstandard' &&
    leftType !== rightType
  )
    return true;
  const leftScript = outputScriptHex(left, network);
  const rightScript = outputScriptHex(right, network);
  return leftScript !== undefined && rightScript !== undefined && leftScript !== rightScript;
}

/** The single address a loaded output pays, when it has exactly one. */
export function outputAddress(output: TxOutput) {
  return (
    output.scriptPubKey.address ??
    (output.scriptPubKey.addresses?.length === 1 ? output.scriptPubKey.addresses[0] : undefined)
  );
}
