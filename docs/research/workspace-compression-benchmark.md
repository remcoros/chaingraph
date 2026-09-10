# Workspace compression measurements

Date: 2026-09-10. Scope: synthetic/public fixtures only. No backend, real wallet,
credentials, preview server, browser suite or screenshots were used.

## Reproduce and interpret

From this checkout after `npm ci`, run:

```sh
node --import tsx scripts/benchmark-workspace-compression.ts
# Repeat only the optional native codec comparison:
node --import tsx scripts/benchmark-workspace-compression.ts --codecs-only
```

The recorded runtime was Node 24.20.0 on Linux x64, using its native Web Crypto,
CompressionStream and DecompressionStream implementations. These are **Node Web
API surrogate timings, not measured browser save or unlock latency**. There is
one complete warmup round and five measured rounds per fixture/format. Format
order alternates. Tables report medians; individual phase medians need not sum
to the median total. This is a small local sample under uncontrolled host load,
without confidence intervals or a cross-device performance claim.

The main benchmark measures the current application encryption/decryption code.
A benchmark-only helper reproduces the old uncompressed v1 JSON/UTF-8,
PBKDF2-SHA256, AES-GCM and canonical base64 pipeline, including the exact v1 AAD.
Both paths use 600,000 iterations, fresh 16-byte salts and 12-byte IVs, and derive
a fresh key for every save and unlock. Save includes `parseWorkspace(data, false)`;
unlock includes `parseWorkspace(data, true)` and full public-address derivation
verification. Fixture creation and equality checks are outside the timing window.
No reduced-cost KDF or key reuse is used. The old helper is absent from production.

Totals include validation, JSON/UTF-8, compression/decompression when selected,
KDF, AES, base64 and intervening code. They exclude worker startup, structured
cloning, encrypted-envelope JSON formatting/parsing, storage publication and UI
scheduling/checkpoint latency. They therefore isolate format costs and cannot
establish end-to-end responsiveness. Application worker use and cancellation are
covered separately by targeted tests. There was no live-service validation.

Fixtures are deterministic except for encryption salt/IVs, which do not change
size. `tests/fixtures/workspace-compression.ts` builds on the existing public
BIP84 wallet fixture and replaces zero-prefixed transaction IDs with SHA256 hashes
of fixed synthetic labels. This avoids unrealistic compression from repeated
zero IDs. All wallet addresses are derived from the published account
public key; transactions are fabricated observations, not claims about chain
history. Every fifth transaction has a short annotation.

| Fixture | Wallets | Derived addresses | Transactions | Transaction/input/output records |
| --- | ---: | ---: | ---: | ---: |
| Tiny empty workspace | 0 | 0 | 0 | 0 |
| Small wallet | 1 | 20 | 60 | 240 |
| Large wallet | 1 | 1,000 | 5,000 | 20,000 |

These fit current workspace budgets. They cover small/large loaded histories,
not maximum-size workspaces, every annotation distribution, camera snapshots,
multiple-wallet derivation patterns or poorly compressible user notes.

## Size results

Bytes are UTF-8 byte counts. Envelopes include metadata, AES authentication tag
and base64 ciphertext, serialized as compact JSON.

| Fixture | Plaintext JSON | Selected bytes before AES | Codec | Legacy v1 envelope | New v2 envelope | Envelope reduction |
| --- | ---: | ---: | --- | ---: | ---: | ---: |
| Tiny empty | 319 | 319 | none | 632 | 653 | -3.3% |
| Small wallet | 48,660 | 7,769 | gzip | 65,088 | 10,585 | 83.7% |
| Large wallet | 3,913,836 | 688,143 | gzip | 5,218,656 | 917,753 | 82.4% |

Small/large gzip payloads retain 16.0%/17.6% of plaintext size. The large envelope
falls below the current approximate 1 MiB inline index threshold in isolation,
while the old envelope exceeds it. Other saved entries and browser quota still
control whether IndexedDB is needed; this benchmark does not measure storage.

Tiny inputs below 1,024 bytes deliberately skip gzip. V2 still adds its
authenticated compression field, accounting for 21 extra envelope bytes here.
An additional deterministic 65,536-byte high-entropy **binary codec probe**, not
a workspace, gzips to 65,576 bytes. The application chooses `none`, retaining
65,536 bytes. At/above the threshold gzip is retained only when strictly smaller.
This probe verifies the selection policy without pretending arbitrary binary data
is valid workspace JSON.

## Save and unlock times

Milliseconds, median of five; ranges are minimum to maximum total.

| Fixture / operation | Legacy v1 total | New v2 total | Legacy total range | New total range |
| --- | ---: | ---: | --- | --- |
| Tiny save | 70.07 | 73.71 | 65.57 to 71.82 | 65.29 to 75.58 |
| Tiny unlock | 62.94 | 70.70 | 58.94 to 69.32 | 51.81 to 71.76 |
| Small save | 69.33 | 82.90 | 57.92 to 77.34 | 73.96 to 110.19 |
| Small unlock | 106.25 | 102.02 | 102.80 to 138.38 | 85.89 to 107.72 |
| Large save | 415.56 | 527.36 | 382.96 to 486.20 | 499.76 to 548.66 |
| Large unlock | 950.46 | 981.92 | 902.25 to 994.40 | 971.48 to 1,054.38 |

| Fixture / operation / format | Validation | JSON + UTF-8 | Codec | KDF | AES | Base64 / header |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Small save v1 | 6.11 | 0.11 | 0 | 62.78 | 0.49 | 0.54 |
| Small save v2 | 5.38 | 0.16 | 2.52 | 75.47 | 0.48 | 0.13 |
| Small unlock v1 | 34.48 | 0.47 | 0 | 68.77 | 0.64 | 3.00 |
| Small unlock v2 | 34.10 | 0.40 | 2.34 | 64.48 | 0.54 | 0.58 |
| Large save v1 | 309.85 | 8.91 | 0 | 65.44 | 4.30 | 23.31 |
| Large save v2 | 314.03 | 8.70 | 136.66 | 64.30 | 0.88 | 8.27 |
| Large unlock v1 | 771.90 | 11.83 | 0 | 71.95 | 4.46 | 78.06 |
| Large unlock v2 | 789.70 | 18.24 | 96.79 | 66.55 | 1.19 | 20.02 |

Compression substantially reduced these stored file sizes. It did **not** yield
a general save/unlock speed improvement: the large fixture saved about 112 ms
slower and unlocked about 31 ms slower by median. The small unlock difference
lies within overlapping ranges. KDF and validation work remain unchanged;
reducing bytes lowers AES/base64 work but adds codec work. In particular, unlock
still derives and verifies every stored wallet address. Streaming safety checks
and bounded input chunks are part of the production codec timings.

## Native codec comparison

The runtime accepted both gzip and Brotli constructors. The optional codec-only
comparison uses native default settings, the same JSON bytes, Blob streams and
bounded collection. It excludes JSON, validation, encryption and storage. Its
Blob source chunking differs from the application's deliberate smaller chunks,
so its gzip timing must not replace the production codec timings above.

Milliseconds, median of five after one warmup, per codec.

| Fixture | Codec | Compressed bytes | Compression | Decompression |
| --- | --- | ---: | ---: | ---: |
| Small | gzip | 7,769 | 1.41 | 0.80 |
| Small | Brotli | 5,825 | 68.79 | 1.72 |
| Large | gzip | 688,143 | 104.80 | 51.23 |
| Large | Brotli | 343,737 | 5,340.10 | 40.29 |

Brotli saved another 50.1% of compressed bytes for the large fixture but took
about 5.34 seconds to compress at native defaults, compared with 105 ms for
gzip in this codec-only run. The native API provides no quality setting. This
does not justify adding another on-disk codec or implementation dependency for
ordinary autosaves. Gzip remains the only compressed format in v2; future codec
choices need their own compatibility decision and browser measurements.

## Primary sources and applicability

- [WHATWG Compression Standard](https://compression.spec.whatwg.org/), consulted
  2026-09-10, living-standard update 2026-04-20: specifies stream APIs, gzip and
  Brotli formats, unsupported-constructor errors and integrity/truncation rules.
  Applicability: native worker codecs and feature detection. Limit: specification
  presence is not a browser-support guarantee; this run probes only Node.
- [BIP84 public test vectors](https://github.com/bitcoin/bips/blob/master/bip-0084.mediawiki),
  consulted 2026-09-10, CC0: published account public key used by the existing
  fixture and benchmark derivation. Applicability: publicly reproducible valid
  watch-only addresses. Limit: synthetic transactions are unrelated to actual
  history, and these published test addresses must never receive funds.

Format/schema decisions, migration rules and the compatibility policy are in
[architecture](../architecture.md), rather than inferred from these measurements.


## Targeted implementation validation

The finished feature branch is based on scheduler integration commit `897779b`.
No main worktree, running preview or backend was changed. Local dependencies were
installed with `npm ci` in this worktree. These focused checks passed:

```sh
npm run build
npx --no-install vitest run \
  src/lib/crypto.test.ts \
  tests/workspace-schema.test.ts \
  tests/workspace.test.ts \
  tests/workspace-encryption-worker.test.ts \
  tests/workspace-format-integration.test.ts \
  tests/workspace-save-scheduling.test.ts \
  tests/workspace-storage.test.ts \
  tests/workspace-overflow.test.ts \
  tests/transaction-scheduler.test.ts
npm run check:portability
```

The focused run passed 126 tests across nine files. It covers exact legacy v1
AAD/read compatibility, gzip and raw v2 round trips, missing-version migration,
invalid/future schema and envelope versions, codec metadata authentication,
wrong passwords, malformed/truncated gzip, expansion limits with stream
cancellation, unavailable APIs, worker errors/timeouts/cancellation, import
worker handling, storage failure recovery, gesture deferral and latest-state
checkpoints. A real scheduler consumer remains active through failed compressed
saves and storage publication, cancels only after successful lock, and receives
a fresh scope on reopen. The scope is never encrypted.

Worker lifecycle tests use controlled workers, while a separate integration test
executes the actual worker handler with native Node Web APIs. Build verifies the
browser worker bundle and TypeScript contracts. Neither establishes browser
execution, device performance or live Bitcoin services. Full unit and browser
suites, previews and screenshots were intentionally skipped. The existing
browser overflow fixture was adjusted to use synthetic high-entropy notes so it
will still exercise IndexedDB after compression, but that browser journey was
not executed in this task.
