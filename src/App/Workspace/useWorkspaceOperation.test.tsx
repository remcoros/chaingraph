// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderHook, act, cleanup } from '@testing-library/react';
import { useWorkspaceOperation } from './useWorkspaceOperation';
import { createWorkspace } from './createWorkspace';
import type { WorkspaceCore } from './workspaceCore';

afterEach(cleanup);

/** The parts of the core that running an operation touches. */
function core(workspace = createWorkspace('Fetch fixture', 'mainnet')) {
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
  const view = renderHook(() => useWorkspaceOperation(workspaceCore));
  return { view, calls };
}

describe('useWorkspaceOperation', () => {
  it('reports an operation while it runs and clears it after', async () => {
    const { view, calls } = setup();
    await act(() => view.result.current.run(async () => {}));
    expect(calls.operation).toEqual(['Working…', '']);
    expect(view.result.current.isActive()).toBe(false);
  });

  it('refuses a second operation while one is running', async () => {
    const { view } = setup();
    const second = vi.fn();
    let release = () => {};
    const first = view.result.current.run(async () => {
      await new Promise<void>((resolve) => (release = resolve));
    });
    await act(() => view.result.current.run(second));
    expect(second).not.toHaveBeenCalled();
    release();
    await act(() => first);
    expect(view.result.current.isActive()).toBe(false);
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
    const { view, calls } = setup();
    await act(() =>
      view.result.current.run(async (signal) => {
        view.result.current.cancel(signal);
        signal.throwIfAborted();
      }),
    );
    expect(calls.notice.join(' ')).toMatch(/cancelled/i);
    expect(calls.error).toEqual(['']);
  });
});
