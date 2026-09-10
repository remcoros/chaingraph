# Bitcoin Core 31 output spender index

Verified 2026-09-10 against the official Core 31 RPC documentation and release
source. The upstream `v31.0` tag resolves to commit
`6574cb40869b96b9ffc79c19dc8f4e467d60f321`. This verification does not establish
behavior in future versions. The earlier discussion-only research was consulted;
this document records independent verification and the implemented decision.

## Protocol and coverage

[Core 31 release notes](https://bitcoincore.org/en/releases/31.0/) announce
`txospenderindex` and the extended RPC. The index maps exact output references to
spending transactions; it does not discover wallet addresses or supply previous
output values.

The [official gettxspendingprevout documentation](https://bitcoincore.org/en/doc/31.0.0/rpc/blockchain/gettxspendingprevout/)
and [pinned RPC implementation](https://github.com/bitcoin/bitcoin/blob/6574cb40869b96b9ffc79c19dc8f4e467d60f321/src/rpc/mempool.cpp)
confirm this positional request shape:

```json
[
  [{ "txid": "<64 hexadecimal characters>", "vout": 0 }],
  { "mempool_only": false, "return_spending_tx": false }
]
```

The flags are fields of the second argument, an options object. They are not
separate positional boolean arguments. Each reply row echoes `txid` and `vout`.
A discovered spender adds `spendingtxid`; an indexed confirmed spender also adds
`blockhash`. Setting `return_spending_tx=true` adds serialized transaction hex in
`spendingtx`, not verbose JSON. Chaingraph requests false and uses its validated
verbose transaction loader.

The mempool is searched first. Omitting `mempool_only` permits mempool-only
coverage when the index is absent. Explicit false prevents an absent mempool
spender from silently becoming a complete empty reply without the index. If every
requested spender is in the mempool, the RPC can succeed even without an index.
Such success does not certify global index readiness. Empty rows describe the
node's lookup at that time; nonexistent outpoints can also yield empty rows.
Neither emptiness nor a failed lookup proves a valid unspent output exists.

## Availability and reorganizations

The [pinned index synchronization code](https://github.com/bitcoin/bitcoin/blob/6574cb40869b96b9ffc79c19dc8f4e467d60f321/src/index/base.cpp)
returns false during initial indexing. Once initially synchronized, it can drain
pending validation notifications before lookup. The RPC checks readiness only
when it needs confirmed coverage. An absent or initially syncing index produces
an RPC failure, as can index/block-data I/O errors. Older Core versions can reject
the method or options. Timeouts are another failure, never an empty observation.

[Core getindexinfo](https://bitcoincore.org/en/doc/31.0.0/rpc/util/getindexinfo/)
reports index summaries, including synchronization and the best indexed height.
The [pinned implementation](https://github.com/bitcoin/bitcoin/blob/6574cb40869b96b9ffc79c19dc8f4e467d60f321/src/rpc/node.cpp)
includes `txospenderindex` when configured. Chaingraph does not add a polling or
`getindexinfo` allowlist path: the explicit lookup itself checks needed readiness,
without a separate preflight race. Missing and syncing indexes share a sanitized
unavailable result rather than an unreliable diagnosis from raw exception text.

The [pinned index implementation](https://github.com/bitcoin/bitcoin/blob/6574cb40869b96b9ffc79c19dc8f4e467d60f321/src/index/txospenderindex.cpp)
stores hashed outpoints with transaction disk positions. Candidate disk records
are read and their inputs checked for exact equality, including possible hash
collisions. Block connection adds records; disconnection removes records. It
requires readable block data even when raw transaction return is disabled.
[Startup checks](https://github.com/bitcoin/bitcoin/blob/6574cb40869b96b9ffc79c19dc8f4e467d60f321/src/init.cpp)
reject pruning with this index. Chaingraph neither creates nor configures it.

There is no atomic snapshot spanning a spender lookup, transaction download and
later graph navigation. Mempool replacement, eviction and block reorganization
can occur between calls. Saved competing exact spends remain alternative
observations; they are not erased by a new or empty lookup.

The [getrawtransaction documentation](https://bitcoincore.org/en/doc/31.0.0/rpc/rawtransactions/getrawtransaction/)
and [pinned implementation](https://github.com/bitcoin/bitcoin/blob/6574cb40869b96b9ffc79c19dc8f4e467d60f321/src/rpc/rawtransaction.cpp)
confirm that a supplied block hash permits retrieval from that block without
`txindex` and supplies `in_active_chain`. Chaingraph carries the hint through
verbosity 2 and the existing narrowly permitted verbosity-1 retry, checks the
returned transaction ID, network-compatible scripts/addresses and exact input,
and marks a disconnected block as outside the active chain. Reused local bytes
get a fresh header check for a confirmed index observation. An unavailable or
inconsistent observation falls back to bounded history search.

## Application integration and limits

`CHAINGRAPH_USE_TXOSPENDERINDEX=false` is an application option in each isolated
network file. Opting in advertises that network through `spenderIndexNetworks` in
`/api/networks`; this describes configuration, not health. Restart the backend and
reload the browser after changing configuration. Other networks stay independent.

- The backend allowlists only explicit confirmed coverage with raw return disabled,
  1 to 500 strict outpoints and signed-32-bit nonnegative output indexes matching
  Core's parser. It canonicalizes/deduplicates outpoints and rejects malformed,
  duplicate, unrelated or partial reply rows. An opted-in backend accepts bounded
  64 KiB request bodies; the default remains 16 KiB. Existing upstream response,
  concurrency, queue and timeout bounds apply.
- Failures activate a 30-second per-network operational cooldown. Later explicit
  actions retry after expiry. Cancellation does not poison capability state.
  Only operational timing is retained, never outpoints, transactions or wallets.
- `fetchIndexedSpenders` validates reply correlation again, groups spending IDs,
  reuses loaded exact relationships and verifies every downloaded input match.
  A batch permits 500 outpoints and at most 250 distinct direct transaction loads,
  with four concurrent loads. The remaining budget allows history fallback, keeping
  `loadSpending` at 500 candidate transactions per action. Larger output selections
  use the existing history path. No spender-result cache survives the action.
- `loadSpending` powers Graph expansion, Inspector Find spending transactions and
  TransactionView output checks. Incomplete lookups use the full selected script
  set for fallback; continuation pages skip the index so capability recovery cannot
  narrow the candidate list underneath an existing history offset.
  Complete empty direct rows avoid history downloads. Failed fallback or known
  unavailable spender data remains partial; available exact relationships survive.
  History continuation remains explicit and its offsets describe the sorted
  current candidate history, not a stable chain snapshot across reorganizations.
  Browser continuation retains unresolved known spender IDs across pages, so an
  empty final page cannot silently erase an earlier transaction-data failure.
  Failed fallback reads withhold continuation; retry starts again with reusable
  loaded transactions rather than advancing over unavailable data.
- `searchTraceSpenders` shares the direct helper, retaining a total 12-candidate
  budget and its separate UTXO observation/history fallback. Trace UI stays disabled.
- TransactionView cached navigation and wallet loaded-spender/relationship indexes
  continue to use exact loaded inputs. New validated transactions enter the existing
  evidence merge. Wallet address discovery, incoming activity and gap scans remain
  Electrum based; no unbounded wallet scan, backend wallet index, ownership inference
  or backward prevout traversal is introduced.

## Validation boundaries

Backend protocol/configuration tests use local synthetic HTTP/TCP upstreams.
Browser and domain tests use synthetic/public fixtures. Tests cover opt-out,
confirmed/mempool/empty replies, strict bounds, fallback, cancellation, capability
recovery and isolation, malformed replies, wrong input/ID/network, disconnected
blocks and explicit/cached navigation. Initial implementation checks before rebasing onto updated main:

- Separate `npm ci` completed without a shared or symlinked dependency directory.
- `npm run build` passed TypeScript checking and the production bundle build.
- `npm test` passed 810 tests across 70 files, including backend synthetic servers.
- `npm run check:portability` and `git diff --check` passed.
- Twenty targeted Chromium tests passed serially with `CHAINGRAPH_E2E_PORT=4193`
  and `CHAINGRAPH_GRAPH_TEST_PORT=4194`: `core31-spender`, `tracing`, `flow-inputs`
  and `tracing-refinement`. Their upstream responses were mocked. Fresh screenshots
  were inspected and retained locally under `artifacts/`.
- Independent review findings were fixed with regressions for active-block
  uncertainty, cross-page unresolved coverage, failed fallback reads and Trace
  failure accounting. Existing tests with obsolete parent-loading assumptions,
  button selectors and analysis wording were updated to match established behavior.


The current operator nodes do not support this index. No live indexed success,
index build, Core configuration change, performance benchmark, disk-size estimate
or production deployment was performed. Performance improvement is an inference
from avoiding unrelated history downloads, not a measured latency claim.

### Validation after rebasing onto main

Rebased onto local main `09d6216` on 2026-09-10. No Git remote was configured.
A separate `npm ci`, `npm run build`, all 850 unit/backend tests across 75 files,
portability and focused formatting checks passed. All four Core 31 mocked browser
workflows passed on the dedicated ports, including a focused rerun after updating
the Inspector button selector to main's shortened label. The earlier 20-workflow
run above predates this rebase. Independent review confirmed feature preservation
and the resolved test-assertion conflict. No live index validation was performed.

### Integration with the background transaction scheduler

The scheduler rebase preserves `TransactionFetchHints` as the fifth argument of
`fetchTransaction`, with the optional spender block hint sixth and included in
scheduler identity. `loadSpending` takes fetch hints sixth and its bounded list
of unresolved continuation IDs seventh. The App supplies its unlocked session
scope. Direct and fallback transaction candidates use background priority and
one observation token per action, preserving navigation reservations and avoiding
coalescing with older navigation observations. Retained Trace accepts the same
optional hints but stays unmounted.

Session disposal also aborts bounded index/history RPCs and fresh header checks
for cached spender bytes. Those leaf requests combine the caller signal with the
session lifetime rather than nesting transaction scheduler jobs. Main's header
consumer cancellation and its new Fulcrum concurrency default of 16 are preserved.
The index option remains independently off by default for each network.

Validation after the scheduler rebase onto local main `897779b`: production build,
TypeScript, all 867 unit/backend tests across 77 files, portability and formatting
checks passed. Eight new mocked integration tests cover block-aware coalescing,
independent consumer cancellation, navigation reservations, direct/fallback
background priority, fresh observations and disposal during index/header RPCs.
The four targeted browser specs passed 21 workflows in total, including a focused
rerun of saved navigation after waiting for deferred entity filtering to settle.
They used ports 4193/4194 serially and mocked upstreams. Independent source review
found no remaining integration blockers. No live index validation was performed.
