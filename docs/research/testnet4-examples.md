# Real testnet4 examples

The curated entries in `src/domain/examples.ts` are public blockchain examples, not synthetic fixtures or wallet ownership claims. The explorer is a discovery and credit source. Transaction structure and links were independently verified through the configured Bitcoin Core and Fulcrum pair, after the proxy confirmed testnet4.

## Discovery references

- [mempool.space testnet4 transaction page](https://mempool.space/testnet4/tx/d4e564d295233f62603f7a7e9527acf88f6e467985868f15339887285d64bb1a) supplied the simple one-input, two-output starting point.
- [Public testnet4 address history](https://mempool.space/testnet4/address/tb1qzsjnew5qcn75e4cqdsc6r9v8fjy5ensancqmv2l2n82p0q5f5tls758l9d) supplied the mixed-output and fan-out candidates. Its history was then fetched from Fulcrum rather than copied from a search snippet.
- [mempool.space testnet4 API documentation](https://mempool.space/testnet4/docs/api/rest) documents the public explorer API. The application does not use that API for these examples. The research browser could not retrieve all explorer API/page responses, so those pages are not represented as an independent data verification.
- [Electrum protocol methods](https://electrum-protocol.readthedocs.io/en/latest/protocol-methods.html) define address-script history lookups. History membership alone does not prove that a candidate spends a particular output; candidate inputs must reference the exact transaction ID and output index.
- [Bitcoin Core getrawtransaction](https://bitcoincore.org/en/doc/30.0.0/rpc/rawtransactions/getrawtransaction/) and [gettxout](https://bitcoincore.org/en/doc/30.0.0/rpc/blockchain/gettxout/) document the transaction and UTXO checks used below.

## Verified selections

Verified at **2026-09-07T23:41:27.848Z**. The timestamp is UTC.

| Example | Selected output | Inputs / outputs | Selected address history | Confirmed spender |
| --- | --- | ---: | ---: | --- |
| [Spent-output path](https://mempool.space/testnet4/tx/d4e564d295233f62603f7a7e9527acf88f6e467985868f15339887285d64bb1a) | 1 | 1 / 2 | 2 transactions | [Spending transaction](https://mempool.space/testnet4/tx/8cfd7566b77a32519b7f9054c879ce73628255fb6171e431ba5134c114cd1044), input 0 |
| [Two inputs and mixed scripts](https://mempool.space/testnet4/tx/b92eb2d8abf81a25197bacde9845eea3d711bd6edf25e1e8975d731271dd83eb) | 0 | 2 / 3 | 8 transactions | [Spending transaction](https://mempool.space/testnet4/tx/e0d797ca417b3c39e64677da7be5591f7c5e5d945743e9046efdbb10fd8ba76f), input 0 |
| [53-output fan-out](https://mempool.space/testnet4/tx/cc159432ffb7a166abeccc79800e9616a09ea9ac6937080c2ca37b38671970e5) | 0 | 1 / 53 | 13 transactions | [Spending transaction](https://mempool.space/testnet4/tx/647cfdf953d2548ad7d60f8079a015b5c667e4a7aaa8da12b857216e579e9769), input 0 |

The initial verification made **29 read-only proxy calls**, fetched **23 distinct transactions**, and checked **3 selected addresses**. All **3 examples**, their **4 referenced funding outputs**, and their **3 confirmed spending links** were verified. Core returned `null` from `gettxout` for each selected output, consistent with the independently identified spends.

The reusable verification script subsequently passed all **3 examples** again. The application's actual `fetchTransaction`, `loadFunding` and `loadSpending` helpers were also exercised against the live proxy: **6 expansion checks passed**, loading **4 funding transactions** and finding **3 spending transactions**, with **0 truncated searches**. This validates these selected paths, not every output of the fan-out.

The mixed transaction contains P2WSH, P2WPKH and data outputs. The fan-out contains P2WSH, P2WPKH and data outputs. Those are script observations, not claims about a wallet, payment purpose or CoinJoin participation. No xpubs were inferred or supplied.

## Reverification and limits

Run `node --import tsx scripts/verify-examples.ts` against the running local proxy. The default is the development backend on port 4000; `CHAINGRAPH_PROXY_URL` can select another running proxy. The script never loads an environment file or prints configured upstream endpoints or credentials. It refuses address histories over 50 entries to keep this verification bounded.

These examples depend on access to historical transactions and matching testnet4 history. A pruned node without suitable transaction retrieval may not serve them. Histories can grow, and a test network can reorganize or reset. Verification timestamps describe a snapshot, not a perpetual guarantee. Start from the selected outpoint to avoid searching every address in the 53-output transaction at once.

## Spending expansion regression

An isolated mock reproduced an existing cutoff problem: with 501 history candidates and the spender last, two repeated expansions both searched the same first 500 candidates. They issued 1,002 mocked requests, found no spender, and never reached candidate 501. No live upstream requests were used for this reproduction.

`loadSpending` now sorts deduplicated transaction IDs and accepts a validated continuation offset, returning `nextOffset` while another 500-candidate batch remains. The caller keeps that offset per workspace and selected outpoint. Regression tests verify that the second batch reaches candidate 501 and that script-only outputs still use exact outpoint matching.

`npx vitest run tests/spending.test.ts`: **9 tests passed**. `npx tsc --noEmit`: passed.

Offset continuation is not a frozen chain snapshot. If history changes between batches, sorted positions can shift, leading to duplicated or skipped candidates. Restart from offset zero for a fresh complete scan after activity changes. Missing script data continues to report an incomplete search even when all available batches finish.
