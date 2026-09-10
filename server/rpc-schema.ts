import { z } from 'zod';
import { SafeError } from './errors';

const hash = z.string().regex(/^[0-9a-fA-F]{64}$/);
const index = z.number().int().min(0).max(0xffffffff);
const empty = z.tuple([]);
// Core 31 parses this RPC's vout as a signed int, unlike gettxout.
export const spenderOutpoint = z.strictObject({ txid: hash, vout: index.max(0x7fffffff) });
const spenderRow = spenderOutpoint.extend({
  spendingtxid: hash.optional(),
  blockhash: hash.optional(),
});
/** Reject incomplete or ambiguous coverage rather than interpreting it as an empty lookup. */
export function validateSpenderResult(value: unknown, outputs: { txid: string; vout: number }[]) {
  const parsed = z.array(spenderRow).max(500).safeParse(value);
  const expected = new Set(outputs.map(({ txid, vout }) => `${txid.toLowerCase()}:${vout}`));
  if (!parsed.success || parsed.data.length !== expected.size) throw invalidSpenderResult();
  const spendingBlocks = new Map<string, string | undefined>();
  for (const row of parsed.data) {
    row.txid = row.txid.toLowerCase();
    if (row.spendingtxid !== undefined) row.spendingtxid = row.spendingtxid.toLowerCase();
    if (row.blockhash !== undefined) row.blockhash = row.blockhash.toLowerCase();
    if (
      (row.blockhash !== undefined && row.spendingtxid === undefined) ||
      !expected.delete(`${row.txid}:${row.vout}`)
    )
      throw invalidSpenderResult();
    if (row.spendingtxid !== undefined) {
      if (
        spendingBlocks.has(row.spendingtxid) &&
        spendingBlocks.get(row.spendingtxid) !== row.blockhash
      )
        throw invalidSpenderResult();
      spendingBlocks.set(row.spendingtxid, row.blockhash);
    }
  }
  return parsed.data;
}
function invalidSpenderResult() {
  return new SafeError(
    'Bitcoin RPC spender coverage is unavailable',
    503,
    'core_spender_unavailable',
  );
}
const methods: Record<string, z.ZodType> = {
  'core:getblockchaininfo': empty,
  'core:getrawtransaction': z.tuple([
    hash,
    z.union([z.boolean(), z.literal(0), z.literal(1), z.literal(2)]).optional(),
    hash.optional(),
  ]),
  'core:getblockhash': z.tuple([index]),
  'core:getblockheader': z.tuple([hash, z.boolean().optional()]),
  'core:getblock': z.tuple([
    hash,
    z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]).optional(),
  ]),
  'core:gettxout': z.tuple([hash, index, z.boolean().optional()]),
  'core:gettxspendingprevout': z.tuple([
    z.array(spenderOutpoint).min(1).max(500),
    z.strictObject({ mempool_only: z.literal(false), return_spending_tx: z.literal(false) }),
  ]),
  'electrum:server.version': empty,
  'electrum:blockchain.scripthash.get_history': z.tuple([hash]),
  'electrum:blockchain.scripthash.get_balance': z.tuple([hash]),
  'electrum:blockchain.scripthash.listunspent': z.tuple([hash]),
  'electrum:blockchain.transaction.get': z.tuple([hash, z.boolean().optional()]),
  'electrum:blockchain.headers.subscribe': empty,
};
const envelope = z.strictObject({
  network: z.enum(['mainnet', 'testnet4']),
  target: z.enum(['core', 'electrum']),
  method: z.string().max(80),
  params: z.array(z.unknown()).max(3),
});
export function parseRpc(value: unknown) {
  const parsed = envelope.safeParse(value);
  if (!parsed.success) throw new SafeError('Invalid RPC request', 400);
  const schema = Object.hasOwn(methods, `${parsed.data.target}:${parsed.data.method}`)
    ? methods[`${parsed.data.target}:${parsed.data.method}`]
    : undefined;
  if (!schema) throw new SafeError('RPC method is not allowed', 400);
  if (!schema.safeParse(parsed.data.params).success)
    throw new SafeError('Invalid RPC parameters', 400);
  return parsed.data;
}
