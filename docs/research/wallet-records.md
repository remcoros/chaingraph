# Wallet transaction and UTXO lists

Reviewed 2026-09-08.

## Protocol sources

- [ElectrumX protocol 1.4-compatible methods](https://electrumx.readthedocs.io/en/latest/protocol-methods.html#blockchain-scripthash-listunspent): `blockchain.scripthash.listunspent` returns a script's unspent outputs, with transaction ID, output index, satoshi value and block height. It includes mempool-created outputs and excludes outputs spent in the server's mempool. Height zero denotes an unconfirmed funding transaction. The call does not provide an address cursor or a synchronized multi-address snapshot.
- [Electrum protocol changes](https://electrum-protocol.readthedocs.io/en/latest/protocol-changes.html): newer protocol versions change the method family. Chaingraph currently negotiates protocol 1.4 in `server/electrum.ts`; the implementation uses that negotiated contract, not the newer scriptPubKey response shape.

## Application behavior

`domain/walletRecords.ts` combines saved wallet-address histories with loaded
transactions whose outputs or input prevouts match verified wallet scripts.
History-only entries remain navigable even when their transactions have not
been downloaded. These are historical associations, not ownership hypotheses.
Unconfirmed observations appear first, followed by decreasing block height,
time and a stable transaction-ID tie break. Conflicting address-history heights
remain unknown unless the loaded transaction supplies a block observation.

`lib/walletUtxos.ts` checks only already discovered receive/change addresses.
Each action processes at most 100 unique scripts with four concurrent requests.
A continuation cursor addresses the same immutable address snapshot. Restart
when wallet discovery changes that snapshot. Each response is bounded to 10,000
outputs, and a batch to 50,000; errors remain explicit partial coverage.
A malformed response contributes no records. Conflicting duplicate outpoints
are removed. Address/network claims are checked before any request.

These browser-memory observations include a check timestamp and network. They
are not an atomic snapshot, spendability guarantee, complete wallet balance or
persistent cache. Coinbase maturity and external mempool policy are outside
this list's scope. Unloaded spending transactions do not establish that an
output is unspent. Before navigation, the funding output's script, value and
index must agree with the reported outpoint. Cancelling discards late results.

## Verification

Unit tests cover history ordering and partial loading, authoritative script
matching, wrong network/address claims, malformed and oversized responses,
bounded concurrency/continuation, contradictory duplicates, per-address errors
and cancellation. These are fixture-backed protocol tests, not live-node
validation or an SPV proof of the upstream observations.
