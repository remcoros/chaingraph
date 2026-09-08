# Graph interaction and encrypted save scheduling

Investigated 2026-09-08 after a user reported freezes during camera gestures.

## Observed causes

The pinned OrbitControls implementation dispatches an `end` event for each mouse
wheel event. Chaingraph handled that event by synchronously collecting, validating,
sorting and serializing all node positions. The React boundary repeated some of
that work, then updated the workspace. Broad workspace-object dependencies also
rebuilt wallet script matches and graph presentation after camera-only changes.

An isolated synthetic Node profile used 15,100 graph nodes, 15,000 outputs with
address/script metadata and a workspace of approximately 3.99 MiB. Full save
validation took about 1.10 to 1.33 seconds synchronously. Wallet matching with no
wallets took approximately 23 to 48 milliseconds per rebuild. These measurements
identify work on the input path; they are not browser frame-rate measurements or
performance guarantees.

## Design and primary references

- [MDN: Using Web Workers](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Using_web_workers) describes separate worker execution and message-based ownership. Workspace validation, JSON encoding and encryption belong together off the UI thread; the envelope format and cryptographic checks remain unchanged.
- [MDN: Structured clone algorithm](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Structured_clone_algorithm) documents the copying used by worker messaging. A worker does not make transport free. Dispatch therefore waits for interaction to settle, and no claim of zero-copy workspace transfer is made.
- [W3C: requestIdleCallback](https://www.w3.org/TR/requestidlecallback/) defines opportunistic idle scheduling. A timeout can force execution outside an idle period, so a short idle deadline is not permission to perform unbounded validation on the UI thread.

Camera snapshots should be coalesced after gestures settle. An explicit lock,
export or workspace switch must flush the latest camera instead of waiting for
the quiet period. Autosave should defer while a graph gesture is active. Changes
to camera state must not recompute wallet script matches or annotation rendering.
The main-thread saved index should avoid constructing a large JSON string merely
to decide that an encrypted payload belongs in IndexedDB.

The implementation is original project code. No external performance framework or
cryptographic implementation was copied. Browser timing, worker use, camera flush,
CSP and persistence evidence is recorded in the validation report after testing.

## Browser evidence

The final Chromium/SwiftShader regression used 15,000 saved outputs and 1,501
rendered nodes. A browser-timed synthetic DOM wheel sequence exercised the real
OrbitControls handler; a separate held-pointer drag used Playwright mouse input.
Both recorded zero encryption-job starts during input, followed by an idle save.
Immediate export and lock retained the changed camera and pending note. The
[recorded event and long-task observations](graph-autosave-measurements.json) are
from that run. They are functional scheduling evidence on this host, not a
hardware-independent frame-rate benchmark.
