import { Transaction as BitcoinTransaction } from 'bitcoinjs-lib';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';

const MAX_RAW_TRANSACTION_HEX_LENGTH = 8_000_000;
const MAX_INSPECTION_INPUTS_OR_OUTPUTS = 10_000;

export interface DecodedRawTransaction {
  hex: string;
  txid: string;
  wtxid: string;
  version: number;
  locktime: number;
  size: number;
  vsize: number;
  weight: number;
  inputs: {
    txid: string;
    vout: number;
    coinbase: boolean;
    script: string;
    witness: string[];
    sequence: number;
  }[];
  outputs: { value: bigint; script: string }[];
}

/** Decode bounded serialized transaction bytes without deriving chain status or ownership. */
export function decodeRawTransaction(raw: unknown): DecodedRawTransaction {
  if (
    typeof raw !== 'string' ||
    raw.length > MAX_RAW_TRANSACTION_HEX_LENGTH ||
    !/^(?:[0-9a-fA-F]{2})+$/.test(raw)
  )
    throw new Error('Invalid or oversized raw transaction hex.');
  const hex = raw.toLowerCase();
  let decoded: BitcoinTransaction;
  try {
    decoded = BitcoinTransaction.fromHex(hex);
  } catch {
    throw new Error('Raw transaction cannot be decoded.');
  }
  if (
    decoded.weight() > 4_000_000 ||
    decoded.ins.length > MAX_INSPECTION_INPUTS_OR_OUTPUTS ||
    decoded.outs.length > MAX_INSPECTION_INPUTS_OR_OUTPUTS
  )
    throw new Error('Raw transaction exceeds inspection limits.');
  return {
    hex,
    txid: decoded.getId(),
    wtxid: bytesToHex(sha256(sha256(hexToBytes(hex))).reverse()),
    version: decoded.version,
    locktime: decoded.locktime,
    size: decoded.byteLength(),
    vsize: decoded.virtualSize(),
    weight: decoded.weight(),
    inputs: decoded.ins.map((input) => ({
      txid: bytesToHex(Uint8Array.from(input.hash).reverse()),
      vout: input.index,
      coinbase: BitcoinTransaction.isCoinbaseHash(input.hash) && input.index === 0xffffffff,
      script: bytesToHex(input.script),
      witness: input.witness.map(bytesToHex),
      sequence: input.sequence,
    })),
    outputs: decoded.outs.map((output) => ({
      value: output.value,
      script: bytesToHex(output.script),
    })),
  };
}
