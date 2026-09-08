import type { Page } from '@playwright/test';
import type { Network } from '../../src/domain/types';

// The key and three addresses are public BIP84 test vectors (CC0):
// https://github.com/bitcoin/bips/blob/master/bip-0084.mediawiki
// Transaction records below are synthetic, not on-chain claims.
export const PUBLIC_ZPUB =
  'zpub6rFR7y4Q2AijBEqTUquhVz398htDFrtymD9xYYfG1m4wAcvPhXNfE3EfH1r1ADqtfSdVCToUG868RvUUkgDKf31mGDtKsAYz2oz2AGutZYs';
export const RECEIVE_ADDRESS = 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu';
export const SECOND_ADDRESS = 'bc1qnjg0jd8228aq7egyzacy8cys3knf9xvrerkf9g';
export const CHANGE_ADDRESS = 'bc1q8c6fshw2dlwun7ekn9qwf37cu2rn755upcp6el';
export const TX_FUNDING = 'a'.repeat(64),
  TX_SPENDING = 'b'.repeat(64);
const addresses = [
  {
    address: RECEIVE_ADDRESS,
    hash: '6e4f16236139f15046b38f399a683fb2aa8edf5fd128b3e5db017fb0ac74078a',
    hex: '0014c0cebcd6c3d3ca8c75dc5ec62ebe55330ef910e2',
  },
  {
    address: SECOND_ADDRESS,
    hash: 'acb101e9312975c11bd7adc75aa91fed37147214218b7dc0343e54b2e863a482',
    hex: '00149c90f934ea51fa0f6504177043e0908da6929983',
  },
  {
    address: CHANGE_ADDRESS,
    hash: '48d4bc4257d5177c6a44dfa0e3fd17916fc15b39b8a1cbb0aa297b059f826425',
    hex: '00143e34985dca6fddc9fb369940e4c7d8e2873f529c',
  },
];
const script = (index: number) => ({
  address: addresses[index].address,
  hex: addresses[index].hex,
  type: 'witness_v0_keyhash',
});
export const transactions = {
  [TX_FUNDING]: {
    txid: TX_FUNDING,
    vin: [{ coinbase: '00' }],
    vout: [
      { n: 0, value: 1, scriptPubKey: script(0) },
      { n: 1, value: 1, scriptPubKey: script(1) },
    ],
    confirmations: 101,
    vsize: 140,
  },
  [TX_SPENDING]: {
    txid: TX_SPENDING,
    vin: [
      { txid: TX_FUNDING, vout: 0 },
      { txid: TX_FUNDING, vout: 1 },
    ],
    vout: [
      { n: 0, value: 1.4999, scriptPubKey: script(0) },
      { n: 1, value: 0.5, scriptPubKey: script(2) },
    ],
    confirmations: 100,
    vsize: 208,
  },
};

export interface MockCall {
  network: Network;
  target: string;
  method: string;
  params: unknown[];
}
export interface MockNetworkOptions {
  networks?: Network[];
  connected?: boolean | Partial<Record<Network, boolean>>;
}

/** Discovery describes configuration independently from upstream availability. */
export async function mockNetworkDiscovery(page: Page, options: MockNetworkOptions = {}) {
  const networks = options.networks ?? ['mainnet', 'testnet4'];
  const statusCalls: Network[] = [];
  await page.route('**/api/networks', (route) => route.fulfill({ json: { networks } }));
  await page.route('**/api/status?*', (route) => {
    const network = new URL(route.request().url()).searchParams.get('network') as Network;
    if (!networks.includes(network))
      return route.fulfill({ status: 400, json: { error: 'Network is not configured.' } });
    statusCalls.push(network);
    const connected =
      typeof options.connected === 'object'
        ? (options.connected[network] ?? true)
        : (options.connected ?? true);
    return route.fulfill({
      json: {
        network,
        connected,
        ...(connected ? { height: network === 'mainnet' ? 900000 : 151500 } : {}),
      },
    });
  });
  return statusCalls;
}

/** Browser API interception keeps end-to-end tests isolated from real wallets/nodes. */
export async function mockBitcoin(
  page: Page,
  connectedOrOptions: boolean | MockNetworkOptions = true,
) {
  const options =
    typeof connectedOrOptions === 'boolean'
      ? { connected: connectedOrOptions }
      : connectedOrOptions;
  const networks = options.networks ?? ['mainnet', 'testnet4'];
  const calls: MockCall[] = [];
  await mockNetworkDiscovery(page, options);
  await page.route('**/api/rpc', async (route) => {
    const call = route.request().postDataJSON() as MockCall;
    calls.push(call);
    if (!networks.includes(call.network))
      return route.fulfill({
        status: 400,
        json: { error: 'RPC requests require a configured network.' },
      });
    let result: unknown;
    if (call.target === 'electrum' && call.method === 'blockchain.scripthash.get_history') {
      const found = addresses.findIndex((a) => a.hash === call.params[0]);
      result =
        found === 0 || found === 1
          ? [
              { tx_hash: TX_FUNDING, height: 899900 },
              { tx_hash: TX_SPENDING, height: 899901 },
            ]
          : found === 2
            ? [{ tx_hash: TX_SPENDING, height: 899901 }]
            : [];
    } else if (
      (call.target === 'core' && call.method === 'getrawtransaction') ||
      (call.target === 'electrum' && call.method === 'blockchain.transaction.get')
    ) {
      result = transactions[call.params[0] as keyof typeof transactions];
    }
    if (result === undefined)
      await route.fulfill({
        status: 400,
        json: { error: 'Unsupported synthetic fixture request' },
      });
    else await route.fulfill({ json: { result } });
  });
  return calls;
}
