import { addressToScriptHash } from '../Wallet/wallet';
import type { Network } from '../Chain/network';

export const txNodeId = (txid: string) => `tx:${txid}`;
export const outputNodeId = (txid: string, vout: number) => `out:${txid}:${vout}`;
export const addressNodeId = (address: string) => `addr:${address}`;

export function canonicalAddress(address: string): string {
  return /^(bc|tb)1/i.test(address) ? address.toLowerCase() : address;
}

/** Canonical entity references may identify observations not loaded in this workspace yet. */
export function canonicalEntityNodeId(id: string, network: Network): string {
  const transaction = /^tx:([0-9a-f]{64})$/i.exec(id);
  if (transaction) return `tx:${transaction[1].toLowerCase()}`;
  const output = /^out:([0-9a-f]{64}):(\d{1,10})$/i.exec(id);
  if (output && Number(output[2]) <= 0xffffffff)
    return outputNodeId(output[1].toLowerCase(), Number(output[2]));
  if (id.startsWith('addr:')) {
    const address = id.slice(5);
    addressToScriptHash(address, network);
    return `addr:${canonicalAddress(address)}`;
  }
  throw new Error('Expected a transaction, output, or network-valid address reference.');
}
