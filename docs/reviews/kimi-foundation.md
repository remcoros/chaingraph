# Independent foundation review (kimi-k3)

Review of `review/kimi-foundation` at 0b0b271, scoped to the recently added
transaction inspection, tags, wallet activity, refresh merging, and workspace
session code. Existing cryptography, labels, and the read-only backend proxy
boundary were checked for regressions only. No keys, signing, consensus
verification, or network publication are involved.

## Fixed issues

1. **Quiet refreshes destroyed undo history and forced autosave**
   (`src/lib/useWorkspaces.ts`, `src/domain/walletActivity.ts`). Every
   non-undoable `update` cleared all undo snapshots and bumped the revision,
   even when the merge changed nothing (scan result for a deleted wallet) or
   only advanced check metadata (`scannedAt`, unchanged evidence). With live
   monitoring this ran every 30 seconds, making the undo control effectively
   unusable. Now an identical result is ignored entirely; snapshots are
   invalidated only when chain evidence actually changed (transaction records
   or wallet identity/keys/script type/address bindings), matching the stated
   intent that undo must never erase newly refreshed transaction data; and
   retained snapshots carry the latest scan-owned metadata (`scannedAt`, scan
   bounds/completeness, pending queue, `lastActivity`, review state) via the
   `carryScanMetadata` projection, so quiet checks and activity
   acknowledgment remain non-undoable while undo still restores user edits
   (names, colors, tags, annotations, views). Deleted wallets are never
   resurrected and newly discovered activity is never hidden.

2. **Null outpoint accepted as a regular prevout in raw binding**
   (`src/domain/transactionInspection.ts`). The non-coinbase input branch
   compared only hash and index, so a crafted record claiming an input from
   the all-zero hash at index 4294967295 bound successfully to a real
   coinbase input. Per Bitcoin Core `src/primitives/transaction.h`,
   `COutPoint::IsNull` is exactly `hash.IsNull() && n == UINT32_MAX`; the
   branch now rejects that null outpoint when the saved input claims an
   ordinary prevout, and still binds a zero hash at any other index
   structurally (serialized bytes agree), without implying the referenced
   output exists. Primary source recorded in
   `docs/research/transaction-inspection.md`.

## Backend transport fix (after merge of frozen main 6a62434)

3. **Stale keep-alive Core socket caused sporadic offline status**
   (`server/core.ts`). Root reproduced against the configured live Core with a
   standalone `CoreClient(loadConfig())` probe: `getblockchaininfo` after idle
   intervals [0, 15000, 30000, 1000, 30000] ms gave success (63 ms), success
   (7 ms), ECONNRESET with `reusedSocket: true` (4 ms), success (51 ms),
   ECONNRESET with `reusedSocket: true` (2 ms). Only `error.code` and
   `ClientRequest.reusedSocket` were inspected; no messages, URLs or
   credentials. Cause: the pooled keep-alive agent hands out a socket the
   peer already closed while idle (Node documents this for pooled agents);
   the request fails with ECONNRESET before any response and surfaced as a
   generic connection failure, flipping the UI to offline after idle.

   Fix: exactly one bounded retry, on a fresh non-pooled socket
   (`agent: false`), only when all of these hold: the request failed with
   `ECONNRESET`, `request.reusedSocket` is true, no response callback had
   fired, the combined abort signal is not aborted, and the client is not
   closing. The retry reuses the same overall `AbortSignal.timeout` deadline
   and limiter slot, gets its own connect-timer cleanup, and its failure is
   final (no recursion). Authentication, HTTP status, JSON-RPC rejections,
   response-size limits, mid-response failures, aborts, timeouts, and
   fresh-socket transport errors are never retried. Keep-alive, TLS
   verification, and the RPC method allowlist are unchanged. Primary source:
   Node http documentation for `request.reusedSocket` and `agent: false`,
   logged in `docs/research/backend.md`.

   Deterministic regressions in `server/app.test.ts` drive a raw-TCP HTTP/1.1
   stub so the real transport and agent pooling are exercised: a reset of the
   reused pooled socket retries once over a new connection and succeeds;
   a reset on a fresh socket is not retried; a retry that also fails surfaces
   the error after exactly one retry; a 401 on a reused socket, a mid-response
   failure, and an aborted request are not retried (attempt and connection
   counts asserted).

## Verified with no findings

- Raw/witness inspection limits: hex is size- and format-checked before
  decode; weight (4M WU) and input/output counts (10k) after; the decoded ID
  must match the selected transaction and every loaded input/output
  observation. The UI correctly documents that a matching txid does not
  authenticate witness bytes against a block commitment; no consensus
  verification is claimed.
- `ScriptInspector` cancellation and cleanup: in-flight loads abort on
  selection or transaction change and on unmount; decoded raw bytes are held
  only while inspecting the selection; witness rendering is paginated.
- Tag validation (`src/domain/tags.ts`): budgets are counted before
  allocation, references are canonicalized and deduplicated, duplicate IDs
  and case-insensitive names are rejected, and addresses are validated per
  network. Address tags extend to loaded outputs only, never implicitly to
  transactions. Wallet matches verify scripthash consistency, treat a raw
  output script as authoritative over decoded address text, and label
  transaction-level matches as associations rather than ownership.
- Refresh merging (`src/domain/walletActivity.ts`, `src/lib/api.ts`): deleted
  wallets are not resurrected, the unreviewed queue is bounded at 10,000 with
  an overflow flag, unchanged address evidence keeps its reference so quiet
  checks leave findings and run reports fresh, the pending queue rotates
  skipped work ahead of recurring unconfirmed refreshes, and scan budgets
  (500 loads, 10,000 backlog) are enforced. Cancellation propagates through
  the shared abort signal without partial commits.
- Workspace/session storage: encrypted envelope shape, public-name handling,
  cross-tab write guards, lock/persist serialization and history budget
  (15 snapshots) behave as tested. New regressions cover multi-edit + quiet
  scan + double undo retaining the latest scan metadata, acknowledgment
  surviving undo of an earlier user edit, no-op merges leaving revision and
  history untouched, and evidence-changing refreshes still clearing history.

## Test scope

- Independent `npm ci`; full unit suite after the transport fix: 215 passed
  (209 before, plus 6 new Core transport regressions). `npm run build` and
  `npm run format:check` passed. Transport-only change: browser suite not
  re-run for this fix; root's live idle probe and container rebuild verify
  the live path.
- Focused browser suite on ports 4207/4208
  (`CHAINGRAPH_E2E_PORT`/`CHAINGRAPH_GRAPH_TEST_PORT`): all 6
  `wallet-refresh` tests passed after the corrections (cancellation,
  quiet-evidence preservation, acknowledgment persistence, opt-in
  monitoring, wallet-match filtering without requests). Before the
  corrections, all 10 tests in `wallet-refresh`, `transaction-inspection`,
  and `tags` specs passed on the same ports.
- No UI markup changed, so no new screenshot review was needed.

## Remaining limits (unchanged)

Script ASM is a display-only decode, not execution or validation. Raw and
witness data are node-supplied observations bound to the loaded transaction,
not block-commitment proofs. Wallet and tag matches are browser-only signals
over loaded data. Monitoring polls only after opt-in and only while the
workspace is unlocked. No live sensitive wallet scan, remote publication, or
physical-device testing was performed.
