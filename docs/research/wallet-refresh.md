# Returning to a wallet

Reviewed 2026-09-08. Chaingraph's wallet refresh is browser-side and watch-only.

## Workflow

The wallet list shows when each wallet was last checked, including an age such as
“Checked 3 days ago”. Importing and unlocking do not start a wallet scan. Use
**Scan wallet** for initial discovery, **Refresh wallet** for a saved wallet, or
**Refresh all wallets** to check all imported wallets sequentially. The existing
activity monitor is an explicit opt-in and turns off when changing or locking the
workspace. It checks every 30 seconds while the workspace is unlocked. Disabling
the monitor cancels its current request batch as well as future checks.

A completed check adds new transactions and observed spends to the graph. It
preserves the current selection, filters, camera, labels, notes, and unsaved
annotation draft. Only discovery into an empty graph frames the initial result.
The summary separates transactions new to this workspace from transaction records
that were refreshed. An overlapping wallet does not count a transaction already
loaded by another wallet as a new graph transaction.

**Show new activity** filters the graph to newly loaded transactions, their
outputs, and connected context. It is an explicit navigation action and may frame
the filtered view. **All paths** restores the complete loaded graph. New activity
is retained across checks and encrypted reopening until this action acknowledges
it, so the monitor cannot erase the notification with a subsequent quiet check.
The activity queue retains up to 10,000 recent IDs and reports overflow; this cap
does not remove transactions from the workspace.

## Coverage and changes

Each check queries both receive and change branches, with a configurable unused
address gap and maximum derivation index. The successful check records its own
bounds. It downloads at most 500 transactions per wallet. Skipped work stays in an
encrypted continuation queue and is prioritized on the next check. The UI shows
queued counts and partial coverage. A narrower address bound retains previously
known addresses and pending work outside that bound, but does not claim those
addresses were checked.

Confirmed records with unchanged history heights remain saved snapshots. Their
confirmation counts do not advance solely because the status bar sees a new
block. Missing transactions, nonpositive confirmations, unconfirmed history, and
changed history heights trigger transaction retrieval. This is not a complete
chain reorganization detector or a consistent snapshot across a moving chain tip.

If a previously observed transaction disappears from all refreshed/retained wallet
histories, the last-check report records the count and warns that saved graph data
was retained. This may follow a replacement, mempool removal or reorganization; it
does not prove a cause. The application does not delete annotations or infer an
unspent output from the missing record. Received-output totals include spent
outputs and are not a wallet balance.

Cancellation and errors do not commit the current wallet's partially collected
history. In Refresh all, already completed wallets remain updated; later wallets
keep their previous snapshot. Scan results merge only scan-owned fields into the
latest workspace, preserving labels edited during network I/O. Quiet checks retain
transaction/address evidence identity, so they do not invalidate analyses.
Acknowledging new activity changes only bookkeeping; actual confirmation or
history changes still invalidate findings and run reports. No backend scan
jobs, indexes, wallet storage, or additional RPC methods were added.

## Primary sources

- [Electrum protocol history methods](https://electrum-protocol.readthedocs.io/en/latest/protocol-methods.html#blockchain-scripthash-get-history): history combines confirmed and mempool entries; nonpositive heights identify unconfirmed history. Used to determine refresh eligibility and to avoid interpreting disappearance as an unspent proof. Responses are observations from the configured indexer, not independent chain validation.
- [BIP44 address discovery](https://github.com/bitcoin/bips/blob/master/bip-0044.mediawiki#address-gap-limit): discovery uses transaction history and an unused-address gap. Chaingraph applies explicit receive/change bounds to its supported account-key scripts. It does not implement arbitrary account discovery or claim completeness beyond those bounds.

No third-party implementation was copied.

## Validation

- Build, TypeScript and repository formatting checks passed.
- 166 unit/integration tests passed. New regressions cover refresh counts, changed
  history heights, missing observations, cancellation after downloads, activity
  queue bounds, encrypted schema compatibility, concurrent edits, and analysis
  validity after quiet checks versus changed evidence.
- Five targeted browser journeys passed: encrypted reopening three days later
  with new receives and spends; cancellation/retry; analysis preservation across
  quiet refresh and activity acknowledgment; opt-in monitoring; and stopping an
  in-flight monitor check.
- All 17 existing workbench browser tests passed on the initial refresh UI. The
  final focused suite additionally verifies the subsequent quiet-check fixes.
- Desktop (1440 × 1000) and phone (390 × 844) screenshots were inspected. Refresh
  controls are above wallet statistics and remain fully visible on the phone.

Fixtures use the public BIP84 account vector and synthetic transactions. No live
wallet was scanned in this review. These results do not establish discovery
completeness, actual chain reorganizations, or hardware rendering performance.

The [desktop wallet panel](../screenshots/wallet-refresh-desktop.png) and
[phone wallet panel](../screenshots/wallet-refresh-mobile.png) use only public
fixtures. The desktop capture follows All paths while the force renderer is
still framing the changed graph; it is evidence of panel usability, not a
renderer framing or camera stability check. The coordinator received this
specific graph follow-up for the shared-renderer integration.
