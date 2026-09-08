# Transaction confirmation observations

Consulted 2026-09-08. Application code is original MIT code; these are protocol references.

## Primary sources

- [Bitcoin Core 30.0 getrawtransaction](https://bitcoincore.org/en/doc/30.0.0/rpc/rawtransactions/getrawtransaction/): the no-blockhash lookup retrieves mempool transactions and, when a transaction index is available, transactions in blocks. Verbose responses include an optional containing block hash and confirmation count. They do not provide the containing block's height. The implementation treats a successful Core response with no block hash, absent or zero confirmations, and ordinary inputs as a mempool observation. A bare zero count in imported or Electrum verbose data is insufficient.
- [Bitcoin Core 30.0 getblockheader](https://bitcoincore.org/en/doc/30.0.0/rpc/blockchain/getblockheader/): verbose headers provide the requested hash, its height, and an active-chain confirmation count. A negative count identifies a block outside the active chain. The proxy allows only the bounded read-only hash/verbosity request; the browser validates its response and checks the returned hash against the request.
- [ElectrumX script history](https://electrumx.readthedocs.io/en/latest/protocol-methods.html#blockchain-scripthash-get-history) and [mempool history](https://electrumx.readthedocs.io/en/latest/protocol-methods.html#blockchain-scripthash-get-mempool): positive history heights identify the block containing a transaction. Heights zero and minus one identify mempool transactions, distinguished by whether their inputs are confirmed. Existing wallet/address/spending queries supply these observations without extra history queries.

## Implementation and limits

`Transaction.blockHeight` stores an actual observed height. `Transaction.mempool` records an observed mempool membership. Both remain encrypted with the workspace and are optional for older imports. The shared status formatter distinguishes confirmed observations, observed mempool transactions, conflicts and unknown status. It never computes a height by subtracting a saved confirmation count from a newer chain tip.

A newly fetched Core transaction with a block hash and positive confirmations prefers a matching header over an earlier Electrum history height. This avoids combining observations from opposite sides of a reorganization. When history supplies a height without binding it to that block hash, unrelated block hashes, times and confirmation counts are cleared. Refreshing a cached transaction to a different or previously unknown height also clears that old block metadata. Entering the mempool clears block metadata.

Header coordinates are cached only in browser memory, keyed by network and block hash, with at most 512 records. These coordinates are immutable; active-chain status is never cached. Cache reuse requires a freshly fetched transaction reporting positive confirmations. Concurrent header requests share work only when their cancellation signal is the same, so cancelling one workspace operation cannot cancel another. Existing bounded scan concurrency also bounds header requests. Known history observations update already cached transaction metadata without downloading those transactions again.

Header lookup is optional metadata enrichment. Unavailable or malformed header responses preserve the successfully fetched transaction and leave its height unknown, or use a separate available history observation. Cancellation still aborts the complete operation. No request occurs during rendering and the backend retains no index or workspace cache.

These are observations from the user's configured Core/Electrum pair, not SPV inclusion proofs or a continuously updated live status. A saved mempool observation can become stale after confirmation, eviction or replacement. The UI explains this through its status tooltip; wallet refresh or a new lookup supplies a new observation. A containing block can also leave the active chain after a saved observation.

Targeted tests cover zero/unknown distinctions, schema bounds and contradictions, changed-height metadata, fresh-header preference, request reuse, network isolation, cache eviction, mismatched responses, reorganization and cancellation. Browser-level status rendering and live-service validation are separate gates.
