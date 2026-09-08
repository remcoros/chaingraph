# Changelog

## [0.2.0] - Unreleased

First testable release of the MIT-licensed, self-hosted Bitcoin analysis workbench.

- Interactive WebGL transaction, output and address graph with contextual inspection, tracing, labels, notes, icons, bookmarks and clusters.
- Searchable and paginated graph entities, filters for value and loaded evidence, graph context and focused findings.
- Multiple encrypted workspaces and wallets, public workspace names, optional encrypted descriptions, local browser persistence and encrypted file import/export.
- Browser-side public-key address derivation and bounded wallet scanning on mainnet and testnet4 through a stateless Bitcoin RPC and Fulcrum proxy.
- Seven scoped analysis tools with adjustable thresholds, coverage reports, exact evidence highlighting, persistent exclusions and stale-result handling.
- Synthetic laboratory, guided tour, responsive layouts and regression coverage for wallet cryptography, persistence, proxy behavior and browser flows.
- Help/about, connection details, selection history, graph focus and deliberate deletion of locked browser copies.
- Import validation binds saved addresses to their wallet key; long BIP329 wallet labels reopen correctly and scans preserve newer labels.
- Shared graph interaction surface with replaceable rendering adapters, mouse/touch tracing and framing fixes.
- Conventional collapsible transaction inputs/outputs and advanced script, opcode, witness and verified raw transaction inspection.
- Encrypted workspace tags, imported-label grouping and separate wallet-script match highlights across graph cards and transaction rows.
- Returning-wallet refresh, persistent new-activity review, cancellation and preservation of unchanged analysis evidence.
- Compact header with workspace tabs, combined lookup/prefetch controls defaulting to one previous level, Help/sample menu, and floating graph navigation.
- Compact annotation saving and icon controls, themed selects, and display controls outside the picking area.
- Bounded recovery of stale read-only Bitcoin RPC connections, retaining request deadlines and cancellation.
- Production container and local Compose deployment, plus a tag-gated multi-architecture GHCR release workflow.

This is an initial release. It is not a full indexer, custodial wallet, transaction signer or public multi-user service. See the README and deployment guide for operational limits.
