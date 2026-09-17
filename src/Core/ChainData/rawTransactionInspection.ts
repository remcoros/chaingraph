import { sats, type Network } from '../Bitcoin';
import { decodeRawTransaction as decodeBitcoinTransaction } from '../Bitcoin/rawTransaction';
import type { Transaction } from './transaction';
import { rpc } from './api';

export interface RawInspection {
  hex: string;
  txid: string;
  wtxid: string;
  version: number;
  locktime: number;
  size: number;
  vsize: number;
  weight: number;
  inputs: { script: string; witness: string[]; sequence: number }[];
  outputs: { script: string }[];
}

/** Bind decoded bytes to one loaded observation without inferring UTXO existence or ownership. */
export function decodeRawTransaction(raw: unknown, expected: Transaction): RawInspection {
  const decoded = decodeBitcoinTransaction(raw);
  if (decoded.txid !== expected.txid)
    throw new Error('Raw transaction ID does not match the selected transaction.');
  const sameInputs =
    decoded.inputs.length === expected.vin.length &&
    decoded.inputs.every((input, index) => {
      const saved = expected.vin[index];
      return saved.coinbase !== undefined
        ? input.coinbase && input.script === saved.coinbase.toLowerCase()
        : !input.coinbase && input.txid === saved.txid && input.vout === saved.vout;
    });
  const sameOutputs =
    decoded.outputs.length === expected.vout.length &&
    decoded.outputs.every((output, index) => {
      const saved = expected.vout[index];
      return (
        output.value === BigInt(sats(saved.value)) &&
        (saved.scriptPubKey.hex === undefined ||
          output.script === saved.scriptPubKey.hex.toLowerCase())
      );
    });
  if (!sameInputs || !sameOutputs)
    throw new Error(
      'Raw transaction disagrees with the loaded inputs or outputs. Refresh the transaction first.',
    );
  return {
    ...decoded,
    inputs: decoded.inputs.map(({ script, witness, sequence }) => ({ script, witness, sequence })),
    outputs: decoded.outputs.map(({ script }) => ({ script })),
  };
}

export async function fetchRawInspection(
  network: Network,
  transaction: Transaction,
  signal: AbortSignal,
): Promise<RawInspection> {
  let raw: unknown;
  try {
    raw = await rpc(network, 'core', 'getrawtransaction', [transaction.txid, false], signal);
  } catch (error) {
    if (signal.aborted) throw error;
    raw = await rpc(
      network,
      'electrum',
      'blockchain.transaction.get',
      [transaction.txid, false],
      signal,
    );
  }
  signal.throwIfAborted();
  return decodeRawTransaction(raw, transaction);
}
