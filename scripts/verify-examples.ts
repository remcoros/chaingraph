import { TESTNET4_EXAMPLES } from '../src/domain/examples';
import { parseTransaction } from '../src/domain/workspace';
import type { Transaction } from '../src/domain/types';
import { addressToScriptHash } from '../src/lib/wallet';

// Uses a running proxy only. Does not load environment files or print destinations.
const base = process.env.CHAINGRAPH_PROXY_URL ?? 'http://127.0.0.1:4000';
let calls = 0,
  passed = 0;
const transactions = new Map<string, Transaction>();
const addresses = new Set<string>();
async function rpc(
  target: 'core' | 'electrum',
  method: string,
  params: unknown[],
): Promise<unknown> {
  calls++;
  const response = await fetch(`${base}/api/rpc`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ target, method, params }),
    signal: AbortSignal.timeout(45000),
  });
  const body = await response.json();
  if (!response.ok || body.error) throw new Error('Proxy request failed');
  return body.result;
}
async function transaction(id: string) {
  let result = transactions.get(id);
  if (!result) {
    result = parseTransaction(await rpc('core', 'getrawtransaction', [id, 1]));
    if (result.txid !== id) throw new Error('Unexpected transaction identity');
    transactions.set(id, result);
  }
  return result;
}
try {
  const status = await (
    await fetch(`${base}/api/status`, { signal: AbortSignal.timeout(45000) })
  ).json();
  if (!status.connected || status.network !== 'testnet4')
    throw new Error('Matching backend required');
  for (const example of TESTNET4_EXAMPLES) {
    const tx = await transaction(example.txid);
    if (
      !(tx.confirmations && tx.confirmations > 0) ||
      tx.vin.length !== example.evidence.inputCount ||
      tx.vout.length !== example.evidence.outputCount
    )
      throw new Error('Transaction structure changed');
    const output = tx.vout.find((o) => o.n === example.vout);
    if (output?.scriptPubKey.address !== example.evidence.address)
      throw new Error('Example output changed');
    addresses.add(example.evidence.address);
    for (const funding of example.evidence.funding) {
      if (!tx.vin.some((input) => input.txid === funding.txid && input.vout === funding.vout))
        throw new Error('Funding link missing');
      const parent = await transaction(funding.txid);
      if (!parent.vout.some((o) => o.n === funding.vout)) throw new Error('Funding output missing');
    }
    const history = (await rpc('electrum', 'blockchain.scripthash.get_history', [
      addressToScriptHash(example.evidence.address, 'testnet4'),
    ])) as Array<{ tx_hash: string; height: number }>;
    if (
      !Array.isArray(history) ||
      history.length > 50 ||
      !history.some((item) => item.tx_hash === tx.txid)
    )
      throw new Error('History unavailable or outside verification budget');
    for (const entry of history) await transaction(entry.tx_hash);
    for (const spending of example.evidence.spending) {
      if (!history.some((entry) => entry.tx_hash === spending.txid))
        throw new Error('Expected spending history missing');
      const child = await transaction(spending.txid),
        input = child.vin[spending.vin];
      if (
        input?.txid !== tx.txid ||
        input.vout !== example.vout ||
        !child.confirmations ||
        child.confirmations < 1
      )
        throw new Error('Confirmed spending link missing');
    }
    if ((await rpc('core', 'gettxout', [tx.txid, example.vout, true])) !== null)
      throw new Error('Expected spent output is unspent');
    passed++;
  }
  console.log(
    JSON.stringify({
      examples: 'passed',
      passed,
      failed: 0,
      verifiedTransactions: transactions.size,
      verifiedAddresses: addresses.size,
      rpcCalls: calls,
      verifiedAt: new Date().toISOString(),
    }),
  );
} catch {
  console.error(JSON.stringify({ examples: 'failed', passed, failed: 1, rpcCalls: calls }));
  process.exitCode = 1;
}
