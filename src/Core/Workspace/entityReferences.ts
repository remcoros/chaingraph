import { addressToScriptHash, type Network } from '../Bitcoin/index';

export const transactionReference = (txid: string) => `tx:${txid}`;
export const outpointReference = (txid: string, vout: number) => `out:${txid}:${vout}`;
export const addressReference = (address: string) => `addr:${address}`;

export function canonicalAddress(address: string): string {
  return /^(bc|tb)1/i.test(address) ? address.toLowerCase() : address;
}

/** Canonical entity references may identify observations not loaded in this workspace yet. */
export function canonicalEntityReference(id: string, network: Network): string {
  const transaction = /^tx:([0-9a-f]{64})$/i.exec(id);
  if (transaction) return `tx:${transaction[1].toLowerCase()}`;
  const output = /^out:([0-9a-f]{64}):(\d{1,10})$/i.exec(id);
  if (output && Number(output[2]) <= 0xffffffff)
    return outpointReference(output[1].toLowerCase(), Number(output[2]));
  if (id.startsWith('addr:')) {
    const address = id.slice(5);
    addressToScriptHash(address, network);
    return `addr:${canonicalAddress(address)}`;
  }
  throw new Error('Expected a transaction, output, or network-valid address reference.');
}
