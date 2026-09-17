import type { TxOutputDetails } from './transaction';

/** Classify without decoding payloads. Raw script bytes, not an RPC type/address hint. */
export function isOpReturn(hex?: string): hex is string {
  return hex?.slice(0, 2).toLowerCase() === '6a';
}

/** An output beginning with OP_RETURN in valid raw bytes has no spend to discover. */
export function isProvablyUnspendable(output: TxOutputDetails): boolean {
  return /^(?:6a)(?:[0-9a-f]{2})*$/i.test(output.scriptPubKey.hex ?? '');
}
