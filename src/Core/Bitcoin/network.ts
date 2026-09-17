import { networks } from 'bitcoinjs-lib';
export type Network = 'mainnet' | 'testnet4';

/** Testnet4 shares Bitcoin testnet address and extended-key encodings. */
export function bitcoinNetwork(network: Network) {
  if (network !== 'mainnet' && network !== 'testnet4')
    throw new Error('Unsupported Bitcoin network.');
  // Testnet4 retains testnet address and extended-key encodings (BIP94).
  return network === 'mainnet' ? networks.bitcoin : networks.testnet;
}
