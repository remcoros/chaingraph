import type { FetchPriority, TransactionFetchScope } from '../../ChainData/transactionScheduler';
import {
  clearContextProvenance,
  markContextTransactions,
  promoteInputContext,
} from '../transactionContext';
import { mergeTransactionObservations, type Transaction } from '../../ChainData';

import {
  fetchTransaction,
  fetchAddressBalance,
  fetchAddressUtxos,
  fetchHistory,
  loadAddress,
  loadSpending,
  type ScanProgress,
} from '../../ChainData/api';
import { addressToScriptHash } from '../../Bitcoin/scripts';
import {
  addressHistorySchema,
  addressBalanceSchema,
  addressUtxoObservationSchema,
  type AddressHistoryObservation,
} from '../../ChainData/observations';
import type { Workspace } from '../workspace';
import type { Network } from '../../Bitcoin/network';
import { scanWallet } from '../Wallets/scanning';
import { applyWalletScan } from '../Wallets/walletActivity';
import type { Wallet } from '../Wallets/wallets';

export interface RecordTransactionOptions {
  promotionIds?: string[];
  contextIds?: string[];
  /** Reject a late result when the action's source no longer exists. */
  accept?: (workspace: Workspace) => boolean;
}

/** Session-bound reads and accepted observations. Reads alone never change the document. */
export interface ChainDataAcquisition {
  readonly network?: Network;
  read: {
    spending: (
      transaction: Transaction,
      vout: number | undefined,
      signal?: AbortSignal,
      offset?: number,
      unavailableTxids?: readonly string[],
    ) => ReturnType<typeof loadSpending>;
    transaction: (
      id: string,
      signal?: AbortSignal,
      priority?: FetchPriority,
      height?: number,
    ) => Promise<Transaction>;
    addressBalance: (
      address: string,
      signal?: AbortSignal,
    ) => ReturnType<typeof fetchAddressBalance>;
    addressUtxos: (address: string, signal?: AbortSignal) => ReturnType<typeof fetchAddressUtxos>;
    addressHistory: (address: string, signal?: AbortSignal) => Promise<AddressHistoryObservation>;
  };
  observe: {
    /** Wallet discovery rules stay with Wallets; Session owns the request and completed publication. */
    walletScan: (
      wallet: Wallet,
      options: Pick<Parameters<typeof scanWallet>[3], 'gap' | 'maxIndex' | 'signal' | 'onProgress'>,
    ) => Promise<Awaited<ReturnType<typeof scanWallet>> & { snapshot: Workspace }>;
    /** Retain completed watched-address checks if a later address fails or is cancelled. */
    watchedAddresses: (
      addresses: readonly string[],
      options?: { signal?: AbortSignal; accept?: (workspace: Workspace) => boolean },
    ) => Promise<{ added: number; refreshed: number; partial: boolean }>;
    /** A real refresh, accepted without changing Graph scope or resurrecting removed data. */
    refreshTransaction: (id: string, signal?: AbortSignal) => Promise<boolean>;
    transactions: (
      id: string,
      transactions: Transaction[],
      options?: RecordTransactionOptions,
    ) => boolean;
    /** Completed address batches can publish together at the workflow's existing checkpoint. */
    addresses: (
      observations: AddressObservations,
      accept?: (workspace: Workspace) => boolean,
    ) => boolean;
    /** Raw history and small detail batches are accepted progressively, including completed work on cancellation. */
    addressHistory: (
      address: string,
      options?: {
        signal?: AbortSignal;
        accept?: (workspace: Workspace) => boolean;
        onProgress?: (progress: ScanProgress) => void;
        onHistory?: (detailTotal: number) => void;
      },
    ) => ReturnType<typeof loadAddress>;
  };
}

export type AddressObservations = Pick<
  Workspace['chainData'],
  'addressHistories' | 'addressBalances' | 'addressUtxos'
>;

interface Inputs {
  activeWorkspace?: Pick<Workspace, 'id' | 'network' | 'demo'>;
  getUnlocked: (id: string) =>
    | {
        fetchScope: TransactionFetchScope;
        data: Workspace;
        locking: boolean;
        edit: (update: (current: Workspace) => Workspace, undo?: boolean) => void;
      }
    | undefined;
  fetchScope?: TransactionFetchScope;
}

export function createChainDataAcquisition({
  activeWorkspace,
  getUnlocked,
  fetchScope,
}: Inputs): ChainDataAcquisition {
  // Capture the original session token, not only its persistent workspace ID.
  const currentSession = (id: string) => {
    const session = getUnlocked(id);
    return id === activeWorkspace?.id &&
      session &&
      session.data.network === activeWorkspace.network &&
      session.fetchScope === fetchScope &&
      !fetchScope?.closed &&
      !session.locking
      ? session
      : undefined;
  };
  const requireSession = (signal?: AbortSignal) => {
    signal?.throwIfAborted();
    if (!activeWorkspace) throw new Error('Open a workspace first.');
    const session = currentSession(activeWorkspace.id);
    if (!session) throw new DOMException('Workspace session ended.', 'AbortError');
    if (activeWorkspace.demo)
      throw new Error('Live lookups are disabled for legacy synthetic workspaces.');
    return session;
  };
  const requestSignal = (signal?: AbortSignal) => {
    requireSession(signal);
    return signal ? AbortSignal.any([signal, fetchScope!.signal]) : fetchScope!.signal;
  };
  const getTransaction = async (
    id: string,
    signal?: AbortSignal,
    priority: FetchPriority = 'navigation',
    height?: number,
  ) => {
    const session = requireSession(signal);
    const txid = id.toLowerCase();
    return (
      session.data.chainData.transactions[txid] ??
      fetchTransaction(session.data.network, txid, requestSignal(signal), height, {
        scope: fetchScope,
        priority,
      })
    );
  };
  const getAddressBalance = async (address: string, signal?: AbortSignal) => {
    const session = requireSession(signal),
      identity = {};
    fetchScope!.beginObservation(identity);
    const result = await fetchAddressBalance(session.data.network, address, requestSignal(signal));
    requireSession(signal);
    return fetchScope!.markDataObservation(result, identity);
  };
  const getAddressUtxos = async (address: string, signal?: AbortSignal) => {
    const session = requireSession(signal),
      identity = {};
    fetchScope!.beginObservation(identity);
    const result = await fetchAddressUtxos(session.data.network, address, requestSignal(signal));
    requireSession(signal);
    return fetchScope!.markDataObservation(result, identity);
  };
  const getAddressHistory = async (address: string, signal?: AbortSignal) => {
    const session = requireSession(signal),
      identity = {};
    fetchScope!.beginObservation(identity);
    const history = await fetchHistory(
      session.data.network,
      addressToScriptHash(address, session.data.network),
      requestSignal(signal),
    );
    requireSession(signal);
    return fetchScope!.markDataObservation(
      { history, truncated: false, scannedAt: new Date().toISOString() },
      identity,
    );
  };
  const recordAddressObservations = (
    observations: AddressObservations,
    accept?: (workspace: Workspace) => boolean,
  ) => {
    let accepted = false;
    if (!activeWorkspace) return false;
    currentSession(activeWorkspace.id)?.edit((current) => {
      if (accept && !accept(current)) return current;
      let data = current.chainData;
      for (const kind of ['addressHistories', 'addressBalances', 'addressUtxos'] as const) {
        for (const [address, observation] of Object.entries(observations[kind] ?? {})) {
          addressToScriptHash(address, current.network);
          const schema =
            kind === 'addressHistories'
              ? addressHistorySchema
              : kind === 'addressBalances'
                ? addressBalanceSchema
                : addressUtxoObservationSchema;
          schema.parse(observation);
          if ('network' in observation && observation.network !== current.network)
            throw new Error('Address observation belongs to a different network.');
          const previous = current.chainData[kind]?.[address];
          if (previous && fetchScope!.isOlderDataObservation(observation, previous)) continue;
          if (data === current.chainData) data = { ...data };
          // Each map retains its own observation shape; validation above checks that shape.
          Object.assign(data, { [kind]: { ...data[kind], [address]: observation } });
        }
      }
      accepted = true;
      return data === current.chainData ? current : { ...current, chainData: data };
    }, false);
    return accepted;
  };
  const observeAddressHistory: ChainDataAcquisition['observe']['addressHistory'] = async (
    address,
    options = {},
  ) => {
    const session = requireSession(options.signal);
    const identity = {};
    fetchScope!.beginObservation(identity);
    let pending: Transaction[] = [];
    let timer: ReturnType<typeof setTimeout> | undefined;
    const publicationController = new AbortController();
    let publicationError: unknown;
    let publicationFailed = false;
    const flush = () => {
      if (timer) clearTimeout(timer);
      timer = undefined;
      const batch = pending;
      pending = [];
      if (batch.length) recordTransactions(session.data.id, batch, { accept: options.accept });
    };
    try {
      const result = await loadAddress(
        address,
        session.data.network,
        session.data.chainData.transactions,
        AbortSignal.any([requestSignal(options.signal), publicationController.signal]),
        options.onProgress,
        { scope: fetchScope },
        {
          onHistory: (history, detailTotal, truncated) => {
            const observation = fetchScope!.markDataObservation(
              { history, truncated, scannedAt: new Date().toISOString() },
              identity,
            );
            recordAddressObservations(
              { addressHistories: { [address]: observation } },
              options.accept,
            );
            options.onHistory?.(detailTotal);
          },
          onTransaction: (transaction) => {
            pending.push(transaction);
            if (!timer)
              timer = setTimeout(() => {
                try {
                  flush();
                } catch (error) {
                  publicationError = error;
                  publicationFailed = true;
                  publicationController.abort();
                }
              }, 16);
          },
        },
      );
      if (publicationFailed) throw publicationError;
      flush();
      recordTransactions(session.data.id, [], {
        promotionIds: result.observedTransactionIds,
        accept: options.accept,
      });
      return result;
    } catch (error) {
      throw publicationFailed ? publicationError : error;
    } finally {
      if (timer) clearTimeout(timer);
      if (!publicationFailed) flush();
    }
  };
  const recordTransactions = (
    id: string,
    transactions: Transaction[],
    options: RecordTransactionOptions = {},
  ) => {
    const promotionIds =
      options.promotionIds ?? transactions.map((transaction) => transaction.txid);
    let accepted = false;
    currentSession(id)?.edit((current) => {
      if (options.accept && !options.accept(current)) return current;
      accepted = true;
      if (!transactions.length && !promotionIds.length) return current;
      const promoted = options.contextIds
        ? promoteInputContext(current, promotionIds)
        : clearContextProvenance(current, promotionIds);
      const merged = !transactions.length
        ? promoted
        : {
            ...promoted,
            chainData: {
              ...promoted.chainData,
              transactions: {
                ...promoted.chainData.transactions,
                ...Object.fromEntries(
                  transactions.map((transaction) => [
                    transaction.txid,
                    mergeTransactionObservations(
                      promoted.chainData.transactions[transaction.txid],
                      transaction,
                      current.network,
                    ),
                  ]),
                ),
              },
            },
          };
      return options.contextIds ? markContextTransactions(merged, options.contextIds) : merged;
    }, false);
    return accepted;
  };
  const refreshTransaction = async (id: string, signal?: AbortSignal) => {
    signal?.throwIfAborted();
    if (!activeWorkspace) throw new Error('Open a workspace first.');
    const session = currentSession(activeWorkspace.id);
    if (!session || session.locking)
      throw new DOMException('Workspace session ended.', 'AbortError');
    if (activeWorkspace.demo)
      throw new Error('Live lookups are disabled for legacy synthetic workspaces.');
    const txid = id.toLowerCase();
    if (!session.data.chainData.transactions[txid]) return false;
    const transaction = await fetchTransaction(activeWorkspace.network, txid, signal, undefined, {
      scope: fetchScope,
      priority: 'navigation',
      observation: {},
    });
    signal?.throwIfAborted();
    return recordTransactions(activeWorkspace.id, [transaction], {
      promotionIds: [],
      accept: (workspace) => !!workspace.chainData.transactions[txid],
    });
  };
  return {
    network: activeWorkspace?.network,
    read: {
      spending: async (transaction, vout, signal, offset, unavailableTxids) => {
        const session = requireSession(signal);
        const result = await loadSpending(
          transaction,
          {
            network: session.data.network,
            transactions: session.data.chainData.transactions,
          },
          vout,
          requestSignal(signal),
          offset,
          { scope: fetchScope, priority: 'background' },
          unavailableTxids,
        );
        requireSession(signal);
        return result;
      },
      transaction: getTransaction,
      addressBalance: getAddressBalance,
      addressUtxos: getAddressUtxos,
      addressHistory: getAddressHistory,
    },
    observe: {
      walletScan: async (wallet, options) => {
        const session = requireSession(options.signal);
        const isBound = (current: Workspace) =>
          current.wallets.definitions.some(
            (entry) =>
              entry.id === wallet.id &&
              entry.key === wallet.key &&
              entry.scriptType === wallet.scriptType,
          );
        if (!isBound(session.data))
          throw new DOMException('Wallet was removed or replaced.', 'AbortError');
        const result = await scanWallet(
          wallet,
          session.data.network,
          session.data.chainData.transactions,
          {
            ...options,
            signal: requestSignal(options.signal),
            fetchHints: { scope: fetchScope },
          },
        );
        const latest = requireSession(options.signal);
        if (!isBound(latest.data))
          throw new DOMException('Wallet was removed or replaced.', 'AbortError');
        latest.edit(
          (current) => applyWalletScan(current, result.wallet, result.transactions),
          false,
        );
        return { ...result, snapshot: requireSession(options.signal).data };
      },
      watchedAddresses: async (addresses, options = {}) => {
        const session = requireSession(options.signal);
        const known = { ...session.data.chainData.transactions };
        const completed: {
          address: string;
          result: Awaited<ReturnType<typeof loadAddress>>;
          observation: AddressHistoryObservation;
        }[] = [];
        let added = 0,
          refreshed = 0,
          partial = false;
        try {
          for (const address of addresses) {
            const latest = requireSession(options.signal);
            if (!latest.data.chainData.watchedAddresses.includes(address)) continue;
            const identity = {};
            fetchScope!.beginObservation(identity);
            const result = await loadAddress(
              address,
              session.data.network,
              known,
              requestSignal(options.signal),
              undefined,
              { scope: fetchScope },
            );
            requireSession(options.signal);
            completed.push({
              address,
              result,
              observation: fetchScope!.markDataObservation(
                {
                  history: result.history,
                  truncated: result.truncated,
                  scannedAt: new Date().toISOString(),
                },
                identity,
              ),
            });
            for (const tx of result.transactions) {
              if (known[tx.txid]) refreshed++;
              else added++;
              known[tx.txid] = mergeTransactionObservations(
                known[tx.txid],
                tx,
                session.data.network,
              );
            }
            partial ||= result.truncated;
          }
        } finally {
          const latest = currentSession(session.data.id);
          if (latest && (!options.accept || options.accept(latest.data))) {
            const retained = completed.filter(({ address }) =>
              latest.data.chainData.watchedAddresses.includes(address),
            );
            recordTransactions(
              session.data.id,
              retained.flatMap(({ result }) => result.transactions),
              {
                promotionIds: retained.flatMap(({ result }) => result.observedTransactionIds),
                accept: options.accept,
              },
            );
            recordAddressObservations(
              {
                addressHistories: Object.fromEntries(
                  retained.map(({ address, observation }) => [address, observation]),
                ),
              },
              options.accept,
            );
          }
        }
        return { added, refreshed, partial };
      },
      transactions: recordTransactions,
      refreshTransaction,
      addresses: recordAddressObservations,
      addressHistory: observeAddressHistory,
    },
  };
}
