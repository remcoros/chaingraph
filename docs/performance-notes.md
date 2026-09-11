# Performance notes

Measured causes behind a few non-obvious pieces of code. Numbers are from local
runs on synthetic or public data and are not benchmarks or guarantees.

## Camera gestures and encrypted autosave

Camera gestures used to freeze the UI. The pinned OrbitControls dispatches an
`end` event for every wheel event, and each one synchronously collected,
validated, sorted and serialized all node positions, then rebuilt wallet script
matches and graph presentation through broad React dependencies. On a synthetic
workspace of 15,100 nodes (about 4 MB), full validation took 1.1 to 1.3 s
synchronously and wallet matching 23 to 48 ms per rebuild.

Fixes: coalesce camera snapshots after 1.2 s of quiet, pause autosave while a
gesture is active, run validation, serialization and encryption in a worker,
and never recompute wallet matches or captions for camera-only changes. Lock,
export and workspace switch flush the latest camera synchronously instead of
waiting. Worker messaging still clones the workspace, so dispatch waits for
interaction to settle. A Chromium regression with 15,000 saved outputs recorded
zero encryption jobs during wheel and drag input, followed by one idle save.

## Core keep-alive resets

Independent reviews saw connection failures right after idle time. Bitcoin Core
closes idle persistent connections (`-rpcservertimeout`, default 30 s), so a
request written to a pooled socket that Core has just closed fails with
`ECONNRESET` before any response. A probe against a testnet4 node reproduced it
at 30 s idle and not at 15 s.

`CoreClient` retries exactly that condition (`ECONNRESET`, `reusedSocket`, no
response yet, not aborted) once on a fresh non-pooled socket inside the same
limiter slot and deadline. Nothing else is retried. The probe after the fix
recovered both resets in 15 to 18 ms.

## Wallet refresh cost

Refresh queries both branches within the saved gap and index bounds, downloads
at most 500 transactions per wallet and keeps skipped work in an encrypted
continuation queue prioritized on the next check. Unchanged confirmed records
are not re-fetched: retrieval is triggered by missing transactions, non-positive
confirmations, unconfirmed history or changed history heights. Quiet checks keep
transaction and address evidence identity so analysis results stay valid. The
activity queue caps at 10,000 recent IDs. A record that disappears from all
refreshed histories is reported, not deleted, since replacement, eviction and
reorganization are indistinguishable from the client.

## Wallet row selection

Selecting a wallet row remounted its detail panel, which rebuilt the
previous-output index and re-verified wallet addresses each time; address
selection additionally decoded every loaded output. `walletSelectionIndex.ts`
now builds those indexes once per immutable transaction snapshot and network,
and the workbench keeps them above the keyed panel. New observations rebuild
them; nothing is persisted.

## Layout worker and stale replies

An obsolete layout could occupy the worker for tens of seconds before a newer
filter request ran. New topology requests now terminate obsolete work
immediately, stale replies are ignored, and views whose nodes already have cached
positions restore synchronously without simulation. Explicit snapshot flushes
save the current camera and last displayed geometry rather than running a
pending layout on the UI thread.

## Workspace compression

Gzip in envelope v2 cuts stored size by about 82 to 84 percent on wallet
fixtures but does not speed up save or unlock, which are dominated by PBKDF2 and
full wallet-derivation validation. Details and tables are in
[encryption-and-storage.md](encryption-and-storage.md#compression-envelope-v2).
