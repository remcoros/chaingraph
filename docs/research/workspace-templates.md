# Annotated public-chain workspace templates

Recorded on 2026-09-08. Four templates contain bounded public-chain observations
and original educational annotations. Creating a template produces a normal,
editable workspace with a fresh workspace ID, creation time and tag IDs. It has
no imported wallet, ownership finding or special runtime mode.

## Sources and applicability

The transaction identifiers come from the previously researched
[mainnet examples](mainnet-examples.md), [testnet4 examples](testnet4-examples.md)
and [observed equal-output successor](demo-patterns-and-hypotheses.md).
Snapshot JSON was newly retrieved through the application's read-only local
proxy using `fetchTransaction`, with the matching Core/Electrum pair confirmed
connected for each network. No external fixture JSON or implementation was copied.

| Template | Primary chain references | Included transactions | Initial graph nodes |
| --- | --- | ---: | ---: |
| Equal outputs and a spending hop | [Five-equal-output seed](https://mempool.space/tx/323df21f0b0756f98336437aa3d2fb87e02b59f1946b714a7b09df04d429dec2), [successor](https://mempool.space/tx/015d9cf0a12057d009395710611c65109f36b3eaefa3a694594bf243c097f404) | 15 | 37 |
| An on-chain message | [Mainnet OP_RETURN transaction](https://mempool.space/tx/8bae12b5f4c088d940733dcd1455efc6a3a69cf9340e17a981286d3778615684) | 2 | 5 |
| Follow an exact spent output | [Testnet4 creating transaction](https://mempool.space/testnet4/tx/d4e564d295233f62603f7a7e9527acf88f6e467985868f15339887285d64bb1a), [spender](https://mempool.space/testnet4/tx/8cfd7566b77a32519b7f9054c879ce73628255fb6171e431ba5134c114cd1044) | 3 | 8 |
| Explore 53 outputs | [Testnet4 fan-out](https://mempool.space/testnet4/tx/cc159432ffb7a166abeccc79800e9616a09ea9ac6937080c2ca37b38671970e5) | 2 | 56 |

The mainnet discovery references are the MIT-licensed public
[five-output fixture](https://github.com/Copexit/am-i-exposed/blob/3dd81a0dcf9fb4fedd6db6871e5e74315a50531f/src/lib/analysis/heuristics/__tests__/fixtures/api-responses/whirlpool-coinjoin.json)
and [message fixture](https://github.com/Copexit/am-i-exposed/blob/3dd81a0dcf9fb4fedd6db6871e5e74315a50531f/src/lib/analysis/heuristics/__tests__/fixtures/api-responses/op-return-charley.json).
Their original classifications are discovery context, not independently verified
wallet or protocol identities. The earlier research records the checked upstream
license and source limitations.

[Bitcoin Core getrawtransaction](https://bitcoincore.org/en/doc/30.0.0/rpc/rawtransactions/getrawtransaction/)
documents the verbose observations and serialized bytes used for verification.
[getblockheader](https://bitcoincore.org/en/doc/30.0.0/rpc/blockchain/getblockheader/)
documents block-height observations. These interfaces establish transaction and
block observations; they do not establish payment intent or ownership.

## Retrieval and validation

The four snapshots were retrieved on 2026-09-08 at these UTC times:

| File under `src/domain/templateData/` | Retrieval timestamp | JSON bytes |
| --- | --- | ---: |
| `mainnet-equal-outputs.json` | `2026-09-08T18:35:21.153Z` | 107,598 |
| `mainnet-op-return.json` | `2026-09-08T18:35:21.230Z` | 2,418 |
| `testnet4-spent-output.json` | `2026-09-08T18:35:21.343Z` | 3,790 |
| `testnet4-fan-out.json` | `2026-09-08T18:35:21.413Z` | 19,248 |

The loader used the existing `fetchTransaction` normalization and address/network
validation. It loaded each investigation's seed, its selected known successor
when present, and every distinct immediate parent of those transactions. No
recursive ancestry search or address-history expansion was performed. Every
loaded parent outpoint was checked against its complete parent record.

At `2026-09-08T18:37:45.024Z`, all 22 saved transaction records passed a separate
live `fetchRawInspection` check. The existing raw decoder recomputed each txid
from serialized bytes and checked input outpoints, output amounts and scripts
against the saved normalized observations. Raw serialized transactions are not
part of the shipped snapshots. These checks used only the local same-origin
proxy on port 3001, without reading or printing environment files or upstream
connection details.

The exact stored spending links are seed output 2 to successor input 1 in the
mainnet case, and creating-transaction output 1 to spender input 0 in the
testnet4 case. Mainnet successor outputs are 791,116; 907,419; 9,136,520; and
9,136,520 sats. The mainnet message is a zero-value OP_RETURN output with a
19-byte payload. The fan-out contains 51 P2WSH outputs, one P2WPKH output and
one zero-value OP_RETURN output with an 80-byte payload. Annotation text was
written from these observations.

`tests/workspace-templates.test.ts` passed 14 tests covering offline creation,
schema and network validation, exact outpoints and graph spending links, initial
input completeness, bounded graph context, annotations and tags, fresh identities,
and mutation isolation between copies and the reusable snapshot. These domain
checks do not establish browser usability or live service availability later.

## Bounds and interpretation

Each template is a separate lazy-loaded data chunk; the lightweight catalog
contains only names, descriptions, icons and public source links. Complete
records remain available for inspection. `inputContext` limits automatically
included parents to the relevant outputs in the initial graph. The equal-output
case includes a 247-output parent, but initially displays only its referenced
output. The unrelated 327-input mainnet example is absent from every snapshot.

All immediate input data for both the seed and included successor is local.
Opening the initial transaction flow needs no RPC requests. Explicit tracing,
raw inspection and later exploration use the workspace's ordinary network-specific
read-only operations and can require a connected backend.

Annotations, notes, bookmarks and tags are editable human metadata. They describe
observed script forms, equal amounts and exact outpoints. They do not identify
owners, participant counts, payment/change roles or the author of an on-chain
message. No heuristic findings are pre-applied. Users can run analysis and
evaluate its assumptions themselves.

Confirmation counts and block information remain historical observations.
Missing spending data does not establish current unspent status. The snapshots
are not exhaustive histories; testnet4 can reorganize or reset. Template creation
does not contact public explorers, import xpubs or write server-side data.
