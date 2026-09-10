# Current UTXO status

Reviewed 2026-09-08.

Primary reference: [Bitcoin Core 30.0 gettxout RPC](https://bitcoincore.org/en/doc/30.0.0/rpc/blockchain/gettxout/).

The Inspector explicitly queries `gettxout(txid, vout, true)` on the workspace network. Including the mempool means outputs consumed by mempool transactions do not appear. A non-null response describes an unspent output at that node when checked; it does not establish spending authority or coinbase maturity. Null means the outpoint was absent from this node's queried UTXO view, not proof of a particular spending transaction.

Inspector results remain ephemeral, with a check timestamp and visible mempool scope. Loaded spender relationships are separate historical observations. Changing selection, workspace or expected output facts cancels the request and discards stale completion. Known amount/script metadata must agree with the returned output. The check does not change graph data, labels, filters, or tracing availability.

Connection scans reuse this validated lookup as of 2026-09-11. A positive scan
endpoint retains its compact check timestamp, best-block identity and mempool
scope inside the encrypted latest-result record, together with bounded creator
proof. It remains a historical observation, not a current UTXO cache. Empty
spender-index or history replies are never substituted for a positive UTXO check.
