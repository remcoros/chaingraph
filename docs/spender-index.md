# Previous outputs and the Core 31 spender index

How Chaingraph obtains input values without loading every parent, and how the
optional `txospenderindex` lookup works. Verified against the Bitcoin Core 31.0
RPC documentation and the `v31.0` source tag; later versions may differ.

## Previous-output enrichment

`getrawtransaction` at verbosity 2 returns `vin[].prevout` (value, script,
optional address, creation height, coinbase flag) from the spending block's undo
data. One request for a 327-input CoinJoin returned all 327 input values and
scripts (432 KB) instead of requiring 113 parent downloads. Chaingraph requests
verbosity 2, falls back to verbosity 1 when a node reports prevouts unavailable,
and then to Electrum's `blockchain.transaction.get`.

Attached prevout observations are validated (amount bounds and precision,
outpoint association, network and script consistency) and stored on the input.
A shared resolver reports each outpoint as `loaded` (parent present),
`attached`, `missing` or `conflict`; conflicts stay unknown and imported
workspaces containing them are rejected. Attached evidence feeds the flow view,
graph placeholders, wallet matches, filters, fees and analysis, but never
fabricates a parent transaction node. Full parents load on explicit navigation
or through the bounded bulk action.

Limits: txid-only retrieval needs a ready `txindex` or a block-hash hint;
mempool and coinbase transactions carry no prevouts; pruned or missing undo data
reduces coverage. `gettxout` covers only currently unspent outputs and cannot
replace historical lookup. `getblock` verbosity 3 could supply prevouts for many
transactions in one block but is too large for single lookups and is not used.

## `gettxspendingprevout`

Core 31 adds `txospenderindex`, mapping exact outpoints to spending
transactions. The RPC takes an array of `{txid, vout}` and an options object;
`mempool_only` and `return_spending_tx` are option fields, not positional
booleans. Chaingraph sends `{ mempool_only: false, return_spending_tx: false }`
so confirmed coverage is required and spenders are loaded through the normal
validated transaction path. Rows echo `txid`/`vout` and add `spendingtxid`
(plus `blockhash` for confirmed spends).

Behaviour that shapes the integration:

- The mempool is searched first. Without explicit `mempool_only:false`, an
  absent index could return a complete-looking empty reply. Even with it, a
  request whose spenders are all in the mempool can succeed without an index,
  so success does not certify index readiness.
- The index returns unavailable during initial sync and after I/O errors; older
  Core versions reject the method. Timeouts are failures, never observations.
- The index requires an unpruned node and readable block data. Block
  disconnection removes records, so there is no atomic snapshot across a lookup,
  a transaction download and later navigation.
- Empty rows mean this node found no spender at that moment. Nonexistent
  outpoints also yield empty rows. Emptiness never proves an output is unspent.

## Integration

`CHAINGRAPH_USE_TXOSPENDERINDEX=true` in a network file opts that network in and
is advertised in `/api/networks` as configuration, not health. The server
allowlists only the fixed options, 1 to 500 canonical deduplicated outpoints
with non-negative 32-bit indexes, validates that reply rows correlate exactly,
and raises that network's request body limit from 16 KiB to 64 KiB. Failures
start a 30-second per-network cooldown; nothing else is retained. No
`getindexinfo` polling is added because the lookup itself checks readiness.

In the browser, `fetchIndexedSpenders` re-validates correlation, deduplicates
spending IDs, reuses loaded transactions and verifies that every downloaded
spender really references the requested outpoint. A batch allows 500 outpoints
and at most 250 direct transaction loads, four at a time, leaving budget for
Electrum history fallback within the 500-candidate action limit. Continuation
pages skip the index so a capability change cannot shift the candidate list under
an existing offset, and known-but-unavailable spender IDs are carried until a
later page validates them. Block-hash hints flow through `fetchTransaction`;
`in_active_chain:false` becomes an outside-active-chain observation. Existing
saved competing spends are kept as alternative observations rather than erased.

Address and wallet discovery stay Electrum based. No spender results are cached
between actions, and a missing spender is never evidence of an unspent output.
Sources are listed in [references.md](references.md).
