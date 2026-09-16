import { z } from 'zod';
import { address as bitcoinAddress, networks as bitcoinNetworks } from 'bitcoinjs-lib';
import { hexToBytes } from '@noble/hashes/utils.js';
import { addressToScriptHash } from '../Wallet/wallet';
import type { Network } from './network';
import { sats, type Transaction } from './transaction';

const MAX_MONEY = 21_000_000;
export const MAX_MONEY_SATS = MAX_MONEY * 100_000_000;

const txid = z.string().regex(/^[0-9a-f]{64}$/);
const text = z.string().max(10000);
const uint32 = z.number().int().min(0).max(0xffffffff);
const valueSchema = z
  .number()
  .min(0)
  .max(MAX_MONEY)
  .refine(
    // Check decimal precision before multiplying: large valid BTC values can
    // acquire a fractional binary rounding residue when scaled to satoshis.
    (value) =>
      Math.abs(value - Number(value.toFixed(8))) <= Number.EPSILON * Math.max(1, Math.abs(value)),
    'Output values must have whole-satoshi precision.',
  );
const scriptPubKeySchema = z.object({
  hex: z
    .string()
    .max(20000)
    .regex(/^(?:[0-9a-fA-F]{2})*$/)
    .optional(),
  address: z.string().min(1).max(150).optional(),
  addresses: z.array(z.string().min(1).max(150)).max(20).optional(),
  type: text.optional(),
});
const outputDetailsSchema = z.object({
  value: valueSchema,
  scriptPubKey: scriptPubKeySchema,
});
const inputSchema = z
  .object({
    txid: txid.optional(),
    vout: uint32.optional(),
    coinbase: text.min(1).optional(),
    sequence: uint32.optional(),
    prevout: outputDetailsSchema
      .extend({
        scriptPubKey: scriptPubKeySchema.extend({
          hex: z
            .string()
            .max(20000)
            .regex(/^(?:[0-9a-fA-F]{2})*$/),
        }),
      })
      .optional(),
  })
  .refine(
    (input) =>
      input.coinbase !== undefined
        ? input.txid === undefined && input.vout === undefined && input.prevout === undefined
        : input.txid !== undefined && input.vout !== undefined,
    'An input must contain either coinbase data or a complete transaction outpoint.',
  );
const outputSchema = outputDetailsSchema.extend({
  n: uint32,
});

export const transactionSchema = z
  .object({
    txid,
    vin: z.array(inputSchema).min(1).max(10000),
    vout: z.array(outputSchema).min(1).max(10000),
    confirmations: z.number().int().min(-0x7fffffff).max(0x7fffffff).optional(),
    blockHeight: z.number().int().min(0).max(0x7fffffff).optional(),
    mempool: z.boolean().optional(),
    blocktime: uint32.optional(),
    time: uint32.optional(),
    size: z.number().int().min(1).max(4_000_000).optional(),
    vsize: z.number().int().min(1).max(1_000_000).optional(),
    blockhash: txid.optional(),
  })
  .superRefine((transaction, context) => {
    if (
      transaction.mempool &&
      (transaction.blockHeight !== undefined ||
        transaction.blockhash !== undefined ||
        (transaction.confirmations ?? 0) !== 0)
    )
      context.addIssue({
        code: 'custom',
        path: ['mempool'],
        message: 'Mempool observations cannot include a block or nonzero confirmations.',
      });
    if (
      transaction.blockHeight !== undefined &&
      transaction.confirmations !== undefined &&
      transaction.confirmations <= 0
    )
      context.addIssue({
        code: 'custom',
        path: ['blockHeight'],
        message: 'A confirmed block height cannot have zero or negative confirmations.',
      });
    if (
      transaction.vin.some((input) => input.coinbase !== undefined) &&
      transaction.vin.length !== 1
    ) {
      context.addIssue({
        code: 'custom',
        path: ['vin'],
        message: 'Coinbase must be the transaction’s only input.',
      });
    }
    const inputs = new Set<string>();
    let inputTotal = 0;
    for (const [index, input] of transaction.vin.entries()) {
      if (input.txid === undefined) continue;
      const key = `${input.txid}:${input.vout}`;
      if (inputs.has(key))
        context.addIssue({
          code: 'custom',
          path: ['vin', index],
          message: 'Duplicate input outpoint.',
        });
      inputs.add(key);
      if (input.prevout) inputTotal += sats(input.prevout.value);
    }
    if (inputTotal > MAX_MONEY_SATS)
      context.addIssue({
        code: 'custom',
        path: ['vin'],
        message: 'Transaction previous-output total exceeds the Bitcoin money limit.',
      });
    let total = 0;
    for (const [index, output] of transaction.vout.entries()) {
      if (output.n !== index)
        context.addIssue({
          code: 'custom',
          path: ['vout', index, 'n'],
          message: 'Output indexes must be unique and sequential from zero.',
        });
      total += sats(output.value);
    }
    if (total > MAX_MONEY_SATS)
      context.addIssue({
        code: 'custom',
        path: ['vout'],
        message: 'Transaction output total exceeds the Bitcoin money limit.',
      });
    if (
      transaction.size !== undefined &&
      transaction.vsize !== undefined &&
      transaction.vsize > transaction.size
    ) {
      context.addIssue({
        code: 'custom',
        path: ['vsize'],
        message: 'Virtual size cannot exceed serialized size.',
      });
    }
  });

/** Validate decoded metadata without treating network-neutral transaction bytes as chain proof. */
export function validateTransactionAddresses(transaction: Transaction, network: Network): void {
  const outputs = [
    ...transaction.vout,
    ...transaction.vin.flatMap((input) =>
      input.prevout && input.vout !== undefined ? [{ n: input.vout, ...input.prevout }] : [],
    ),
  ];
  for (const output of outputs) {
    const { address, addresses, hex } = output.scriptPubKey;
    const reported = [...new Set([...(address ? [address] : []), ...(addresses ?? [])])];
    if (!reported.length) continue;
    const hashes = reported.map((value) => {
      try {
        return addressToScriptHash(value, network);
      } catch {
        throw new Error(`Transaction output ${output.n} has an invalid address for ${network}.`);
      }
    });
    if (hex === undefined) continue;
    let canonical: string;
    try {
      canonical = bitcoinAddress.fromOutputScript(
        hexToBytes(hex),
        network === 'mainnet' ? bitcoinNetworks.bitcoin : bitcoinNetworks.testnet,
      );
    } catch {
      // Bare multisig/P2PK can report participant addresses that do not encode
      // the whole output script. Keep their network checks without imposing a
      // single-address script model on them or on nonstandard scripts.
      continue;
    }
    const expected = addressToScriptHash(canonical, network);
    if (hashes.some((hash) => hash !== expected))
      throw new Error(`Transaction output ${output.n} address does not match its script.`);
  }
}

export function parseTransaction(data: unknown): Transaction {
  return transactionSchema.parse(data);
}
