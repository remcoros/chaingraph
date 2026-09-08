# Annotated public-chain workspace templates

Recorded on 2026-09-08. The catalog contains six mainnet templates followed by
three testnet4 templates. Each creates a normal editable, encrypted workspace
with fresh workspace, tag and wallet IDs. Labels, notes, icons and bookmarks are
original educational annotations. Tags distinguish observed amounts, script forms
and exact spending links from ownership hypotheses.

## Catalog and sources

| Template                      | Primary chain reference                                                                                                                                                                                                                   | Transactions | Initial graph nodes |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -----------: | ------------------: |
| Whirlpool: five equal outputs | [Five-input seed](https://mempool.space/tx/323df21f0b0756f98336437aa3d2fb87e02b59f1946b714a7b09df04d429dec2), [successor](https://mempool.space/tx/015d9cf0a12057d009395710611c65109f36b3eaefa3a694594bf243c097f404)                      |           15 |                  37 |
| An on-chain message           | [OP_RETURN transaction](https://mempool.space/tx/8bae12b5f4c088d940733dcd1455efc6a3a69cf9340e17a981286d3778615684)                                                                                                                        |            2 |                   5 |
| Follow the largest output     | [Fifteen-input split](https://mempool.space/tx/a6d697a25266ce3c78774fd1d75f896b7af522ada209b0f6228ea497bc49a46d), [funding hop](https://mempool.space/tx/17a0d14d4ec50f3384e1c9c6eac7a67345b4c1946a518ab2d943a6d71fe5266e)                |           16 |                  36 |
| One input, 143 outputs        | [Mainnet fan-out](https://mempool.space/tx/3d81a6b95903dd457d45a2fc998acc42fe96f59ef01157bdcbc331fe451c8d9e)                                                                                                                              |            2 |                 146 |
| A large WabiSabi CoinJoin     | [327-input, 279-output transaction](https://mempool.space/tx/fb596c9f675471019c60e984b569f9020dac3b2822b16396042b50c890b45e5e)                                                                                                            |          114 |                 720 |
| Explore a public demo wallet  | [Change-branch funding](https://mempool.space/tx/9f3dbe0da718398178955cbe386813f8f6ed709f525fb5bf2885ba3545276ed3), public-key sources below                                                                                              |           10 |                  21 |
| Follow an exact spent output  | [Creating transaction](https://mempool.space/testnet4/tx/d4e564d295233f62603f7a7e9527acf88f6e467985868f15339887285d64bb1a), [spender](https://mempool.space/testnet4/tx/8cfd7566b77a32519b7f9054c879ce73628255fb6171e431ba5134c114cd1044) |            3 |                   8 |
| Explore 53 outputs            | [Testnet4 fan-out](https://mempool.space/testnet4/tx/cc159432ffb7a166abeccc79800e9616a09ea9ac6937080c2ca37b38671970e5)                                                                                                                    |            2 |                  56 |
| From mixed scripts to a spend | [Mixed scripts](https://mempool.space/testnet4/tx/b92eb2d8abf81a25197bacde9845eea3d711bd6edf25e1e8975d731271dd83eb), [successor](https://mempool.space/testnet4/tx/e0d797ca417b3c39e64677da7be5591f7c5e5d945743e9046efdbb10fd8ba76f)      |            4 |                  10 |

The public transaction discovery fixtures in MIT-licensed am-i-exposed are
[Whirlpool](https://github.com/Copexit/am-i-exposed/blob/3dd81a0dcf9fb4fedd6db6871e5e74315a50531f/src/lib/analysis/heuristics/__tests__/fixtures/api-responses/whirlpool-coinjoin.json),
[WabiSabi](https://github.com/Copexit/am-i-exposed/blob/3dd81a0dcf9fb4fedd6db6871e5e74315a50531f/src/lib/analysis/heuristics/__tests__/fixtures/api-responses/wabisabi-coinjoin.json),
[143-output batch](https://github.com/Copexit/am-i-exposed/blob/3dd81a0dcf9fb4fedd6db6871e5e74315a50531f/src/lib/analysis/heuristics/__tests__/fixtures/api-responses/batch-withdrawal-143.json)
and [OP_RETURN message](https://github.com/Copexit/am-i-exposed/blob/3dd81a0dcf9fb4fedd6db6871e5e74315a50531f/src/lib/analysis/heuristics/__tests__/fixtures/api-responses/op-return-charley.json).
Only their transaction identifiers were used. Snapshot JSON was freshly retrieved
through the application's read-only network-scoped Core/Electrum proxy, not copied
from another project's fixtures. The upstream protocol names identify the published
examples; transaction structure was checked independently, but participant
identities, ownership, privacy guarantees and protocol provenance were not.

The large split was supplied as a public transaction identifier during product
testing. The exact loaded parent outpoint is consumed at input 0. No direct link
to the separately discussed `1d690f3b…` transaction is claimed. Testnet4 discovery
and successor checks are documented in [testnet4 research](testnet4-examples.md).

## Public wallet provenance and scan limits

The wallet uses the intentionally published **BIP84 account-0 test zpub**, also
presented as the am-i-exposed homepage's “Wallet audit (zpub)” example:

- [am-i-exposed example catalog](https://github.com/Copexit/am-i-exposed/blob/main/src/lib/constants.ts)
- [BIP84 public test vectors](https://github.com/bitcoin/bips/blob/master/bip-0084.mediawiki#test-vectors)

The public test vector establishes key derivation, not an identity. Its underlying
test seed is public, so **never send funds to these addresses**. The application
contains only the public account key. No seed or private key was imported,
generated or used. Any person can use this published test wallet, so a match to
its addresses does not establish common human ownership.

The snapshot derives 20 addresses, indexes 0 through 9 on both receive and change
branches, with existing vetted wallet primitives. Their complete bounded history
responses include 214 distinct transaction IDs across 11 used addresses. Ten
transaction records are included: two funding/spending stories and their complete
immediate parents. The remaining 204 known IDs are retained as
`pendingTransactionIds`. The wallet declares `scanComplete: false`, `scanLimit: 10`
and `scanGap: 20`. Addresses beyond the chosen range were not discovered; this is
not a full wallet history, balance or current UTXO inventory.

Wallet highlights and tags match actual derived output scripts. A derivation
change branch is not proof that an output economically represents change. The
workspace opens on Wallets so the user can inspect or continue discovery. Activity
monitoring stays off. Creating a copy requires no live transaction lookup; later
refreshes intentionally query the configured backend.

## Retrieval and raw-byte verification

[Bitcoin Core getrawtransaction](https://bitcoincore.org/en/doc/30.0.0/rpc/rawtransactions/getrawtransaction/)
documents the normalized observations and serialized transactions used here.
[getblockheader](https://bitcoincore.org/en/doc/30.0.0/rpc/blockchain/getblockheader/)
documents recorded heights. These observations do not establish ownership or
payment intent. Both configured network pairs reported connected before new
retrievals. No real environment file was opened or printed.

| Snapshot file                   | Retrieval UTC              | JSON bytes |
| ------------------------------- | -------------------------- | ---------: |
| `mainnet-equal-outputs.json`    | `2026-09-08T18:35:21.153Z` |    107,598 |
| `mainnet-op-return.json`        | `2026-09-08T18:35:21.230Z` |      2,418 |
| `mainnet-large-value-path.json` | `2026-09-08T19:36:35.971Z` |     34,243 |
| `mainnet-batch-outputs.json`    | `2026-09-08T19:36:36.107Z` |     41,901 |
| `mainnet-wabisabi.json`         | `2026-09-08T19:42:37.540Z` |  9,884,645 |
| `mainnet-public-wallet.json`    | `2026-09-08T19:44:22.719Z` |     63,059 |
| `testnet4-spent-output.json`    | `2026-09-08T18:35:21.343Z` |      3,790 |
| `testnet4-fan-out.json`         | `2026-09-08T18:35:21.413Z` |     19,248 |
| `testnet4-mixed-path.json`      | `2026-09-08T19:36:36.485Z` |      5,026 |

The original four snapshots' 22 records passed raw-byte checks at
`2026-09-08T18:37:45.024Z`. New large-value, batch and mixed-script snapshots added
22 verified records. WabiSabi and the public wallet added 124 verified records.
Each record passed `fetchRawInspection`: recomputed txid, exact input outpoints,
output amounts and script bytes were compared against the saved normalized data.
No previous records were repeatedly fetched for the later catalog adjustment.
Raw transactions are not duplicated in the shipped snapshots, so opening raw
inspection still requires the backend. This is not an independent signature or
consensus validator.

The large WabiSabi snapshot includes all 113 distinct immediate parents, several
of which are themselves large transactions. Complete observations therefore occupy
about 9.9 MB of formatted JSON, but only referenced parent outputs appear in the
720-node initial graph. The JSON is lazy-loaded and workspace validation runs in
a worker. No recursive ancestry scan is performed.

## Suggested demonstrations and validation

- **Whirlpool:** compare five inputs and five 5,000,000-sat outputs, then follow
  seed output 2 into successor input 1. Equal amounts do not determine a unique
  input-to-output mapping.
- **Large values:** open the preselected 3,400 BTC output with value sizing already
  enabled, compare the 598.50 BTC sibling and follow the bookmarked funding hop.
- **Fan-out:** compare largest/smallest bookmarks and independently filter amounts
  in the flow panel and 3D graph. Script tags describe forms, not recipient groups.
- **WabiSabi:** compare the four tagged amount groups, including 20 outputs of
  2,097,152 sats, then follow individual outpoints. Common inputs are not a sound
  basis for assigning all CoinJoin participants to one owner.
- **Public wallet:** use wallet highlights and receive/change-branch tags to follow
  the two loaded spending stories, inspect pending history and continue scanning.
- **Testnet4:** follow exact spending links, compare mixed scripts or inspect the
  53-output fan-out's data output. The end of a bundled path is not a final
  destination claim or proof that an output remains unspent.

The expanded targeted suite passes **29 tests**, covering all nine offline copies,
fresh identities, independent mutable data, address derivation validation,
network rejection, complete initial inputs, bounded graphs, truthful amount tags,
exact spending links and honest wallet scan state. Historical confirmations remain
snapshots. Domain/live-data validation does not measure browser usability or prove
an exhaustive spending history.
