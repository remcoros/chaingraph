# Public mainnet tracing examples

Researched and verified on 2026-09-08. These examples complement the existing
[testnet4 examples](testnet4-examples.md). The example dialog follows the active
workspace network; opening a mainnet workspace never offers testnet4 identifiers.
All loads still use the workspace network and the self-hosted backend.

## Sources and selection

[Copexit/am-i-exposed](https://github.com/Copexit/am-i-exposed) publishes real-chain
fixtures for its heuristic tests. We used its transaction identifiers as discovery
references and independently queried the local mainnet Bitcoin Core and Fulcrum
services. Descriptions below are original and concern observable structure, not
wallet attribution. The upstream [MIT license](https://github.com/Copexit/am-i-exposed/blob/3dd81a0dcf9fb4fedd6db6871e5e74315a50531f/LICENSE)
was checked; no implementation or fixture JSON was copied into this repository.

| Example                    | Observed structure                                  | Discovery reference                                                                                                                                                                                | Chain reference                                                                                          |
| -------------------------- | --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Five equal outputs         | 5 inputs, 5 outputs of 0.05 BTC each                | [whirlpool-coinjoin](https://github.com/Copexit/am-i-exposed/blob/3dd81a0dcf9fb4fedd6db6871e5e74315a50531f/src/lib/analysis/heuristics/__tests__/fixtures/api-responses/whirlpool-coinjoin.json)   | [Transaction](https://mempool.space/tx/323df21f0b0756f98336437aa3d2fb87e02b59f1946b714a7b09df04d429dec2) |
| Large equal-output pattern | 327 inputs, 279 outputs; several equal-value groups | [wabisabi-coinjoin](https://github.com/Copexit/am-i-exposed/blob/3dd81a0dcf9fb4fedd6db6871e5e74315a50531f/src/lib/analysis/heuristics/__tests__/fixtures/api-responses/wabisabi-coinjoin.json)     | [Transaction](https://mempool.space/tx/fb596c9f675471019c60e984b569f9020dac3b2822b16396042b50c890b45e5e) |
| OP_RETURN message          | 1 input, 2 outputs; output 0 contains data          | [op-return-charley](https://github.com/Copexit/am-i-exposed/blob/3dd81a0dcf9fb4fedd6db6871e5e74315a50531f/src/lib/analysis/heuristics/__tests__/fixtures/api-responses/op-return-charley.json)     | [Transaction](https://mempool.space/tx/8bae12b5f4c088d940733dcd1455efc6a3a69cf9340e17a981286d3778615684) |
| Legacy transaction         | 1 input, 2 P2PKH outputs                            | [simple-legacy-p2pkh](https://github.com/Copexit/am-i-exposed/blob/3dd81a0dcf9fb4fedd6db6871e5e74315a50531f/src/lib/analysis/heuristics/__tests__/fixtures/api-responses/simple-legacy-p2pkh.json) | [Transaction](https://mempool.space/tx/0b6461de422c46a221db99608fcbe0326e4f2325ebf2a47c9faf660ed61ee6a4) |

The first two discovery fixtures are called Whirlpool and WabiSabi by their
publisher. The app describes their equal-output patterns without claiming to
independently establish protocol provenance or participant ownership. Equal values
alone cannot prove CoinJoin participation, a number of owners, payment/change
roles or the success of a privacy technique. Large input/output counts are useful
for navigation practice, not a performance benchmark.

No attributed wallet xpub is included. The selected public transaction references
provide reproducible on-chain activity without importing an unknown person's
extended key. Educational key-derivation vectors used by the test suite remain
separate from curated live-chain examples.

## Reproduction and limits

With the backend running, execute:

```sh
node --use-system-ca --import tsx scripts/verify-examples.ts
```

The script discovers configured networks, verifies each one's status, checks
confirmed transaction identity and input/output counts, and compares serialized
transaction bytes returned by Bitcoin Core and Electrum. Selected output indices
must exist. Each example's recorded funding references are also checked. Testnet4
examples additionally retain their bounded address-history and known-spend checks.
The verifier keys its in-memory transaction map by both network and transaction
ID. It does not load environment files, log upstream destinations or use private
wallet data. Mainnet examples do not claim a complete spending history.

The graph fetches only requested examples and its bounded tracing context. It does
not import upstream classifications as annotations or hypotheses. Historical
confirmation counts and address history remain snapshots; re-running the verifier
checks the currently configured services.

Live verification on 2026-09-08 at 12:54:53 UTC passed all seven configured-network
examples, covering 31 distinct network/transaction pairs and three testnet4 address
histories in 51 RPC calls. This is read-only service validation; it does not measure
interactive rendering performance for the large example.
