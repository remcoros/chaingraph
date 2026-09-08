# Encrypted browser storage for large graphs

Reviewed 2026-09-08 after a dense public mainnet transaction and its direct parents
exceeded localStorage capacity. The backend remains stateless.

## Decision

Small workspaces retain the original version-1 inline encrypted envelopes in the
public localStorage index. When its serialized JSON exceeds 1,048,576 characters,
or a write raises `QuotaExceededError`, the client stores encrypted envelopes in
IndexedDB and publishes a compact public index containing workspace identifiers,
public names, saved timestamps and immutable random envelope references. Existing
inline envelopes migrate together so several smaller workspaces cannot exhaust the
index. Once an index uses IndexedDB, subsequent saves keep using that backing.

The AES-256-GCM/PBKDF2 envelope, 32 MiB plaintext budget, authenticated metadata and
portable encrypted export format are unchanged. IndexedDB receives ciphertext and
cryptographic envelope metadata only. Notes, labels, wallet data, passwords and
plaintext workspace descriptions are not written there. The index retains its
100-workspace limit. Browser storage remains origin-specific and may be cleared or
evicted; exported backups remain necessary.

## Commit and recovery

A single IndexedDB transaction writes new, independently named envelopes and waits
for its `complete` event. A separate readwrite transaction on the same object store
then acquires the index coordinator through a sentinel read. Its request-success
callback synchronously compares the public index with the version the session read
and publishes the replacement. No asynchronous work runs inside that callback.
Every save and deletion uses this coordinator when IndexedDB is available, even
when Web Locks is also present, so contexts with different Web Locks availability
still serialize their index writes. Web Locks additionally serialize the full save
sequence when available and provide the coordinator when IndexedDB is unavailable.
If neither mechanism exists, saving fails while retaining the unlocked session.
A bare localStorage read/check/write is not a cross-process compare-and-swap and is
never used as a concurrency fallback.

No pending write overwrites an existing encrypted blob. If publishing the index
fails before publication, the new references are removed and the previous index
remains intact. The unlocked session keeps its unsaved revision and can retry or
export. If the coordinator transaction aborts after its synchronous index
publication succeeded, that save is already committed: its referenced ciphertext
is retained and the saved revision advances. Edits arriving
during encryption or an IndexedDB write remain dirty until a later save. Locking
waits for the latest revision before removing the unlocked session.

Replaced and deliberately deleted blobs are removed only after the corresponding
index update succeeds. Cleanup is best effort: an interrupted browser process or
failed cleanup can leave unreferenced encrypted blobs, but cannot replace the last
indexed copy with a half-written envelope. No broad garbage collection runs, since it could delete another tab's newly written
blob while that tab is waiting to publish its index.

Unlock resolves the referenced envelope, validates its shape, authenticates it and
checks its decrypted workspace identity. It pins the index version before any
asynchronous work and rejects if that version changes during unlocking. Deletion
rechecks that no unlocked session exists inside the synchronized publication
callback. These two checks prevent deletion and unlocking from leaving a clean
session whose saved ciphertext has disappeared. Missing, malformed, tampered or
identity-mismatched payloads do not replace saved data. The IndexedDB adapter waits
for transaction completion rather than an individual request's success, uses
strict write durability, and closes each database connection after use.

## Primary references

- [Indexed Database API transaction completion](https://w3c.github.io/IndexedDB/#transaction-lifecycle): transaction success is the persistence boundary, not request success.
- [MDN transaction complete event](https://developer.mozilla.org/en-US/docs/Web/API/IDBTransaction/complete_event): lifecycle confirmation and browser API reference.
- [MDN storage quotas and eviction](https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria): localStorage limits, separate IndexedDB quotas and origin eviction behavior.

These sources informed an original implementation. No external library or
third-party implementation was copied.

## Validation

Thirteen new storage tests cover large-envelope migration, migration of old inline
records on quota pressure, failed IndexedDB commits, failed index writes and retry,
competing-tab writes, edits arriving during a save, missing/tampered/mismatched
blobs, failed deletion, concurrent saves without Web Locks, a coordinator abort
after publication, missing coordination APIs, and both orderings of a concurrent
unlock and deletion. These and the 19 existing
persistence tests pass.

The browser cases in `tests/e2e/workspace-overflow.spec.ts` use real IndexedDB for
large-envelope, forced-localStorage-quota and unavailable-Web-Locks round trips.
They exercise reload, unlock, editing, encrypted export, locking and deletion,
including cleanup and exported plaintext equivalence. A simultaneous two-page
case disables Web Locks and verifies that one conflicting save remains dirty,
while every reference in the winning index still unlocks. Browser execution
results belong in the current validation report.
