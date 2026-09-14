import { examplesForNetwork } from '../src/Domain/Workspace/examples';
import { parseTransaction } from '../src/Domain/Workspace/workspace';
import type { Network, Transaction } from '../src/Domain/types';
import { addressToScriptHash } from '../src/Domain/Wallet/wallet';

// Uses a running proxy only. Does not load environment files or print destinations.
const base = process.env.CHAINGRAPH_PROXY_URL ?? 'http://127.0.0.1:4000';
let calls = 0,
  passed = 0;
const transactions = new Map<string, Transaction>();
const addresses = new Set<string>();
async function rpc(
  network: Network,
  target: 'core' | 'electrum',
  method: string,
  params: unknown[],
): Promise<unknown> {
  calls++;
  const response = await fetch(`${base}/api/rpc`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ network, target, method, params }),
    signal: AbortSignal.timeout(45000),
  });
  const body = await response.json();
  if (!response.ok || body.error) throw new Error('Proxy request failed');
  return body.result;
}
async function transaction(network: Network, id: string) {
  let result = transactions.get(`${network}:${id}`);
  if (!result) {
    result = parseTransaction(await rpc(network, 'core', 'getrawtransaction', [id, 1]));
    if (result.txid !== id) throw new Error('Unexpected transaction identity');
    transactions.set(`${network}:${id}`, result);
  }
  return result;
}
try {
  const capabilityResponse = await fetch(`${base}/api/networks`, {
    signal: AbortSignal.timeout(45000),
  });
  const capabilities = await capabilityResponse.json();
  if (
    !capabilityResponse.ok ||
    !Array.isArray(capabilities.networks) ||
    !capabilities.networks.length ||
    !capabilities.networks.every(
      (network: unknown) => network === 'mainnet' || network === 'testnet4',
    )
  )
    throw new Error('Configured networks required');
  for (const network of capabilities.networks as Network[]) {
    const status = await (
      await fetch(`${base}/api/status?network=${network}`, { signal: AbortSignal.timeout(45000) })
    ).json();
    if (!status.connected || status.network !== network)
      throw new Error('Matching backend required');
    for (const example of examplesForNetwork(network)) {
      const tx = await transaction(network, example.txid);
      if (
        !(tx.confirmations && tx.confirmations > 0) ||
        tx.vin.length !== example.evidence.inputCount ||
        tx.vout.length !== example.evidence.outputCount
      )
        throw new Error('Transaction structure changed');
      const coreRaw = await rpc(network, 'core', 'getrawtransaction', [tx.txid, 0]);
      const electrumRaw = await rpc(network, 'electrum', 'blockchain.transaction.get', [
        tx.txid,
        false,
      ]);
      if (typeof coreRaw !== 'string' || coreRaw !== electrumRaw)
        throw new Error('Upstreams disagree on transaction bytes');
      const output = tx.vout.find((o) => o.n === example.vout);
      if (example.vout !== undefined && !output) throw new Error('Example output missing');
      if (example.evidence.address && output?.scriptPubKey.address !== example.evidence.address)
        throw new Error('Example output changed');

      for (const funding of example.evidence.funding) {
        if (!tx.vin.some((input) => input.txid === funding.txid && input.vout === funding.vout))
          throw new Error('Funding link missing');
        const parent = await transaction(network, funding.txid);
        if (!parent.vout.some((o) => o.n === funding.vout))
          throw new Error('Funding output missing');
      }
      if (example.evidence.address) {
        addresses.add(`${network}:${example.evidence.address}`);
        const history = (await rpc(network, 'electrum', 'blockchain.scripthash.get_history', [
          addressToScriptHash(example.evidence.address, network),
        ])) as Array<{ tx_hash: string; height: number }>;
        if (
          !Array.isArray(history) ||
          history.length > 50 ||
          !history.some((item) => item.tx_hash === tx.txid)
        )
          throw new Error('History unavailable or outside verification budget');
        for (const entry of history) await transaction(network, entry.tx_hash);
        for (const spending of example.evidence.spending) {
          if (!history.some((entry) => entry.tx_hash === spending.txid))
            throw new Error('Expected spending history missing');
          const child = await transaction(network, spending.txid),
            input = child.vin[spending.vin];
          if (
            input?.txid !== tx.txid ||
            input.vout !== example.vout ||
            !child.confirmations ||
            child.confirmations < 1
          )
            throw new Error('Confirmed spending link missing');
        }
        if ((await rpc(network, 'core', 'gettxout', [tx.txid, example.vout, true])) !== null)
          throw new Error('Expected spent output is unspent');
      }
      passed++;
    }
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
