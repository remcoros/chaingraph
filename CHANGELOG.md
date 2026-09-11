# Changelog

## [0.1.0] - Unreleased

First public release of Chaingraph, a self-hosted, watch-only Bitcoin workbench.

- Encrypted workspaces (AES-256-GCM, PBKDF2-SHA256) saved in the browser with
  public names, encrypted file export/import and automatic saving.
- Watch-only wallets from account-level extended public keys on mainnet and
  testnet4, with browser-side derivation, bounded scanning and refresh.
- Wallet workbench with a review queue, UTXO checks, transactions, addresses,
  one-hop sources and destinations, review decisions and batch editing.
- Interactive 3D/flat transaction graph with explicit membership, grouped
  input/output layout, filters, isolation, multi-selection and undo/redo.
- Transaction view with exact-output navigation, previous-output evidence,
  bounded parent loading, script and raw-transaction inspection.
- Labels, notes, icons, bookmarks and colored tags, plus plaintext BIP329 label
  import and export.
- Seven local analysis tools with scopes, parameters, coverage reports and
  evidence links.
- Bounded connection scans for funding/spending paths, shared ancestors and
  descendants, and reconnections.
- Nine example workspaces from real mainnet and testnet4 transactions.
- Stateless read-only Core/Electrum proxy serving one or both networks, optional
  Core 31 spender-index lookup, container image and Compose deployment.

Not included: a full indexer, custodial wallet, signing, spending, or
multi-user hosting.
