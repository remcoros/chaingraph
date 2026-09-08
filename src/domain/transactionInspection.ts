import { Transaction as BitcoinTransaction, script } from 'bitcoinjs-lib';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import { outputNodeId, type GraphNode, type Transaction } from './types';

/** A display-only decode. ASM is normalized by bitcoinjs; hex remains authoritative. */
export function inspectScript(hex: string | undefined): {
  hex?: string;
  asm?: string;
  error?: string;
} {
  if (hex === undefined) return {};
  if (hex.length > 8_000_000 || !/^(?:[0-9a-fA-F]{2})*$/.test(hex))
    return { error: 'Invalid or oversized script hex.' };
  try {
    return { hex, asm: script.toASM(hexToBytes(hex)) || '(empty script)' };
  } catch {
    return {
      hex,
      error: 'Malformed push data: opcodes cannot be decoded. Original hex is preserved.',
    };
  }
}

export function relatedTransactions(
  transactions: Record<string, Transaction>,
  selected: GraphNode,
): { tx: Transaction; role: 'Selected' | 'Creating' | 'Spending' | 'Related' }[] {
  if (selected.kind === 'transaction') {
    const tx = transactions[selected.txid ?? ''];
    return tx ? [{ tx, role: 'Selected' }] : [];
  }
  const result: ReturnType<typeof relatedTransactions> = [];
  if (selected.kind === 'output') {
    const creating = transactions[selected.txid ?? ''];
    if (creating) result.push({ tx: creating, role: 'Creating' });
    for (const tx of Object.values(transactions)) {
      if (tx.vin.some((input) => input.txid === selected.txid && input.vout === selected.vout))
        result.push({ tx, role: 'Spending' });
    }
  } else {
    const outputs = new Set<string>();
    for (const tx of Object.values(transactions)) {
      for (const output of tx.vout) {
        if (
          output.scriptPubKey.address === selected.address ||
          output.scriptPubKey.addresses?.includes(selected.address ?? '')
        )
          outputs.add(outputNodeId(tx.txid, output.n));
      }
    }
    for (const tx of Object.values(transactions)) {
      if (
        tx.vout.some((o) => outputs.has(outputNodeId(tx.txid, o.n))) ||
        tx.vin.some((i) => i.txid !== undefined && outputs.has(outputNodeId(i.txid, i.vout!)))
      )
        result.push({ tx, role: 'Related' });
    }
  }
  return result;
}

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

/** Decode only after byte limits, then bind the result to both ID and loaded observations. */
export function decodeRawTransaction(raw: unknown, expected: Transaction): RawInspection {
  if (typeof raw !== 'string' || raw.length > 8_000_000 || !/^(?:[0-9a-fA-F]{2})+$/.test(raw))
    throw new Error('Invalid or oversized raw transaction hex.');
  let decoded: BitcoinTransaction;
  try {
    decoded = BitcoinTransaction.fromHex(raw);
  } catch {
    throw new Error('Raw transaction cannot be decoded.');
  }
  if (decoded.getId() !== expected.txid)
    throw new Error('Raw transaction ID does not match the selected transaction.');
  if (decoded.weight() > 4_000_000 || decoded.ins.length > 10000 || decoded.outs.length > 10000)
    throw new Error('Raw transaction exceeds inspection limits.');
  const sameInputs =
    decoded.ins.length === expected.vin.length &&
    decoded.ins.every((input, index) => {
      const saved = expected.vin[index];
      return saved.coinbase !== undefined
        ? BitcoinTransaction.isCoinbaseHash(input.hash) &&
            input.index === 0xffffffff &&
            bytesToHex(input.script) === saved.coinbase.toLowerCase()
        : // Reject the exact null outpoint (COutPoint::IsNull: zero hash and
          // n == UINT32_MAX), which is the coinbase sentinel, not a prevout a
          // saved non-coinbase input may claim. A zero hash at any other index
          // binds structurally like any other txid; no UTXO existence is implied.
          !(BitcoinTransaction.isCoinbaseHash(input.hash) && input.index === 0xffffffff) &&
            bytesToHex(Uint8Array.from(input.hash).reverse()) === saved.txid &&
            input.index === saved.vout;
    });
  const sameOutputs =
    decoded.outs.length === expected.vout.length &&
    decoded.outs.every((output, index) => {
      const saved = expected.vout[index];
      return (
        output.value === BigInt(Math.round(saved.value * 100_000_000)) &&
        (saved.scriptPubKey.hex === undefined ||
          bytesToHex(output.script) === saved.scriptPubKey.hex.toLowerCase())
      );
    });
  if (!sameInputs || !sameOutputs)
    throw new Error(
      'Raw transaction disagrees with the loaded inputs or outputs. Refresh the transaction first.',
    );
  return {
    hex: raw.toLowerCase(),
    txid: decoded.getId(),
    wtxid: bytesToHex(sha256(sha256(hexToBytes(raw))).reverse()),
    version: decoded.version,
    locktime: decoded.locktime,
    size: decoded.byteLength(),
    vsize: decoded.virtualSize(),
    weight: decoded.weight(),
    inputs: decoded.ins.map((i) => ({
      script: bytesToHex(i.script),
      witness: i.witness.map(bytesToHex),
      sequence: i.sequence,
    })),
    outputs: decoded.outs.map((o) => ({ script: bytesToHex(o.script) })),
  };
}
