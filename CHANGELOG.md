# Changelog

## [0.2.0] - Unreleased

First testable release of the MIT-licensed, self-hosted Bitcoin analysis workbench.

- Interactive WebGL transaction, output and address graph with contextual inspection, tracing, labels, notes, icons, bookmarks and clusters.
- Searchable and paginated graph entities, filters for value and loaded evidence, graph context and focused findings.
- Multiple encrypted workspaces and wallets, public workspace names, optional encrypted descriptions, local browser persistence and encrypted file import/export.
- Browser-side public-key address derivation and bounded wallet scanning on mainnet and testnet4 through a stateless Bitcoin RPC and Fulcrum proxy.
- Simultaneous mainnet/testnet4 backends with independent configuration, transports and request queues; discovered network choices and explicit offline handling for unsupported workspaces.
- Seven scoped analysis tools with adjustable thresholds, coverage reports, exact evidence highlighting, persistent exclusions and stale-result handling.
- Synthetic laboratory, guided tour, responsive layouts and regression coverage for wallet cryptography, persistence, proxy behavior and browser flows.
- Help/about, connection details, selection history, graph focus and deliberate deletion of locked browser copies.
- Import validation binds saved addresses to their wallet key; long BIP329 wallet labels reopen correctly and scans preserve newer labels.
- Shared graph interaction surface with replaceable rendering adapters, mouse/touch tracing and framing fixes.
- Conventional collapsible transaction inputs/outputs and advanced script, opcode, witness and verified raw transaction inspection.
- Compact transaction flow with exact-output navigation, decoded OP_RETURN previews, inline tag creation and automatic encrypted persistence of annotations, filters and graph layout.
- Encrypted workspace tags, imported-label grouping and separate wallet-script match highlights across graph cards and transaction rows.
- Returning-wallet refresh, persistent new-activity review, cancellation and preservation of unchanged analysis evidence.
- Compact header with workspace tabs, centered lookup/prefetch controls defaulting to Previous Off, Help/sample menu, and floating graph navigation.
- Compact annotation saving and icon controls, themed selects, and display controls outside the picking area.
- Node-only hover cards with compact header actions, saved selection locking, independent label/tag/icon captions and desktop-only focus beside 3D/Flat.
- Direct input data loads automatically for the transaction flow, with bounded parent context that avoids displaying unrelated branches until navigated.
- Transaction cards select across the whole block and expose label/tag/icon shortcuts; input/output expand controls remain above their rows.
- Network-aware curated samples: four independently verified mainnet transactions and three testnet4 output paths.
- Encrypted IndexedDB backing for large workspaces and localStorage quota recovery, preserving small-save behavior and portable encrypted exports.
- Saved manual entity visibility, hidden/all entity views, compact row actions, grouped input/output visibility and guarded transaction/address-watch removal with Undo.
- Compact transaction input/output counts and observed block-height or mempool status across entities, flow and inspection.
- Deferred graph snapshots and worker-based validation/encryption, with latest-view checkpoints on lock, export and workspace switching.
- Bounded recovery of stale read-only Bitcoin RPC connections, retaining request deadlines and cancellation.
- Production container and local Compose deployment, plus a tag-gated multi-architecture GHCR release workflow.

This is an initial release. It is not a full indexer, custodial wallet, transaction signer or public multi-user service. See the README and deployment guide for operational limits.
