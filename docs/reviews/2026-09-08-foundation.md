# Shared analysis foundation review

The reviewed main foundation combines the independent Opus UI review, Kimi label
and proxy corrections, shared graph boundary, conventional transaction inspection,
returning-wallet refresh, and workspace tags. The renderer proposals remain local
experiments and are being rebased on this shared behavior.

## Integrated behavior

- Renderer adapters receive display frames and emit stable node/link IDs. Shared
  React code owns tooltip content, selection, labels, tracing, controls and legend.
  `graph/defaultAdapter.ts` is the default renderer composition point.
- Transaction inputs/outputs stay separate from WebGL and follow the same selection
  and annotation actions. Script/raw inspection is explicit and bounded.
- Refresh preserves the camera, drafts and unchanged analysis evidence. New activity
  persists until reviewed; missing history entries do not delete annotated records.
- Encrypted tags remain independent from annotations. Address tags extend to their
  loaded outputs. Wallet script matches and associated transactions have distinct
  wording from manual groups and ownership hypotheses. Member lists are paginated.
- Shared badges appear in transaction rows and graph cards. All-wallet-match and
  tag filters retain connected graph evidence without making additional requests.

## Verified integration

- Production build and 203 unit/backend tests passed.
- The full synthetic browser suite passed all 45 tests on ports 4190/4191.
- After the final shared toolbar/legend composition, default-adapter module and
  screenshot-path cleanup, build and 203 unit tests passed again. Three focused
  browser tests passed: desktop/phone shared controls, collapsed large transaction
  lists, and wallet-match filtering without requests or activity acknowledgment.
- The suite now contains 46 browser tests including the added wallet-match journey.
- Read-only live Core/Electrum smoke passed all five checks on testnet4 at height
  151449. The separate transaction inspection review records real raw/witness UI
  inspection through the same bounded proxy.
- Formatting and whitespace checks passed. Container validation is recorded in the
  final validation report after it completes, separately from host-node checks.

## Screenshot review

[Transaction view](../screenshots/foundation-transactions-desktop.png),
[phone transaction view](../screenshots/foundation-transactions-mobile.png),
[tags](../screenshots/foundation-tags-desktop.png),
[phone tags](../screenshots/foundation-tags-mobile.png),
[wallet refresh](../screenshots/foundation-wallet-desktop.png), and
[phone wallet refresh](../screenshots/foundation-wallet-mobile.png) use public test
vectors or synthetic records, not private wallets. These capture the integrated
flows before the final laboratory-badge positioning adjustment. A final focused
browser capture checks that badge inside the canvas viewport. Automated screenshots
now write to test-results rather than modifying historical report images.

Save was previously clipped by its scrolling ancestor. It now precedes annotation
fields and is tested with full viewport intersection. The phone laboratory badge
was also overlapping wrapped controls; controls occupy their own layout strip and
the badge/legend now belong to the graph viewport. Waiting for the force layout to
settle improves initial framing. A subsequent live screenshot review exposed an
additional short-canvas defect: a fixed 65-pixel fit margin could consume the usable
height. The margin now adapts to the canvas, with actual rendered-node and picking
coverage at 390 by 110 pixels. This does not establish sustained GPU performance. The custom renderer remains a separately tested comparison.

No remote publication, GitHub release, native ARM run, physical-device test or
consensus/signature validation is implied by these results.

The subsequent 47-test main run passed 46 and exposed a short-canvas hover card covering its node before a click. The card title now provides an explicit shared selection button. All seven graph browser tests passed after that fix; the build, 203 unit tests and formatting also passed. The optional renderer-recovery event is shared so a restored experimental renderer can clear the common WebGL fallback.

## Final combined UI check

Main integrated the corrected Kimi foundation at `0547e2b`, transaction geometry
refinement at `b3de0fd`, and Opus panel sizing at `9ba99e5`. Build and 209 unit
tests passed. The final serial browser run passed all 48 tests after adjusting a
stale scroll-offset assertion for the taller desktop panel. A row that already
fits need not scroll; phone overflow and deliberate scrolling remain asserted.

The rebuilt hardened container passed the extended production-browser round trip.
A fresh live public-testnet4 walkthrough passed at height 151457 with no browser
errors, including tags, parents, exact spending discovery and raw inspection.
Updated desktop and phone screenshots show the selected tagged output fully
inside its panel. A separate Core idle-socket investigation and its final
verification are recorded in the backend review and validation report.
