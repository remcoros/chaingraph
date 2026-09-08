import { z } from 'zod';
import { SafeError } from './errors';

const hash = z.string().regex(/^[0-9a-fA-F]{64}$/);
const index = z.number().int().min(0).max(0xffffffff);
const empty = z.tuple([]);
const methods: Record<string, z.ZodType> = {
  'core:getblockchaininfo': empty,
  'core:getrawtransaction': z.tuple([
    hash,
    z.union([z.boolean(), z.literal(0), z.literal(1), z.literal(2)]).optional(),
    hash.optional(),
  ]),
  'core:getblockhash': z.tuple([index]),
  'core:getblock': z.tuple([
    hash,
    z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]).optional(),
  ]),
  'core:gettxout': z.tuple([hash, index, z.boolean().optional()]),
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
