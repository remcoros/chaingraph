import { describe, expect, it } from 'vitest';
import { TransactionFetchScope } from '../../../src/Core/ChainData/transactionScheduler';
import { createWorkspace } from '../../../src/Core/Workspace/createWorkspace';
import { createChainDataAcquisition } from '../../../src/Core/Workspace/Session/chainDataAcquisition';
import { traceSourceExists } from '../../../src/App/Workspace/GraphState/traceSource';
import type { Workspace } from '../../../src/Core/Workspace/workspace';

const txid = 'a'.repeat(64),
  child = 'b'.repeat(64);
function fixture() {
  const data = createWorkspace('Public acquisition fixture', 'mainnet');
  data.chainData.transactions = {
    [txid]: {
      txid,
      vin: [{ coinbase: '00' }],
      vout: [{ n: 0, value: 1, scriptPubKey: { hex: '51' } }],
    },
    [child]: { txid: child, vin: [{ txid, vout: 0 }], vout: [] },
  };
  const scope = new TransactionFetchScope('mainnet');
  let session = {
    data,
    fetchScope: scope,
    locking: false,
    edit: (update: (current: Workspace) => Workspace) => {
      if (!session.locking) session.data = update(session.data);
    },
  };
  const acquisition = createChainDataAcquisition({
    activeWorkspace: data,
    getUnlocked: () => session,
    fetchScope: scope,
  });
  return {
    data,
    scope,
    acquisition,
    current: () => session,
    reopen: () => {
      session = { ...session, fetchScope: new TransactionFetchScope('mainnet') };
    },
  };
}

describe('session-bound transaction acceptance', () => {
  it('suppresses obsolete interaction publication without discarding an accepted checkpoint', () => {
    const { data, acquisition, current } = fixture();
    let selectionGeneration = 0;
    const generation = selectionGeneration;
    const accepted = { ...data.chainData.transactions[txid], txid: 'c'.repeat(64) };
    const obsolete = { ...accepted, txid: 'd'.repeat(64) };
    const options = { accept: () => generation === selectionGeneration };
    expect(acquisition.observe.transactions(data.id, [accepted], options)).toBe(true);
    selectionGeneration++;
    expect(acquisition.observe.transactions(data.id, [obsolete], options)).toBe(false);
    expect(current().data.chainData.transactions[accepted.txid]).toBeDefined();
    expect(current().data.chainData.transactions[obsolete.txid]).toBeUndefined();
  });
  it('rejects results retained across lock/reopen of the same workspace ID, including empty batches', () => {
    const { scope, acquisition, reopen, data } = fixture();
    scope.close();
    reopen();
    expect(acquisition.observe.transactions(data.id, [data.chainData.transactions[txid]])).toBe(
      false,
    );
    expect(acquisition.observe.transactions(data.id, [])).toBe(false);
  });

  it('checks the captured transaction anchor inside publication when an output placeholder survives', () => {
    const { data, acquisition, current } = fixture();
    const result = data.chainData.transactions[txid];
    current().data = {
      ...data,
      chainData: {
        ...data.chainData,
        transactions: { [child]: data.chainData.transactions[child] },
      },
    };
    expect(traceSourceExists(current().data.chainData, `out:${txid}:0`)).toBe(true);
    for (const records of [[], [result]])
      expect(
        acquisition.observe.transactions(data.id, records, {
          accept: (workspace) => traceSourceExists(workspace.chainData, `tx:${txid}`),
        }),
      ).toBe(false);
    expect(current().data.chainData.transactions[txid]).toBeUndefined();
  });

  it('rejects a cached empty batch while the session is locking', () => {
    const { data, acquisition, current } = fixture();
    current().locking = true;
    expect(acquisition.observe.transactions(data.id, [])).toBe(false);
  });
});
