# Wallet derivation and workspace encryption

Research checked 2026-09-08. Implementation: `src/lib/wallet.ts`, `src/lib/crypto.ts`. Source material is referenced for attribution; application logic is newly written around the installed libraries.

## Decisions

Wallets are watch-only account keys. The browser derives receive/change addresses and Electrum script hashes, then orchestrates bounded queries through the configured personal backend. Extended keys and workspace passwords do not need to cross that boundary.

Imports require depth 3 with a hardened account index. Accepted forms are xpub/ypub/zpub for mainnet and tpub/upub/vpub for testnet4. The serialized key cannot prove its earlier derivation path, so displayed paths are relative (`account/0/0`). The person importing must select the right script family for xpub/tpub; ypub/upub and zpub/vpub constrain the family. Multisig descriptors, root keys, private keys, and nonstandard derivation trees are outside this first version.

Taproot uses BIP86 single-key outputs: lift the derived x coordinate to the even-Y curve point, apply the tagged TapTweak hash using noble's secp256k1 implementation, and encode the resulting output key as witness version 1. It does not support wallets with Taproot script trees. Bitcoinjs address conversion for Taproot expects an installed ECC adapter; this module directly uses its Bech32m codec with the already verified output key instead.

Mainnet and testnet encodings are rejected across each other's workspaces. Testnet4 deliberately shares address/key encodings with testnet3 and signet: an address or public key alone cannot distinguish those networks. The configured backend must identify the actual chain separately.

Saved data uses Web Crypto AES-256-GCM, a fresh 16-byte salt and 12-byte nonce on every encryption, PBKDF2-HMAC-SHA256 with 600,000 iterations, and a 128-bit authentication tag. The versioned envelope authenticates its format, algorithm, KDF, salt, and nonce as additional data. Import accepts exactly the known KDF cost and bounds ciphertext before decoding or deriving a key; the UI must check `File.size` against `MAX_ENCRYPTED_FILE_BYTES` before reading and parsing an import. Plaintext payloads are limited to 32 MiB. Passwords for new files are 8–1024 characters; a long unique passphrase is preferable.

Only encrypted envelopes should reach browser persistence and disk. Decrypted workspace objects remain in memory while unlocked; clearing a workspace must also discard the password and data references. The crypto API does not persist anything. Callers must validate the returned JSON against the workspace schema. Typed arrays are cleared where practical, but JavaScript strings and runtime copies cannot be reliably erased. Encryption protects saved files, not an unlocked browser, malicious extensions, compromised same-origin JavaScript, or a stolen password. There is no password recovery mechanism.

## Persistence and locking

The session store applies edits synchronously, independently of React rendering. Saves are serialized and record the revision actually encrypted. Locking immediately freezes edits and undo, waits behind prior saves, then encrypts any newer revision before removing the session. Failed encryption, browser quota errors, or storage conflicts leave the workspace open and exportable. The app aborts its active scan before locking; no new scan results are accepted for a locking session.

Undo retains up to 15 full snapshots of recent user edits. Loading or refreshing chain data clears that history: returning to an older snapshot could otherwise erase transactions discovered by a later scan. New edits after a refresh can be undone while retaining the refreshed data.

The browser index stores random workspace IDs and save timestamps in plaintext alongside encrypted envelopes. Wallet keys, names, labels, transaction data, and passwords are not written there in plaintext. Corrupt index records cause the entire index to be preserved and writes refused, rather than silently discarding entries. If another tab changes storage, saves stop with an export/reload message. Web Locks serialize the compare/write step across tabs where supported; without that browser API, detection is best effort and simultaneous cross-tab writes are unsupported. This first version does not merge edits across browser tabs.

Browser storage quota may be substantially smaller than the format's 32 MiB payload limit. Exported encrypted files are the portable backup; browser storage can be evicted or deleted. Unsaved changes trigger a browser navigation warning, but termination, crashes, and forced shutdown can still lose them. Keep encrypted exports of valuable investigations. A malformed index is intentionally not auto-repaired: retain the original storage and restore a known backup or repair it before reloading.

## Primary references and attribution

| Source | Applied finding | License / reuse |
| --- | --- | --- |
| [BIP32, Pieter Wuille](https://github.com/bitcoin/bips/blob/master/bip-0032.mediawiki) | Public derivation, hardened boundary, serialized depth/index, invalid-key vectors | BSD-2-Clause; public test-vector values used, implementation delegated to scure |
| [BIP49, Daniel Weigl](https://github.com/bitcoin/bips/blob/master/bip-0049.mediawiki) | Nested SegWit script and testnet upub vector | Public domain |
| [BIP84, Pavol Rusnak](https://github.com/bitcoin/bips/blob/master/bip-0084.mediawiki) | Native SegWit account zpub and receive/change vectors | CC0-1.0 |
| [BIP86, Ava Chow](https://github.com/bitcoin/bips/blob/master/bip-0086.mediawiki) | Single-key Taproot tweak and three address vectors | BSD-2-Clause; public test-vector values used |
| [SLIP132, Clark Moody](https://github.com/satoshilabs/slips/blob/master/slip-0132.md) | Extended-key version registry and legacy/nested reference address values | [CC-BY-SA-4.0](https://github.com/satoshilabs/slips/blob/master/LICENSE); factual registry/test values consulted, no prose or implementation copied |
| [Bitcoin Core testnet4 chain parameters](https://github.com/bitcoin/bitcoin/blob/master/src/kernel/chainparams.cpp) | Testnet4 uses `tb`, testnet Base58 versions and tpub version bytes | MIT; source inspected |
| [Electrum protocol: script hashes](https://electrum-protocol.readthedocs.io/en/latest/protocol-basics.html#script-hashes) | Reversed SHA256 of scriptPubKey and genesis-address example | Protocol reference; mathematical example used |
| [W3C Web Cryptography API](https://www.w3.org/TR/webcrypto/#aes-gcm) | AES-GCM authenticated encryption and PBKDF2 through native browser crypto | Specification reference; no code copied |
| [OWASP Password Storage Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html#pbkdf2) | 600,000-iteration PBKDF2-SHA256 cost baseline | CC-BY-SA-4.0; recommendation consulted, no prose/code copied |
| [scure-bip32](https://github.com/paulmillr/scure-bip32), [noble-curves](https://github.com/paulmillr/noble-curves), [noble-hashes](https://github.com/paulmillr/noble-hashes), [scure-base](https://github.com/paulmillr/scure-base), [bitcoinjs-lib](https://github.com/bitcoinjs/bitcoinjs-lib) | BIP32, curve/hash primitives, Base58Check/Base64, Bitcoin address codecs | MIT; installed package manifests and license files checked |

## Validation

Unit tests exercise published BIP32/49/84/86 and SLIP132 vectors, Electrum hash byte order, mainnet/testnet rejection, private/root key rejection, SLIP132 script mismatches, and bounded derivation. Encryption tests exercise round trips, fresh randomness, wrong passwords, ciphertext/salt/nonce tampering, invalid envelope structure and KDF parameters, size limits, and a payload exceeding 1 MiB. Browser integration and live chain scanning are separate end-to-end checks; these module tests do not establish those outcomes.

Persistence tests exercise same-turn edit/lock, edits arriving during an earlier encryption, immediate undo/update freeze, fresh-store unlock, quota failure and retry, malformed-index preservation, concurrent saves, and external storage changes while saving or locking. These use real encryption with controlled asynchronous gates.
