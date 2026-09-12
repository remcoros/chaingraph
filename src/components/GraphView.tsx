import { Amount } from './Amount';
import { TransactionBlockTime } from './TransactionBlockTime';
import {
  ArrowLeftFromLine,
  CheckSquare,
  Pencil,
  X,
  Expand,
  Plus,
  Minus,
  RotateCw,
  LoaderCircle,
  Pause,
  Play,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  short,
  type GraphLink,
  type GraphNode,
  type Transaction,
  type Workspace,
} from '../domain/types';
import { ResponsiveIdentifier } from './ResponsiveIdentifier';
import './graph.css';
import type { GraphFlowContext } from './graph/flowContext';
import { VisibilityActions, type VisibilityProps } from './VisibilityActions';
import {
  graphSnapshotSchema,
  mergeGraphSnapshot,
  type GraphSnapshot,
} from '../domain/graphSnapshot';
import type { GraphAdapter, GraphAdapterFactory } from './graph/adapter';
import { createDefaultAdapter } from './graph/defaultAdapter';
import {
  buildGraphPresentationIndex,
  readGraphPalette,
  resolveGraphHit,
  type NodePresentation,
} from './graph/presentation';
import { GraphPresentationUpdates } from './graph/presentationUpdates';

export interface GraphViewProps extends VisibilityProps {
  adapterFactory?: GraphAdapterFactory;
  /** Initial view for this mounted workspace. Own saves never reapply the camera. */
  snapshot?: GraphSnapshot;
  onSnapshot?: (snapshot: GraphSnapshot) => void;
  onActivity?: (active: boolean) => void;
  onRegisterSnapshotFlush?: (flush: (() => void) | undefined) => void;
  /** Shared React chrome. Toolbar content takes layout space above the canvas. */
  toolbar?: ReactNode | ((controls: { motionToggle?: ReactNode }) => ReactNode);
  /** Shared controls floating over the viewport, outside the renderer event surface. */
  navigation?: ReactNode;
  /** Filter/visibility context below every floating control group. */
  navigationStatus?: ReactNode;
  /** Contextual actions float along the right edge without remounting the renderer. */
  contextToolbar?: ReactNode;
  renderMetadata?: (nodeId: string) => ReactNode;
  legend?: ReactNode;
  nodePresentation?: ReadonlyMap<string, NodePresentation>;
  flowContext?: GraphFlowContext;
  nodes: GraphNode[];
  links: GraphLink[];
  selectedId?: string;
  onSelect: (id: string) => void;
  /** Shared multiple-selection state; the renderer stays free of selection logic. */
  selectionMode?: boolean;
  selectionPurpose?: 'batch' | 'scan-target';
  batchSelectedIds?: readonly string[];
  onToggleSelection?: (id: string) => void;
  dimensions: 2 | 3;
  sizeBy: 'uniform' | 'value' | 'degree';
  glow: boolean;
  showLabels?: boolean;
  showTags?: boolean;
  showIcons?: boolean;
  fitToken: number;
  focusRequest?: { id: string; token: number; preserveZoom?: boolean };
  transactions?: Record<string, Transaction>;
  workspace?: Pick<Workspace, 'network' | 'transactions'>;
  onTrace?: (id: string) => void;
  onEdit?: (id: string) => void;
  traceDisabledReason?: string;
  busy?: boolean;
  filtering?: boolean;
}

type HoverCard = { type: 'node'; id: string; x: number; y: number };

export default function GraphView(props: GraphViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const graphRef = useRef<GraphAdapter | null>(null);
  const current = useRef(props);
  // Every reader of `current.current` is an event handler or an imperative
  // renderer callback, so it always runs after commit. Publishing the latest
  // props from an effect instead of during render keeps the component safe
  // under concurrent rendering (a discarded render must not mutate a ref) and
  // lets React Compiler memoize this component instead of skipping it.
  // Declared before every other effect so same-commit effects still read the
  // current props.
  useEffect(() => {
    current.current = props;
  });
  const cardRef = useRef<HTMLElement>(null);
  const navigationRef = useRef<HTMLDivElement>(null);
  const contextToolbarRef = useRef<HTMLDivElement>(null);
  const resizeGraph = useRef<(() => void) | undefined>(undefined);
  const pointer = useRef({ x: 0, y: 0, touch: false });
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const cardEntered = useRef(false);
  const visibilityOpen = useRef(false);
  const openTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pendingNode = useRef<string | undefined>(undefined);
  const visibleNode = useRef<string | undefined>(undefined);
  const [hover, setHover] = useState<HoverCard>();
  const [error, setError] = useState(false);
  const [layout, setLayout] = useState<{ busy: boolean; nodeCount: number; error?: boolean }>({
    busy: false,
    nodeCount: 0,
  });
  const graphBusy = !!props.filtering || layout.busy;
  const [showBusyStatus, setShowBusyStatus] = useState(false);
  useEffect(() => {
    if (!graphBusy || error) {
      setShowBusyStatus(false);
      return;
    }
    const timer = setTimeout(() => setShowBusyStatus(true), 200);
    return () => clearTimeout(timer);
  }, [graphBusy, error]);
  const [rendererActions, setRendererActions] = useState({
    zoom: false,
    repack: false,
    motion: false,
  });
  const [motionEnabled, setMotionEnabled] = useState(true);
  const savedSnapshot = useRef(props.snapshot);
  const lastFitToken = useRef(props.fitToken);
  const immutableNodeSource = useRef<GraphSnapshot['nodes'] | undefined>(undefined);
  const snapshotSignatures = useRef<{ camera: string; nodes: string } | undefined>(undefined);
  // Lazy one-time ref initialisation. Written with an explicit guard rather than
  // `??=`, which React Compiler does not yet support and which made it skip this
  // whole component.
  if (snapshotSignatures.current === undefined) {
    snapshotSignatures.current = {
      camera: props.snapshot
        ? JSON.stringify([props.snapshot.dimensions, props.snapshot.camera])
        : '',
      nodes: props.snapshot ? JSON.stringify(props.snapshot.nodes) : '',
    };
  }

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
      if (
        !visibilityOpen.current &&
        !cardEntered.current &&
        !cardRef.current?.contains(document.activeElement)
      ) {
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
        visibilityOpen.current ||
        cardRef.current?.contains(document.activeElement))
    )
      return;
    keepCardOpen();
    visibleNode.current = id;
    const element = containerRef.current;
    if (!element) return;
    const { width, height } = element.getBoundingClientRect();
    const widthOfCard = Math.min(304, Math.max(0, width - 24));
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
      visibilityOpen.current ||
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
    setLayout({ busy: false, nodeCount: 0 });
    dismissCard();
    try {
      adapter = adapterFactory(element, {
        hover: ({ hit, point }) => {
          pointer.current = { x: point.x, y: point.y, touch: point.pointerType === 'touch' };
          if (hit?.type === 'node') requestCard(hit.id);
          else scheduleCardClose();
        },
        select: ({ hit, point }) => {
          if (!hit) {
            dismissCard();
            return;
          }
          const node = resolveGraphHit(hit, current.current.nodes, current.current.links);
          if (!node) return;
          const toggle = Boolean(point.modifiers?.ctrl || point.modifiers?.meta);
          if ((toggle || current.current.selectionMode) && current.current.onToggleSelection)
            current.current.onToggleSelection(node.id);
          else current.current.onSelect(node.id);
        },
        dismiss: () => dismissCard(),
        error: () => setError(true),
        recovered: () => setError(false),
        layout: (next) =>
          setLayout((previous) =>
            previous.busy === next.busy &&
            previous.nodeCount === next.nodeCount &&
            previous.error === next.error
              ? previous
              : next,
          ),
        activity: (active) => current.current.onActivity?.(active),
        snapshot: (next) => {
          if (!next || typeof next !== 'object') return;
          let merged: GraphSnapshot;
          let nodesSignature = snapshotSignatures.current!.nodes;
          // The default adapter freezes validated position records. Camera-only
          // changes can reuse the accepted geometry without allocating it again.
          if (
            next.version === 1 &&
            immutableNodeSource.current !== undefined &&
            next.nodes === immutableNodeSource.current &&
            savedSnapshot.current?.dimensions === next.dimensions
          ) {
            const camera = graphSnapshotSchema.shape.camera.safeParse(next.camera);
            if (!camera.success) return;
            merged = { ...savedSnapshot.current, camera: camera.data };
          } else {
            const parsed = graphSnapshotSchema.safeParse(next);
            if (!parsed.success) return;
            merged = mergeGraphSnapshot(savedSnapshot.current, parsed.data);
            nodesSignature = JSON.stringify(merged.nodes);
            immutableNodeSource.current =
              Object.isFrozen(next.nodes) && next.nodes.every(Object.isFrozen)
                ? next.nodes
                : undefined;
          }
          const cameraSignature = JSON.stringify([merged.dimensions, merged.camera]);
          if (
            cameraSignature === snapshotSignatures.current!.camera &&
            nodesSignature === snapshotSignatures.current!.nodes
          )
            return;
          savedSnapshot.current = merged;
          snapshotSignatures.current = { camera: cameraSignature, nodes: nodesSignature };
          current.current.onSnapshot?.(merged);
        },
      });
      if (savedSnapshot.current) adapter.restoreSnapshot?.(savedSnapshot.current);
      graphRef.current = adapter;
      setRendererActions({
        zoom: !!adapter.zoom,
        repack: !!adapter.repack,
        motion: !!adapter.setMotion,
      });
      current.current.onRegisterSnapshotFlush?.(
        adapter.flushSnapshot ? () => adapter?.flushSnapshot?.() : undefined,
      );
      adapter.canvas.tabIndex = 0;
      adapter.canvas.setAttribute(
        'aria-label',
        'Interactive transaction graph. Select an item using the entity list, then press Enter here for its details.',
      );
      adapter.canvas.addEventListener('keydown', onKeyDown);
      const resize = () => {
        const { width, height } = element.getBoundingClientRect();
        const navigation = navigationRef.current?.getBoundingClientRect();
        const topInset = navigation?.height
          ? Math.max(0, navigation.bottom - element.getBoundingClientRect().top + 8)
          : 0;
        const context = contextToolbarRef.current?.getBoundingClientRect();
        const rightInset = context?.width ? context.width + 24 : 0;
        element.parentElement?.style.setProperty('--graph-context-right-inset', `${rightInset}px`);
        adapter?.resize(width, height, topInset, rightInset);
      };
      resizeGraph.current = resize;
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
      resizeGraph.current = undefined;
      clearTimeout(closeTimer.current);
      cancelCardOpen();
      adapter?.canvas.removeEventListener('keydown', onKeyDown);
      adapter?.dispose();
      current.current.onRegisterSnapshotFlush?.(undefined);
      graphRef.current = null;
    };
  }, [adapterFactory]);

  useEffect(() => {
    graphRef.current?.setMotion?.(motionEnabled);
  }, [adapterFactory, motionEnabled]);

  const hasNavigation = Boolean(props.navigation);
  const hasContextToolbar = Boolean(props.contextToolbar);
  useEffect(() => {
    const navigation = navigationRef.current;
    resizeGraph.current?.();
    if (!navigation) return;
    const observer = new ResizeObserver(() => resizeGraph.current?.());
    observer.observe(navigation);
    if (contextToolbarRef.current) observer.observe(contextToolbarRef.current);
    return () => observer.disconnect();
  }, [hasNavigation, hasContextToolbar, adapterFactory]);

  const presentationIndex = useMemo(
    () => buildGraphPresentationIndex(props.nodes, props.links),
    [props.nodes, props.links],
  );
  const presentationUpdates = useMemo(() => new GraphPresentationUpdates(), [adapterFactory]);
  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const update = () => {
      const adapter = graphRef.current;
      if (adapter)
        presentationUpdates.update(adapter, props, readGraphPalette(element), presentationIndex);
    };
    update();
    // Accent changes affect canvas colors as well as CSS, without replacing the renderer.
    const observer = new MutationObserver(update);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-accent-theme'],
    });
    return () => observer.disconnect();
  }, [
    adapterFactory,
    presentationUpdates,
    presentationIndex,
    props.nodes,
    props.links,
    props.dimensions,
    props.selectedId,
    props.batchSelectedIds,
    props.sizeBy,
    props.glow,
    props.showLabels,
    props.showTags,
    props.showIcons,
    props.nodePresentation,
    props.flowContext,
  ]);

  useEffect(() => {
    if (props.fitToken === lastFitToken.current) return;
    lastFitToken.current = props.fitToken;
    graphRef.current?.fit();
  }, [adapterFactory, props.fitToken]);

  useEffect(() => {
    if (props.focusRequest)
      graphRef.current?.focus(props.focusRequest.id, {
        preserveZoom: props.focusRequest.preserveZoom,
      });
    else graphRef.current?.cancelFocus?.();
  }, [adapterFactory, props.focusRequest]);

  const hoveredNode = hover ? props.nodes.find((node) => node.id === hover.id) : undefined;
  const hoveredIdentifier = hoveredNode
    ? hoveredNode.kind === 'output' && hoveredNode.txid
      ? `${hoveredNode.txid}:${hoveredNode.vout}`
      : hoveredNode.txid || hoveredNode.address || hoveredNode.id
    : '';
  const hoveredPresentation = hoveredNode && props.nodePresentation?.get(hoveredNode.id);
  const hoveredRole = hoveredNode && props.flowContext?.nodes.get(hoveredNode.id);
  // Explicit annotation metadata distinguishes human labels, even hex-shaped ones,
  // from generated identifiers. Keep the legacy display-label fallback for callers
  // without that metadata, shortening only an exact raw/canonical reference.
  const hoveredLabel =
    hoveredPresentation?.label !== undefined
      ? [hoveredPresentation.icon, hoveredPresentation.label || short(hoveredIdentifier)]
          .filter(Boolean)
          .join(' ')
      : hoveredNode?.label === hoveredIdentifier || hoveredNode?.label === hoveredNode?.id
        ? short(hoveredIdentifier)
        : hoveredNode?.label;
  const hoveredLabelIsIdentifier =
    hoveredPresentation?.label !== undefined
      ? !hoveredPresentation.label
      : hoveredNode?.label === hoveredIdentifier || hoveredNode?.label === hoveredNode?.id;
  const transaction = hoveredNode?.txid ? props.transactions?.[hoveredNode.txid] : undefined;
  const missingCreatingTransaction =
    hoveredNode?.kind === 'output' &&
    Boolean(props.transactions && hoveredNode.txid && !transaction);
  const loadedSpenders = useMemo(() => {
    const counts = new Map<string, number>();
    for (const transaction of Object.values(props.transactions ?? {})) {
      const outpoints = new Set(
        transaction.vin.flatMap((input) =>
          input.txid !== undefined && input.vout !== undefined
            ? [`${input.txid}:${input.vout}`]
            : [],
        ),
      );
      for (const outpoint of outpoints) counts.set(outpoint, (counts.get(outpoint) ?? 0) + 1);
    }
    return counts;
  }, [props.transactions]);
  const loadedSpendingCount =
    hoveredNode?.kind === 'output'
      ? (loadedSpenders.get(`${hoveredNode.txid}:${hoveredNode.vout}`) ?? 0)
      : 0;
  const hasHoveredNode = hoveredNode !== undefined;
  const traceReason = props.busy
    ? 'Another operation is running.'
    : hoveredNode?.kind === 'output' && transaction
      ? undefined
      : props.traceDisabledReason;

  useEffect(() => {
    if (hover && !hasHoveredNode) dismissCard();
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
  }, [hover?.id, hover?.type, hasHoveredNode]);

  return (
    <div className="graph-view" data-testid="graph-view" onPointerLeave={scheduleCardClose}>
      {props.toolbar && (
        <div className="graph-shared-toolbar">
          {typeof props.toolbar === 'function'
            ? props.toolbar({
                motionToggle: rendererActions.motion ? (
                  <button
                    type="button"
                    className={`icon-button ${motionEnabled ? 'active' : ''}`}
                    aria-label="Motion"
                    aria-pressed={motionEnabled}
                    title={motionEnabled ? 'Pause motion' : 'Resume motion'}
                    onClick={() => setMotionEnabled((enabled) => !enabled)}
                  >
                    {motionEnabled ? (
                      <Pause size={16} aria-hidden="true" />
                    ) : (
                      <Play size={16} aria-hidden="true" />
                    )}
                  </button>
                ) : undefined,
              })
            : props.toolbar}
        </div>
      )}
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
              <span
                className={`graph-card-kind graph-card-kind-${hoveredNode.kind}`}
                title={
                  hoveredRole
                    ? `${hoveredRole === 'input' ? 'Input to' : 'Output from'} ${props.flowContext?.transactionId.slice(3)}`
                    : hoveredNode.kind
                }
              >
                {hoveredRole
                  ? `${hoveredRole === 'input' ? 'Input to' : 'Output from'} transaction`
                  : hoveredNode.kind}
              </span>
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
              title={`${hoveredLabel}\n${hoveredIdentifier}\nSelect this item in the transaction view and Inspector`}
              onClick={() => {
                props.onSelect(hoveredNode.id);
                dismissCard();
              }}
            >
              {hoveredLabelIsIdentifier ? (
                <>
                  {hoveredPresentation?.icon && `${hoveredPresentation.icon} `}
                  <ResponsiveIdentifier value={hoveredIdentifier} />
                </>
              ) : (
                hoveredLabel
              )}
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
                <dd className="graph-card-identifier" title={hoveredIdentifier}>
                  <ResponsiveIdentifier value={hoveredIdentifier} />
                </dd>
              </div>
              {hoveredNode.value !== undefined && (
                <div>
                  <dt>
                    {hoveredNode.kind === 'transaction'
                      ? 'Total outputs'
                      : hoveredNode.kind === 'address'
                        ? 'Balance'
                        : 'Output value'}
                  </dt>
                  <Amount as="dd" value={hoveredNode.value} />
                </div>
              )}
              {hoveredNode.address && hoveredNode.kind !== 'address' && (
                <div>
                  <dt>Address</dt>
                  <dd className="graph-card-identifier" title={hoveredNode.address}>
                    <ResponsiveIdentifier value={hoveredNode.address} />
                  </dd>
                </div>
              )}
              {transaction && hoveredNode.kind === 'transaction' && (
                <div>
                  <dt>Structure</dt>
                  <dd title="Inputs / outputs">
                    ({transaction.vin.length} / {transaction.vout.length})
                  </dd>
                </div>
              )}
              {transaction && (
                <div className="graph-card-block">
                  <dt>Block</dt>
                  <dd>
                    <TransactionBlockTime
                      transaction={transaction}
                      workspace={props.workspace}
                      showFee={hoveredNode.kind === 'transaction'}
                    />
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
            {missingCreatingTransaction && (
              <p className="graph-card-explanation graph-card-missing">
                Creating transaction is not loaded.
                {hoveredNode.value === undefined
                  ? ' Value and script details are unavailable.'
                  : ' Output details are attached to loaded spending evidence.'}
              </p>
            )}
            {hoveredNode.kind === 'output' && (
              <p className="graph-card-explanation">
                {loadedSpendingCount
                  ? `${loadedSpendingCount} spending transaction${loadedSpendingCount === 1 ? '' : 's'} loaded.`
                  : 'No spending transaction loaded.'}
              </p>
            )}
            {traceReason && props.onTrace && hoveredNode.kind !== 'address' && (
              <p className="graph-card-explanation">{traceReason}</p>
            )}
            <div className="graph-card-actions" role="group" aria-label="Graph item actions">
              {props.onTrace && hoveredNode.kind !== 'address' && (
                <button
                  type="button"
                  disabled={Boolean(traceReason)}
                  aria-label={
                    hoveredNode.kind === 'output'
                      ? 'Open creating transaction'
                      : 'Load previous level'
                  }
                  title={
                    traceReason ||
                    (hoveredNode.kind === 'output'
                      ? 'Open only the transaction that created this output'
                      : 'Load one previous level of funding transactions')
                  }
                  onClick={() => {
                    props.onTrace?.(hoveredNode.id);
                    dismissCard();
                  }}
                >
                  <ArrowLeftFromLine size={15} /> Trace
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
                  <Pencil size={15} /> Edit
                </button>
              )}
              <div
                className="graph-card-secondary-actions"
                role="group"
                aria-label="Visibility and selection"
              >
                <VisibilityActions
                  nodeId={hoveredNode.id}
                  transaction={
                    hoveredNode.kind === 'transaction'
                      ? props.transactions?.[hoveredNode.txid ?? '']
                      : undefined
                  }
                  hiddenNodeIds={props.hiddenNodeIds}
                  graphNodeIds={props.graphNodeIds}
                  onSetHidden={props.onSetHidden}
                  onOpenChange={(open) => {
                    visibilityOpen.current = open;
                    if (open) keepCardOpen();
                  }}
                />
                {props.onToggleSelection &&
                  (props.selectionPurpose !== 'scan-target' ||
                    /^(tx|out):/.test(hoveredNode.id)) && (
                    <button
                      type="button"
                      aria-label={`${props.batchSelectedIds?.includes(hoveredNode.id) ? 'Remove from' : 'Add to'} ${props.selectionPurpose === 'scan-target' ? 'scan targets' : 'batch selection'}`}
                      aria-pressed={props.batchSelectedIds?.includes(hoveredNode.id) ?? false}
                      title={
                        props.selectionPurpose === 'scan-target'
                          ? 'Add or remove this scan target'
                          : 'Add or remove this item in the batch selection'
                      }
                      onClick={() => props.onToggleSelection?.(hoveredNode.id)}
                    >
                      <CheckSquare size={15} />
                    </button>
                  )}
              </div>
            </div>
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
        <div className="graph-overlays">
          {(props.navigation || props.filtering || layout.busy || layout.error) && (
            <div
              ref={navigationRef}
              className="graph-navigation-overlay"
              onPointerEnter={() => dismissCard()}
              onFocusCapture={() => dismissCard()}
            >
              <div className="graph-navigation-shell" role="toolbar" aria-label="Graph navigation">
                <div className="graph-navigation-row">
                  {props.navigation}
                  <div
                    className="graph-camera-controls"
                    role="group"
                    aria-label="Graph camera and layout"
                  >
                    <button
                      aria-label="Fit graph"
                      title="Fit all visible nodes"
                      onClick={() => graphRef.current?.fit()}
                      disabled={!props.nodes.length}
                    >
                      <Expand size={14} />
                      <span>Fit</span>
                    </button>
                    {rendererActions.zoom && (
                      <>
                        <button
                          aria-label="Zoom out"
                          title="Zoom out"
                          onClick={() => graphRef.current?.zoom?.(1.25)}
                        >
                          <Minus size={14} />
                        </button>
                        <button
                          aria-label="Zoom in"
                          title="Zoom in"
                          onClick={() => graphRef.current?.zoom?.(0.8)}
                        >
                          <Plus size={14} />
                        </button>
                      </>
                    )}
                    {rendererActions.repack && (
                      <button
                        aria-label="Repack graph"
                        title="Repack visible nodes into a compact layout. This moves nodes and fits the view."
                        disabled={!props.nodes.length}
                        onClick={() => graphRef.current?.repack?.()}
                      >
                        <RotateCw size={14} />
                      </button>
                    )}
                  </div>
                </div>
                {props.navigationStatus && (
                  <div className="graph-navigation-status" role="status">
                    {props.navigationStatus}
                  </div>
                )}
                {!error && ((graphBusy && showBusyStatus) || (!graphBusy && layout.error)) && (
                  <div className="graph-layout-status" role={graphBusy ? 'status' : 'alert'}>
                    {props.filtering || layout.busy ? (
                      <>
                        <LoaderCircle size={15} className="spin" aria-hidden="true" />
                        <span>
                          {props.filtering
                            ? 'Updating graph…'
                            : `Arranging ${layout.nodeCount.toLocaleString()} nodes…`}
                        </span>
                      </>
                    ) : (
                      <>
                        <span>Could not arrange the graph.</span>
                        <button type="button" onClick={() => graphRef.current?.repack?.()}>
                          Retry
                        </button>
                      </>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
          {props.contextToolbar && (
            <div
              ref={contextToolbarRef}
              className="graph-context-overlay"
              onPointerEnter={() => dismissCard()}
              onFocusCapture={() => dismissCard()}
            >
              {props.contextToolbar}
            </div>
          )}
        </div>
        {props.legend}
      </div>
    </div>
  );
}
