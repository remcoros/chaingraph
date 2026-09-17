import { previousOutputsConflict, type Network } from '../Bitcoin';
import type { Transaction } from './transaction';
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
  const status =
    !incoming.status || (incoming.status.kind === 'unknown' && previous.status?.kind !== 'unknown')
      ? (previous.status ?? incoming.status)
      : incoming.status;
  return status !== incoming.status || vin.some((input, index) => input !== incoming.vin[index])
    ? { ...incoming, vin, status }
    : incoming;
}
