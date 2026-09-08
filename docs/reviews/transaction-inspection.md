# Transaction inspection review

Implemented and reviewed 2026-09-08 on `feature/transaction-inspection`.

## Result

The renderer-independent transaction panel sits in normal flow above the canvas. It can collapse, keeps selection in shared application state, and shows creating and loaded spending transactions for an output. Input rows resolve to the same output entities used by the graph. A chooser preserves the displayed spending transaction while following its input. Rows show available addresses, exact satoshi values, outpoints, labels and a direct annotation action. Missing previous outputs have an explicit one-level fetch action. Competing loaded spends are retained without making an unspent or ownership claim.

The inspector has a separate collapsible script/raw section. Saved output scripts are decoded locally; raw transaction requests are explicit, bounded and verified against the requested ID and loaded input/output observations. Raw bytes, input scriptSig and witness stacks remain in memory. Witness stacks initially render up to 20 items, with an explicit next-items action. Scripts are never executed. Synthetic raw data stays unavailable.

## Verification

- TypeScript and production build passed.
- 163 unit/integration tests passed, including raw SegWit parsing, coinbase serialization hashing, malformed/trailing/oversized hex, inconsistent loaded observations, malformed push data, exact creating/spending relationships, fallback and cancellation.
- Full browser suite: 34 tests passed on isolated app port 4201 and graph fixture port 4202.
- After final witness pagination and transaction identity wording, the three focused transaction-inspection browser journeys passed again. They cover tracing and labels, 150-output phone selection and collapse, raw/witness inspection, pagination and releasing raw data on selection change.
- Formatting and diff whitespace checks passed.
- Read-only live testnet4 through preview 3111 and bridge 4400 passed at height 151448. Public transaction `d4e564d295233f62603f7a7e9527acf88f6e467985868f15339887285d64bb1a`, output 1, loaded successfully; raw verification succeeded and two witness items were displayed with no browser errors. No environment file was read or copied.

## Screenshot findings and fixes

- [Desktop tracing and annotation](../screenshots/transaction-inspection-desktop.png), 1440 by 900.
- [Collapsed 150-output phone selection](../screenshots/transaction-inspection-mobile.png), 390 by 844.
- [Public testnet4 script and witness inspection](../screenshots/transaction-inspection-live.png), 1440 by 900.
- [Same live view after layout settled, before explicit Fit graph](../screenshots/transaction-inspection-before-fit.png).

The first mobile review found that collapsing a long list retained its old scroll offset, hiding the selected row. Selection and collapse now scroll that row into the panel's visible area, with a full viewport-intersection assertion. A duplicate sibling React key between annotation and script editors was also corrected. The transaction chooser was made a compact horizontal control, and input/output content is left-aligned.

An immediate live screenshot initially showed tiny graph nodes. Waiting four seconds for the existing force layout produced readable framing; pressing Fit graph then made no visible difference. This was settling time, not a persistent panel-resize regression. No automatic camera jump on panel resize was added.

## Limits

These are loaded observations and read-only inspection, not consensus or signature verification. Matching txid does not authenticate witness data against a block commitment. ASM uses bitcoinjs's normalized representation; original hex is retained. Hardware/mobile performance, every script type and every live transaction are not certified by these checks. Raw bytes intentionally require loading again after selection changes. The transaction panel follows ordinary graph filters: navigating to a filtered-out output preserves the filter and the existing visibility notice rather than silently changing it.
