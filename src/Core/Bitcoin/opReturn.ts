import type { TxOutputDetails } from './transaction';

/** A valid raw script beginning with OP_RETURN. This does not decode its payload. */
export function isOpReturn(hex?: string): hex is string {
  return /^(?:6a)(?:[0-9a-f]{2})*$/i.test(hex ?? '');
}

/** An output beginning with OP_RETURN in valid raw bytes has no spend to discover. */
export function isProvablyUnspendable(output: TxOutputDetails): boolean {
  return isOpReturn(output.scriptPubKey.hex);
}
