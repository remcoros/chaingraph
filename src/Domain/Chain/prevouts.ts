import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import { address as bitcoinAddress, networks as bitcoinNetworks } from 'bitcoinjs-lib';
import {
  outputNodeId,
  sats,
  type Network,
  type Transaction,
  type TxInput,
  type TxOutput,
  type Workspace,
} from '../types';

export type PreviousOutputResolution =
  { status: 'loaded' | 'attached'; output: TxOutput } | { status: 'missing' | 'conflict' };

export type PreviousOutputIndex = ReadonlyMap<string, PreviousOutputResolution>;

function canonicalTxid(value: string | undefined): string | undefined {
  return value && /^[0-9a-f]{64}$/i.test(value) ? value.toLowerCase() : undefined;
}

function validVout(value: number | undefined): value is number {
  return Number.isSafeInteger(value) && value! >= 0 && value! <= 0xffffffff;
}

export function outputScriptHex(output: TxOutput, network: Network): string | undefined {
  if (output.scriptPubKey.hex !== undefined) return output.scriptPubKey.hex.toLowerCase();
  const reported =
    output.scriptPubKey.address ??
    (output.scriptPubKey.addresses?.length === 1 ? output.scriptPubKey.addresses[0] : undefined);
  if (!reported) return undefined;
  try {
    return bytesToHex(
      bitcoinAddress.toOutputScript(
        reported,
        network === 'mainnet' ? bitcoinNetworks.bitcoin : bitcoinNetworks.testnet,
      ),
    );
  } catch {
    return undefined;
  }
}

export function outputScriptHash(output: TxOutput, network: Network): string | undefined {
  try {
    const hex = outputScriptHex(output, network);
    return hex === undefined ? undefined : bytesToHex(sha256(hexToBytes(hex)).reverse());
  } catch {
    return undefined;
  }
}

export function previousOutputsConflict(
  left: TxOutput,
  right: TxOutput,
  network: Network,
): boolean {
  if (sats(left.value) !== sats(right.value)) return true;
  const leftType = left.scriptPubKey.type,
    rightType = right.scriptPubKey.type;
  if (
    leftType &&
    rightType &&
    leftType !== 'nonstandard' &&
    rightType !== 'nonstandard' &&
    leftType !== rightType
  )
    return true;
  const leftScript = outputScriptHex(left, network);
  const rightScript = outputScriptHex(right, network);
  return leftScript !== undefined && rightScript !== undefined && leftScript !== rightScript;
}

/** Index output facts without inventing their creating transactions. */
export function indexPreviousOutputs(workspace: Pick<Workspace, 'network' | 'transactions'>) {
  const result = new Map<string, PreviousOutputResolution>();
  const transactions = Object.entries(workspace.transactions).flatMap(([key, transaction]) => {
    const txid = canonicalTxid(transaction.txid);
    return txid && canonicalTxid(key) === txid ? [{ txid, transaction }] : [];
  });
  const loadedTxids = new Set(transactions.map(({ txid }) => txid));
  for (const { txid, transaction } of transactions)
    for (const output of transaction.vout) {
      if (!validVout(output.n)) continue;
      result.set(outputNodeId(txid, output.n), { status: 'loaded', output });
    }

  for (const { transaction } of transactions)
    for (const input of transaction.vin) {
      const txid = canonicalTxid(input.txid);
      if (!txid || !validVout(input.vout)) continue;
      const id = outputNodeId(txid, input.vout);
      const current = result.get(id);
      if (loadedTxids.has(txid) && !current) {
        result.set(id, { status: 'conflict' });
        continue;
      }
      if (!input.prevout) continue;
      const output: TxOutput = { n: input.vout, ...input.prevout };
      if (current?.status === 'conflict') continue;
      if (
        current &&
        (current.status === 'loaded' || current.status === 'attached') &&
        previousOutputsConflict(current.output, output, workspace.network)
      ) {
        result.set(id, { status: 'conflict' });
      } else if (current && (current.status === 'loaded' || current.status === 'attached')) {
        result.set(id, {
          ...current,
          output: {
            ...current.output,
            scriptPubKey: {
              ...output.scriptPubKey,
              ...current.output.scriptPubKey,
              type:
                current.output.scriptPubKey.type &&
                current.output.scriptPubKey.type !== 'nonstandard'
                  ? current.output.scriptPubKey.type
                  : output.scriptPubKey.type,
            },
          },
        });
      } else if (!current) {
        result.set(id, { status: 'attached', output });
      }
    }
  return result;
}

export function resolvePreviousOutput(
  workspace: Pick<Workspace, 'network' | 'transactions'>,
  point: Pick<TxInput, 'txid' | 'vout'>,
  index: PreviousOutputIndex = indexPreviousOutputs(workspace),
): PreviousOutputResolution {
  const txid = canonicalTxid(point.txid);
  if (!txid || !validVout(point.vout)) return { status: 'missing' };
  return index.get(outputNodeId(txid, point.vout)) ?? { status: 'missing' };
}

/** Preserve compatible enrichment when a status refresh returns less verbose data. */
export function mergeTransactionObservations(
  previous: Transaction | undefined,
  incoming: Transaction,
  network: Network,
): Transaction {
  if (!previous || previous.txid !== incoming.txid) return incoming;
  const vin = incoming.vin.map((input, index) => {
    const before = previous.vin[index];
    if (
      !before ||
      before.txid !== input.txid ||
      before.vout !== input.vout ||
      before.coinbase !== input.coinbase
    )
      return input;
    if (!input.prevout) return before.prevout ? { ...input, prevout: before.prevout } : input;
    if (!before.prevout) return input;
    const n = input.vout!;
    if (previousOutputsConflict({ n, ...before.prevout }, { n, ...input.prevout }, network))
      throw new Error('Conflicting previous-output observations.');
    return {
      ...input,
      prevout: {
        ...before.prevout,
        ...input.prevout,
        scriptPubKey: { ...before.prevout.scriptPubKey, ...input.prevout.scriptPubKey },
      },
    };
  });
  return vin.some((input, index) => input !== incoming.vin[index])
    ? { ...incoming, vin }
    : incoming;
}

/** The single address a loaded output pays, when it has exactly one. */
export function outputAddress(output: Transaction['vout'][number]) {
  return (
    output.scriptPubKey.address ??
    (output.scriptPubKey.addresses?.length === 1 ? output.scriptPubKey.addresses[0] : undefined)
  );
}
