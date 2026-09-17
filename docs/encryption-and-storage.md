# Encryption and storage decisions

Why the workspace encryption, persistence and wallet-key handling look the way
they do. The current contracts are in [architecture.md](architecture.md); this
note records the reasoning, measurements and known limits.

## Watch-only keys

Wallets are depth-3 account public keys. The serialized key cannot prove its
parent derivation path, so displayed paths are relative (`account/0/0`).
`ypub`/`upub` and `zpub`/`vpub` fix the script family; `xpub`/`tpub` need the
user's choice. Taproot follows BIP86: lift the derived x coordinate to the
even-Y point, apply the tagged TapTweak with noble's secp256k1, encode with
Bech32m directly (bitcoinjs' Taproot address helper needs an ECC adapter that is
not installed). Script-tree Taproot wallets, descriptors, multisig, root and
private keys are rejected.

Testnet4 shares key and address encodings with testnet3 and signet, so a key
or address alone cannot establish the network; the backend's chain identity
check does. Mainnet and testnet encodings are rejected across each other's
workspaces.

## Envelope

AES-256-GCM with a 128-bit tag, PBKDF2-HMAC-SHA256 at 600,000 iterations
(OWASP baseline), fresh 16-byte salt and 12-byte IV per encryption. Format,
algorithm, KDF, iterations, salt and IV are authenticated as additional data,
so an import cannot request cheaper KDF work or swap parameters. Passwords for
new files are 8 to 1,024 characters. Plaintext is limited to 32 MiB and
ciphertext is bounded before any decoding; the UI checks `File.size` before
reading an import.

Encryption protects saved files and browser storage. It does not protect an
unlocked tab, a compromised extension, same-origin JavaScript or a stolen
password, and there is no recovery. JavaScript strings cannot be reliably
erased; typed arrays are zeroed where practical.

Workspace names were originally encrypted too. They became public so locked
entries stay recognizable in the saved list; descriptions, wallet names, keys
and annotations remained inside the envelope, and the format did not change.

## Compression (envelope v2)

A dense mainnet transaction with its parents exceeded localStorage. Envelope
v2 adds an authenticated `compression` field (`none` or `gzip`) and keeps
everything else. Measured on synthetic fixtures with the production code path
(Node's native codecs, so surrogate timings rather than browser latency):

| Fixture                      | Plaintext JSON | v1 envelope | v2 envelope |                        Reduction |
| ---------------------------- | -------------: | ----------: | ----------: | -------------------------------: |
| Empty workspace              |          319 B |       632 B |       653 B | none (below 1 KiB, gzip skipped) |
| 1 wallet, 60 transactions    |        48.7 KB |     65.1 KB |     10.6 KB |                              84% |
| 1 wallet, 5,000 transactions |         3.9 MB |      5.2 MB |      0.9 MB |                              82% |

Compression is a size feature, not a speed feature: the large fixture saved
about 110 ms slower and unlocked about 30 ms slower, because KDF and full
wallet-derivation validation dominate and codec work is added. Brotli halved the
gzip output again but took about 5 s to compress at native defaults with no
quality control, so gzip is the only codec. Gzip is used only when strictly
smaller; both `CompressionStream` and `DecompressionStream` must exist for any
save, and a missing API fails the save rather than silently downgrading.
Decompression starts only after GCM authentication, reads bounded chunks and
aborts past 32 MiB. Reproduce with
`node --import tsx src/Core/Workspace/Persistence/Codec/workspaceCompression.benchmark.ts`.

## Browser persistence

Small envelopes sit inline in a public localStorage index (name, ID, timestamp).
When the serialized index would exceed about 1 MiB or a write raises
`QuotaExceededError`, envelopes move to IndexedDB and the index keeps immutable
random references; existing inline entries migrate together. IndexedDB holds
ciphertext and envelope metadata only.

Commit protocol: one IndexedDB transaction writes the new blob and waits for
`complete`; a second readwrite transaction acquires a sentinel record and, inside
its success callback with no awaits, compares the index revision the session
read and publishes the replacement. Web Locks additionally serialize the whole
save where available and act as the coordinator when IndexedDB is not. If
neither exists, saving fails and the session stays unlocked; a bare
read/check/write on localStorage is never used as a fallback. Failed
publication removes the new blob and keeps the old index; a coordinator abort
after synchronous publication is already committed. Replaced blobs are deleted
only after a successful index update, and no broad garbage collection runs
because it could delete another tab's not-yet-published blob. Unlock pins the
index revision and rejects if it changes; deletion rechecks for an unlocked
session inside the coordinator so neither can strand a session without its
ciphertext.

Corrupt index records preserve the whole index and refuse writes rather than
dropping entries. Cross-tab edit merging is unsupported: a conflicting save
stays dirty and asks for export or reload.

## Locking and undo

Edits apply synchronously to the session store. Saves are serialized and record
the revision they encrypted. Lock freezes edits, waits behind earlier saves,
encrypts any newer revision, then removes the session; failed encryption or
quota errors leave it open. Undo keeps 15 snapshots; loading or refreshing chain
data clears them so an undo cannot erase later discoveries.

## Password dialogs

Chrome occasionally offered to save a password after ordinary navigation. The
create, unlock and import dialogs used native forms with sign-in/sign-up
autocomplete hints, which Chromium treats as submission signals. They now use
an accessible group with explicit buttons, Enter handling and
`autocomplete="off"`. This removes the application's submission signal; it does
not guarantee suppression, since Chromium can infer submissions and may ignore
the autocomplete hint. Sources are listed under Browser platform in
[references.md](references.md).
