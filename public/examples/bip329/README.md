# BIP329 examples for the public demo wallet

These are synthetic annotations on public references from **Explore a public
demo wallet**, the bundled mainnet workspace. They represent the audited
software's BIP329 shapes, not files captured from real users or live wallet
round-trip certification. The public BIP84 test key is credited in
`docs/references.md`; never send funds to its addresses.

Open the example workspace, then **Workspace → Import BIP329 labels**. Select
the named software profile and its file. The example has existing annotations,
so the default keeps its existing text. Choose **Import options → Replace with
imported text** to see the new labels or Notes applied. Tags merge by default.
Inspect the preview, apply, and use Undo to restore the previous state. Reopen
the example for an independent run.

| File                 | Profile        | Expected manual check                                                                                                                                                                                                                                                       |
| -------------------- | -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `generic.jsonl`      | Generic BIP329 | Literal punctuation remains one label; key label does not rename the wallet unless selected.                                                                                                                                                                                |
| `sparrow.jsonl`      | Sparrow        | Origin is inspectable; missing-label and unsupported input rows are excluded; `spendable` and height are not applied. Key encoding matches the demo zpub.                                                                                                                   |
| `btcpay.jsonl`       | BTCPay Server  | Several labels for one transaction become several tags. A comma stays inside one tag. Existing labels and Notes remain.                                                                                                                                                     |
| `bluewallet.jsonl`   | BlueWallet     | Transaction strings become Notes, including escaped newlines and text longer than 255 units. Empty memo is excluded unless applying clears.                                                                                                                                 |
| `keeper.jsonl`       | Bitcoin Keeper | Transaction Note plus multiple address/output tags. Export requires the demo wallet scope. Import its exported file into the matching Keeper wallet.                                                                                                                        |
| `review-cases.jsonl` | Generic BIP329 | Conflicting origins, a valid 255-unit label, an over-limit label, an empty label, an omitted label, a wrong-network address, an unsupported input, malformed JSON, an unmatched reference and a valid trailing record. Blank line 2 keeps physical line diagnostics honest. |

For `review-cases.jsonl`, inspect exclusions before applying. Select an origin
or choose first/last to resolve the transaction conflict. Enable shortening to
review the over-limit label, and enable clears separately. Whole-workspace
scope retains unmatched valid references; wallet scope excludes them.

Then open **Export BIP329 labels** and compare destinations:
BTCPay exports repeated tag records, Sparrow/Generic export literal labels,
BlueWallet exports transaction Notes with label fallback, and Keeper exports
transaction Notes plus address/output tags for one wallet. Key labels are
opt-in. Optional composition such as `Label [tag A, tag B]` remains literal on
re-import. Notes, colors, icons and bookmarks are not all preserved by every
destination; use the encrypted workspace export for a complete backup.

The fixtures are also consumed by `labels.examples.test.ts`, which verifies
the real example's references and profile behavior without network access.
