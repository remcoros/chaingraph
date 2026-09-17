/** Classify without decoding payloads. Raw script bytes, not an RPC type/address hint. */
export function isOpReturn(hex?: string): hex is string {
  return hex?.slice(0, 2).toLowerCase() === '6a';
}
