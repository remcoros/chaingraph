# Wallet workbench usability refinement

The manual report identified real feedback and layout problems. Independent
Copilot review with GPT-6 Astra at high effort compared the frozen pre-change
application with the revised Wallet workbench at 1440 × 900 and 390 × 844.
It used fresh browser contexts, public synthetic wallet fixtures and intercepted
API responses. The reviewer did not edit application sources.

## Changes

- Align the wallet selector, refresh controls and record filters. Use a compact
  two-column phone summary, shorter guidance and a consistent selected-item card.
  Wallet refresh and UTXO-check timestamps describe their separate observations.
- Show labels, notes, tags and icons on review rows, Records and selected details.
  Single-entity editing starts from the current label/icon and replaces it.
  Batch edits preserve existing labels/icons unless replacement is chosen.
- Keep source and counterparty candidates after metadata edits. Labelling an
  observation is separate from completing its review; evidence fingerprints and
  wallet-qualified decisions remain unchanged.
- Support explicit checkboxes, Ctrl/Command toggles and Shift ranges in displayed
  row order. Batch controls show the target count and filtered-out selections.
  Review queue batches can edit metadata, complete reviews or defer items.
- Give deferred work its own Review later filter, separate from To review and
  Reviewed. Deferring advances to untouched work; Return to review and Reopen
  select the returned item. Deferral never acknowledges refreshed activity.
- Remove duplicate unlabelled record IDs and the confusing single-record batch
  scope wording. Render label/tag editors outside the scrolling panel's clipping
  boundary, positioned within the viewport.

## Review-driven correction

The new popup portal initially survived non-pointer workbench navigation. A
reproduction focused the Analysis navigation button programmatically, activated
it with Enter, then confirmed that the hidden Wallet editor still trapped Tab.
This is a focus-driven regression, not a claim about an undocumented keyboard
shortcut. The regression failed before the correction.

All three Wallet metadata bars now receive their workbench's active state.
Deactivation removes their editors and icon palette and clears pending popup
state. The independent reviewer confirmed all eight combinations of desktop/phone,
single/batch and Label/Tag navigation, including returning without reopening the
unapplied draft. Locking also removes the editors.

## Validation and limits

- Build, TypeScript, formatting and portability checks passed.
- Thirty focused domain tests passed, including metadata retention across open,
  deferred, reviewed and source-unknown decisions.
- Nineteen focused browser journeys passed across Wallet review, refresh and
  records. Coverage includes new receives/spends, cancellation, explicit monitor
  opt-in, encrypted persistence, wallet isolation, selection ranges, metadata
  feedback, editor lifecycle and cached navigation preserving Undo/current
  findings. Actual changed evidence still invalidates the latter.
- A further desktop/phone visual check covers popup Apply hit targets and the
  compact annotated detail. The independent reviewer confirmed all nine detail
  actions are inside the panel and hittable: desktop at scroll-top, phone after
  scrolling the detail into view. No outstanding issues remained in that review
  scope. Screenshots informed the spacing changes rather than relying solely on
  DOM visibility assertions.

Local evidence is retained under `artifacts/wallet-polish-review/` (independent
baseline, findings, screenshots and closure) and `artifacts/wallet-review/`
(focused browser screenshots). These ignored directories are development
artifacts, not shipped wallet data. No credential files or private wallets were
used. This was not a live upstream scan, native-phone keyboard test, full
accessibility certification or release publication.
