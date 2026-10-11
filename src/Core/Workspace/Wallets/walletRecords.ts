import {
  addressToScriptHash,
  MAX_MONEY_SATS,
  type Network,
  sats,
  outputScriptHash,
} from '../../Bitcoin';

import {
  type PreviousOutputIndex,
  type Transaction,
  indexPreviousOutputs,
  resolvePreviousOutput,
} from '../../ChainData';

import type { Wallet, WalletAddress } from './wallets';
import type { Workspace } from '../workspace';

export interface WalletTransactionRecord {
  txid: string;
  transaction?: Transaction;
  height?: number;
  mempool: boolean;
  time?: number;
  /** Effect relative to this wallet's verified discovered scripts, not ownership
   * of the whole transaction or identification of its counterparties. */
  direction: 'received' | 'sent' | 'transfer' | 'unknown';
  /** Known matching outputs. This alone does not establish the net effect. */
  receivedSats?: number;
  /** Matching inputs, available only when every input's identity/value resolves. */
  spentSats?: number;
  /** Matching outputs minus matching inputs, with complete input/output evidence. */
  netSats?: number;
  /** Whole-transaction fee, never an allocation of that fee to this wallet. */
  feeSats?: number;
  /** Inputs whose previous output identity or value cannot be resolved. */
  missingInputCount: number;
}

export interface WalletUtxoRecord {
  txid: string;
  vout: number;
  valueSats: number;
  height: number;
  address: string;
  scripthash: string;
}

export interface WalletAddressRecord extends WalletAddress {
  loadedOutputCount: number;
}

function observedSats(value: number): number | undefined {
  const amount = sats(value);
  return value >= 0 &&
    Number.isSafeInteger(amount) &&
    amount >= 0 &&
    amount <= MAX_MONEY_SATS &&
    Math.abs(value - Number(value.toFixed(8))) <= Number.EPSILON * Math.max(1, Math.abs(value))
    ? amount
    : undefined;
}

type TransactionEffect = Pick<
  WalletTransactionRecord,
  'direction' | 'receivedSats' | 'spentSats' | 'netSats' | 'feeSats' | 'missingInputCount'
>;

/** A missing co-input may itself match this wallet, so it cannot be counted as
 * external or zero. Attached output facts qualify without loading their creator. */
function transactionEffect(
  transaction: Transaction | undefined,
  hashes: ReadonlySet<string>,
  network: Network,
  prevouts: PreviousOutputIndex,
): TransactionEffect {
  if (!transaction) return { direction: 'unknown', missingInputCount: 0 };
  let received = 0;
  let receivedComplete = true;
  let outputTotal = 0;
  let outputValuesComplete = transaction.vout.length > 0;
  let outputsComplete = transaction.vout.length > 0;
  let allOutputsMatch = transaction.vout.length > 0;
  const outputIndexes = new Set<number>();
  for (const output of transaction.vout) {
    const hash = outputScriptHash(output, network);
    const matches = hash !== undefined && hashes.has(hash);
    const amount = observedSats(output.value);
    const invalidIndex = !Number.isSafeInteger(output.n) || output.n < 0 || output.n > 0xffffffff;
    const duplicate = outputIndexes.has(output.n);
    outputIndexes.add(output.n);
    if (amount === undefined || duplicate || invalidIndex) {
      outputValuesComplete = false;
      if (matches) receivedComplete = false;
    } else {
      outputTotal += amount;
      if (matches) received += amount;
    }
    if (!hash || amount === undefined || duplicate || invalidIndex) outputsComplete = false;
    if (!matches) allOutputsMatch = false;
  }
  outputValuesComplete &&= outputTotal <= MAX_MONEY_SATS;
  receivedComplete &&= received <= MAX_MONEY_SATS;
  outputsComplete &&= outputValuesComplete;

  let spent = 0;
  let inputTotal = 0;
  let missingInputCount = 0;
  let inputValuesComplete = transaction.vin.length > 0;
  let allInputsMatch = transaction.vin.length > 0;
  const firstInput = transaction.vin[0];
  const coinbase =
    transaction.vin.length === 1 &&
    firstInput.coinbase !== undefined &&
    firstInput.txid === undefined &&
    firstInput.vout === undefined &&
    firstInput.prevout === undefined;
  const inputPoints = new Set<string>();
  for (const input of transaction.vin) {
    if (coinbase) {
      allInputsMatch = false;
      continue;
    }
    const point = `${input.txid}:${input.vout}`;
    const resolution = resolvePreviousOutput({ network, transactions: {} }, input, prevouts);
    if (
      input.coinbase !== undefined ||
      inputPoints.has(point) ||
      (resolution.status !== 'loaded' && resolution.status !== 'attached')
    ) {
      inputValuesComplete = false;
      allInputsMatch = false;
      missingInputCount++;
      continue;
    }
    inputPoints.add(point);
    const amount = observedSats(resolution.output.value);
    const hash = outputScriptHash(resolution.output, network);
    if (amount === undefined) inputValuesComplete = false;
    else inputTotal += amount;
    if (!hash || amount === undefined) missingInputCount++;
    if (hash && hashes.has(hash)) {
      if (amount !== undefined) spent += amount;
    } else allInputsMatch = false;
  }
  inputValuesComplete &&= inputTotal <= MAX_MONEY_SATS;
  const inputsComplete =
    transaction.vin.length > 0 && missingInputCount === 0 && inputValuesComplete;
  const receivedSats = receivedComplete ? received : undefined;
  const spentSats = inputsComplete ? spent : undefined;
  const complete = inputsComplete && outputsComplete && receivedSats !== undefined;
  const netSats = complete ? receivedSats - spent : undefined;
  const fee = inputTotal - outputTotal;
  const feeSats =
    !coinbase && inputValuesComplete && outputValuesComplete && fee >= 0 ? fee : undefined;
  const direction = !complete
    ? 'unknown'
    : allInputsMatch && allOutputsMatch
      ? 'transfer'
      : netSats! > 0
        ? 'received'
        : netSats! < 0
          ? 'sent'
          : 'unknown';
  return { direction, receivedSats, spentSats, netSats, feeSats, missingInputCount };
}

/** An address claim must agree with its network and recorded Electrum hash. */
export function verifiedWalletAddresses(
  wallet: Pick<Wallet, 'addresses'>,
  network: Network,
): WalletAddress[] {
  const unique = new Map<string, WalletAddress>();
  for (const address of wallet.addresses) {
    try {
      if (addressToScriptHash(address.address, network) === address.scripthash)
        unique.set(address.scripthash, address);
    } catch {
      // Invalid imported claims cannot participate in wallet association.
    }
  }
  return [...unique.values()];
}

/** Count received outputs in the local transaction snapshot, including spent
 * outputs. This is neither a complete history count nor an unspent balance.
 */
export function listWalletAddresses(
  workspace: Pick<Workspace, 'network'> & {
    chainData: Pick<Workspace['chainData'], 'transactions'>;
  },
  wallet: Pick<Wallet, 'addresses'>,
): WalletAddressRecord[] {
  const records = verifiedWalletAddresses(wallet, workspace.network).map((address) => ({
    ...address,
    loadedOutputCount: 0,
  }));
  const byScript = new Map(records.map((record) => [record.scripthash, record]));
  for (const tx of Object.values(workspace.chainData.transactions)) {
    for (const output of tx.vout) {
      const record = byScript.get(outputScriptHash(output, workspace.network) ?? '');
      if (record) record.loadedOutputCount++;
    }
  }
  return records.sort(
    (a, b) => a.branch - b.branch || a.index - b.index || a.address.localeCompare(b.address),
  );
}

/** Historical association is separate from ownership and current unspent status.
 * Include unloaded history entries so partial scans remain navigable. Script
 * matches add directly received/spent outputs, never unrelated co-inputs.
 */
export function listWalletTransactions(
  workspace: Pick<Workspace, 'network'> & {
    chainData: Pick<Workspace['chainData'], 'transactions'>;
  },
  wallet: Pick<Wallet, 'addresses'>,
): WalletTransactionRecord[] {
  const addresses = verifiedWalletAddresses(wallet, workspace.network);
  const hashes = new Set(addresses.map((address) => address.scripthash));
  const histories = new Map<string, Set<number>>();
  for (const address of addresses) {
    for (const entry of address.history ?? []) {
      if (
        !/^[0-9a-f]{64}$/i.test(entry.tx_hash) ||
        !Number.isSafeInteger(entry.height) ||
        entry.height < -1 ||
        entry.height > 0x7fffffff
      )
        continue;
      const id = entry.tx_hash.toLowerCase();
      const heights = histories.get(id) ?? new Set<number>();
      heights.add(entry.height);
      histories.set(id, heights);
    }
  }
  const ids = new Set(histories.keys());
  const ownedOutputs = new Set<string>();
  const prevouts = indexPreviousOutputs({
    network: workspace.network,
    transactions: workspace.chainData.transactions,
  });
  for (const [outpoint, resolution] of prevouts) {
    if (resolution.status !== 'loaded' && resolution.status !== 'attached') continue;
    if (hashes.has(outputScriptHash(resolution.output, workspace.network) ?? '')) {
      ownedOutputs.add(outpoint);
      ids.add(outpoint.slice(0, 64));
    }
  }
  for (const tx of Object.values(workspace.chainData.transactions)) {
    if (
      tx.vin.some(
        (input) =>
          input.txid !== undefined &&
          input.vout !== undefined &&
          ownedOutputs.has(`${input.txid}:${input.vout}`),
      )
    )
      ids.add(tx.txid);
  }
  const records = [...ids]
    .map((txid): WalletTransactionRecord => {
      const candidate = workspace.chainData.transactions[txid];
      const transaction = candidate?.txid.toLowerCase() === txid ? candidate : undefined;
      const heights = histories.get(txid);
      // Multiple address observations can straddle a block or reorganization.
      // Preserve the record but avoid inventing a definitive conflicting height.
      const observed = heights?.size === 1 ? [...heights][0] : undefined;
      const mempool =
        (transaction?.status?.kind === 'mempool') === true ||
        (transaction?.status?.blockHeight === undefined &&
          (transaction?.status?.confirmations ?? 0) <= 0 &&
          observed !== undefined &&
          observed <= 0);
      return {
        txid,
        transaction,
        height: mempool
          ? undefined
          : (transaction?.status?.blockHeight ?? (observed && observed > 0 ? observed : undefined)),
        mempool,
        time: transaction?.status?.blocktime ?? transaction?.status?.time,
        ...transactionEffect(transaction, hashes, workspace.network, prevouts),
      };
    })
    .sort(
      (a, b) =>
        Number(b.mempool) - Number(a.mempool) ||
        (b.height ?? -1) - (a.height ?? -1) ||
        (b.time ?? -1) - (a.time ?? -1) ||
        a.txid.localeCompare(b.txid),
    );
  return records;
}

/** Bind an Electrum observation to the loaded funding output before navigation.
 * The raw script wins over decoded address text. This verifies output facts, not
 * the server's current claim that the output remains unspent.
 */
export function verifyWalletUtxo(
  record: WalletUtxoRecord,
  transaction: Transaction,
  network: Network,
): boolean {
  try {
    const output = transaction.vout.find((item) => item.n === record.vout);
    return (
      transaction.txid === record.txid &&
      output !== undefined &&
      Number.isSafeInteger(record.vout) &&
      record.vout >= 0 &&
      record.vout <= 0xffffffff &&
      Number.isSafeInteger(record.valueSats) &&
      record.valueSats >= 0 &&
      record.valueSats <= 2_100_000_000_000_000 &&
      sats(output.value) === record.valueSats &&
      addressToScriptHash(record.address, network) === record.scripthash &&
      outputScriptHash(output, network) === record.scripthash
    );
  } catch {
    return false;
  }
}
