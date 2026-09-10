# Inspector metadata consistency

The Inspector previously split editable metadata across unrelated layouts: a
label/note form, a large standalone icon picker, an offset bookmark checkbox,
and a separate tag section containing wallet-match evidence. This made a script
match look like another user-assigned classification.

The Wallet section below Annotations lists associated imported wallets with
clickable names that open their details. A short description distinguishes
address/script matches from transaction input/output associations; optional help
explains why the latter does not establish ownership of the whole transaction.
The Inspector reuses the App's existing projection rather than calculating a
second wallet-match index on metadata edits.

One **Annotations** section contains label, notes and tags. Icon and bookmark
controls share a compact 28px utility row; tag assignment uses the existing
shared popup. The native bookmark checkbox, immediate saves, undo groups,
external edit handoffs and output/address tag scope remain in place. Tag names
fill the available width, wrapping beside fixed color chips and a 24px bin button. Direct removal preserves
the tag and other memberships; address-level removal explains its broader scope
before applying. Redundant section copy and unused styles
were removed. The separately requested 24px fact rows/copy controls were committed
before this redesign.

The product-ui-design and Chaingraph UI review skills guided hierarchy, density,
copy, keyboard behavior and visual verification. No data schema or RPC changes.

Validation: production build and portability check passed. Eight focused browser
tests passed, covering desktop and 390px layouts, empty and populated annotations,
long wallet/tag names, keyboard focus and popup return, icon selection/clearing,
tag scope, and encrypted lock/reopen with an immediate final note edit. Wallet
association checks cover matched outputs, related transactions and unmatched
outputs without making RPC requests. These were public fixture tests, not live
backend validation.

The four Inspector tests were rerun after adding bin buttons. They also verify
direct and address-level removal, cancellation, focus return and preservation of
tag definitions and unrelated assignments through an immediate encrypted save.
After moving associations into the Wallet section, five focused tests passed,
including full-width short/long tags at desktop and 390px widths, wallet navigation
with unsaved-note preservation, and wallet association without network requests.

Fresh screenshots were inspected under `artifacts/inspector-metadata/`. Review
caught and fixed an inherited column layout on the bookmark checkbox. Wallet names
wrap within their own section. The reduction pass removed redundant save
copy, the decorative tag icon and an extra section boundary; the optional wallet
explanation remains behind help. Existing Inspector scrolling is preserved.

The output UTXO check now uses a top-bar refresh icon. Results and sanitized failures
use the existing dismissible eight-second notification; repeated checks restart its
timer. Snapshot details moved to Chain evidence. Aborted or superseded checks return
no notification, preserving the existing selection/workspace request guards.
Browser tests and screenshots were explicitly skipped for this follow-up; the
existing browser regression was updated without running it. The production build,
portability check and 21 focused UTXO domain tests passed.
