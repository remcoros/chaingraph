# First-use feedback response

Reviewed 2026-09-09 against the supplied external `FEEDBACK.md` and screenshots.
The report was in the sibling QA checkout, rather than the initially named path.
This pass addresses first-use interactions in the main application. The separate
Graph/Analysis/Trace workbench experiment is outside this change.

## Findings and decisions

| Report | Judgment and response |
| --- | --- |
| 1.1 Workspace menu dismissal | Confirmed. Outside pointer input, Escape and focus leaving the menu now dismiss it. Escape restores trigger focus; opening focuses the first available action and arrow keys navigate actions. |
| 1.2 Silent invalid lookup | Not reproduced as stated: entering `hello world` already produced an invalid-address toast. That feedback was distant from the input. Added inline validation, invalid-field styling and focus return, with no RPC request for invalid identifiers or wrong-network addresses. |
| 1.3 Background scroll on invalid create | Replaced browser-native form validation for create/unlock/import. Focus changes avoid scrolling the background; an offscreen invalid field scrolls inside the dialog. |
| 1.4 Native validation appearance | Replaced with styled, accessible inline errors. Errors clear when the affected field is edited. |
| 2.1 Password requirements | Minimum length and passphrase guidance are visible before submission. Added reveal controls to create, confirmation, unlock and import fields. No strength meter: this pass gives guidance without suggesting that minimum length guarantees strength. |
| 2.2 Camera vocabulary | `Focus graph` actually hid side panels. Renamed it `Hide panels`, retaining `Show panels` for the inverse. Added visible `Fit` text. Center selection and Repack remain separate because their behavior is distinct. |
| 2.3 BTC/sats units | Deferred. A unit preference needs consistent formatting across the graph, flow, inspector, wallet records and analysis, with unambiguous thresholds and precision. A local conversion toggle would leave inconsistent displays. |
| 2.4 Small text | Increased entity amounts/block status and flow addresses/amounts to 12px, and graph legend/help to 11px. No global density redesign or claim that every text size is now at least 12px. |
| 2.5 Reload locking | Explained in create, unlock and import dialogs and user documentation. Password retention and encryption behavior are unchanged. |
| 2.6 Mobile context | The network name stays visible. Prefetch options read `Previous: off`, `Previous: 1` and `Previous: 2`, retaining context at narrow widths. A broader mobile graph-height redesign is deferred. |
| 2.7 Export ambiguity | Header reads `Export workspace`, with an explicit encrypted-backup accessible name and tooltip. The menu retains the full encrypted-workspace label. |
| 2.8 Label interchange | Export now reads `Export BIP329 labels · plaintext`, matching the import format name and retaining the disclosure. |
| 3.1 Tour vocabulary | Tour now names visible Fit, Value under Size by, and Hide panels, explaining their different purposes. |
| 3.2 Prefetch vocabulary | Options retain their visible context; the tooltip explains previous transaction levels and bounds. The default stays off. |
| 3.3 Wallet discovery terms | Added tooltips explaining the gap limit and maximum addresses per receive/change branch. |
| 3.4 Fragmented wallet copy | Rewrote the scan explanation as a complete sentence. |
| 4.1–4.2 Analysis copy | Deferred to the active workbench experiment, which is replacing this interaction. No further redesign of the current side panel here. |
| 4.3 Inconsistent glyphs | Replaced both monochrome fork glyphs with an outgoing emoji, including their starter annotations. |
| 4.4 Repeated network badges | Kept. The gallery already groups six mainnet and three testnet4 examples; badges remain useful when cards wrap. The report's reference to two testnet4 examples was inaccurate. |

## Verification

- 18 distinct focused browser cases passed across first-use feedback (3), password
  UX (3), guided tour (7), encrypted storage/export (4), and responsive graph
  control layout (1). The layout case exercises widths down to 320px.
- One tour case was interrupted by a development-server reload during an edit;
  it passed on an isolated rerun after source changes stopped. Initial test
  selector/expectation mistakes were corrected before the passing runs.
- Inspected desktop and 390px screenshots of the lookup/navigation changes and
  password dialogs. Password validation checks cover focus, background scroll,
  reveal controls, mismatch correction and focus restoration. Reload/unlock was
  exercised using real browser encryption with public fixture data.
- 40 focused unit tests passed for encryption, its worker and workspace templates.
- TypeScript and production build passed. Formatting, diff whitespace and the
  repository portability check passed.

Browser regressions use mocked Bitcoin RPC data and Chromium software WebGL.
They do not establish hardware GPU performance or fresh upstream reliability.
This was not a new complete 3D gesture/large-wallet acceptance run, full browser
suite, or comprehensive accessibility audit. Cryptographic primitives, backend
behavior and persistence formats were not changed.

Screenshots remain in ignored local browser artifacts. No credential files or
private workspace data were needed for this pass.
