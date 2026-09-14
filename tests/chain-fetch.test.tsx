// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderHook, act, cleanup } from '@testing-library/react';
import { useChainFetch } from '../src/App/Workspace/ChainData/useChainFetch';
import { newWorkspace } from '../src/Domain/Workspace/workspace';
import type { WorkspaceCore } from '../src/App/Workspace/workspaceCore';

afterEach(cleanup);

/** The parts of the core that running an operation touches. */
function core(workspace = newWorkspace('Fetch fixture', 'mainnet')) {
  const calls = { operation: [] as string[], error: [] as string[], notice: [] as string[] };
  const ref = { current: workspace };
  return {
    calls,
    core: {
      activeWorkspace: workspace,
      activeWorkspaceRef: ref,
      workspaces: { getUnlocked: () => undefined },
      setOperation: (value: string) => calls.operation.push(value),
      setError: (value: string) => calls.error.push(value),
      setNotice: (value: string) => calls.notice.push(value),
    } as unknown as WorkspaceCore,
  };
}

function setup() {
  const { core: workspaceCore, calls } = core();
  const operationRef = { current: undefined as AbortController | undefined };
  const view = renderHook(() =>
    useChainFetch({ core: workspaceCore, fetchScope: undefined, operationRef }),
  );
  return { view, calls, operationRef };
}

describe('useChainFetch', () => {
  it('reports an operation while it runs and clears it after', async () => {
    const { view, calls, operationRef } = setup();
    await act(() => view.result.current.run(async () => {}));
    expect(calls.operation).toEqual(['Working…', '']);
    expect(operationRef.current).toBeUndefined();
  });

  it('refuses a second operation while one is running', async () => {
    const { view, operationRef } = setup();
    const second = vi.fn();
    let release = () => {};
    const first = view.result.current.run(async () => {
      await new Promise<void>((resolve) => (release = resolve));
    });
    await act(() => view.result.current.run(second));
    expect(second).not.toHaveBeenCalled();
    release();
    await act(() => first);
    expect(operationRef.current).toBeUndefined();
  });

  it('reports why an operation failed', async () => {
    const { view, calls } = setup();
    await act(() =>
      view.result.current.run(async () => {
        throw new Error('Upstream unavailable.');
      }),
    );
    expect(calls.error).toContain('Upstream unavailable.');
  });

  it('says cancelled work kept what it had already gathered', async () => {
    const { view, calls, operationRef } = setup();
    await act(() =>
      view.result.current.run(async (signal) => {
        operationRef.current?.abort();
        signal.throwIfAborted();
      }),
    );
    expect(calls.notice.join(' ')).toMatch(/cancelled/i);
    expect(calls.error).toEqual(['']);
  });
});
