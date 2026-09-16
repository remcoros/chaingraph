import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Transaction } from '../../../../../Domain/Chain/transaction';
import { newWorkspace } from '../../../../../Domain/Workspace/workspace';
import { fetchTransaction } from '../../../../../Infra/Bitcoin/api';
import { loadScanActionEvidence } from './connectionScanActionEvidence';
import { TransactionFetchScope } from '../../../../../Infra/Bitcoin/transactionScheduler';

const id = (n: number) => n.toString(16).padStart(64, '0');
const transaction = (n: number): Transaction => ({
  txid: id(n),
  vin: [{ txid: id(n + 100), vout: 0 }],
  vout: [{ n: 0, value: 1, scriptPubKey: { hex: '51' } }],
});
const fixture = () => ({
  workspace: newWorkspace('Public scan action fixture', 'mainnet'),
  missingTxids: [id(1)],
  scope: new TransactionFetchScope('mainnet'),
  canLoadChainData: true,
  signal: new AbortController().signal,
});

afterEach(() => vi.useRealTimers());

describe('explicit scan action evidence', () => {
  it('reuses loaded and retained evidence offline without mutating the workspace', async () => {
    const options = fixture();
    options.workspace.transactions[id(1)] = transaction(1);
    options.workspace.connectionScans = { runs: [], evidence: { [id(2)]: transaction(2) } };
    options.missingTxids = [id(1), id(2), id(1)];
    options.canLoadChainData = false;
    const before = structuredClone(options.workspace);
    const fetch = vi.fn<typeof fetchTransaction>();
    expect(await loadScanActionEvidence(options, fetch)).toEqual({
      [id(1)]: transaction(1),
      [id(2)]: transaction(2),
    });
    expect(fetch).not.toHaveBeenCalled();
    expect(options.workspace).toEqual(before);
  });

  it('fetches only unique requested transactions with navigation priority and no ancestry walk', async () => {
    const options = fixture();
    options.missingTxids = [id(1), id(1), id(2)];
    const fetch = vi
      .fn<typeof fetchTransaction>()
      .mockImplementation(async (_network, txid) => transaction(Number.parseInt(txid, 16)));
    expect(await loadScanActionEvidence(options, fetch)).toEqual({
      [id(1)]: transaction(1),
      [id(2)]: transaction(2),
    });
    expect(fetch.mock.calls.map((call) => call[1])).toEqual([id(1), id(2)]);
    expect(fetch).toHaveBeenCalledWith('mainnet', id(1), expect.any(AbortSignal), undefined, {
      scope: options.scope,
      priority: 'navigation',
    });
    expect(options.workspace.transactions).toEqual({});
    expect(options.workspace.connectionScans).toBeUndefined();
  });

  it('allows the bounded union of both route proofs without fetching extra transactions', async () => {
    const options = fixture();
    options.missingTxids = Array.from({ length: 20 }, (_, i) => id(i + 1));
    const fetch = vi
      .fn<typeof fetchTransaction>()
      .mockImplementation(async (_network, txid) => transaction(Number.parseInt(txid, 16)));
    const evidence = await loadScanActionEvidence(options, fetch);
    expect(Object.keys(evidence)).toEqual(options.missingTxids);
    expect(fetch.mock.calls.map((call) => call[1])).toEqual(options.missingTxids);
  });

  it('rejects an oversized request or invalid IDs before any lookup', async () => {
    const options = fixture();
    const fetch = vi.fn<typeof fetchTransaction>();
    await expect(
      loadScanActionEvidence(
        { ...options, missingTxids: Array.from({ length: 21 }, (_, i) => id(i)) },
        fetch,
      ),
    ).rejects.toThrow('shorter path');
    await expect(
      loadScanActionEvidence({ ...options, missingTxids: ['tx:' + id(1)] }, fetch),
    ).rejects.toThrow('Invalid transaction ID');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('rejects network mismatch even when the requested transaction is cached', async () => {
    const options = fixture();
    options.workspace.transactions[id(1)] = transaction(1);
    const fetch = vi.fn<typeof fetchTransaction>();
    await expect(
      loadScanActionEvidence({ ...options, scope: new TransactionFetchScope('testnet4') }, fetch),
    ).rejects.toThrow('different Bitcoin network');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('rejects missing offline proof with actionable copy', async () => {
    const fetch = vi.fn<typeof fetchTransaction>();
    await expect(
      loadScanActionEvidence({ ...fixture(), canLoadChainData: false }, fetch),
    ).rejects.toThrow('Connect to the backend');
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each(['cached', 'fetched'])(
    'validates %s transaction identity before returning evidence',
    async (source) => {
      const options = fixture();
      if (source === 'cached') options.workspace.transactions[id(1)] = transaction(2);
      const fetch = vi.fn<typeof fetchTransaction>().mockResolvedValue(transaction(2));
      await expect(loadScanActionEvidence(options, fetch)).rejects.toThrow('could not be verified');
      expect(options.workspace.connectionScans).toBeUndefined();
    },
  );

  it('rejects an address from the other network in a fetched transaction', async () => {
    const value = transaction(1);
    value.vout[0].scriptPubKey.address = 'mipcBbFg9gMiCh81Kj8tqqdgoZub1ZJRfn';
    const fetch = vi.fn<typeof fetchTransaction>().mockResolvedValue(value);
    await expect(loadScanActionEvidence(fixture(), fetch)).rejects.toThrow('could not be verified');
  });

  it('does not surface raw upstream error messages', async () => {
    const fetch = vi
      .fn<typeof fetchTransaction>()
      .mockRejectedValue(new Error('private upstream response'));
    await expect(loadScanActionEvidence(fixture(), fetch)).rejects.toThrow(
      'Could not load transactions. Retry when the backend is available.',
    );
  });

  it.each(['cancel', 'scope'])(
    'settles on %s even when the transport ignores its signal',
    async (cause) => {
      const options = fixture();
      const controller = new AbortController();
      const fetch = vi
        .fn<typeof fetchTransaction>()
        .mockImplementation(() => new Promise(() => {}));
      const task = loadScanActionEvidence({ ...options, signal: controller.signal }, fetch);
      const rejected = expect(task).rejects.toMatchObject({ name: 'AbortError' });
      if (cause === 'scope') options.scope.close();
      else controller.abort(new Error('private abort reason'));
      await rejected;
      expect(fetch.mock.calls[0][2]!.aborted).toBe(true);
      expect(options.workspace.transactions).toEqual({});
    },
  );

  it('rejects a stale reply without requesting the remaining path', async () => {
    const options = fixture();
    let current = true;
    let resolve!: (value: Transaction) => void;
    const fetch = vi.fn<typeof fetchTransaction>().mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const task = loadScanActionEvidence(
      { ...options, missingTxids: [id(1), id(2)], isCurrent: () => current },
      fetch,
    );
    current = false;
    resolve(transaction(1));
    await expect(task).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('does not start lookups for an already closed or stale session', async () => {
    const options = fixture();
    const fetch = vi.fn<typeof fetchTransaction>();
    await expect(
      loadScanActionEvidence({ ...options, isCurrent: () => false }, fetch),
    ).rejects.toMatchObject({ name: 'AbortError' });
    options.scope.close();
    await expect(loadScanActionEvidence(options, fetch)).rejects.toMatchObject({
      name: 'AbortError',
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('bounds the whole action to 30 seconds and aborts its transport', async () => {
    vi.useFakeTimers();
    const options = fixture();
    const fetch = vi.fn<typeof fetchTransaction>().mockImplementation(() => new Promise(() => {}));
    const task = loadScanActionEvidence(options, fetch);
    const rejected = expect(task).rejects.toThrow('Loading transactions timed out. Retry.');
    await vi.advanceTimersByTimeAsync(30_000);
    await rejected;
    expect(fetch.mock.calls[0][2]!.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
});
