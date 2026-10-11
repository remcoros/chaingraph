import { Amount } from '../../../../Controls/Display/Amount';
import {
  memo,
  startTransition,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  ArrowLeftRight,
  Coins,
  ListChecks,
  Users,
  ArrowDownLeft,
  ArrowUpRight,
  MapPin,
  Filter,
  Network,
  Wallet as WalletIcon,
  LoaderCircle,
} from 'lucide-react';
import type { Wallet } from '../../../../../Core/Workspace/Wallets/wallets';
import type { Workspace } from '../../../../../Core/Workspace/workspace';

import type { WalletUtxoRecord } from '../../../../../Core/Workspace/Wallets/walletRecords';
import {
  applyReviewDecisions,
  isCompletedReview,
  REVIEW_SCOPES,
  spendGuidance,
  type ReviewScope,
  type WalletReviewItem,
} from '../../../../../Core/Workspace/Wallets/walletReview';
import {
  buildWalletRecordRows,
  buildWalletReviewRows,
  buildWalletRelationshipRows,
  matchesWalletStatus,
  walletSelectAll,
  walletRowWithContext,
  walletLinkedOutputRow,
  resolveWalletRow,
  type WalletRow,
  type WalletStatusFilter,
  type WalletTab,
} from '../walletRows';
import {
  matchesReviewCategories,
  walletReviewCategoryGroups,
  walletReviewCategoryScanState,
  type WalletReviewCategoryWorkspace,
} from './reviewCategories';
import type { AnalysisScan } from '../../../../../Core/Workspace/Analysis/analysisScan';
import { useRecordSelection } from '../useRecordSelection';
import type { WalletUtxoController } from '../../../Wallets/WalletUtxos';
import type { WalletWorkbenchContext } from '../walletWorkbenchContext';
import { useWalletCounterparties } from '../useWalletCounterparties';
import { useTransactionFetch } from '../../../TransactionFetchProvider';
import { WALLET_FLOW_INPUT_WAVE_LIMIT } from './walletFlowInputs';
import { BatchMetadataBar } from './BatchMetadataBar';
import {
  WalletCounterpartyList,
  WalletCounterpartyDetail,
  walletCounterpartyNames,
} from '../WalletCounterparties';
import { createCounterpartyLookup } from '../../../../../Core/Workspace/Counterparties/counterparties';
import { WalletOverview } from '../WalletOverview';
import { MultiSelectFilter } from '../../../../Controls/MultiSelectFilter';
import { WalletItemDetail } from './WalletItemDetail';
import { WalletDecisionButtons, type WalletDecisionAction } from './WalletReviewInteractions';
import { WalletRelatedSelection } from '../WalletRelatedSelection';
import { matchRelatedEntities } from '../walletRelatedSelection';
import { WalletRowAttention } from './WalletRowAttention';
import { WalletHelp } from '../../../../Controls/Display/WalletHelp';
import { TransactionTimestamp } from '../../../../Controls/Display/TransactionBlockTime';
import { walletRecordBlockObservation } from '../../../../../Core/Workspace/Wallets/walletRecordBlockObservation';
import { buildTagIndex } from '../../../Annotations/tagProjection';
import { ResponsiveIdentifier } from '../../../../Controls/Display/ResponsiveIdentifier';
import {
  WalletPreparationCache,
  type WalletPreparation,
} from '../../../../../Core/Workspace/Wallets/walletPreparation';
import '../wallet-workbench.css';

export interface WalletWorkbenchViewProps extends WalletWorkbenchContext {
  walletUtxos: WalletUtxoController;
  preparationCache?: WalletPreparationCache;
  sessionAnalysis?: AnalysisScan;
}

const TABS = [
  { id: 'transactions', label: 'Transactions', Icon: ArrowLeftRight },
  { id: 'utxos', label: 'Coins', Icon: Coins },
  { id: 'addresses', label: 'Addresses', Icon: MapPin },
  { id: 'counterparties', label: 'Counterparties', Icon: Users },
  { id: 'review', label: 'Review', Icon: ListChecks },
] as const;
const PAGE = 40;
const STATUS_LABELS = {
  open: 'To review',
  later: 'Review later',
  decided: 'Reviewed',
  all: 'All items',
} as const;
const SCOPE_LABELS: Record<ReviewScope, string> = {
  utxos: 'UTXOs',
  transactions: 'Transactions',
  addresses: 'Addresses',
  relationships: 'Related addresses',
  'previous-output-decisions': 'Prior output reviews',
};

function isOutstandingReview(item: WalletReviewItem): boolean {
  return !item.legacyOutputReview && !item.satisfied && (item.changed || item.status === 'open');
}

// Even programmatic events in a preview cannot reach workspace edits or network actions.
const noop = () => {};
const PREVIEW_ACTIONS = {
  walletUtxos: { loading: false, error: '', check: async () => {} },
  updateEvidence: noop,
  onSelectWallet: noop,
  onAddWallet: noop,
  onEditWallet: noop,
  onExchangeLabels: noop,
  onChange: noop,
  onRefresh: noop,
  onShowInGraph: noop,
  onIsolateInGraph: noop,
  onShowSelection: noop,
  onInspect: noop,
};

function buildWalletRows(
  workspace: Pick<Workspace, 'network'> & {
    chainData: Pick<Workspace['chainData'], 'transactions'>;
    wallets: Pick<Workspace['wallets'], 'reviews'>;
  },
  wallet: Pick<Wallet, 'id' | 'addresses'>,
  currentUtxos: readonly WalletUtxoRecord[],
  reviewItems: readonly WalletReviewItem[],
  relationships: ReturnType<WalletPreparationCache['prepare']>['relationships'],
  tab: WalletTab,
  groups: ReturnType<WalletPreparationCache['prepare']>['review']['groups'],
  preparedRecords: Pick<WalletPreparation, 'transactionRecords' | 'addressRecords'>,
): Record<WalletTab, WalletRow[]> {
  const records =
    tab === 'utxos' || tab === 'transactions' || tab === 'addresses' || tab === 'counterparties'
      ? buildWalletRecordRows(
          workspace,
          wallet,
          currentUtxos,
          reviewItems,
          tab === 'counterparties' ? 'transactions' : tab,
          preparedRecords,
        )
      : { utxos: [], transactions: [], addresses: [] };
  return {
    review: buildWalletReviewRows(workspace, wallet, currentUtxos, groups, preparedRecords),
    counterparties: [],
    ...records,
    ...(tab === 'sources' || tab === 'destinations'
      ? buildWalletRelationshipRows(workspace, relationships, reviewItems)
      : { sources: [], destinations: [] }),
  };
}

function buildWalletRowTagIndex(
  tags: Workspace['annotations']['tags'],
  rows: readonly WalletRow[],
) {
  return buildTagIndex(
    { annotations: { tags: tags } },
    {
      nodes: rows.map((row) => ({
        id: row.nodeId,
        kind: row.kind,
        address: row.address,
        label: '',
      })),
      links: [],
    },
  );
}

function walletCategoryScanState(
  findings: Workspace['analysis']['findings'],
  currentAnalysis: AnalysisScan | undefined,
) {
  return walletReviewCategoryScanState({ analysis: { findings: findings } }, currentAnalysis);
}

function walletCategoryGroups(
  workspace: WalletReviewCategoryWorkspace,
  items: readonly WalletReviewItem[],
) {
  return walletReviewCategoryGroups(workspace, items);
}

function matchesWalletCategory(
  item: WalletReviewItem,
  selectedTypes: readonly string[],
  workspace: WalletReviewCategoryWorkspace,
) {
  return matchesReviewCategories(item, selectedTypes, workspace);
}

export const WalletWorkbenchView = memo(
  function WalletWorkbenchView(props: WalletWorkbenchViewProps) {
    const previewWorkspace = props.tourPreview?.example ?? props.workspace;
    const previewWallet = props.tourPreview?.example?.wallets.definitions[0] ?? props.wallet;
    const walletIdentity = props.wallet ? `${props.workspace.id}:${props.wallet.id}` : undefined;
    const [mountedWallet, setMountedWallet] = useState<string>();
    const prepared =
      props.wallet &&
      props.preparationCache?.peek(props.workspace, props.wallet, props.walletUtxos.utxos);
    const nextMountedWallet =
      prepared || mountedWallet === walletIdentity ? walletIdentity : undefined;
    if (mountedWallet !== nextMountedWallet) setMountedWallet(nextMountedWallet);
    const retainWallet = nextMountedWallet !== undefined;
    useEffect(() => {
      if (!props.active || props.tourPreview || !walletIdentity || retainWallet) return;
      // Let the active tab and preparation message paint before building the review.
      // Keep the mounted review when leaving this workbench; cancel unopened reviews.
      let frame = requestAnimationFrame(() => {
        frame = requestAnimationFrame(() => {
          startTransition(() => setMountedWallet(walletIdentity));
        });
      });
      return () => cancelAnimationFrame(frame);
    }, [props.active, props.tourPreview, walletIdentity, retainWallet]);
    if (!props.wallet && !previewWallet)
      return (
        <section className="wallet-workbench" aria-label="Wallet review workbench">
          <div className="wallet-empty" data-tour="wallet-empty">
            <WalletIcon size={30} />
            <h1>Wallet review</h1>
            <p>
              Import a watch-only extended public key to review coins and their direct transaction
              relationships.
            </p>
            <button className="primary" onClick={props.onAddWallet} disabled={props.workspace.demo}>
              Add a wallet
            </button>
          </div>
        </section>
      );
    return (
      <>
        {!retainWallet && props.active && !props.tourPreview && props.wallet && (
          <section className="wallet-workbench is-preparing" aria-label="Wallet review workbench">
            <div className="wallet-preparing" role="status">
              <LoaderCircle size={16} className="spin" aria-hidden="true" />
              <span>Preparing wallet…</span>
            </div>
          </section>
        )}
        {retainWallet && props.wallet && (
          <WalletReviewPanel
            key={walletIdentity}
            {...props}
            tourPreview={undefined}
            hidden={!!props.tourPreview}
            wallet={props.wallet}
          />
        )}
        {props.tourPreview && previewWallet && (
          <WalletReviewPanel
            key={`tour:${previewWorkspace.id}:${previewWallet.id}:${props.tourPreview.tab}`}
            {...props}
            {...PREVIEW_ACTIONS}
            preparationCache={undefined}
            active={false}
            workspace={previewWorkspace}
            wallet={previewWallet}
            sessionAnalysis={props.tourPreview.example ? undefined : props.sessionAnalysis}
            canLoadChainData={props.tourPreview.example ? false : props.canLoadChainData}
            chainDataDisabledReason={
              props.tourPreview.example
                ? 'Public example · preview only'
                : props.chainDataDisabledReason
            }
          />
        )}
      </>
    );
  },
  (before, after) =>
    before.tourPreview === after.tourPreview &&
    !before.active &&
    !after.active &&
    before.workspace.id === after.workspace.id &&
    before.wallet?.id === after.wallet?.id,
);

export function WalletReviewPanel(
  props: WalletWorkbenchViewProps & { wallet: Wallet; hidden?: boolean },
) {
  const {
    workspace,
    wallet,
    active,
    busy,
    canLoadChainData,
    onChange,
    tourPreview,
    onPresentationChange,
  } = props;
  const [localPreparation] = useState(() => new WalletPreparationCache());
  const preparation = props.preparationCache ?? localPreparation;
  const saved = workspace.view.wallet?.[wallet.id];
  const [tab, setTab] = useState<WalletTab>(
    props.tourPreview?.tab ?? saved?.activeTab ?? saved?.browsing?.tab ?? 'transactions',
  );
  const initial = tab === 'review' ? saved?.review : saved?.browsing;
  const scrollRef = useRef<HTMLElement>(null);
  const [initialScroll] = useState(initial?.scrollTop ?? 0);
  const partyLookup = useMemo(
    () => createCounterpartyLookup({ counterparties: workspace.counterparties }),
    [workspace.counterparties],
  );
  const [status, setStatus] = useState<WalletStatusFilter>(
    saved?.review?.status ?? (props.tourPreview?.tab === 'sources' ? 'all' : 'open'),
  );
  const [selectedKey, setSelectedKey] = useState<string | undefined>(initial?.selectedKey);
  const selection = useRecordSelection();
  const [limit, setLimit] = useState(initial?.limit ?? PAGE);
  const [query, setQuery] = useState(initial?.query ?? '');
  const [labelFilter, setLabelFilter] = useState<string>(initial?.labelFilter ?? 'all');
  const [tagFilter, setTagFilter] = useState(initial?.tagFilter ?? 'all');
  const [typeIds, setTypeIds] = useState<string[] | undefined>(saved?.review?.typeIds);
  const [scopeFilter, setScopeFilter] = useState<'all' | ReviewScope>(
    saved?.review?.scopeFilter ?? 'all',
  );
  const [reviewOnly, setReviewOnly] = useState(saved?.browsing?.reviewOnly ?? false);
  const [exactReview, setExactReview] = useState<{
    nodeId: string;
    reference: string;
  }>();
  const [transactionScope, setTransactionScope] = useState<string[] | undefined>(
    saved?.browsing?.transactionIds,
  );
  const [focusedReviewKey, setFocusedReviewKey] = useState<string>();
  const [notice, setNotice] = useState('');
  const [detailTrail, setDetailTrail] = useState<{
    origin: string;
    scope: string;
    references: string[];
  }>();

  const detailRef = useRef<HTMLElement>(null);
  const navigationFocus = useRef<{ reference?: string } | undefined>(undefined);
  // The row this workbench settled on and the filters it was chosen under.
  // Recording it is what lets a row that a metadata edit pushed out of the
  // current filters stay on screen until the user navigates, changes filters,
  // or changes the selected record.
  const [shown, setShown] = useState<{
    row: WalletRow | undefined;
    scope: string | undefined;
    selectedKey: string | undefined;
  }>({ row: undefined, scope: undefined, selectedKey: undefined });
  const filterScopeFor = (reviewStatus: WalletStatusFilter) =>
    JSON.stringify([
      workspace.id,
      wallet.id,
      tab,
      query,
      labelFilter,
      tagFilter,
      reviewStatus,
      typeIds,
      scopeFilter,
      reviewOnly,
      exactReview?.nodeId,
      transactionScope,
    ]);
  const filterScope = filterScopeFor(status);
  const { utxos, loading: utxoLoading, error: utxoError } = props.walletUtxos;
  const {
    selectionIndex,
    walletAddresses,
    relationships,
    review,
    currentUtxos,
    invalidCount,
    transactionRecords,
    addressRecords,
  } = preparation.prepare(workspace, wallet, utxos);
  const counterpartyPreparation = useMemo(
    () => ({ prevouts: selectionIndex.prevouts, scripthashes: walletAddresses.scripthashes }),
    [selectionIndex.prevouts, walletAddresses.scripthashes],
  );
  const fetchTransaction = useTransactionFetch('background');
  const counterparties = useWalletCounterparties({
    workspace,
    wallet,
    groups: relationships,
    active: active && tab === 'sources',
    enabled: canLoadChainData && !busy,
    fetch: fetchTransaction,
    update: props.updateEvidence,
  });
  const counterpartyReady = active && tab === 'sources';
  const rowsByTab = useMemo(
    () =>
      buildWalletRows(
        {
          network: workspace.network,
          chainData: { transactions: workspace.chainData.transactions },
          wallets: { reviews: workspace.wallets.reviews },
        },
        { id: wallet.id, addresses: wallet.addresses },
        currentUtxos,
        review.items,
        relationships,
        tab,
        review.groups,
        { transactionRecords, addressRecords },
      ),
    [
      workspace.network,
      workspace.chainData.transactions,
      workspace.wallets.reviews,
      wallet.id,
      wallet.addresses,
      currentUtxos,
      review.items,
      review.groups,
      transactionRecords,
      addressRecords,
      relationships,
      tab,
    ],
  );
  const rows = useMemo(
    () =>
      tab === 'review' && exactReview
        ? buildWalletReviewRows(
            {
              network: workspace.network,
              chainData: { transactions: workspace.chainData.transactions },
              wallets: { reviews: workspace.wallets.reviews },
            },
            { id: wallet.id, addresses: wallet.addresses },
            currentUtxos,
            review.groups.map((group) => ({
              ...group,
              items: group.items.filter((item) => item.subjectIds.includes(exactReview.nodeId)),
            })),
            { transactionRecords, addressRecords },
          )
        : rowsByTab[tab],
    [
      tab,
      exactReview,
      rowsByTab,
      workspace.network,
      workspace.chainData.transactions,
      workspace.wallets.reviews,
      wallet.id,
      wallet.addresses,
      currentUtxos,
      review.groups,
      transactionRecords,
      addressRecords,
    ],
  );
  const rowTags = useMemo(
    () => buildWalletRowTagIndex(workspace.annotations.tags, rows),
    [workspace.annotations.tags, rows],
  );
  const search = query.trim().toLowerCase();
  const metadataFiltered = useMemo(
    () =>
      rows.filter((row) => {
        if (
          tab === 'transactions' &&
          transactionScope &&
          !transactionScope.includes(row.txid ?? '')
        )
          return false;
        const annotation = workspace.annotations.entities[row.nodeId];
        const tags = rowTags.get(row.nodeId) ?? [];
        if (
          search &&
          ![
            row.identifier,
            row.address,
            row.title,
            annotation?.label,
            annotation?.note,
            ...walletCounterpartyNames(workspace, row, partyLookup),
            ...tags.map((tag) => tag.name),
            ...row.contextTransactionIds,
          ].some((text) => text?.toLowerCase().includes(search))
        )
          return false;
        if (labelFilter === 'unlabeled' && annotation?.label?.trim()) return false;
        if (labelFilter === 'labeled' && !annotation?.label?.trim()) return false;
        if (tagFilter === 'untagged' && tags.length) return false;
        if (
          tagFilter !== 'all' &&
          tagFilter !== 'untagged' &&
          !tags.some((tag) => tag.id === tagFilter)
        )
          return false;
        return true;
      }),
    [rows, rowTags, workspace, partyLookup, search, labelFilter, tagFilter, tab, transactionScope],
  );
  const relationFiltered = metadataFiltered;
  const statusFiltered = useMemo(
    () =>
      tab === 'review'
        ? relationFiltered.filter((row) => matchesWalletStatus(row, status))
        : relationFiltered,
    [tab, relationFiltered, status],
  );
  const currentAnalysis = props.sessionAnalysis;
  const scanState = useMemo(
    () => walletCategoryScanState(workspace.analysis.findings, currentAnalysis),
    [workspace.analysis.findings, currentAnalysis],
  );
  const categoryGroups = useMemo(
    () =>
      tab !== 'review'
        ? []
        : walletCategoryGroups(
            {
              annotations: {
                entities: workspace.annotations.entities,
                tags: workspace.annotations.tags,
              },
              analysis: { findings: workspace.analysis.findings },
              wallets: { reviews: workspace.wallets.reviews },
            },
            statusFiltered.flatMap((row) => row.reviews),
          ).map((group) => ({
            ...group,
            options: group.options.map((category) => {
              const tool = scanState.tools.find((entry) => entry.id === category.algorithm);
              const note = !category.heuristic
                ? undefined
                : tool?.status === 'not-scanned'
                  ? 'Not analyzed'
                  : tool?.status === 'saved-findings'
                    ? 'Saved findings'
                    : tool?.status === 'skipped'
                      ? 'Skipped'
                      : tool?.status === 'error'
                        ? 'Analysis failed. Refresh to retry.'
                        : `Last scan: ${currentAnalysis?.scope.label ?? 'selection unavailable'}.`;
              return { ...category, note };
            }),
          })),
    [
      tab,
      workspace.annotations.entities,
      workspace.annotations.tags,
      workspace.analysis.findings,
      workspace.wallets.reviews,
      statusFiltered,
      scanState,
      currentAnalysis,
    ],
  );
  const categories = useMemo(
    () => categoryGroups.flatMap((group) => group.options),
    [categoryGroups],
  );
  const selectedTypes = useMemo(
    () => typeIds ?? categories.map((category) => category.id),
    [typeIds, categories],
  );
  const allTypes = categories.every((category) => selectedTypes.includes(category.id));
  const filteredRows = useMemo(() => {
    if (tab !== 'review')
      return reviewOnly
        ? statusFiltered.filter((row) => row.reviews.some(isOutstandingReview))
        : statusFiltered;
    return statusFiltered.filter(
      (row) =>
        (scopeFilter === 'all' ||
          row.reviews.some((item) =>
            (item.scopes ?? [item.scope]).includes(scopeFilter as ReviewScope),
          )) &&
        (allTypes ||
          row.reviews.some((item) =>
            matchesWalletCategory(item, selectedTypes, {
              annotations: {
                entities: workspace.annotations.entities,
                tags: workspace.annotations.tags,
              },
              analysis: { findings: workspace.analysis.findings },
              wallets: { reviews: workspace.wallets.reviews },
            }),
          )),
    );
  }, [
    tab,
    allTypes,
    reviewOnly,
    scopeFilter,
    statusFiltered,
    selectedTypes,
    workspace.annotations.entities,
    workspace.annotations.tags,
    workspace.analysis.findings,
    workspace.wallets.reviews,
  ]);
  const displayedRows = filteredRows.slice(0, limit);
  const initialReviewLoading =
    !props.tourPreview &&
    tab === 'review' &&
    filteredRows.length === 0 &&
    !selectedKey &&
    !shown.row &&
    canLoadChainData &&
    utxoLoading &&
    !utxos &&
    !utxoError;
  const retainedRow =
    shown.scope === filterScope && (!selectedKey || selectedKey === shown.row?.key)
      ? rows.find((row) => row.key === shown.row?.key)
      : undefined;
  const currentRow = initialReviewLoading
    ? undefined
    : (retainedRow ?? resolveWalletRow(filteredRows, selectedKey, shown.row));
  const selectedRow = useMemo(
    () =>
      currentRow
        ? walletRowWithContext(
            {
              network: workspace.network,
              chainData: { transactions: workspace.chainData.transactions },
            },
            currentRow,
            selectionIndex,
          )
        : undefined,
    [workspace.network, workspace.chainData.transactions, selectionIndex, currentRow],
  );
  const selectionKeys = useMemo(() => new Set(selection.ids), [selection.ids]);
  const rowKeys = useMemo(() => new Set(rows.map((row) => row.key)), [rows]);
  const filteredKeys = useMemo(() => new Set(filteredRows.map((row) => row.key)), [filteredRows]);
  const allSelection = useMemo(
    () => walletSelectAll(selection.ids, [...filteredKeys]),
    [selection.ids, filteredKeys],
  );
  const selectedRows = selection.ids.length ? rows.filter((row) => selectionKeys.has(row.key)) : [];
  const selectedIds = [...new Set(selectedRows.map((row) => row.nodeId))];
  const selectedKinds = new Map(selectedRows.map((row) => [row.nodeId, row.kind]));
  const selectionSummary = (['address', 'transaction', 'output'] as const)
    .flatMap((kind) => {
      const count = [...selectedKinds.values()].filter((value) => value === kind).length;
      const noun = kind === 'output' ? (tab === 'utxos' ? 'UTXO' : 'outpoint') : kind;
      return count ? [`${count} ${noun}${count === 1 ? '' : kind === 'address' ? 'es' : 's'}`] : [];
    })
    .join(' · ');
  const selectedReviews =
    tab === 'review'
      ? [
          ...new Map(
            selectedRows
              .flatMap((row) => row.reviews)
              .filter((item) => !item.legacyOutputReview)
              .map((item) => [item.key, item]),
          ).values(),
        ]
      : [];
  const hiddenSelected = selectedRows.filter((row) => !filteredKeys.has(row.key)).length;
  const missingSelected = selection.ids.filter((id) => !rowKeys.has(id)).length;
  const batching = selection.ids.length > 0;
  // Record what this render settled on. Doing it here rather than in an effect
  // keeps the row React renders and the row it remembers in step: an effect
  // records after the fact, so the next render reads commit history instead of
  // the value this one actually used. The recorded selection is the one this
  // render saw, so snapping it below re-runs this block once and then settles.
  if (
    !batching &&
    (shown.row !== currentRow || shown.scope !== filterScope || shown.selectedKey !== selectedKey)
  ) {
    if (
      currentRow &&
      ((selectedKey && selectedKey !== currentRow.key) ||
        (shown.row?.kind === 'output' &&
          !shown.row.address &&
          currentRow.kind === 'address' &&
          currentRow.outpointIds?.includes(shown.row.nodeId) &&
          (!selectedKey || selectedKey === shown.row.key)))
    )
      setSelectedKey(currentRow.key);
    setShown({ row: currentRow, scope: filterScope, selectedKey });
  }
  const tabLabel =
    TABS.find((item) => item.id === tab)?.label ?? (tab === 'sources' ? 'Sources' : 'Destinations');
  const statusTotals = useMemo(
    () =>
      Object.fromEntries(
        (['all', 'open', 'later', 'decided'] as const).map((value) => [
          value,
          relationFiltered.filter((row) => matchesWalletStatus(row, value)).length,
        ]),
      ),
    [relationFiltered],
  );
  const statusCounts = (value: WalletStatusFilter) => statusTotals[value];
  const openReviewCount = useMemo(
    () => rowsByTab.review.filter((row) => matchesWalletStatus(row, 'open')).length,
    [rowsByTab.review],
  );
  const outstandingRecordCount = useMemo(
    () => metadataFiltered.filter((row) => row.reviews.some(isOutstandingReview)).length,
    [metadataFiltered],
  );
  const scopeCounts = useMemo(
    () =>
      Object.fromEntries(
        REVIEW_SCOPES.map((scope) => [
          scope,
          statusFiltered.filter((row) =>
            row.reviews.some((item) => (item.scopes ?? [item.scope]).includes(scope)),
          ).length,
        ]),
      ) as Record<ReviewScope, number>,
    [statusFiltered],
  );
  const hasPreviousOutputDecisions = review.items.some(
    (item) => item.scope === 'previous-output-decisions',
  );

  useEffect(() => {
    if (selectedKey && window.matchMedia('(max-width: 760px)').matches)
      detailRef.current?.scrollIntoView({ block: 'nearest' });
  }, [selectedKey, batching]);

  useLayoutEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = initialScroll;
  }, [initialScroll]);
  useEffect(() => {
    if (!active || tourPreview || !onPresentationChange) return;
    const shared = {
      query,
      labelFilter: labelFilter as 'all' | 'labeled' | 'unlabeled',
      tagFilter,
      selectedKey,
      limit,
    };
    onPresentationChange(wallet.id, (current) => {
      const next =
        tab === 'review'
          ? {
              ...current,
              activeTab: tab,
              review: { ...current.review, ...shared, status, scopeFilter, typeIds },
            }
          : {
              ...current,
              activeTab: tab,
              browsing: {
                ...current.browsing,
                ...shared,
                tab,
                reviewOnly,
                transactionIds: transactionScope,
              },
            };
      return JSON.stringify(next) === JSON.stringify(current) ? current : next;
    });
  }, [
    active,
    tourPreview,
    onPresentationChange,
    wallet.id,
    tab,
    query,
    labelFilter,
    tagFilter,
    selectedKey,
    limit,
    status,
    scopeFilter,
    typeIds,
    reviewOnly,
    transactionScope,
  ]);

  function changeTab(next: WalletTab) {
    const restored =
      next === 'review'
        ? saved?.review
        : saved?.browsing?.tab === next
          ? saved.browsing
          : undefined;
    setLimit(restored?.limit ?? PAGE);
    setTab(next);
    selection.clear();
    setSelectedKey(restored?.selectedKey);
    setShown({ row: undefined, scope: undefined, selectedKey: undefined });
    setQuery(restored?.query ?? '');
    setLabelFilter(restored?.labelFilter ?? 'all');
    setTagFilter(restored?.tagFilter ?? 'all');
    setStatus(next === 'review' ? (saved?.review?.status ?? 'open') : 'all');
    setScopeFilter(next === 'review' ? (saved?.review?.scopeFilter ?? 'all') : 'all');
    setReviewOnly(next === saved?.browsing?.tab ? (saved.browsing.reviewOnly ?? false) : false);
    setExactReview(undefined);
    setFocusedReviewKey(undefined);
    setTypeIds(next === 'review' ? saved?.review?.typeIds : undefined);
    setNotice('');
    setTransactionScope(next === 'transactions' ? restored?.transactionIds : undefined);
    if (scrollRef.current) scrollRef.current.scrollTop = restored?.scrollTop ?? 0;
  }

  function decide(items: readonly WalletReviewItem[], action: WalletDecisionAction) {
    const uniqueItems = [...new Map(items.map((item) => [item.key, item])).values()];
    onChange((current) => applyReviewDecisions(current, wallet, uniqueItems, action));
    selection.clear();
    const messages = {
      reopen: 'Reopened.',
      reviewed: 'Marked reviewed.',
      'cannot-identify': 'Recorded as unidentified.',
      'not-needed': 'No annotation needed.',
      later: 'Review postponed.',
    };
    setNotice(
      uniqueItems.length === 1 ? messages[action] : `${uniqueItems.length} review items updated.`,
    );
  }

  function openLinkedReview(row: WalletRow, item: WalletReviewItem) {
    setTab('review');
    setFocusedReviewKey(item.key);
    setLimit(PAGE);
    setStatus('all');
    setScopeFilter('all');
    setTypeIds(undefined);
    setReviewOnly(false);
    setQuery('');
    setLabelFilter('all');
    setTagFilter('all');
    setExactReview({ nodeId: row.nodeId, reference: row.identifier });
    selection.clear();
    setSelectedKey(
      rowsByTab.review.find((candidate) =>
        candidate.reviews.some((entry) => entry.key === item.key),
      )?.key,
    );
    setShown({ row: undefined, scope: undefined, selectedKey: undefined });
    setNotice('');
  }

  function clearExactReview() {
    setLimit(PAGE);
    setStatus('open');
    setScopeFilter('all');
    setTypeIds(undefined);
    setQuery('');
    setLabelFilter('all');
    setTagFilter('all');
    setExactReview(undefined);
    selection.clear();
    setSelectedKey(undefined);
    setShown({ row: undefined, scope: undefined, selectedKey: undefined });
  }

  const recordById = useMemo(() => {
    const result = new Map<string, WalletRow>();
    for (const records of [
      rowsByTab.transactions,
      rowsByTab.utxos,
      rowsByTab.addresses,
      rowsByTab.sources,
      rowsByTab.destinations,
      rowsByTab.review,
    ])
      for (const row of records) if (!result.has(row.nodeId)) result.set(row.nodeId, row);
    return result;
  }, [rowsByTab]);
  const linkedRow = (id: string) => {
    const existing = recordById.get(id);
    if (existing) return walletRowWithContext(workspace, existing, selectionIndex);
    if (id.startsWith('out:')) {
      const output = walletLinkedOutputRow(
        workspace,
        id,
        selectionIndex,
        walletAddresses,
        review.items,
      );
      if (output?.ownership === 'wallet') return output;
    }
    return undefined;
  };
  const canOpenRecord = (id: string) =>
    id.startsWith('party:')
      ? !!workspace.counterparties?.definitions.some((party) => `party:${party.id}` === id)
      : !!linkedRow(id);
  const origin = tab === 'counterparties' ? selectedKey : selectedRow?.nodeId;
  const trail =
    detailTrail && detailTrail.origin === origin && detailTrail.scope === filterScope
      ? detailTrail.references
      : [];
  if (detailTrail && (detailTrail.origin !== origin || detailTrail.scope !== filterScope))
    setDetailTrail(undefined);
  const inspectedId = trail.at(-1) ?? origin;
  const inspectedRow =
    inspectedId && !inspectedId.startsWith('party:')
      ? inspectedId === selectedRow?.nodeId
        ? selectedRow
        : linkedRow(inspectedId)
      : undefined;
  useLayoutEffect(() => {
    const pending = navigationFocus.current;
    if (!pending) return;
    navigationFocus.current = undefined;
    const target = [
      ...(detailRef.current?.querySelectorAll<HTMLElement>('[data-wallet-reference]') ?? []),
    ].find((element) => element.dataset.walletReference === pending.reference);
    const visibleTarget = target?.closest('details:not([open])') ? undefined : target;
    (visibleTarget ?? detailRef.current?.querySelector<HTMLElement>('h2'))?.focus({
      preventScroll: true,
    });
  }, [inspectedId]);

  function openRecord(id: string) {
    if (id === inspectedId || !origin) return;
    if (!canOpenRecord(id)) {
      props.onShowInGraph(id);
      return;
    }
    navigationFocus.current = {};
    setDetailTrail({ origin, scope: filterScope, references: [...trail, id] });
  }
  function returnToRecord() {
    if (!origin || !trail.length) return;
    navigationFocus.current = { reference: inspectedId };
    setDetailTrail({ origin, scope: filterScope, references: trail.slice(0, -1) });
  }
  const inspector = inspectedId?.startsWith('party:') ? (
    <WalletCounterpartyDetail
      {...props}
      partyId={inspectedId.slice(6)}
      activityRows={rowsByTab.transactions}
      onRemoved={() => {
        if (trail.length)
          setDetailTrail({ origin: origin!, scope: filterScope, references: trail.slice(0, -1) });
        else setSelectedKey(undefined);
      }}
      onOpenRecord={openRecord}
      canOpenRecord={canOpenRecord}
      onShowRelatedTransactions={(ids) => {
        changeTab('transactions');
        setTransactionScope(ids);
      }}
    />
  ) : inspectedRow ? (
    <WalletItemDetail
      key={inspectedRow.nodeId}
      {...props}
      row={inspectedRow}
      selectionIndex={selectionIndex}
      walletAddresses={walletAddresses}
      onNotice={setNotice}
      onDecide={decide}
      focusedReviewKey={!trail.length ? focusedReviewKey : undefined}
      onOpenReviewItem={tab === 'review' ? undefined : openLinkedReview}
      onOpenRecord={openRecord}
      canOpenRecord={canOpenRecord}
      resolveInputs={tab !== 'sources' || (counterpartyReady && !counterparties.loading)}
    />
  ) : undefined;
  const inspectedDetail = (
    <>
      {trail.length > 0 && (
        <div className="wallet-inspector-back">
          <button className="text-button" onClick={returnToRecord}>
            ← Back
          </button>
        </div>
      )}
      {inspector ?? (trail.length > 0 && <p className="wallet-empty-note">Record unavailable</p>)}
    </>
  );

  const related = (row: WalletRow) => ({
    id: row.key,
    address: row.address,
    txid: row.txid,
    transactionIds:
      row.kind === 'address' && row.relationshipDirection ? row.contextTransactionIds : undefined,
  });
  const relatedCandidates = useMemo(() => filteredRows.map(related), [filteredRows]);
  const relatedSeeds = (batching ? selectedRows : []).map(related);
  const hasRelatedMatches =
    matchRelatedEntities(relatedCandidates, relatedSeeds, 'address').length > 0 ||
    matchRelatedEntities(relatedCandidates, relatedSeeds, 'transaction').length > 0;
  const relatedSelection = hasRelatedMatches ? (
    <WalletRelatedSelection
      active={active}
      candidates={relatedCandidates}
      seeds={relatedSeeds}
      onSelect={selection.setIds}
    />
  ) : undefined;
  return (
    <section
      className="wallet-workbench"
      ref={scrollRef}
      onScroll={(event) => {
        const scrollTop = event.currentTarget.scrollTop;
        if (active && !props.tourPreview)
          props.onPresentationChange?.(wallet.id, (current) =>
            tab === 'review'
              ? { ...current, review: { ...current.review, scrollTop } }
              : { ...current, browsing: { ...current.browsing, scrollTop } },
          );
      }}
      aria-label="Wallet review workbench"
      hidden={props.hidden}
      inert={!!props.tourPreview}
      data-tour={props.tourPreview ? 'wallet-preview' : undefined}
    >
      <WalletOverview
        {...props}
        coverage={review.coverage}
        utxos={utxos}
        analysisStatus={
          currentAnalysis?.scope.kind === 'wallet' &&
          currentAnalysis.scope.label === `Wallet ${wallet.name}`
            ? `${currentAnalysis.findings.length} findings`
            : ''
        }
        analysisIssues={currentAnalysis?.reports
          .filter((report) => report.status === 'error')
          .map((report) => `${report.toolId}: ${report.message}`)
          .join(' ')}
      />
      <div aria-live="polite" className="wallet-review-messages">
        {utxoError && (
          <p role="alert" className="small warning">
            {utxoError}
          </p>
        )}
        {invalidCount > 0 && (
          <p role="alert" className="small warning">
            {invalidCount} UTXO observations disagree with their loaded transactions and are
            excluded. Check again to retry.
          </p>
        )}
      </div>
      <nav className="wallet-review-tabs" aria-label="Wallet sections" data-tour="wallet-sections">
        {TABS.map(({ id, label, Icon }) => (
          <button
            key={id}
            aria-pressed={
              tab === id || (id === 'addresses' && (tab === 'sources' || tab === 'destinations'))
            }
            className={
              tab === id || (id === 'addresses' && (tab === 'sources' || tab === 'destinations'))
                ? 'active'
                : ''
            }
            onClick={() => changeTab(id)}
          >
            <Icon size={14} /> {label}
            {id === 'review' && <span className="wallet-count">{openReviewCount}</span>}
          </button>
        ))}
      </nav>
      {tab === 'counterparties' ? (
        <WalletCounterpartyList
          {...props}
          selectedId={selectedKey?.replace(/^party:/, '')}
          onSelect={(id) => {
            setDetailTrail(undefined);
            setSelectedKey(`party:${id}`);
          }}
          query={query}
          onQueryChange={setQuery}
        >
          <article className="wallet-review-detail" aria-label="Selected counterparty">
            {inspector ? inspectedDetail : <p>Select a counterparty.</p>}
          </article>
        </WalletCounterpartyList>
      ) : (
        <div className="wallet-review-body">
          {tab === 'review' && exactReview && (
            <div className="wallet-review-context" role="status">
              <span>
                Review items for{' '}
                <strong>
                  <ResponsiveIdentifier value={exactReview.reference} />
                </strong>
              </span>
              <button className="text-button" onClick={clearExactReview}>
                Clear
              </button>
            </div>
          )}
          {tab === 'transactions' && transactionScope && (
            <div className="wallet-review-context">
              <span>Related activity ({transactionScope.length})</span>
              <button onClick={() => setTransactionScope(undefined)}>Clear scope</button>
            </div>
          )}
          <div className="wallet-record-filters" data-tour="wallet-filters">
            {(tab === 'addresses' || tab === 'sources' || tab === 'destinations') && (
              <label>
                Address scope
                <select
                  aria-label="Address scope"
                  value={tab}
                  onChange={(event) => changeTab(event.target.value as WalletTab)}
                >
                  <option value="addresses">Wallet addresses</option>
                  <option value="sources">Sources</option>
                  <option value="destinations">Destinations</option>
                </select>
              </label>
            )}
            {tab === 'review' && (
              <>
                <MultiSelectFilter
                  active={active}
                  groups={categoryGroups}
                  selectedIds={selectedTypes}
                  onChange={(ids) => {
                    setLimit(PAGE);
                    setTypeIds(ids);
                  }}
                  labels={{
                    trigger: 'Review reason',
                    title: 'Review reasons',
                    optionNoun: 'reasons',
                    countHelpTitle: 'Review reason counts',
                    countHelp:
                      'Counts use the selected review state, independent of scope and other reasons. A review item can match several reasons, so counts may overlap. Selecting several reasons matches any of them.',
                  }}
                />
                <label>
                  <span>Scope</span>
                  <select
                    aria-label="Scope"
                    value={scopeFilter}
                    onChange={(event) => {
                      setLimit(PAGE);
                      setScopeFilter(event.target.value as 'all' | ReviewScope);
                    }}
                  >
                    <option value="all">All review items ({statusFiltered.length})</option>
                    {REVIEW_SCOPES.filter(
                      (scope) =>
                        scope !== 'previous-output-decisions' || hasPreviousOutputDecisions,
                    ).map((scope) => (
                      <option key={scope} value={scope}>
                        {SCOPE_LABELS[scope]} ({scopeCounts[scope]})
                      </option>
                    ))}
                  </select>
                </label>
              </>
            )}
            {tab === 'review' && (
              <label>
                <span>State</span>
                <select
                  aria-label="State"
                  value={status}
                  onChange={(event) => {
                    setLimit(PAGE);
                    setStatus(event.target.value as WalletStatusFilter);
                  }}
                >
                  {(Object.keys(STATUS_LABELS) as WalletStatusFilter[]).map((value) => (
                    <option key={value} value={value}>
                      {STATUS_LABELS[value]} ({statusCounts(value)})
                    </option>
                  ))}
                </select>
              </label>
            )}
            {tab !== 'review' && (
              <button
                className="wallet-review-only-toggle"
                aria-pressed={reviewOnly}
                onClick={() => {
                  setLimit(PAGE);
                  setReviewOnly((value) => !value);
                }}
              >
                To review ({outstandingRecordCount})
              </button>
            )}
            <label>
              <span>Labels</span>
              <select
                aria-label="Label filter"
                value={labelFilter}
                onChange={(event) => {
                  setLimit(PAGE);
                  setLabelFilter(event.target.value);
                }}
              >
                <option value="all">All</option>
                <option value="unlabeled">Unlabeled</option>
                <option value="labeled">Labelled</option>
              </select>
            </label>
            <label>
              <span>Tags</span>
              <select
                aria-label="Tag filter"
                value={tagFilter}
                onChange={(event) => {
                  setLimit(PAGE);
                  setTagFilter(event.target.value);
                }}
              >
                <option value="all">Any tag state</option>
                <option value="untagged">No tags</option>
                {(workspace.annotations.tags ?? []).map((tag) => (
                  <option key={tag.id} value={tag.id}>
                    {tag.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="wallet-record-search">
              <span className="sr-only">Search</span>
              <input
                type="search"
                aria-label="Filter wallet records"
                placeholder={`Search ${tab === 'utxos' ? 'coins' : tab === 'review' ? 'review items' : tab === 'sources' || tab === 'destinations' ? 'addresses' : tab}…`}
                value={query}
                onChange={(event) => {
                  setLimit(PAGE);
                  setQuery(event.target.value);
                }}
              />
            </label>
            {(query ||
              labelFilter !== 'all' ||
              tagFilter !== 'all' ||
              (tab === 'review' &&
                (status !== 'all' || scopeFilter !== 'all' || typeIds !== undefined)) ||
              (tab !== 'review' && reviewOnly)) && (
              <button
                className="text-button"
                aria-label="Clear wallet filters"
                onClick={() => {
                  setLimit(PAGE);
                  setQuery('');
                  setLabelFilter('all');
                  setTagFilter('all');
                  setStatus('all');
                  setScopeFilter('all');
                  setTypeIds(undefined);
                  setReviewOnly(false);
                }}
              >
                Clear filters
              </button>
            )}
          </div>
          {tab === 'sources' && (
            <div className="wallet-input-status" role="status">
              {counterparties.loading ? (
                <span>Loading source addresses...</span>
              ) : (
                <>
                  {counterparties.failedCount > 0 && (
                    <>
                      <span>{counterparties.failedCount} input lookups failed</span>
                      <button
                        disabled={!canLoadChainData || busy}
                        title={props.chainDataDisabledReason}
                        onClick={counterparties.retry}
                      >
                        Retry
                      </button>
                    </>
                  )}
                  {counterparties.missingCount > counterparties.failedCount && (
                    <>
                      <span>
                        {counterparties.missingCount - counterparties.failedCount} input
                        transactions waiting
                      </span>
                      <button
                        disabled={!canLoadChainData || busy}
                        onClick={counterparties.loadMore}
                        title={
                          props.chainDataDisabledReason ??
                          'Load the next batch of direct input transactions'
                        }
                      >
                        Load next{' '}
                        {Math.min(
                          WALLET_FLOW_INPUT_WAVE_LIMIT,
                          counterparties.missingCount - counterparties.failedCount,
                        )}
                      </button>
                    </>
                  )}
                </>
              )}
              {counterparties.unavailableCount > 0 && (
                <span title="These input references could not be matched to an output in the loaded transactions. They are not listed as addresses.">
                  {counterparties.unavailableCount} unmatched input references
                </span>
              )}
            </div>
          )}
          {(tab === 'sources' || tab === 'destinations') &&
            (() => {
              const nonAddress = (
                tab === 'sources'
                  ? relationships.sourceExceptions
                  : relationships.destinationExceptions
              ).filter((entry) => !entry.missing).length;
              return nonAddress ? (
                <p
                  className="wallet-input-status"
                  title="Scripts such as OP_RETURN do not have an address and are excluded from this list."
                >
                  {nonAddress} non-address outputs excluded
                </p>
              ) : null;
            })()}
          <div className="wallet-review-grid">
            <div
              className="wallet-review-list wallet-review-records"
              role="list"
              aria-label={tab === 'review' ? 'Review queue' : `${tabLabel} records`}
            >
              <div className="wallet-list-header compact-controls" role="listitem">
                <input
                  type="checkbox"
                  aria-label={`Select all matching records (${filteredRows.length})`}
                  aria-checked={
                    allSelection.allSelected
                      ? true
                      : selection.ids.some((id) => filteredKeys.has(id))
                        ? 'mixed'
                        : false
                  }
                  checked={allSelection.allSelected}
                  ref={(input) => {
                    if (input)
                      input.indeterminate =
                        !allSelection.allSelected &&
                        selection.ids.some((id) => filteredKeys.has(id));
                  }}
                  disabled={!filteredRows.length}
                  title="Select every matching row, including rows below Show more"
                  onChange={() => selection.setIds(allSelection.next)}
                />
                <div className="wallet-list-header-content">
                  <span
                    className="small muted"
                    aria-label={`${Math.min(limit, filteredRows.length)} of ${filteredRows.length} matching results shown`}
                  >
                    {Math.min(limit, filteredRows.length)}/{filteredRows.length} shown
                  </span>
                  <span className="wallet-review-notice" role="status" title={notice}>
                    {notice}
                  </span>
                </div>
              </div>
              {displayedRows.map((row) => {
                const annotation = workspace.annotations.entities[row.nodeId];
                const checked = selectionKeys.has(row.key);
                const current = !batching && selectedRow?.key === row.key;
                return (
                  <div
                    className={`wallet-review-item wallet-review-record ${current ? 'current' : ''} ${checked ? 'batch-selected selected' : ''}`}
                    role="listitem"
                    key={row.key}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => {}}
                      aria-label={
                        tab === 'review'
                          ? `Select review item ${row.title}`
                          : `Select ${row.identifier}`
                      }
                      onClick={(event) =>
                        selection.choose(
                          row.key,
                          displayedRows.map((entry) => entry.key),
                          event,
                          true,
                        )
                      }
                    />
                    <div
                      className="wallet-row-content"
                      onClick={(event) => {
                        if (event.ctrlKey || event.metaKey || event.shiftKey)
                          selection.choose(
                            row.key,
                            displayedRows.map((entry) => entry.key),
                            event,
                          );
                        else {
                          selection.clear();
                          selection.anchorAt(row.key);
                          setDetailTrail(undefined);
                          setSelectedKey(row.key);
                        }
                      }}
                    >
                      <div className="wallet-row-heading">
                        <div className="wallet-row-identity">
                          <a
                            href="#wallet-record-detail"
                            className="wallet-row-link"
                            aria-current={current ? 'true' : undefined}
                            onClick={(event) => event.preventDefault()}
                          >
                            <span className="wallet-row-primary">
                              {row.walletTransaction && (
                                <span
                                  className="wallet-direction"
                                  title={row.walletTransaction.direction}
                                  aria-label={row.walletTransaction.direction}
                                >
                                  {row.walletTransaction.direction === 'received' ? (
                                    <ArrowDownLeft size={15} />
                                  ) : row.walletTransaction.direction === 'sent' ? (
                                    <ArrowUpRight size={15} />
                                  ) : (
                                    <ArrowLeftRight size={15} />
                                  )}
                                </span>
                              )}
                              <strong className="wallet-item-title mono" title={row.identifier}>
                                <ResponsiveIdentifier value={row.identifier} />
                              </strong>
                            </span>
                            {(annotation?.label || annotation?.icon) && (
                              <span className="wallet-row-label" title={annotation.label}>
                                {annotation.icon && (
                                  <span aria-hidden="true">{annotation.icon} </span>
                                )}
                                {annotation.label}
                              </span>
                            )}
                          </a>
                        </div>
                        {(row.amountSats !== undefined || row.kind === 'transaction') && (
                          <span className="wallet-row-amount">
                            <Amount value={row.amountSats} signed={row.kind === 'transaction'} />
                          </span>
                        )}
                      </div>
                      <div className="wallet-row-footer">
                        <span className="wallet-row-values muted">
                          {row.kind === 'address' && row.relationshipDirection && row.meta && (
                            <span>{row.meta}</span>
                          )}
                          {tab === 'review' && (
                            <span className={`wallet-review-status status-${row.status}`}>
                              {row.changed
                                ? 'Evidence changed'
                                : row.status === 'resolved'
                                  ? 'Complete'
                                  : row.status === 'open'
                                    ? 'To review'
                                    : row.status === 'later'
                                      ? 'Later'
                                      : row.status === 'reviewed'
                                        ? 'Reviewed'
                                        : row.status === 'not-needed'
                                          ? 'No annotation needed'
                                          : 'Cannot identify'}
                            </span>
                          )}
                          {row.kind !== 'address' && row.txid && (
                            <TransactionTimestamp
                              transaction={
                                row.utxo
                                  ? walletRecordBlockObservation(
                                      row.txid,
                                      workspace.chainData.transactions[row.txid],
                                      row.utxo.height,
                                      row.utxo.height <= 0,
                                    )
                                  : workspace.chainData.transactions[row.txid]
                              }
                            />
                          )}
                        </span>
                        <WalletRowAttention
                          workspace={workspace}
                          wallet={wallet}
                          row={row}
                          prepared={counterpartyPreparation}
                          busy={busy}
                          onChange={onChange}
                          onNotice={setNotice}
                          onReview={openLinkedReview}
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
              {!filteredRows.length && (
                <p className="wallet-empty-note">
                  {tab === 'review' && !selectedTypes.length
                    ? 'No review reasons selected'
                    : query ||
                        labelFilter !== 'all' ||
                        tagFilter !== 'all' ||
                        (tab === 'review' &&
                          (status !== 'all' || scopeFilter !== 'all' || typeIds !== undefined)) ||
                        (tab !== 'review' && reviewOnly)
                      ? 'No results'
                      : transactionScope
                        ? 'No transactions in this scope'
                        : exactReview
                          ? 'No review items for this transaction'
                          : tab === 'utxos' && !utxos
                            ? 'Coins not checked yet'
                            : tab === 'transactions'
                              ? wallet.scannedAt
                                ? 'No transactions'
                                : 'Wallet not checked yet'
                              : tab === 'review'
                                ? 'No review items'
                                : tab === 'sources' && counterparties.loading
                                  ? 'Loading addresses…'
                                  : tab === 'utxos'
                                    ? 'No coins'
                                    : 'No addresses'}
                </p>
              )}
              {filteredRows.length > limit && (
                <button onClick={() => setLimit((current) => current + PAGE)}>
                  Show more ({filteredRows.length - limit} remaining)
                </button>
              )}
            </div>
            <article
              ref={detailRef}
              className={`wallet-review-detail ${batching ? 'wallet-batch-detail' : ''}`}
              aria-label={
                batching
                  ? 'Batch selection details'
                  : tab === 'review'
                    ? 'Selected review item'
                    : 'Selected wallet item'
              }
            >
              {batching ? (
                <>
                  <div className="wallet-detail-toolbar" aria-label="Selected batch actions">
                    <BatchMetadataBar
                      active={active}
                      workspace={workspace}
                      ids={selectedIds}
                      scopeLabel="selected"
                      guidedActions={
                        selectedReviews.some(
                          (item) =>
                            item.reason === 'link' &&
                            (item.changed ||
                              item.status === 'open' ||
                              !isCompletedReview({ status: item.status })),
                        )
                          ? ['tags']
                          : undefined
                      }
                      disabled={busy || missingSelected > 0}
                      onChange={onChange}
                      onNotice={setNotice}
                    />
                    {selectedReviews.length > 0 && (
                      <div className="wallet-action-group" aria-label="Batch review decisions">
                        <WalletDecisionButtons
                          items={selectedReviews}
                          busy={busy || missingSelected > 0}
                          onDecide={decide}
                        />
                      </div>
                    )}
                    {relatedSelection && (
                      <div className="wallet-action-group">{relatedSelection}</div>
                    )}
                    <div className="wallet-action-group" aria-label="Graph actions">
                      <button
                        disabled={!selectedIds.length || busy || missingSelected > 0}
                        title="Show these selections in Graph and zoom to the first"
                        onClick={() => props.onShowSelection(selectedIds, false)}
                      >
                        <Network size={14} /> Show on graph
                      </button>
                      <button
                        disabled={!selectedIds.length || busy || missingSelected > 0}
                        title="Isolate these selections and their connected graph context"
                        onClick={() => props.onShowSelection(selectedIds, true)}
                      >
                        <Filter size={14} /> Isolate
                      </button>
                    </div>
                  </div>
                  <h2>
                    {selectionSummary
                      ? `${selectionSummary} selected`
                      : 'Selection no longer listed'}
                  </h2>
                  <div className="wallet-compact-status">
                    <span>
                      {selectedRows.length} {selectedRows.length === 1 ? 'row' : 'rows'} ·{' '}
                      {selectedReviews.length} review{' '}
                      {selectedReviews.length === 1 ? 'item' : 'items'}
                    </span>
                    <button className="text-button" onClick={selection.clear}>
                      Clear selection
                    </button>
                    {tab === 'utxos' && spendGuidance(workspace, selectedIds) && (
                      <WalletHelp title="Combining these UTXOs" active={active}>
                        {spendGuidance(workspace, selectedIds)}
                      </WalletHelp>
                    )}
                  </div>
                  {hiddenSelected > 0 && (
                    <p className="wallet-review-bound" role="note">
                      {hiddenSelected} selected outside this filter
                    </p>
                  )}
                  {missingSelected > 0 && (
                    <p className="warning" role="alert">
                      {missingSelected} selected records unavailable
                    </p>
                  )}
                </>
              ) : inspector ? (
                inspectedDetail
              ) : (
                <p className="wallet-empty-note">
                  {initialReviewLoading
                    ? 'Checking current UTXOs...'
                    : tab === 'transactions'
                      ? 'Select a transaction.'
                      : tab === 'utxos'
                        ? 'Select a coin'
                        : tab === 'review'
                          ? 'Select a review item.'
                          : 'Select an address.'}
                </p>
              )}
            </article>
          </div>
        </div>
      )}
      {tab === 'review' && review.legacyDecisions.length > 0 && (
        <details>
          <summary>Previous decisions ({review.legacyDecisions.length})</summary>
          {review.legacyDecisions.map((decision) => (
            <p key={decision.key}>
              <ResponsiveIdentifier value={decision.key} /> · {decision.status} · {decision.at}
            </p>
          ))}
        </details>
      )}
    </section>
  );
}
