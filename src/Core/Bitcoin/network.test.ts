import { expect, it } from 'vitest';
import { networks } from 'bitcoinjs-lib';
import { bitcoinNetwork, type Network } from './network';

it('uses Bitcoin-native encodings while preserving the testnet4 network identity', () => {
  expect(bitcoinNetwork('mainnet')).toBe(networks.bitcoin);
  expect(bitcoinNetwork('testnet4')).toBe(networks.testnet);
  expect(() => bitcoinNetwork('unsupported' as Network)).toThrow('Unsupported Bitcoin network');
});
