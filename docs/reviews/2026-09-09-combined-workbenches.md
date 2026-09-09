# Combined workbench integration

The candidate combines the accepted Graph/Analysis workbenches (`eb47b39`),
Wallet review (`2cbf9b5`) and graph filters/batch editing (`a5f2add`) with main's
CoinJoin selection and first-use fixes (`cda78f8`). The source branches remain
unchanged. Trace remains disabled.

## Integration decisions

- Keep compact CoinJoin input selection recovery and address-context promotion.
  Main's workspace-menu keyboard behavior, password controls and explicit export
  wording remain alongside workbench-scoped focus and lock behavior.
- Merge both IconPicker naming contracts so Graph and Wallet batch editors retain
  their accessible names.
- Keep Graph's batch toolbar mounted, but inactive outside Graph. Its editor
  closes when leaving Graph; its undo claim survives ordinary navigation only
  while the corresponding history head still belongs to that batch.
- Share isolation preparation across Analysis and graph batch actions. It reveals
  amount-filtered targets and enables selected address display while preserving
  manual hiding.
- Show the canvas amount restriction in filter chips and active counts. Reset
  controls in the chips, filter popovers, Entities and empty-canvas recovery clear
  the same canvas filters. Flow amounts and deliberate manual hiding remain
  independent.
- Constrain the non-Graph workspace actions to their visible width. Main's desktop
  lookup grid otherwise left an invisible overlay intercepting Back to Wallet.
- Preserve the accepted header adjacency, hit-target and bounded Inspector scroll
  tests. Update password locators to exact names because Show password is also an
  accessible control.

## Validation scope

The combined domain run passed 559 tests in 49 files. The build, TypeScript and
format checks passed. The initial cross-feature browser run had 28 passing cases,
five intentionally skipped dormant Trace cases and one failing Back to Wallet
pointer interaction. That failure drove the toolbar-width correction. A focused
15-case rerun passed, including desktop/phone handoffs, batch history ownership,
workbench navigation and all three amount-reset surfaces. A further 15-case
regression pass covered the real WabiSabi snapshots, failed creator recovery,
wallet refresh, dense analysis, header reachability and bounded Inspector
scrolling. All passed.

Browser automation uses public synthetic fixtures and software WebGL. Bundled
WabiSabi regression tests use real public transaction snapshots with mocked
network behavior. Neither is a live upstream scan or a hardware performance
benchmark. Independent acceptance of the actual combined candidate remains a
separate gate. Branch acceptance alone is not release acceptance.

The two batch domain modules still have different planning APIs for graph and
wallet workflows. Consolidating their shared primitives can be a later
maintenance change; this integration preserves their independently tested limits
and metadata semantics.
