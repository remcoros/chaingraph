# Analysis heuristics

What each analysis tool computes, what it can and cannot claim, and the research
it rests on. Tools live in `src/domain/analysis/`, run locally over loaded
workspace records and make no network requests. Wallet review reuses the same
registry.

## Scope and lifecycle

A run receives the transaction IDs in scope (the workspace, a selection or a
wallet); loaded parents may supply input values and scripts without being
targets, and reports say which transactions were scoped versus supporting.
Each run returns findings, coverage counts and an explanation when nothing
matched. Parameters are validated first. Findings can be shown on the graph,
isolated, excluded and restored; changed input records or wallet coverage mark
them stale. This is always a partial local view, never a statement about
complete chain history.

## Tools

| Tool | Method | Limits |
| --- | --- | --- |
| Equal-output detection | Group positive output amounts in integer satoshis; configurable minimum repeats and input count; highlight only group members | Excludes data outputs and coinbase. Repeated values do not identify a CoinJoin and are not a linkability calculation |
| Common-input ownership | Union co-spent input identities across the scope, following known scripts or addresses; missing parents stay as outpoint references | A hypothesis. Transactions with three or more equal outputs are skipped by default (configurable) and reported; PayJoin and other collaborative spends are not detected |
| Address reuse | Count outputs per decoded address in scope, optionally requiring separate transactions | Counts include spent outputs and are not balances; unaddressed scripts are reported as unavailable |
| Value flow and fees | Sum known previous-output amounts minus outputs in integer satoshis; divide by a valid virtual size for sat/vB | Never substitutes zero for a missing parent or raw size for vsize; coinbase skipped; a fee threshold is a review filter, not a recommendation |
| Consolidation and fan-out | Configurable input/output counts and ratio | Reports structure, not purpose; batching and collaborative spends share these shapes |
| Script-type comparisons | Compare decoded input/output script types; optionally flag change-like patterns | Missing types stay unavailable; the tool does not guess change, wallet software or owners |
| Imported-wallet intersections | Match inputs and outputs against addresses and script hashes already derived for imported wallets; optionally co-spent inputs only | Overlapping imports are distinguished from separate participants; coverage is bounded by derived addresses |

No tool identifies a person, proves that a wallet owns a transaction, or maps
individual inputs to outputs. There is no Boltzmann solver, dust classification
or privacy score; any future linkability work needs explicit computational
bounds and reference vectors before showing probabilities.

## Wallet review guidance

The wallet workbench states coverage as discovered addresses, used addresses,
partial discovery and a continue action, with no completeness percentage,
because a watch-only wallet cannot know about addresses beyond its scanned gap
(Sparrow FAQ). When selected outputs carry different recorded sources, one
sentence notes that combining them in an ordinary spend would publish that link
(Sparrow, spending privately). Chaingraph has no spend composer, coin selection,
PSBT, signing or broadcast, and never claims a privacy score.

Counterparty labels such as "Exchange A withdrawal" are personal annotations on a
receipt. They do not attribute address ownership, and labelling one output never
implies the other outputs of that transaction belong to the same party. No
public entity or exchange dataset is consulted or bundled. Review decisions and
tags are Chaingraph-specific encrypted data and are deliberately not exported as
BIP329 records; BIP329 carries labels only.

## Sources

Meiklejohn et al. (clustering research), BIP78 (PayJoin breaks common-input
reasoning), Boltzmann and Am I Exposed (linkability references, no code copied),
BIP141 (virtual size), BIP32 (bounded imported coverage), BIP329 and the Sparrow
documentation. Links are in [references.md](references.md).
