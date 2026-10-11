// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { RelativeTime } from './RelativeTime';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

it('updates recent ages and stops its clock when inactive or unmounted', () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2025-01-01T12:00:25Z'));
  const props = { dateTime: '2025-01-01T12:00:00Z', active: true };
  const view = render(<RelativeTime {...props} />);
  expect(view.container.textContent).toBe('25s ago');
  act(() => vi.advanceTimersByTime(1000));
  expect(view.container.textContent).toBe('26s ago');
  view.rerender(<RelativeTime {...props} active={false} />);
  expect(vi.getTimerCount()).toBe(0);
  view.rerender(<RelativeTime {...props} />);
  expect(vi.getTimerCount()).toBe(1);
  view.unmount();
  expect(vi.getTimerCount()).toBe(0);
});
