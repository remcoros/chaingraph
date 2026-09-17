import { afterEach, describe, expect, it, vi } from 'vitest';
import { SafeError } from './errors';
import { logFailure } from './logging';

afterEach(() => vi.restoreAllMocks());

describe('backend failure logging', () => {
  it('writes the Node transport diagnostic with its responsible upstream', () => {
    const write = vi.spyOn(console, 'error').mockImplementation(() => {});
    const error = Object.assign(new Error('self signed certificate in certificate chain'), {
      code: 'SELF_SIGNED_CERT_IN_CHAIN',
    });

    logFailure({
      component: 'bitcoin-rpc',
      operation: 'getblockchaininfo',
      network: 'mainnet',
      error,
    });

    expect(JSON.parse(String(write.mock.calls[0][0]))).toEqual({
      level: 'error',
      event: 'backend_request_failed',
      component: 'bitcoin-rpc',
      operation: 'getblockchaininfo',
      network: 'mainnet',
      errorName: 'Error',
      errorMessage: 'self signed certificate in certificate chain',
      errorCode: 'SELF_SIGNED_CERT_IN_CHAIN',
    });
  });

  it('marks expected client errors as warnings', () => {
    const write = vi.spyOn(console, 'warn').mockImplementation(() => {});

    logFailure({
      component: 'http-api',
      operation: 'rpc',
      error: new SafeError('Invalid RPC request', 400),
    });

    expect(JSON.parse(String(write.mock.calls[0][0]))).toMatchObject({
      level: 'warn',
      component: 'http-api',
      errorMessage: 'Invalid RPC request',
      status: 400,
    });
  });
});
