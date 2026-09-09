# Quick editor consistency review

Date: 2026-09-09. Local application review, not a release or live-service claim.

## Audit and changes

The audit covered Wallet single/batch controls, Graph batch selection, Inspector,
graph hover and transaction flow handoffs, Analysis, retained Trace actions,
workspace tag management and the shared icon palette.

Three independent tag editors differed in width, color creation, assignment
controls and close behavior. Graph and Wallet also defined conflicting global
`.batch-tag-name` styles. They now use one `BatchTagEditor`, with a 380px preferred
width bounded by the visual viewport. Names wrap beside a fixed color chip;
assignment counts sit below names and actions move below on narrow screens.
Every quick tag editor searches names/descriptions, offers color selection,
creates and assigns in one update, and keeps existing-tag Add/Remove available.
The Inspector retains explicit output/address scope and inherited membership hints.

Graph batch labels previously replaced existing values by default while Wallet
preserved them. Both now use the same label editor and explicit replacement
policy; batch icons also preserve existing icons unless replacement is enabled.
Single label editing starts with the current value. Notes keep per-edit autosave
and undo grouping. The Inspector's permanently visible label/note fields remain
inline; hover, transaction flow and retained Trace actions already lead there.
Analysis has no independent annotation popup. Workspace tag management keeps its
full description/member workflow and shares the color palette.

Label, tag, note and icon popups share a portal that follows content size, scroll,
resize and visual viewport changes. Nonmodal keyboard focus can leave the editor;
Escape and completion return to the invoker. Invokers toggle without reopening
from an intervening focus event. Scope changes discard unapplied drafts and
close icon palettes. Domain mutation wrappers reuse bounded batch primitives;
Graph retains strict validation of the supplied selection and its own undo-head
ownership.

## Validation

- Build, formatting and portability checks passed.
- All 694 unit tests passed, including batch scope, network/reference rejection,
  budgets, no-op updates and metadata preservation.
- Desktop, 390px and 320px browser workflows exercise long names, unbroken
  100-character names, one-character creation, explicit colors, direct membership,
  encrypted lock/reopen, search and shared popup dimensions.
- Current Wallet To review, UTXOs, Transactions and Addresses workflows passed
  single/batch label, tag and icon editing with encrypted reopen. Notes survived
  immediate lock at all three tested widths. Trigger toggling, resize, scope
  changes and nonmodal focus dismissal passed.
- Inspector checks retain output/address membership distinctions, duplicate-name
  handling and unchanged notes. Icon tests cover imported icons, clearing, arrow
  navigation, Escape and focus return.
- Fresh browser screenshots were inspected under the ignored
  `artifacts/quick-edit-review/` directory. No private account data was used.
- A broader browser run passed 45 tests, including dense graph gesture/save
  deferral, lock/export flush and encryption failure recovery, before it was
  stopped after three confirmed baseline selector failures. One running test was
  interrupted and 193 were not run. The full browser gate is not green.

The baseline failures are `coinjoin-selection.spec.ts` and `flow-inputs.spec.ts`
expecting the former “Load all input details” wording, and
`flow-polish.spec.ts` using an unscoped Graph button selector that matches both
workbench and mobile navigation. The baseline source already has the newer
wording and both buttons. Those application modules and tests are unchanged.

The older Wallet browser scenarios also assumed every row had only one button
and used former selection-count wording. Those selectors were corrected for the
metadata workflows above. The older Sources/Destinations fixtures still expect
outpoint rows; current counterparties are grouped by address. This review does
not claim the full older Wallet fixture suite passed.
