import { useEffect, useState, useSyncExternalStore } from 'react';
import type { WalletPresentation } from '../../../../Core/Workspace/view';
import type { TransactionFetchScope } from '../../../../Core/ChainData/transactionScheduler';
import type { ReviewScope } from '../../../../Core/Workspace/Wallets/walletReview';
import type { WalletTab, WalletStatusFilter } from './walletRows';
import { chooseRecords, type RecordSelection } from './useRecordSelection';

type Section = keyof NonNullable<WalletPresentation['tabs']>;
const SECTIONS: Section[] = ['transactions', 'utxos', 'addresses', 'counterparties', 'review'];
const LABELS: Record<Section, string> = {
  transactions: 'Transactions',
  utxos: 'Coins',
  addresses: 'Addresses',
  counterparties: 'Counterparties',
  review: 'Review',
};

export function walletSection(tab: WalletTab): Section {
  return tab === 'sources' || tab === 'destinations' ? 'addresses' : tab;
}

interface Position {
  tab: WalletTab;
  query: string;
  labelFilter: 'all' | 'labeled' | 'unlabeled';
  tagFilter: string;
  addressBranch: 'all' | 'receive' | 'change';
  reviewOnly: boolean;
  status: WalletStatusFilter;
  scopeFilter: 'all' | ReviewScope;
  typeIds?: string[];
  transactionScope?: string[];
  selectedKey?: string;
  selection: RecordSelection;
  limit: number;
  scrollTop: number;
  retained?: { key: string; scope: string };
  exactReview?: { nodeId: string; reference: string };
  focusedReviewKey?: string;
  detailTrail?: { origin: string; scope: string; references: string[] };
}
interface Focus {
  element?: HTMLElement;
  reference?: string;
}
interface Visit {
  position: Position;
  returnTo?: { section: Section; origin: Visit; destination: Visit; focus: Focus };
}

function normalVisit(visit: Visit): Visit {
  while (visit.returnTo) visit = visit.returnTo.destination;
  return visit;
}

function position(tab: WalletTab, saved?: WalletPresentation): Position {
  const section = walletSection(tab);
  const stored =
    saved?.tabs?.[section] ??
    (section === 'review'
      ? saved?.review
      : saved?.browsing?.tab && walletSection(saved.browsing.tab) === section
        ? saved.browsing
        : undefined);
  const review = section === 'review' ? (saved?.tabs?.review ?? saved?.review) : undefined;
  const addressScope = section === 'addresses' ? saved?.tabs?.addresses?.addressScope : undefined;
  return {
    tab:
      section === 'addresses'
        ? addressScope === 'sources' || addressScope === 'destinations'
          ? addressScope
          : !saved?.tabs?.addresses &&
              (saved?.browsing?.tab === 'sources' || saved?.browsing?.tab === 'destinations')
            ? saved.browsing.tab
            : 'addresses'
        : tab,
    query: stored?.query ?? '',
    labelFilter: stored?.labelFilter ?? 'all',
    tagFilter: stored?.tagFilter ?? 'all',
    addressBranch: stored?.addressBranch ?? 'all',
    reviewOnly:
      section !== 'review' && stored && 'reviewOnly' in stored
        ? (stored.reviewOnly ?? false)
        : false,
    status: review?.status ?? (section === 'review' ? 'open' : 'all'),
    scopeFilter: review?.scopeFilter ?? 'all',
    typeIds: review?.typeIds,
    transactionScope: stored?.transactionIds,
    selectedKey: stored?.selectedKey,
    selection: { ids: [] },
    limit: stored?.limit ?? 40,
    scrollTop: stored?.scrollTop ?? 0,
  };
}

/** Wallet's tab positions, selection and contextual return trail. It holds only
 * presentation and exact references, never workspace/record snapshots.
 */
export class WalletNavigation {
  private listeners = new Set<() => void>();
  private state: {
    section: Section;
    visits: Record<Section, Visit>;
    entry: number;
    focus?: Focus;
  };
  constructor(saved?: WalletPresentation, previewTab?: WalletTab) {
    const tab = previewTab ?? saved?.activeTab ?? saved?.browsing?.tab ?? 'transactions';
    const visits = Object.fromEntries(
      SECTIONS.map((section) => [section, { position: position(section, saved) }]),
    ) as Record<Section, Visit>;
    if (previewTab)
      visits[walletSection(previewTab)] = {
        position: {
          ...position(previewTab),
          tab: previewTab,
          status: previewTab === 'sources' ? 'all' : 'open',
        },
      };
    this.state = { section: walletSection(tab), visits, entry: 0 };
  }
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private publish(next: typeof this.state) {
    this.state = next;
    for (const listener of this.listeners) listener();
  }
  update(patch: Partial<Position>) {
    const { section, visits } = this.state;
    const visit = visits[section];
    if (
      Object.entries(patch).every(([key, value]) => visit.position[key as keyof Position] === value)
    )
      return;
    this.publish({
      ...this.state,
      visits: { ...visits, [section]: { ...visit, position: { ...visit.position, ...patch } } },
    });
  }
  filter(patch: Partial<Position>) {
    this.update({ ...patch, limit: 40, retained: undefined, detailTrail: undefined });
  }
  switchTab(tab: WalletTab) {
    const section = walletSection(tab);
    if (section === this.state.section) return;
    this.publish({ ...this.state, section, entry: this.state.entry + 1, focus: undefined });
  }
  addressScope(value: string) {
    this.filter({
      tab: value === 'sources' || value === 'destinations' ? value : 'addresses',
      addressBranch: value === 'receive' || value === 'change' ? value : 'all',
    });
  }
  inspect(key?: string) {
    this.update({
      selectedKey: key,
      selection: { ids: [], anchor: key },
      detailTrail: undefined,
      retained: undefined,
    });
  }
  choose(
    ...args: Parameters<typeof chooseRecords> extends [RecordSelection, ...infer Rest]
      ? Rest
      : never
  ) {
    this.update({
      selection: chooseRecords(this.state.visits[this.state.section].position.selection, ...args),
    });
  }
  select(ids: string[]) {
    const current = this.state.visits[this.state.section].position.selection;
    this.update({ selection: { ...current, ids } });
  }
  clearSelection() {
    this.update({ selection: { ids: [] } });
  }
  settle(key: string | undefined, scope: string) {
    const current = this.state.visits[this.state.section].position;
    if (
      current.selection.ids.length ||
      !key ||
      (current.selectedKey === key &&
        current.retained?.key === key &&
        current.retained.scope === scope)
    )
      return;
    this.update({ selectedKey: key, retained: { key, scope } });
  }
  private handoff(next: Position) {
    const { section, visits } = this.state;
    const target = walletSection(next.tab);
    const active = document.activeElement;
    this.publish({
      ...this.state,
      section: target,
      entry: this.state.entry + 1,
      focus: {},
      visits: {
        ...visits,
        [target]: {
          position: next,
          returnTo: {
            section,
            origin: visits[section],
            destination: normalVisit(visits[target]),
            focus: { element: active instanceof HTMLElement ? active : undefined },
          },
        },
      },
    });
  }
  showTransactions(ids: string[]) {
    this.handoff({ ...position('transactions'), transactionScope: [...new Set(ids)] });
  }
  openReview(target: { nodeId: string; reference: string; key: string; selectedKey?: string }) {
    this.handoff({
      ...position('review'),
      status: 'all',
      exactReview: { nodeId: target.nodeId, reference: target.reference },
      focusedReviewKey: target.key,
      selectedKey: target.selectedKey,
    });
  }
  openRecord(origin: string, scope: string, id: string) {
    const current = this.state.visits[this.state.section].position.detailTrail;
    const references =
      current?.origin === origin && current.scope === scope ? current.references : [];
    this.update({ detailTrail: { origin, scope, references: [...references, id] } });
    this.publish({ ...this.state, focus: {} });
  }
  back() {
    const { section, visits } = this.state;
    const visit = visits[section];
    const trail = visit.position.detailTrail;
    if (trail?.references.length) {
      this.publish({
        ...this.state,
        visits: {
          ...visits,
          [section]: {
            ...visit,
            position: {
              ...visit.position,
              detailTrail: { ...trail, references: trail.references.slice(0, -1) },
            },
          },
        },
        focus: { reference: trail.references.at(-1) },
      });
    } else this.returnToOrigin();
  }
  returnToOrigin() {
    const { section, visits } = this.state;
    const back = visits[section].returnTo;
    if (!back) return;
    this.publish({
      ...this.state,
      section: back.section,
      entry: this.state.entry + 1,
      visits: { ...visits, [section]: back.destination, [back.section]: back.origin },
      focus: back.focus,
    });
  }
  contextBackLabel(snapshot = this.state) {
    const back = snapshot.visits[snapshot.section].returnTo;
    return back ? `Back to ${LABELS[back.section]}` : undefined;
  }
  backLabel(snapshot = this.state) {
    const visit = snapshot.visits[snapshot.section];
    return visit.position.detailTrail?.references.length ? 'Back' : this.contextBackLabel(snapshot);
  }
  presentation(): WalletPresentation {
    const tabs: NonNullable<WalletPresentation['tabs']> = {};
    for (const section of SECTIONS) {
      const value = normalVisit(this.state.visits[section]).position;
      const shared = {
        query: value.query,
        labelFilter: value.labelFilter,
        tagFilter: value.tagFilter,
        addressBranch: value.addressBranch,
        selectedKey: value.selectedKey,
        limit: value.limit,
        scrollTop: value.scrollTop,
      };
      if (section === 'review')
        tabs.review = {
          ...shared,
          status: value.status,
          scopeFilter: value.scopeFilter,
          typeIds: value.typeIds,
        };
      else if (section === 'addresses')
        tabs.addresses = {
          ...shared,
          reviewOnly: value.reviewOnly,
          addressScope:
            value.tab === 'sources' || value.tab === 'destinations' ? value.tab : 'wallet',
        };
      else
        tabs[section] = {
          ...shared,
          reviewOnly: value.reviewOnly,
          transactionIds: value.transactionScope,
        };
    }
    return { activeTab: this.state.section, tabs };
  }
}

export type WalletNavigationSession = Map<string, WalletNavigation>;

/** Matches the existing unlocked Analysis UI lifetime. Relocking/reopening gets
 * a new scope; removed wallets and closed scopes release their UI state.
 */
export function useWalletNavigationSessions(
  open: readonly {
    fetchScope: TransactionFetchScope;
    data: { wallets: { definitions: readonly { id: string }[] } };
  }[],
) {
  const [sessions] = useState(() => new Map<TransactionFetchScope, WalletNavigationSession>());
  useEffect(() => {
    const scopes = new Set(open.map((entry) => entry.fetchScope));
    for (const scope of sessions.keys())
      if (!scopes.has(scope) || scope.closed) sessions.delete(scope);
    for (const entry of open) {
      const wallets = new Set(entry.data.wallets.definitions.map((wallet) => wallet.id));
      const session = sessions.get(entry.fetchScope);
      if (session) for (const id of session.keys()) if (!wallets.has(id)) session.delete(id);
    }
  }, [open, sessions]);
  return (scope: TransactionFetchScope | undefined) => {
    if (!scope || scope.closed) return undefined;
    let session = sessions.get(scope);
    if (!session) {
      session = new Map();
      sessions.set(scope, session);
    }
    return session;
  };
}

export function useWalletNavigation(
  walletId: string,
  saved?: WalletPresentation,
  session?: WalletNavigationSession,
  previewTab?: WalletTab,
) {
  const [navigation] = useState(() => {
    const value = session?.get(walletId) ?? new WalletNavigation(saved, previewTab);
    session?.set(walletId, value);
    return value;
  });
  const state = useSyncExternalStore(
    navigation.subscribe,
    navigation.getSnapshot,
    navigation.getSnapshot,
  );
  return { navigation, state, visit: state.visits[state.section] };
}
