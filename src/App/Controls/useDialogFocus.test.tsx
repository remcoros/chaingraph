// @vitest-environment jsdom
import { cleanup, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useDialogFocus } from './useDialogFocus';

afterEach(cleanup);

it('closes only the topmost dialog when Escape is pressed', () => {
  const first = vi.fn();
  const second = vi.fn();
  renderHook(() => useDialogFocus(first));
  renderHook(() => useDialogFocus(second));

  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));

  expect(first).not.toHaveBeenCalled();
  expect(second).toHaveBeenCalledOnce();
});
