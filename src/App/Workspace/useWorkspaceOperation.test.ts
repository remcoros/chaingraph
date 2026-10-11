// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useWorkspaceOperation } from './useWorkspaceOperation';
import type { WorkspaceCore } from './workspaceCore';

afterEach(cleanup);
it('lets foreground work preempt automatic work, without making idle foreground controls busy', async () => {
  const setOperation = vi.fn();
  const core = {
    activeWorkspaceRef: { current: { id: 'public-fixture' } },
    setOperation,
    setError: vi.fn(),
    setNotice: vi.fn(),
  } as unknown as WorkspaceCore;
  const { result } = renderHook(() => useWorkspaceOperation(core));
  const events: string[] = [];
  let background!: Promise<void>;
  await act(async () => {
    background = result.current.run(
      async (signal) => {
        events.push('background');
        await new Promise<void>((resolve) =>
          signal.addEventListener(
            'abort',
            () => {
              events.push('yield');
              resolve();
            },
            { once: true },
          ),
        );
      },
      { background: true },
    );
  });
  expect(setOperation).not.toHaveBeenCalled();
  expect(result.current.isActive()).toBe(true);
  await act(async () => {
    await result.current.run(async () => {
      events.push('foreground');
    });
    await background;
  });
  expect(events).toEqual(['background', 'yield', 'foreground']);
  expect(result.current.isActive()).toBe(false);
  expect(setOperation).toHaveBeenLastCalledWith('');
});
