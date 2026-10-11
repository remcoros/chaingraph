// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createWorkspace } from '../../../../../Core/Workspace/createWorkspace';
import {
  FlowPanelTransactionView,
  useFlowPanelTransaction,
  type FlowPanelTransactionViewProps,
} from './FlowPanelTransactionView';
import { FlowPanelShell } from './FlowPanelShell';
import { TX_FUNDING, TX_SPENDING, transactions } from '../../../../../../tests/fixtures/bitcoin';

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

let scroll = 0;
let horizontalScroll = 0;
let panelWidth = 920;
let transactionHeight = 160;
let inputHeight = 60;
let rowPositions = new Map<string, DOMRect>();
let observers: {
  callback: ResizeObserverCallback;
  observed: Set<Element>;
  disconnect: () => void;
}[];

function bounds(element: Element): DOMRect {
  const classes = element.classList;
  if (classes.contains('flow-panel')) return rect(40, 20, panelWidth, 420);
  if (element.tagName === 'SUMMARY') return rect(40, 20, panelWidth, 38);
  if (classes.contains('transaction-flow-connections')) return rect(50, 60, panelWidth, 382);
  if (classes.contains('transaction-flow'))
    return rect(50 - horizontalScroll, 60 - scroll, 900, 480);
  if (classes.contains('flow-panel-identity'))
    return rect(400 - horizontalScroll, 100, 200, transactionHeight);
  if (classes.contains('transaction-flow-center'))
    return rect(400 - horizontalScroll, 60, 200, transactionHeight + 40);
  const inputs = !!element.closest('.transaction-flow-inputs');
  const laneX = (inputs ? 50 : 700) - horizontalScroll;
  if (classes.contains('transaction-lane-context'))
    return rect(laneX, Math.max(65 - scroll, 58), 250, 60);
  if (classes.contains('transaction-rows')) return rect(laneX, 140 - scroll, 250, 400);
  if (element.hasAttribute('data-flow-row')) {
    const index = Number(element.getAttribute('data-flow-row'));
    const override = rowPositions.get(`${inputs ? 'input' : 'output'}:${index}`);
    if (override) return override;
    const y = (inputs ? 150 + index * 80 : 140 + index * 110) - scroll;
    // Model the browser's sticky result, not a row-index-derived connector endpoint.
    const pinnedTop = Number.parseFloat(
      element
        .closest('section')!
        .getAttribute('style')
        ?.match(/--transaction-selected-top: ([\d.]+)/)?.[1] ?? '122',
    );
    return rect(
      laneX,
      classes.contains('is-pinned') ? Math.max(y, 20 + pinnedTop) : y,
      250,
      inputs ? (index === 0 ? inputHeight : 100) : 70 + index * 20,
    );
  }
  return rect(laneX, 60 - scroll, 250, 480);
}

beforeEach(() => {
  scroll = 0;
  horizontalScroll = 0;
  panelWidth = 920;
  transactionHeight = 160;
  inputHeight = 60;
  rowPositions = new Map();
  observers = [];
  vi.useFakeTimers();
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) =>
    window.setTimeout(() => callback(0), 16),
  );
  vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id));
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observed = new Set<Element>();
      disconnect = vi.fn(() => this.observed.clear());
      constructor(callback: ResizeObserverCallback) {
        observers.push({ callback, observed: this.observed, disconnect: this.disconnect });
      }
      observe(element: Element) {
        this.observed.add(element);
      }
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
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(function (
    this: HTMLElement,
  ) {
    return bounds(this).height;
  });
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function (
    this: HTMLElement,
  ) {
    return bounds(this).width;
  });
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (
    this: HTMLElement,
  ) {
    return this.classList.contains('flow-panel-actions') ? 0 : bounds(this).height;
  });
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(function (
    this: HTMLElement,
  ) {
    return bounds(this).width;
  });
  vi.spyOn(HTMLElement.prototype, 'offsetLeft', 'get').mockImplementation(function (
    this: HTMLElement,
  ) {
    return this.classList.contains('transaction-flow-outputs') ? 650 : 0;
  });
  const getComputedStyle = window.getComputedStyle.bind(window);
  vi.spyOn(window, 'getComputedStyle').mockImplementation((element) => {
    const style = getComputedStyle(element);
    return new Proxy(style, {
      get(target, property) {
        if (property === 'marginTop' && element.classList.contains('transaction-flow-center'))
          return '0px';
        const value = Reflect.get(target, property, target);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
  });
  HTMLElement.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function fixture(outputCount = 2): FlowPanelTransactionViewProps {
  const workspace = createWorkspace('Synthetic connector fixture', 'mainnet');
  workspace.chainData.transactions = structuredClone(transactions);
  const tx = workspace.chainData.transactions[TX_SPENDING];
  tx.vout = Array.from({ length: outputCount }, (_, n) => ({ ...tx.vout[n % 2], n }));
  return {
    workspace,
    selected: { id: `tx:${TX_SPENDING}`, kind: 'transaction', txid: TX_SPENDING, label: '' },
    onSelect: vi.fn(),
    onEdit: vi.fn(),
    onApplyTags: vi.fn(),
    onSetIcon: vi.fn(),
    onTrace: vi.fn(),
    onSmallAmountThresholdChange: vi.fn(),
  };
}

function Harness({ panel, open = true }: { panel: FlowPanelTransactionViewProps; open?: boolean }) {
  const transaction = useFlowPanelTransaction(panel);
  return (
    <FlowPanelShell open={open} fullHeight={false} onHeight={vi.fn()} header="Transaction">
      <FlowPanelTransactionView panel={panel} transaction={transaction} />
    </FlowPanelShell>
  );
}

async function draw() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(16);
  });
}

function curves(container: HTMLElement) {
  return [...container.querySelectorAll<SVGPathElement>('[data-flow-curve]')];
}

function resize() {
  act(() => {
    for (const observer of observers)
      if (observer.observed.size) observer.callback([], {} as ResizeObserver);
  });
}

it('uses facing card edges and actual unequal row centers relative to the SVG origin', async () => {
  const { container } = render(<Harness panel={fixture()} />);
  await draw();
  expect(curves(container).map((path) => path.getAttribute('d'))).toEqual([
    'M 250 120 C 295 120, 295 120, 340 120',
    'M 250 220 C 295 220, 295 120, 340 120',
    'M 550 120 C 595 120, 595 115, 640 115',
    'M 550 120 C 595 120, 595 235, 640 235',
  ]);
  const svg = container.querySelector('.transaction-flow-connections')!;
  expect(svg.getAttribute('aria-hidden')).toBe('true');
  expect(svg.getAttribute('focusable')).toBe('false');
  expect(curves(container).every((path) => path.getAttribute('stroke-width') === '1.5')).toBe(true);
  expect(container.querySelector('clipPath rect')?.getAttribute('height')).toBe('374');
});

it('omits clipped rows and clamps partial rows below sticky headings and above the panel bottom', async () => {
  const { container } = render(<Harness panel={fixture(4)} />);
  await draw();
  scroll = 120;
  fireEvent.scroll(container.querySelector('.flow-panel')!);
  await draw();
  expect(curves(container).map((path) => path.getAttribute('data-flow-curve'))).toEqual([
    'input:1',
    'output:1',
    'output:2',
    'output:3',
  ]);
  expect(curves(container)[0].getAttribute('d')).toBe('M 250 100 C 295 100, 295 120, 340 120');
  expect(curves(container).at(-1)?.getAttribute('d')).toBe('M 550 120 C 595 120, 595 355, 640 355');
  rowPositions.set('output:1', rect(700, 90, 250, 50));
  rowPositions.set('output:3', rect(700, 410, 250, 90));
  fireEvent.scroll(container.querySelector('.transaction-rows')!);
  await draw();
  expect(
    curves(container)
      .find((p) => p.dataset.flowCurve === 'output:1')
      ?.getAttribute('d'),
  ).toBe('M 550 120 C 595 120, 595 61, 640 61');
  expect(curves(container).at(-1)?.getAttribute('d')).toBe('M 550 120 C 595 120, 595 369, 640 369');
  rowPositions.set('output:3', rect(700, 426, 250, 90));
  fireEvent.scroll(container.querySelector('.flow-panel')!);
  await draw();
  expect(curves(container).at(-1)?.getAttribute('opacity')).toBe('0.5');
});

it('connects a pinned selection at its sticky position and omits rows hidden behind it', async () => {
  const panel = fixture(4);
  panel.selected = {
    id: `out:${TX_SPENDING}:1`,
    kind: 'output',
    txid: TX_SPENDING,
    vout: 1,
    label: '',
  };
  panel.state = { transactionId: TX_SPENDING };
  const { container } = render(<Harness panel={panel} />);
  await draw();
  scroll = 200;
  rowPositions.set('output:2', rect(700, 100, 250, 100));
  fireEvent.scroll(container.querySelector('.flow-panel')!);
  await draw();
  const selected = curves(container).find((path) => path.classList.contains('is-selected'))!;
  expect(selected.dataset.flowCurve).toBe('output:1');
  expect(selected.getAttribute('d')).toBe('M 550 120 C 595 120, 595 107, 640 107');
  expect(curves(container).some((path) => path.dataset.flowCurve === 'output:0')).toBe(false);
  expect(curves(container).some((path) => path.dataset.flowCurve === 'output:2')).toBe(false);
  expect(
    curves(container)
      .find((path) => path.dataset.flowCurve === 'output:3')
      ?.getAttribute('d'),
  ).toBe('M 550 120 C 595 120, 595 275, 640 275');
  expect(HTMLElement.prototype.scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' });
});

it('batches resize and scroll measurements, follows annotation sizing, and clips horizontal overflow', async () => {
  const panel = fixture();
  const { container, rerender } = render(<Harness panel={panel} />);
  await draw();
  const observed = observers.at(-1)!.observed;
  expect(observed.has(container.querySelector('.flow-panel-identity')!)).toBe(true);
  expect(
    [...container.querySelectorAll('.transaction-row')].every((row) => observed.has(row)),
  ).toBe(true);
  transactionHeight = 240;
  inputHeight = 100;
  resize();
  resize();
  fireEvent(window, new Event('resize'));
  expect(curves(container)[0].getAttribute('d')).toContain('M 250 120');
  await draw();
  expect(curves(container)[0].getAttribute('d')).toBe('M 250 140 C 295 140, 295 160, 340 160');
  panel.workspace = {
    ...panel.workspace,
    annotations: {
      ...panel.workspace.annotations,
      entities: {
        [`out:${TX_FUNDING}:0`]: {
          label: 'Long synthetic annotation',
          note: '',
          icon: '',
          bookmarked: false,
        },
      },
    },
  };
  inputHeight = 120;
  rerender(<Harness panel={panel} />);
  await draw();
  expect(curves(container)[0].getAttribute('d')).toContain('M 250 150');
  panelWidth = 550;
  resize();
  await draw();
  expect(curves(container).map((path) => path.dataset.flowCurve)).toEqual(['input:0', 'input:1']);
  horizontalScroll = 350;
  fireEvent.scroll(container.querySelector('.flow-panel')!);
  await draw();
  expect(curves(container).map((path) => path.dataset.flowCurve)).toEqual(['output:0', 'output:1']);
  expect(container.querySelector('clipPath rect')?.getAttribute('x')).toBe('-10');
});

it('measures only displayed rows after expansion and filtering, including a selected filtered row', async () => {
  const panel = fixture(30);
  const { container, rerender } = render(<Harness panel={panel} />);
  await draw();
  expect(container.querySelectorAll('.transaction-flow-outputs .transaction-row')).toHaveLength(25);
  fireEvent.click(screen.getByRole('button', { name: 'Show all 30 outputs' }));
  await draw();
  expect(container.querySelectorAll('.transaction-flow-outputs .transaction-row')).toHaveLength(30);
  rowPositions.set('output:29', rect(700, 380, 250, 40));
  resize();
  await draw();
  expect(curves(container).at(-1)?.dataset.flowCurve).toBe('output:29');
  panel.workspace = {
    ...panel.workspace,
    view: { ...panel.workspace.view, flowAmountThreshold: 100000000 },
  };
  panel.selected = {
    id: `out:${TX_SPENDING}:29`,
    kind: 'output',
    txid: TX_SPENDING,
    vout: 29,
    label: '',
  };
  rowPositions.set('output:29', rect(700, 140, 250, 40));
  rerender(<Harness panel={panel} />);
  await draw();
  expect(container.querySelectorAll('.transaction-flow-outputs .transaction-row')).toHaveLength(16);
  expect(curves(container).some((path) => path.dataset.flowCurve === 'output:29')).toBe(true);
  expect(screen.getByText('Selected · outside filter')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: /14 amounts filtered from outputs/ }));
  expect(panel.onSmallAmountThresholdChange).toHaveBeenCalledWith(0);
});

it('recalculates on opening and loaded input data, retains keyboard, annotation and navigation actions', async () => {
  const panel = fixture();
  const loaded = panel.workspace.chainData.transactions[TX_FUNDING];
  delete panel.workspace.chainData.transactions[TX_FUNDING];
  const { container, rerender } = render(<Harness panel={panel} open={false} />);
  await draw();
  expect(curves(container)).toHaveLength(0);
  rerender(<Harness panel={panel} />);
  fireEvent(container.querySelector('.flow-panel')!, new Event('toggle'));
  await draw();
  expect(curves(container)).toHaveLength(4);
  expect(screen.getAllByText('Select to load previous output')).toHaveLength(2);
  fireEvent.keyDown(screen.getByRole('button', { name: /^Input 0:/ }), { key: 'Enter' });
  expect(panel.onSelect).toHaveBeenCalledWith(`out:${TX_FUNDING}:0`);
  fireEvent.click(screen.getByRole('button', { name: 'Edit input 0 annotation' }));
  expect(panel.onEdit).toHaveBeenCalledWith(`out:${TX_FUNDING}:0`, undefined);
  panel.workspace = {
    ...panel.workspace,
    chainData: {
      ...panel.workspace.chainData,
      transactions: { ...panel.workspace.chainData.transactions, [TX_FUNDING]: loaded },
    },
  };
  inputHeight = 80;
  rerender(<Harness panel={panel} />);
  await draw();
  expect(curves(container)[0].getAttribute('d')).toContain('M 250 130');
  fireEvent.click(screen.getByRole('button', { name: 'Go to previous transaction for input 0' }));
  panel.selected = {
    id: `out:${TX_FUNDING}:0`,
    kind: 'output',
    txid: TX_FUNDING,
    vout: 0,
    label: '',
  };
  rerender(<Harness panel={panel} />);
  await draw();
  expect(container.querySelectorAll('.transaction-flow-inputs .transaction-row')).toHaveLength(1);
  expect(screen.getByText('Newly created coins')).toBeTruthy();
});

it('keeps marker IDs panel-local and cancels observers, listeners and pending frames on unmount', async () => {
  const panel = fixture();
  const first = render(<Harness panel={panel} />);
  const second = render(<Harness panel={panel} />);
  await draw();
  const ids = [...document.querySelectorAll('marker')].map((marker) => marker.id);
  expect(new Set(ids).size).toBe(4);
  const oldPanel = first.container.querySelector('.flow-panel')!;
  const removePanelListener = vi.spyOn(oldPanel, 'removeEventListener');
  const removeWindowListener = vi.spyOn(window, 'removeEventListener');
  const cancel = vi.spyOn(window, 'cancelAnimationFrame');
  const request = vi.spyOn(window, 'requestAnimationFrame');
  fireEvent.scroll(oldPanel);
  const pendingFrame = request.mock.results.at(-1)!.value;
  first.unmount();
  expect(cancel).toHaveBeenCalledWith(pendingFrame);
  expect(observers[0].disconnect).toHaveBeenCalledOnce();
  expect(removePanelListener).toHaveBeenCalledWith('scroll', expect.any(Function), true);
  expect(removePanelListener).toHaveBeenCalledWith('toggle', expect.any(Function));
  expect(removeWindowListener).toHaveBeenCalledWith('resize', expect.any(Function));
  fireEvent.scroll(oldPanel);
  await draw();
  expect(curves(second.container)).toHaveLength(4);
  second.unmount();
  expect(observers.every((observer) => observer.observed.size === 0)).toBe(true);
});

it('keeps the SVG outside the scrolling grid, updates existing paths in the paint frame and paints the selected input last', async () => {
  const panel = fixture();
  panel.selected = {
    id: `out:${TX_FUNDING}:0`,
    kind: 'output',
    txid: TX_FUNDING,
    vout: 0,
    label: '',
  };
  panel.state = { transactionId: TX_SPENDING };
  const { container } = render(<Harness panel={panel} />);
  await draw();
  const svg = container.querySelector('.transaction-flow-connections')!;
  expect(container.querySelector('.transaction-flow')!.contains(svg)).toBe(false);
  expect(svg.parentElement!.className).toBe('transaction-flow-connections-anchor');
  const selected = curves(container).at(-1)!;
  expect(selected.dataset.flowCurve).toBe('input:0');
  expect(selected.getAttribute('marker-end')).toContain('-selected)');
  const marker = container.querySelector('marker.is-selected')!;
  expect(marker.getAttribute('refX')).toBe('0');
  expect(marker.getAttribute('markerWidth')).toBe('8');
  scroll = 90;
  fireEvent.scroll(container.querySelector('.flow-panel')!);
  act(() => {
    vi.advanceTimersByTime(16);
    // The path is already painted before React has a chance to flush another commit.
    expect(curves(container).at(-1)).toBe(selected);
    expect(selected.getAttribute('d')).toBe('M 250 92 C 295 92, 295 120, 340 120');
  });
});
