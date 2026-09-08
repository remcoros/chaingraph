import { ArrowLeftFromLine, Crosshair, Pencil, X } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { formatSats, type GraphLink, type GraphNode, type Transaction } from '../domain/types';
import './graph.css';
import {
  graphSnapshotSchema,
  mergeGraphSnapshot,
  type GraphSnapshot,
} from '../domain/graphSnapshot';
import type { GraphAdapter, GraphAdapterFactory } from './graph/adapter';
import { createDefaultAdapter } from './graph/defaultAdapter';
import {
  presentGraph,
  readGraphPalette,
  resolveGraphHit,
  type NodePresentation,
} from './graph/presentation';

export interface GraphViewProps {
  adapterFactory?: GraphAdapterFactory;
  /** Initial view for this mounted workspace. Own saves never reapply the camera. */
  snapshot?: GraphSnapshot;
  onSnapshot?: (snapshot: GraphSnapshot) => void;
  /** Shared React chrome. Toolbar content takes layout space above the canvas. */
  toolbar?: ReactNode;
  /** Shared controls floating over the viewport, outside the renderer event surface. */
  navigation?: ReactNode;
  renderMetadata?: (nodeId: string) => ReactNode;
  legend?: ReactNode;
  nodePresentation?: ReadonlyMap<string, NodePresentation>;
  nodes: GraphNode[];
  links: GraphLink[];
  selectedId?: string;
  onSelect: (id: string) => void;
  dimensions: 2 | 3;
  sizeBy: 'uniform' | 'value' | 'degree';
  glow: boolean;
  showLabels?: boolean;
  showTags?: boolean;
  showIcons?: boolean;
  fitToken: number;
  focusRequest?: { id: string; token: number };
  transactions?: Record<string, Transaction>;
  onTrace?: (id: string) => void;
  onEdit?: (id: string) => void;
  traceDisabledReason?: string;
  busy?: boolean;
}

type HoverCard = { type: 'node'; id: string; x: number; y: number };

export default function GraphView(props: GraphViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const graphRef = useRef<GraphAdapter | null>(null);
  const current = useRef(props);
  current.current = props;
  const cardRef = useRef<HTMLElement>(null);
  const pointer = useRef({ x: 0, y: 0, touch: false });
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const cardEntered = useRef(false);
  const openTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pendingNode = useRef<string | undefined>(undefined);
  const visibleNode = useRef<string | undefined>(undefined);
  const [hover, setHover] = useState<HoverCard>();
  const [error, setError] = useState(false);
  const savedSnapshot = useRef(props.snapshot);
  const lastFitToken = useRef(props.fitToken);
  const snapshotSignature = useRef(props.snapshot ? JSON.stringify(props.snapshot) : '');

  function keepCardOpen() {
    clearTimeout(closeTimer.current);
  }
  function cancelCardOpen() {
    clearTimeout(openTimer.current);
    pendingNode.current = undefined;
  }
  function scheduleCardClose() {
    cancelCardOpen();
    keepCardOpen();
    closeTimer.current = setTimeout(() => {
      if (!cardEntered.current && !cardRef.current?.contains(document.activeElement)) {
        visibleNode.current = undefined;
        setHover(undefined);
      }
    }, 450);
  }
  function showCard(type: HoverCard['type'], id: string, keyboard = false) {
    if (
      !keyboard &&
      (pointer.current.touch ||
        cardEntered.current ||
        cardRef.current?.contains(document.activeElement))
    )
      return;
    keepCardOpen();
    visibleNode.current = id;
    const element = containerRef.current;
    if (!element) return;
    const { width, height } = element.getBoundingClientRect();
    const widthOfCard = Math.min(304, Math.max(200, width - 24));
    const x = keyboard ? (width - widthOfCard) / 2 : pointer.current.x + 12;
    const y = keyboard ? 40 : pointer.current.y + 12;
    setHover((previous) =>
      !keyboard && previous?.type === type && previous.id === id
        ? previous
        : {
            type,
            id,
            x: Math.max(12, Math.min(x, width - widthOfCard - 12)),
            y: Math.max(12, Math.min(y, height - 280)),
          },
    );
    if (keyboard) requestAnimationFrame(() => cardRef.current?.focus());
  }
  function requestCard(id: string) {
    if (
      pointer.current.touch ||
      cardEntered.current ||
      cardRef.current?.contains(document.activeElement)
    )
      return;
    keepCardOpen();
    if (visibleNode.current === id || pendingNode.current === id) return;
    cancelCardOpen();
    pendingNode.current = id;
    openTimer.current = setTimeout(() => {
      pendingNode.current = undefined;
      showCard('node', id);
    }, 320);
  }
  function dismissCard(returnFocus = false) {
    cancelCardOpen();
    keepCardOpen();
    visibleNode.current = undefined;
    cardEntered.current = false;
    setHover(undefined);
    if (returnFocus) graphRef.current?.canvas.focus();
  }

  const adapterFactory = props.adapterFactory ?? createDefaultAdapter;
  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    let adapter: GraphAdapter | undefined;
    let observer: ResizeObserver | undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') dismissCard();
      if ((event.key === 'Enter' || event.key === ' ') && current.current.selectedId) {
        event.preventDefault();
        showCard('node', current.current.selectedId, true);
      }
    };
    setError(false);
    dismissCard();
    try {
      adapter = adapterFactory(element, {
        hover: ({ hit, point }) => {
          pointer.current = { x: point.x, y: point.y, touch: point.pointerType === 'touch' };
          if (hit?.type === 'node') requestCard(hit.id);
          else scheduleCardClose();
        },
        select: ({ hit }) => {
          if (!hit) {
            dismissCard();
            return;
          }
          const node = resolveGraphHit(hit, current.current.nodes, current.current.links);
          if (node) current.current.onSelect(node.id);
        },
        dismiss: () => dismissCard(),
        error: () => setError(true),
        recovered: () => setError(false),
        snapshot: (next) => {
          const parsed = graphSnapshotSchema.safeParse(next);
          if (!parsed.success) return;
          const merged = mergeGraphSnapshot(savedSnapshot.current, parsed.data);
          const signature = JSON.stringify(merged);
          if (signature === snapshotSignature.current) return;
          savedSnapshot.current = merged;
          snapshotSignature.current = signature;
          current.current.onSnapshot?.(merged);
        },
      });
      if (savedSnapshot.current) adapter.restoreSnapshot?.(savedSnapshot.current);
      graphRef.current = adapter;
      adapter.canvas.tabIndex = 0;
      adapter.canvas.setAttribute(
        'aria-label',
        'Interactive transaction graph. Select an item using the entity list, then press Enter here for its details.',
      );
      adapter.canvas.addEventListener('keydown', onKeyDown);
      const resize = () => {
        const { width, height } = element.getBoundingClientRect();
        adapter?.resize(width, height);
      };
      resize();
      observer = new ResizeObserver(resize);
      observer.observe(element);
    } catch {
      adapter?.dispose();
      graphRef.current = null;
      setError(true);
    }
    return () => {
      observer?.disconnect();
      clearTimeout(closeTimer.current);
      cancelCardOpen();
      adapter?.canvas.removeEventListener('keydown', onKeyDown);
      adapter?.dispose();
      graphRef.current = null;
    };
  }, [adapterFactory]);

  useEffect(() => {
    if (containerRef.current)
      graphRef.current?.update(presentGraph(props, readGraphPalette(containerRef.current)));
  }, [
    adapterFactory,
    props.nodes,
    props.links,
    props.dimensions,
    props.selectedId,
    props.sizeBy,
    props.glow,
    props.showLabels,
    props.showTags,
    props.showIcons,
    props.nodePresentation,
  ]);

  useEffect(() => {
    if (props.fitToken === lastFitToken.current) return;
    lastFitToken.current = props.fitToken;
    graphRef.current?.fit();
  }, [adapterFactory, props.fitToken]);

  useEffect(() => {
    if (props.focusRequest) graphRef.current?.focus(props.focusRequest.id);
  }, [adapterFactory, props.focusRequest, props.dimensions]);

  const hoveredNode = hover ? props.nodes.find((node) => node.id === hover.id) : undefined;
  const transaction = hoveredNode?.txid ? props.transactions?.[hoveredNode.txid] : undefined;
  const missingFunding =
    hoveredNode?.kind === 'output' &&
    (hoveredNode.value === undefined ||
      Boolean(props.transactions && hoveredNode.txid && !transaction));
  const loadedSpendingCount =
    hoveredNode?.kind === 'output'
      ? Object.values(props.transactions ?? {}).reduce(
          (count, transaction) =>
            count +
            Number(
              transaction.vin.some(
                (input) => input.txid === hoveredNode.txid && input.vout === hoveredNode.vout,
              ),
            ),
          0,
        )
      : 0;
  const traceReason = props.busy ? 'Another operation is running.' : props.traceDisabledReason;

  useEffect(() => {
    if (hover && !hoveredNode) dismissCard();
    const card = cardRef.current;
    const container = containerRef.current;
    if (!card || !container) return;
    const clamp = () => {
      const bounds = container.getBoundingClientRect();
      const size = card.getBoundingClientRect();
      setHover((previous) => {
        if (!previous) return previous;
        const x = Math.max(12, Math.min(previous.x, bounds.width - size.width - 12));
        const y = Math.max(12, Math.min(previous.y, bounds.height - size.height - 12));
        return x === previous.x && y === previous.y ? previous : { ...previous, x, y };
      });
    };
    clamp();
    const observer = new ResizeObserver(clamp);
    observer.observe(card);
    observer.observe(container);
    return () => observer.disconnect();
  }, [hover?.id, hover?.type, Boolean(hoveredNode)]);

  return (
    <div className="graph-view" data-testid="graph-view" onPointerLeave={scheduleCardClose}>
      {props.toolbar && <div className="graph-shared-toolbar">{props.toolbar}</div>}
      <div className="graph-viewport">
        <div ref={containerRef} className="graph-canvas" aria-hidden={error} />
        {!error && hover && hoveredNode && (
          <section
            ref={cardRef}
            className="graph-hover-card"
            role="dialog"
            aria-label="Graph item details"
            tabIndex={-1}
            style={{ left: hover.x, top: hover.y }}
            onPointerEnter={() => {
              cardEntered.current = true;
              keepCardOpen();
            }}
            onPointerLeave={() => {
              cardEntered.current = false;
              scheduleCardClose();
            }}
            onFocus={keepCardOpen}
            onBlur={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget)) scheduleCardClose();
            }}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.stopPropagation();
                dismissCard(true);
              }
            }}
          >
            <div className="graph-card-heading">
              <span className={`graph-card-kind graph-card-kind-${hoveredNode.kind}`}>
                {hoveredNode.kind}
              </span>
              <div className="graph-card-actions" role="group" aria-label="Graph item actions">
                <button
                  type="button"
                  aria-label="Select graph item"
                  title="Select in transaction view and Inspector"
                  onClick={() => {
                    props.onSelect(hoveredNode.id);
                    dismissCard();
                  }}
                >
                  <Crosshair size={15} />
                </button>
                {props.onTrace && hoveredNode.kind !== 'address' && (
                  <button
                    type="button"
                    disabled={Boolean(traceReason)}
                    aria-label="Load previous level"
                    title={traceReason || 'Load one previous level of funding transactions'}
                    onClick={() => {
                      props.onTrace?.(hoveredNode.id);
                      dismissCard();
                    }}
                  >
                    <ArrowLeftFromLine size={15} />
                  </button>
                )}
                {props.onEdit && (
                  <button
                    type="button"
                    aria-label="Edit label and notes"
                    title="Edit label, tags, icon and notes"
                    onClick={() => {
                      props.onEdit?.(hoveredNode.id);
                      dismissCard();
                    }}
                  >
                    <Pencil size={15} />
                  </button>
                )}
              </div>
              <button
                type="button"
                className="graph-card-close"
                aria-label="Close graph details"
                onClick={() => dismissCard(true)}
              >
                <X size={15} />
              </button>
            </div>
            <button
              type="button"
              className="graph-card-label"
              aria-label="Select this graph item"
              title="Select this item in the transaction view and Inspector"
              onClick={() => {
                props.onSelect(hoveredNode.id);
                dismissCard();
              }}
            >
              {hoveredNode.label}
            </button>
            {props.renderMetadata?.(hoveredNode.id)}
            <dl className="graph-card-facts">
              <div>
                <dt>
                  {hoveredNode.kind === 'transaction'
                    ? 'Transaction ID'
                    : hoveredNode.kind === 'output'
                      ? 'Outpoint'
                      : 'Address'}
                </dt>
                <dd
                  className="graph-card-identifier"
                  title={
                    hoveredNode.kind === 'output' && hoveredNode.txid
                      ? `${hoveredNode.txid}:${hoveredNode.vout}`
                      : hoveredNode.txid || hoveredNode.address || hoveredNode.id
                  }
                >
                  {hoveredNode.kind === 'output' && hoveredNode.txid
                    ? `${hoveredNode.txid}:${hoveredNode.vout}`
                    : hoveredNode.txid || hoveredNode.address || hoveredNode.id}
                </dd>
              </div>
              {hoveredNode.value !== undefined && (
                <div>
                  <dt>{hoveredNode.kind === 'transaction' ? 'Total outputs' : 'Output value'}</dt>
                  <dd>{formatSats(hoveredNode.value)}</dd>
                </div>
              )}
              {hoveredNode.address && hoveredNode.kind !== 'address' && (
                <div>
                  <dt>Address</dt>
                  <dd className="graph-card-identifier" title={hoveredNode.address}>
                    {hoveredNode.address}
                  </dd>
                </div>
              )}
              {transaction && hoveredNode.kind === 'transaction' && (
                <div>
                  <dt>Structure</dt>
                  <dd>
                    {transaction.vin.length} {transaction.vin.length === 1 ? 'input' : 'inputs'} ·{' '}
                    {transaction.vout.length} {transaction.vout.length === 1 ? 'output' : 'outputs'}
                  </dd>
                </div>
              )}
              {transaction?.confirmations !== undefined && (
                <div>
                  <dt>Saved confirmations</dt>
                  <dd>{transaction.confirmations.toLocaleString()}</dd>
                </div>
              )}
            </dl>
            {missingFunding && (
              <p className="graph-card-explanation graph-card-missing">
                Funding transaction is not loaded. Value and address may be unknown.
              </p>
            )}
            {hoveredNode.kind === 'output' && !missingFunding && (
              <p className="graph-card-explanation">
                {loadedSpendingCount
                  ? `${loadedSpendingCount} spending transaction${loadedSpendingCount === 1 ? '' : 's'} loaded.`
                  : 'No spending transaction loaded.'}
              </p>
            )}
            {traceReason && props.onTrace && hoveredNode.kind !== 'address' && (
              <p className="graph-card-explanation">{traceReason}</p>
            )}
          </section>
        )}
        {error && (
          <div className="graph-unavailable" role="status">
            <strong>The graph needs WebGL</strong>
            <p>
              Your workspace is still available. Use the entity list to inspect and select items, or
              reload with hardware acceleration enabled.
            </p>
          </div>
        )}
        {!error && !props.nodes.length && (
          <div className="graph-empty" aria-hidden="true">
            <span className="graph-empty-cross">+</span>
            <span>No visible graph nodes</span>
          </div>
        )}
        {props.navigation && (
          <div
            className="graph-navigation-overlay"
            onPointerEnter={() => dismissCard()}
            onFocusCapture={() => dismissCard()}
          >
            {props.navigation}
          </div>
        )}
        {props.legend}
      </div>
    </div>
  );
}
