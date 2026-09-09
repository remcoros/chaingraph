# Previous-output loading

Research date: 2026-09-09. This note records the evidence used by the focused
prevout-enrichment implementation.

## Findings

At the time of this investigation, `fetchTransaction` in `src/lib/api.ts`
requested Core `getrawtransaction` at verbosity 1. Core verbosity 2 can supply
`vin[].prevout.value`, script, optional
address, creation height and coinbase origin from the spending block's undo data.
The existing proxy schema already permitted verbosity 2. `TxInput` and `inputSchema`
in the application did not retain prevout details, so changing the RPC argument
alone would discard the extra information during parsing.

The current Graph flow automatically resolves only the selected missing creator;
bulk parent loading is explicit and bounded. Parent values elsewhere still depend
on loaded creating transactions. Thus richer input information should be separated
from loading full parent transactions and expanding graph context.

## Live public observations

Read-only serial requests through the running frontend's `/api/rpc` proxy, mainnet.
No credential files accessed. Each combination was requested once; timing is not a
controlled benchmark and does not measure parsing, rendering or encryption.

| Public transaction                                                 | Verbosity | Inputs | Prevout values/scripts | Bytes  | Seconds |
| ------------------------------------------------------------------ | --------- | ------ | ---------------------- | ------ | ------- |
| `85d2ca15bea33a592e73ed40c6a5da887feecf1e77f58ec7f580e00841645043` | 1         | 1      | 0                      | 1799   | 0.030   |
| same                                                               | 2         | 1      | 1                      | 2155   | 0.036   |
| `fb596c9f675471019c60e984b569f9020dac3b2822b16396042b50c890b45e5e` | 1         | 327    | 0                      | 308278 | 0.072   |
| same                                                               | 2         | 327    | 327                    | 431866 | 0.057   |

The large bundled WabiSabi example references 113 distinct parent transactions.
Verbosity 2 delivered all 327 input values and scripts in one transaction response.
This demonstrates live availability, not a measured speedup over 113 parent loads.

## Implemented approach and limits

1. Request enriched transaction data where input information is needed. Preserve
   validated optional prevout observations in encrypted workspace data.
2. Provide a shared previous-output resolver: loaded parent output or validated
   attached prevout observation, otherwise unknown. Detect conflicting observations
   instead of silently trusting conflicting imported data. Validate amount bounds,
   precision, outpoint association and network/script consistency.
3. Use this in flow, graph input placeholders, wallet membership/source discovery,
   filters, fee calculations and analysis. Do not fabricate full parent transactions
   from a single known output. Keep metadata IDs attached to canonical outpoints.
4. Fetch full parents on explicit navigation/expansion or when prevout details are
   absent. Deduplicate parent IDs and in-flight requests, preserve cancellation and
   workspace/network scope, and render progressive results.

For historical txid-only retrieval Core needs a ready `txindex`, or callers can
provide the containing block hash. The spender index is not needed for enrichment.
The pinned v31.0 implementation reads the containing block and undo data, so the
operation has server I/O cost. It returns ordinary transaction data without prevouts
for mempool transactions and coinbase; missing undo/pruned data also limits coverage
or produces errors. Parent-fetch fallback remains necessary. `gettxout` only covers
currently unspent outputs and cannot replace historical prevout lookup.

For many requested transactions within one known block, `getblock` verbosity 3 can
provide input details collectively, but a full verbose block is excessive for one
selected transaction and can exceed proxy response budgets. This is a possible
future bounded helper optimization, not a proposed default or persistent cache.

## Primary references

- [Core 31 getrawtransaction](https://bitcoincore.org/en/doc/31.0.0/rpc/rawtransactions/getrawtransaction/)
- [Pinned v31.0 implementation](https://github.com/bitcoin/bitcoin/blob/v31.0/src/rpc/rawtransaction.cpp)
- [Core getblock verbosity 3](https://bitcoincore.org/en/doc/30.0.0/rpc/blockchain/getblock/)
- [Core PR review: fee and previous-output enrichment](https://bitcoincore.reviews/23319)

The implementation validates optional attached value and script observations, rejects
conflicts at the workspace boundary, and treats runtime conflicts as unknown. Mempool
and coinbase responses without prevouts remain valid. The live observations above are
single smoke results only; end-to-end performance and browser behavior were not measured.
