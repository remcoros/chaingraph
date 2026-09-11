# Example workspaces: sources and verification

The nine bundled examples are real public transactions retrieved through
Chaingraph's own read-only Core/Electrum proxy and stored as snapshots in
`src/domain/templateData/`. Labels, notes, icons, bookmarks and tags are
original educational annotations. Tags describe observed amounts, script forms
and exact spending links; none of them is an ownership or participant claim.

## Catalog

| Example                       | Network  | Chain reference                                                                                                                                                                                                                      | Transactions | Initial nodes |
| ----------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -----------: | ------------: |
| Whirlpool: five equal outputs | mainnet  | [seed](https://mempool.space/tx/323df21f0b0756f98336437aa3d2fb87e02b59f1946b714a7b09df04d429dec2), [successor](https://mempool.space/tx/015d9cf0a12057d009395710611c65109f36b3eaefa3a694594bf243c097f404)                            |           15 |            37 |
| An on-chain message           | mainnet  | [OP_RETURN](https://mempool.space/tx/8bae12b5f4c088d940733dcd1455efc6a3a69cf9340e17a981286d3778615684)                                                                                                                               |            2 |             5 |
| Follow the largest output     | mainnet  | [15-input split](https://mempool.space/tx/a6d697a25266ce3c78774fd1d75f896b7af522ada209b0f6228ea497bc49a46d), [funding hop](https://mempool.space/tx/17a0d14d4ec50f3384e1c9c6eac7a67345b4c1946a518ab2d943a6d71fe5266e)                |           16 |            36 |
| One input, 143 outputs        | mainnet  | [fan-out](https://mempool.space/tx/3d81a6b95903dd457d45a2fc998acc42fe96f59ef01157bdcbc331fe451c8d9e)                                                                                                                                 |            2 |           146 |
| A large WabiSabi CoinJoin     | mainnet  | [327 in / 279 out](https://mempool.space/tx/fb596c9f675471019c60e984b569f9020dac3b2822b16396042b50c890b45e5e)                                                                                                                        |            1 |           607 |
| Explore a public demo wallet  | mainnet  | [change-branch funding](https://mempool.space/tx/9f3dbe0da718398178955cbe386813f8f6ed709f525fb5bf2885ba3545276ed3)                                                                                                                   |           10 |            21 |
| Follow an exact spent output  | testnet4 | [creator](https://mempool.space/testnet4/tx/d4e564d295233f62603f7a7e9527acf88f6e467985868f15339887285d64bb1a), [spender](https://mempool.space/testnet4/tx/8cfd7566b77a32519b7f9054c879ce73628255fb6171e431ba5134c114cd1044)         |            3 |             8 |
| Explore 53 outputs            | testnet4 | [fan-out](https://mempool.space/testnet4/tx/cc159432ffb7a166abeccc79800e9616a09ea9ac6937080c2ca37b38671970e5)                                                                                                                        |            2 |            56 |
| From mixed scripts to a spend | testnet4 | [mixed scripts](https://mempool.space/testnet4/tx/b92eb2d8abf81a25197bacde9845eea3d711bd6edf25e1e8975d731271dd83eb), [successor](https://mempool.space/testnet4/tx/e0d797ca417b3c39e64677da7be5591f7c5e5d945743e9046efdbb10fd8ba76f) |            4 |            10 |

Initial nodes counts the loaded evidence. Examples with a wide transaction open
on a bounded sample of it, chosen to keep every script form and the annotated
outpoints visible, and reveal the rest on demand. The WabiSabi example is the
exception: comparing repeated amounts across one CoinJoin is what it teaches, so
all 327 inputs and 279 outputs are on the canvas from the start.

## Discovery credits

The Whirlpool, WabiSabi, 143-output and OP_RETURN transaction IDs come from the
public test fixtures of the MIT-licensed
[Am I Exposed](https://github.com/Copexit/am-i-exposed) project. Only the
identifiers were used; snapshot JSON was fetched independently, and the
protocol names are the publisher's. Chaingraph does not verify protocol
provenance, participant identities or the success of any privacy technique.
Testnet4 candidates were found through
[mempool.space testnet4](https://mempool.space/testnet4/) pages and then fetched
from the configured Electrum server. The large split was a public transaction
ID supplied during testing.

## The public demo wallet

The wallet example uses the intentionally published BIP84 account-0 test `zpub`
(the [BIP84 test vector](https://github.com/bitcoin/bips/blob/master/bip-0084.mediawiki#test-vectors),
CC0, also used as Am I Exposed's homepage example). Its seed is public, so
**never send funds to these addresses**, and a match to them establishes
nothing about ownership. The snapshot derives receive and change indexes 0 to 9,
records 214 known transaction IDs across 11 used addresses, includes 10 complete
transaction records (two funding/spending stories with their immediate parents)
and keeps the other 204 IDs as pending. The wallet is saved with
`scanComplete: false`, `scanLimit: 10` and `scanGap: 20`; continuing discovery
queries the user's backend. A change-branch match is a derivation fact, not
proof that an output is economically change.

## Snapshot shape

A snapshot holds `network`, `retrievedAt`, `roots` and `transactions`. Labels,
notes, icons, bookmarks, tags and the opening view are built in code in
`src/domain/workspaceTemplates.ts`, not stored in the JSON, so editing prose
never means refetching chain data.

An input's funding output can be recorded two ways:

- attach it to the spending input as `vin[].prevout`, the same representation
  Chaingraph's own verbosity-2 fetch produces (see `docs/spender-index.md`);
- load the whole parent transaction and scope its display through
  `inputContext`, which lists the outputs an example draws.

Prefer the attached prevout unless the example actually puts the parent on the
canvas. A loaded parent also loads every output the example never draws, and
every one of its own inputs becomes a placeholder node with unknown value and
unknown address. `createTemplateWorkspace` builds `inputContext` only for
parents the snapshot loads in full, and a test caps each snapshot at 400 KB.

## Verification

Every snapshot record passed `fetchRawInspection`: the txid was recomputed from
serialized bytes and compared with the saved data along with exact input
outpoints, output amounts and script bytes. Raw bytes are not shipped, so raw
inspection of an example still needs the backend. The WabiSabi snapshot records
the CoinJoin alone and attaches each consumed output to the input that spends it,
so all 327 input amounts and scripts are present without the parent
transactions. The parents were never drawn on the canvas, and exploring the
CoinJoin outward is the point of that example, so fetching a parent is left to
the user's backend.

`node --use-system-ca --import tsx scripts/verify-examples.ts` re-checks the
examples against a running backend (`CHAINGRAPH_PROXY_URL`, default
`http://127.0.0.1:4000`): configured networks, transaction identity and I/O
counts, Core versus Electrum serialized bytes, referenced funding outputs and,
for testnet4, bounded address histories and known spends. It loads no
environment file and prints no endpoints. Histories grow and test networks can
reset, so verification describes a moment, not a guarantee. A pruned node may
not serve historical transactions.

Snapshot confirmation counts are historical. The end of a bundled path is not a
final destination, and a missing spender never proves an output is unspent.
