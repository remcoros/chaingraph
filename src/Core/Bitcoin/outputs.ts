import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import { type Network } from './network';
import { sats } from './amount';
import { addressToScript, scriptHashHex, scriptToAddress } from './scripts';
import type { TxOutput } from './transaction';

export type OutputScriptType =
  | 'pubkeyhash'
  | 'scripthash'
  | 'witness_v0_keyhash'
  | 'witness_v0_scripthash'
  | 'witness_v1_taproot'
  | 'pubkey'
  | 'multisig'
  | 'anchor';

const reportedScriptTypes = new Set<OutputScriptType>([
  'pubkeyhash',
  'scripthash',
  'witness_v0_keyhash',
  'witness_v0_scripthash',
  'witness_v1_taproot',
  'pubkey',
  'multisig',
  'anchor',
]);

function exactOutputScriptType(hex: string | undefined): OutputScriptType | undefined {
  const normalized = hex?.toLowerCase();
  return normalized === undefined
    ? undefined
    : /^76a914[0-9a-f]{40}88ac$/.test(normalized)
      ? 'pubkeyhash'
      : /^a914[0-9a-f]{40}87$/.test(normalized)
        ? 'scripthash'
        : /^0014[0-9a-f]{40}$/.test(normalized)
          ? 'witness_v0_keyhash'
          : /^0020[0-9a-f]{64}$/.test(normalized)
            ? 'witness_v0_scripthash'
            : /^5120[0-9a-f]{64}$/.test(normalized)
              ? 'witness_v1_taproot'
              : undefined;
}

/** Raw bytes establish an exact outer script type. A known report can fill a missing raw type. */
export function outputScriptType(output: TxOutput): OutputScriptType | undefined {
  const decoded = exactOutputScriptType(output.scriptPubKey.hex);
  const reported = output.scriptPubKey.type;
  if (decoded && reported && reported !== 'nonstandard' && decoded !== reported) return undefined;
  const known = reportedScriptTypes.has(reported as OutputScriptType)
    ? (reported as OutputScriptType)
    : undefined;
  return decoded ?? known;
}

export function outputScriptHex(output: TxOutput, network: Network): string | undefined {
  if (output.scriptPubKey.hex !== undefined) return output.scriptPubKey.hex.toLowerCase();
  const reported =
    output.scriptPubKey.address ??
    (output.scriptPubKey.addresses?.length === 1 ? output.scriptPubKey.addresses[0] : undefined);
  if (!reported) return undefined;
  try {
    return bytesToHex(addressToScript(reported, network));
  } catch {
    return undefined;
  }
}

export function outputScriptHash(output: TxOutput, network: Network): string | undefined {
  try {
    const hex = outputScriptHex(output, network);
    return hex === undefined ? undefined : scriptHashHex(hex);
  } catch {
    return undefined;
  }
}

/** The one address encoded by raw script bytes or a validated address claim. */
export function outputScriptAddress(output: TxOutput, network: Network): string | undefined {
  try {
    const hex = outputScriptHex(output, network);
    return hex === undefined ? undefined : scriptToAddress(hexToBytes(hex), network);
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
