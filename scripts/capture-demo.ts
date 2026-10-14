import { readFile, writeFile } from 'node:fs/promises';
import {
  backendNetworks,
  backendStatus,
  fetchTransaction,
  fetchHistory,
  fetchAddressUtxos,
} from '../src/Core/ChainData/api';
import { fetchRawInspection } from '../src/Core/ChainData/rawTransactionInspection';
import type { Transaction, AddressUtxoObservation } from '../src/Core/ChainData';
import type { Wallet } from '../src/Core/Workspace/Wallets/wallets';

// Explicit opt-in to a verified local proxy. No environment files or upstream URLs.
const base = process.env.CHAINGRAPH_PROXY_URL;
if (!base || !/^http:\/\/127\.0\.0\.1:\d+$/.test(base))
  throw new Error('Choose a verified loopback proxy.');
const nativeFetch = globalThis.fetch;
globalThis.fetch = (input, init) => nativeFetch(new URL(String(input), base), init);
const signal = AbortSignal.timeout(15 * 60_000);
const network = 'mainnet';
if (
  !(await backendNetworks(signal)).includes(network) ||
  !(await backendStatus(network, signal)).connected
)
  throw new Error('Matching connected network required.');
const cache = new Map<string, Transaction>();
let verifiedPrevouts = 0;
async function transaction(id: string): Promise<Transaction> {
  if (cache.has(id)) return cache.get(id)!;
  if (cache.size >= 1500) throw new Error('Capture exceeds transaction budget.');
  const tx = await fetchTransaction(network, id, signal);
  await fetchRawInspection(network, tx, signal);
  // Verify every consumed output independently against its creator's raw bytes.
  for (const input of tx.vin) {
    if (!input.txid || input.vout === undefined) continue;
    const parent = cache.get(input.txid) ?? (await fetchTransaction(network, input.txid, signal));
    await fetchRawInspection(network, parent, signal);
    const output = parent.vout.find((item) => item.n === input.vout);
    if (!output) throw new Error('Referenced output missing.');
    if (
      input.prevout &&
      (input.prevout.value !== output.value ||
        input.prevout.scriptPubKey.hex !== output.scriptPubKey.hex)
    )
      throw new Error('Conflicting previous output.');
    input.prevout = { value: output.value, scriptPubKey: output.scriptPubKey };
    verifiedPrevouts++;
  }
  cache.set(id, tx);
  return tx;
}
async function source(id: string) {
  return JSON.parse(await readFile(`src/App/Examples/templateData/${id}.json`, 'utf8'));
}
async function save(id: string, roots: string[], ids: Set<string>, extra = {}) {
  const snapshot = {
    workspaceVersion: 8,
    network,
    retrievedAt: new Date().toISOString(),
    roots,
    transactions: Object.fromEntries([...ids].map((id) => [id, cache.get(id)!])),
    ...extra,
  };
  await writeFile(`src/App/Examples/templateData/${id}.json`, JSON.stringify(snapshot) + '\n');
  console.log(JSON.stringify({ example: id, transactions: ids.size, verifiedPrevouts }));
}
if (!process.argv.includes('--paths-only')) {
  const walletSource = await source('mainnet-public-wallet');
  const wallet = walletSource.wallet as Omit<Wallet, 'id'>;
  const walletIds = new Set<string>();
  const addressUtxos: Record<string, AddressUtxoObservation> = {};
  for (const address of wallet.addresses) {
    const history = await fetchHistory(network, address.scripthash, signal);
    if (history.length > 500) throw new Error('Address exceeds capture budget.');
    address.history = history;
    for (const entry of history) walletIds.add(entry.tx_hash);
    addressUtxos[address.address] = await fetchAddressUtxos(network, address.address, signal);
    for (const output of addressUtxos[address.address].utxos) walletIds.add(output.txid);
  }
  for (const id of walletIds) await transaction(id);
  wallet.scannedAt = new Date().toISOString();
  wallet.scanComplete = false;
  wallet.pendingTransactionIds = [];
  delete wallet.refreshedAt;
  delete wallet.lastActivity;
  await save('demo-public-wallet', walletSource.roots, walletIds, { wallet, addressUtxos });
}
const pathSource = await source('mainnet-large-value-path');
const start = pathSource.roots[0] as string;
const pathIds = new Set<string>([start]);
await transaction(start);
// Follow the two largest funding branches backwards. Their saved descendants
// meet at the published split; its later spends may be outside this capture.
let frontier = [start];
for (let depth = 0; depth < 3; depth++) {
  const next: string[] = [];
  for (const id of frontier) {
    const tx = await transaction(id);
    const inputs = tx.vin
      .filter((input) => input.txid)
      .sort((a, b) => (b.prevout?.value ?? 0) - (a.prevout?.value ?? 0))
      .slice(0, depth === 0 ? 2 : 1);
    for (const input of inputs) {
      await transaction(input.txid!);
      if (!pathIds.has(input.txid!)) next.push(input.txid!);
      pathIds.add(input.txid!);
    }
  }
  frontier = next;
}
if (pathIds.size < 5) throw new Error('Branching path is incomplete.');
await save('demo-branching-path', [frontier[0]], pathIds);
const equal = await source('mainnet-equal-outputs');
const equalIds = new Set<string>();
for (const id of equal.roots as string[]) {
  await transaction(id);
  equalIds.add(id);
}
await save('demo-equal-outputs', equal.roots, equalIds);
console.log(
  JSON.stringify({
    verifiedTransactions: cache.size,
    verifiedPrevouts,
    capturedAt: new Date().toISOString(),
  }),
);
