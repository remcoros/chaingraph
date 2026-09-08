import { useEffect, useRef, useState, type ReactNode } from 'react';
import { formatSats, type GraphLink, type GraphNode, type Transaction } from '../domain/types';
import './graph.css';
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
  /** Shared React chrome. Toolbar content takes layout space above the canvas. */
  toolbar?: ReactNode;
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
  fitToken: number;
  focusRequest?: { id: string; token: number };
  transactions?: Record<string, Transaction>;
  onTrace?: (id: string) => void;
  onEdit?: (id: string) => void;
  traceDisabledReason?: string;
  busy?: boolean;
}

type HoverCard = { type: 'node' | 'link'; id: string; x: number; y: number };

export default function GraphView(props: GraphViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const graphRef = useRef<GraphAdapter | null>(null);
  const current = useRef(props);
  current.current = props;
  const cardRef = useRef<HTMLElement>(null);
  const pointer = useRef({ x: 0, y: 0, touch: false });
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const cardEntered = useRef(false);
  const [hover, setHover] = useState<HoverCard>();
  const [error, setError] = useState(false);

  function keepCardOpen() {
    clearTimeout(closeTimer.current);
  }
  function scheduleCardClose() {
    keepCardOpen();
    closeTimer.current = setTimeout(() => {
      if (!cardEntered.current && !cardRef.current?.contains(document.activeElement))
        setHover(undefined);
    }, 650);
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
    const element = containerRef.current;
    if (!element) return;
    const { width, height } = element.getBoundingClientRect();
    const widthOfCard = Math.min(320, Math.max(200, width - 24));
    const x = keyboard ? (width - widthOfCard) / 2 : pointer.current.x + 18;
    const y = keyboard ? 40 : pointer.current.y + 18;
    setHover((previous) =>
      !keyboard && previous?.type === type && previous.id === id
        ? previous
        : {
            type,
            id,
            x: Math.max(12, Math.min(x, width - widthOfCard - 12)),
            y: Math.max(12, Math.min(y, height - 320)),
          },
    );
    if (keyboard) requestAnimationFrame(() => cardRef.current?.focus());
  }
  function dismissCard(returnFocus = false) {
    keepCardOpen();
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
          if (hit) showCard(hit.type, hit.id);
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
      });
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
    props.nodePresentation,
  ]);

  useEffect(() => {
    if (props.fitToken) graphRef.current?.fit();
  }, [adapterFactory, props.fitToken]);

  useEffect(() => {
    if (props.focusRequest) graphRef.current?.focus(props.focusRequest.id);
  }, [adapterFactory, props.focusRequest, props.dimensions]);

  const hoveredLink =
    hover?.type === 'link' ? props.links.find((link) => link.id === hover.id) : undefined;
  const hoveredNode = hover ? resolveGraphHit(hover, props.nodes, props.links) : undefined;
  const linkedOutput = hoveredLink
    ? props.nodes.find(
        (node) =>
          node.kind === 'output' &&
          (node.id === hoveredLink.source || node.id === hoveredLink.target),
      )
    : undefined;
  const transaction = hoveredNode?.txid ? props.transactions?.[hoveredNode.txid] : undefined;
  const missingFunding =
    hoveredNode?.kind === 'output' &&
    (hoveredNode.value === undefined ||
      Boolean(props.transactions && hoveredNode.txid && !transaction));
  const cardTitle = hoveredLink
    ? { creates: 'Creates output', spends: 'Spends output', address: 'Address association' }[
        hoveredLink.kind
      ]
    : hoveredNode?.kind;
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
              <span>{cardTitle}</span>
              <button
                type="button"
                className="graph-card-close"
                aria-label="Close graph details"
                onClick={() => dismissCard(true)}
              >
                ×
              </button>
            </div>
            <button
              type="button"
              className="graph-card-label"
              aria-label="Select graph item"
              title="Select this item in the transaction view and Inspector"
              onClick={() => {
                props.onSelect(hoveredNode.id);
                dismissCard();
              }}
            >
              {hoveredNode.label}
            </button>
            {props.renderMetadata?.(hoveredNode.id)}
            {hoveredLink && (
              <p className="graph-card-explanation">
                {
                  {
                    creates: 'The transaction creates this output.',
                    spends: 'This output is consumed by the linked spending transaction.',
                    address:
                      'This output pays to the address. An address association does not establish common ownership.',
                  }[hoveredLink.kind]
                }
              </p>
            )}
            <dl className="graph-card-facts">
              <div>
                <dt>
                  {hoveredNode.kind === 'transaction'
                    ? 'Transaction ID'
                    : hoveredNode.kind === 'output'
                      ? 'Outpoint'
                      : 'Address'}
                </dt>
                <dd className="graph-card-identifier">
                  {hoveredNode.kind === 'output' && hoveredNode.txid
                    ? `${hoveredNode.txid}:${hoveredNode.vout}`
                    : hoveredNode.txid || hoveredNode.address || hoveredNode.id}
                </dd>
              </div>
              {hoveredLink?.kind === 'spends' && (
                <div>
                  <dt>Spending transaction</dt>
                  <dd className="graph-card-identifier">
                    {hoveredLink.target.replace(/^tx:/, '')}
                  </dd>
                </div>
              )}
              {hoveredLink?.kind === 'address' && linkedOutput && (
                <div>
                  <dt>Output</dt>
                  <dd className="graph-card-identifier">{linkedOutput.id.replace(/^out:/, '')}</dd>
                </div>
              )}
              {(hoveredNode.value !== undefined || linkedOutput?.value !== undefined) && (
                <div>
                  <dt>{hoveredNode.kind === 'transaction' ? 'Total outputs' : 'Output value'}</dt>
                  <dd>{formatSats(hoveredNode.value ?? linkedOutput?.value)}</dd>
                </div>
              )}
              {hoveredNode.address && hoveredNode.kind !== 'address' && (
                <div>
                  <dt>Address</dt>
                  <dd className="graph-card-identifier">{hoveredNode.address}</dd>
                </div>
              )}
              {transaction && hoveredNode.kind === 'transaction' && (
                <div>
                  <dt>Structure</dt>
                  <dd>
                    {transaction.vin.length} inputs · {transaction.vout.length} outputs
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
                An output node may already be spent. Inspect its spending links to investigate.
              </p>
            )}
            <div className="graph-card-actions">
              {props.onTrace && hoveredNode.kind !== 'address' && (
                <button
                  type="button"
                  disabled={Boolean(traceReason)}
                  title={traceReason || 'Load one previous level of funding transactions'}
                  onClick={() => {
                    props.onTrace?.(hoveredNode.id);
                    dismissCard();
                  }}
                >
                  Load previous level
                </button>
              )}
              {props.onEdit && (
                <button
                  type="button"
                  onClick={() => {
                    props.onEdit?.(hoveredNode.id);
                    dismissCard();
                  }}
                >
                  Edit label and notes
                </button>
              )}
            </div>
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
        {props.legend}
      </div>
    </div>
  );
}
