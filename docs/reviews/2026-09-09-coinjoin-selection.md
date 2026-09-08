# CoinJoin input selection disappearing

## Reproduction and cause

Following a loaded input's arrow can display a compact parent transaction without
expanding its graph context. The flow lists that parent's inputs, but the graph
does not yet contain their placeholders. Clicking one assigned a selection that
the graph availability check immediately cleared. The flow then disappeared.
This happened before a backend request, so a load failure was not required.

Reproduced the disappearance in a browser regression before changing application
code. An independent source review confirmed the selection/compact-context mismatch.
Existing coverage had selected the central transaction before following another
input, inadvertently expanding it and avoiding the bug.

## Fix

Selection now uses the current session and exposes a displayed compact transaction
when it actually spends the chosen outpoint. Only the selected input's creator is
fetched; other parents stay compact. Row metadata editing follows the same path.
An arrow can select and trace in one event, so tracing also resolves newly exposed
placeholders from the current session rather than only the previous rendered graph.

A failed fetch retains the clicked input and displayed transaction. It does not
restore the selection from before that click. Loading/errors and retry now stay
in a sticky strip inside the flow: screenshot review caught that the existing
error could otherwise sit below hundreds of expanded inputs. Selection scrolling
accounts for the strip's height. Normal selection cleanup after actual removal
and the existing guards against late results remain in place.

## Verification

Thirteen distinct browser cases passed: five direct-input cases, two real WabiSabi
snapshot cases, and six tracing regressions. Coverage includes row/arrow failure,
retry success, workspace switching, branch removal/Undo and late-result rejection.
The WabiSabi case starts from the bundled 327-input, 279-output transaction and
follows a second input hop inside a 207-input parent. Only the selected creator
was requested. Its simulated timeout left the flow, inspector and graph present.
Screenshot inspection and hit testing confirmed the error/retry strip is visible
and clickable with the large input list expanded.

TypeScript/production build, changed-source formatting, whitespace and portability
checks passed. Tests use public fixtures, mocked backend failures and Chromium
software WebGL. No live upstream failure, private workspace, full test suite or
hardware GPU performance was verified in this pass.
