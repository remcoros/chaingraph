# Independent security review (Kimi, 2026-09-08)

Scope: security/cryptography, backend, Bitcoin validity, persistence/import correctness, error
handling. Reviewed `src/domain`, `src/lib`, `server` and the unit/integration tests from source in a
fresh worktree on branch `review/kimi-security`. No inherited context.

## Audit coverage

- Encrypted envelope: fixed PBKDF2-SHA256 600k/AES-256-GCM v1 parameters enforced before key
  derivation, strict base64 canonicalization, exact envelope key set, AAD binding of metadata,
  salt and IV, zeroization of password/plaintext buffers. No defects found.
- Watch-only derivation: SLIP132 version binding per network, private-version and depth-3 account
  rejection, BIP86 TapTweak path, bounded 1-1000 non-hardened ranges, ownership verification with
  work proportional to supplied addresses. Cross-checked against published BIP32/49/84/86/SLIP132
  vectors already in tests; re-verified uppercase/mixed-case bech32 handling against
  bitcoinjs-lib 7 (uppercase accepted, mixed case rejected per BIP173). No defects found.
- Backend proxy: method/parameter allowlists via zod, Host+Origin DNS-rebinding defense, global
  rate window, 16 kB JSON cap, upstream response byte caps, queue/concurrency bounds with
  cancellation, sanitized upstream errors, cookie rereads with format validation, Electrum framing
  with per-line size cap, protocol 1.4 negotiation, genesis cross-check against Core, TLS with
  system CA. No defects found.
- Workspace schema: uint32 bounds, whole-satoshi precision via decimal-string comparison,
  sequential output indexes, duplicate outpoint rejection, MAX_MONEY total, aggregate record
  budgets before deep parse, wallet/address/path/scripthash binding. No defects found.
- Scanner/tracing/spending: bounded batches, cancellation without fallback leaks, retained
  out-of-bound history, pending-transaction rotation. No defects found.

## Findings and fixes

1. **BIP329 label import aborted on records that omit the label field** (`src/lib/labels.ts`).
   Per [BIP329](https://github.com/bitcoin/bips/blob/master/bip-0329.mediawiki) (BSD-2-Clause),
   `label` is optional and "if the label or spendable properties are omitted, the importing wallet
   should not alter these values". Previously a record of a known type without a `label` field
   aborted the whole import. Records with an omitted label are now skipped and counted, matching
   the existing skip semantics for unsupported types. Explicit string labels are honored as before,
   including an empty string, which clears the existing label through the merge in `App.tsx`
   (wallet names fall back to their current name on blank imports, an existing UI constraint).
   A leading UTF-8 byte-order mark (common from Windows editors) is tolerated.

2. **Unvalidated `xpub` and `addr` references** (`src/lib/labels.ts`, `src/lib/wallet.ts`).
   BIP329 states "for security reasons no private key types are defined". Previously any string up
   to 150 characters was accepted as an `xpub` or `addr` reference, so an `xprv` (or other secret
   material) could be persisted into the encrypted workspace and later re-exported in plaintext
   label files. `xpub` references are now validated by the new `isExtendedPublicKey` in
   `src/lib/wallet.ts`: Base58Check decode, 78-byte payload, one of the six known public SLIP132
   version bytes, key-data byte 45 not the private serialization marker `0x00`, and full
   `HDKey.fromExtendedKey` parsing (rejects invalid or uncompressed secp256k1 points and confirms
   no private key is present). Any key depth remains acceptable; account-depth rules still apply
   only to wallet imports. Regression tests cover a private-shaped payload with public version
   bytes, an uncompressed 0x04 prefix, and a point beyond the field order. `addr` references must
   parse as an address on mainnet or testnet4. Transaction/output hex references are accepted
   case-insensitively and normalized to canonical lowercase (as are bech32 address references),
   and output indexes are bounded to uint32.

3. **Redundant genesis lookup per Electrum request** (`server/app.ts`). Every Electrum call
   re-fetched `getblockhash(0)` from Core for the network cross-check, doubling Core round-trips
   during scans. The genesis hash is immutable per chain and the chain identity is still
   revalidated by `getblockchaininfo` on every request, so a validated genesis is now cached.
   Boundaries: only values matching `^[0-9a-f]{64}$` are cached; malformed results or upstream
   failures throw before caching, so the next request retries (covered by a regression test), and
   the cache lives only for the process lifetime.

## Test evidence

- `npx vitest run`: 157 tests pass (baseline 145 + 10 label boundary tests in
  `tests/labels.test.ts` + 2 genesis caching tests in `server/app.test.ts`).
- `npm run check` (tsc --noEmit, vite build, full vitest run) passes; `npx prettier --check` passes.
- Live smoke: production server on port 3102 answered `/api/status` (disconnected without
  credentials), served `index.html`, rejected `sendrawtransaction` (400) and Electrum requests
  without configuration (503) with sanitized errors.

This is a point-in-time review of the areas above, not a certification; areas marked "no defects
found" reflect the checks and vectors exercised, not a guarantee of absence of other defects.

## Limitations

- No live Core/Fulcrum upstreams were available; upstream protocol behavior is covered by mock
  fixtures only. Browser end-to-end suite was left to the parallel UI review and not run here.
