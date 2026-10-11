// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createWorkspace } from '../../../../../Core/Workspace/createWorkspace';
import { WalletReviewFlow } from './WalletReviewFlow';
import type { WalletReviewContext } from '../walletReviewContext';
import { transactions, TX_FUNDING, TX_SPENDING } from '../../../../../../tests/fixtures/bitcoin';

let stacked = false;
let outputScroll = 0;
let transactionHeight = 180;
let resizeCallbacks: ResizeObserverCallback[];
const disconnect = vi.fn();
const unobserve = vi.fn();

function rect(x: number, y: number, width: number, height: number): DOMRect {
  return {
    x,
    y,
    left: x,
    top: y,
    right: x + width,
    bottom: y + height,
    width,
    height,
    toJSON: () => ({}),
  };
}

function bounds(element: Element) {
  if (
    element.classList.contains('wallet-flow-columns') ||
    element.classList.contains('wallet-flow-connections')
  )
    return rect(30, 40, stacked ? 400 : 900, stacked ? 1000 : 520);
  if (element.classList.contains('wallet-flow-transaction-node'))
    return stacked
      ? rect(130, 450, 200, transactionHeight)
      : rect(380, 140, 200, transactionHeight);
  const input = element.closest('[data-flow-side]')?.getAttribute('data-flow-side') === 'input';
  if (element.classList.contains('wallet-flow-entries'))
    return stacked ? rect(30, input ? 80 : 700, 400, 300) : rect(input ? 30 : 680, 80, 250, 300);
  if (element.hasAttribute('data-flow-entry')) {
    const index = Number(element.getAttribute('data-flow-entry'));
    if (stacked) return rect(30 + (index % 2) * 200, input ? 100 : 720, 190, 100);
    return input
      ? rect(30, 100 + index * 150, 250, index === 0 ? 100 : 130)
      : rect(680, 90 + index * 130 - outputScroll, 250, 80 + index * 40);
  }
  return rect(0, 0, 0, 0);
}

beforeEach(() => {
  stacked = false;
  outputScroll = 0;
  transactionHeight = 180;
  resizeCallbacks = [];
  disconnect.mockClear();
  unobserve.mockClear();
  vi.useFakeTimers();
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) =>
    window.setTimeout(() => callback(0), 16),
  );
  vi.stubGlobal('cancelAnimationFrame', (id: number) => window.clearTimeout(id));
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: ResizeObserverCallback) {
        resizeCallbacks.push(callback);
      }
      observe() {}
      unobserve = unobserve;
      disconnect = disconnect;
    },
  );
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
    this: HTMLElement,
  ) {
    return bounds(this);
  });
  vi.spyOn(SVGElement.prototype, 'getBoundingClientRect').mockImplementation(function (
    this: SVGElement,
  ) {
    return bounds(this);
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function fixture(outputCount = 2) {
  const workspace = createWorkspace('Synthetic wallet connector fixture', 'mainnet');
  workspace.chainData.transactions = structuredClone(transactions);
  const context: WalletReviewContext = {
    transactionId: TX_SPENDING,
    transactionNodeId: `tx:${TX_SPENDING}`,
    transaction: workspace.chainData.transactions[TX_SPENDING],
    transactionSelected: true,
    status: 'loaded',
    missingPrevouts: 1,
    role: 'wallet-related-transaction',
    currentOutputs: [],
    inputs: [0, 1].map((index) => ({
      id: `out:${TX_FUNDING}:${index}`,
      ownership: 'unknown' as const,
      selected: false,
      missing: true,
    })),
    outputs: Array.from({ length: outputCount }, (_, index) => ({
      id: `out:${TX_SPENDING}:${index}`,
      ownership: index === 0 ? ('wallet' as const) : ('external' as const),
      selected: false,
      missing: false,
      valueSats: 1000,
    })),
  };
  return { workspace, context, walletName: 'Synthetic wallet', onShowInGraph: vi.fn() };
}

async function draw() {
  await act(async () => {
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(32);
  });
}

function curves(container: HTMLElement) {
  return [...container.querySelectorAll<SVGPathElement>('[data-flow-curve]')];
}

it('draws on first mount from real card edges and ends the stroke at the arrow base', async () => {
  const { container } = render(<WalletReviewFlow {...fixture()} />);
  await draw();
  expect(curves(container).map((path) => path.getAttribute('d'))).toEqual([
    'M 250 110 C 295 110, 295 190, 340 190',
    'M 250 275 C 295 275, 295 190, 340 190',
    'M 550 190 C 595 190, 595 90, 640 90',
    'M 550 190 C 595 190, 595 240, 640 240',
  ]);
  const marker = container.querySelector('marker')!;
  expect(marker.getAttribute('refX')).toBe('0');
  expect(marker.getAttribute('markerWidth')).toBe('8');
  expect(container.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
  expect(screen.getAllByText('Unknown')).toHaveLength(2);
  expect(screen.getByText('1 inputs need details')).toBeTruthy();
});

it('paints the edited input last with its own highlighted arrow, without coloring wallet ownership', async () => {
  const props = fixture();
  const { container } = render(
    <WalletReviewFlow {...props} editedNodeId={`out:${TX_FUNDING}:0`} />,
  );
  await draw();
  expect(curves(container).at(-1)?.dataset.flowCurve).toBe('input:0');
  expect(curves(container).at(-1)?.classList.contains('is-selected')).toBe(true);
  expect(curves(container).at(-1)?.getAttribute('marker-end')).toContain('-selected)');
  expect(
    curves(container)
      .find((path) => path.dataset.flowCurve === 'output:0')
      ?.classList.contains('is-selected'),
  ).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: `Show input ${TX_FUNDING}:0 on graph` }));
  expect(props.onShowInGraph).toHaveBeenCalledWith(`out:${TX_FUNDING}:0`);
});

it('keeps visible paths mounted while scrolling, omits clipped cards and follows resize in the paint frame', async () => {
  const { container } = render(<WalletReviewFlow {...fixture()} />);
  await draw();
  const output = curves(container).find((path) => path.dataset.flowCurve === 'output:1')!;
  outputScroll = 150;
  fireEvent.scroll(container.querySelector('[data-flow-side="output"] .wallet-flow-entries')!);
  await draw();
  expect(curves(container)).toHaveLength(3);
  expect(curves(container).at(-1)).toBe(output);
  expect(output.getAttribute('d')).toBe('M 550 190 C 595 190, 595 90, 640 90');
  transactionHeight = 220;
  act(() => resizeCallbacks[0]([], {} as ResizeObserver));
  await draw();
  expect(output.getAttribute('d')).toBe('M 550 210 C 595 210, 595 90, 640 90');
});

it('uses vertical arrow-base geometry when the existing responsive layout stacks', async () => {
  const { container } = render(<WalletReviewFlow {...fixture()} />);
  await draw();
  stacked = true;
  fireEvent(window, new Event('resize'));
  await draw();
  expect(curves(container)[0].getAttribute('d')).toBe('M 95 160 C 95 280, 200 280, 200 400');
  expect(curves(container)[2].getAttribute('d')).toBe('M 200 590 C 200 630, 95 630, 95 670');
});

it('updates paging and annotation sizes without an observer loop, and cleans up pending work', async () => {
  const props = fixture(5);
  const { container, rerender, unmount } = render(<WalletReviewFlow {...props} />);
  await draw();
  expect(curves(container)).toHaveLength(4);
  fireEvent.click(screen.getByRole('button', { name: 'Expand outputs' }));
  await draw();
  expect(container.querySelectorAll('[data-flow-side="output"] [data-flow-entry]')).toHaveLength(5);
  expect(curves(container)).toHaveLength(5);
  transactionHeight = 220;
  props.workspace.annotations.entities[`tx:${TX_SPENDING}`] = {
    label: 'Updated synthetic annotation',
    note: '',
    icon: '',
    bookmarked: false,
  };
  rerender(<WalletReviewFlow {...props} />);
  await draw();
  expect(curves(container)[0].getAttribute('d')).toContain('340 210');
  // SVG writes are excluded from the mutation observer, so an idle flow schedules nothing.
  expect(vi.getTimerCount()).toBe(0);
  const columns = container.querySelector('.wallet-flow-columns')!;
  const remove = vi.spyOn(columns, 'removeEventListener');
  const request = vi.spyOn(window, 'requestAnimationFrame');
  const cancel = vi.spyOn(window, 'cancelAnimationFrame');
  fireEvent.scroll(columns);
  const pending = request.mock.results.at(-1)!.value;
  unmount();
  expect(cancel).toHaveBeenCalledWith(pending);
  expect(disconnect).toHaveBeenCalledOnce();
  expect(remove).toHaveBeenCalledWith('scroll', expect.any(Function), true);
});
