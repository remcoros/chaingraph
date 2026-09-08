# Security

Chaingraph targets a trusted, single-user, self-hosted environment. It has no backend login or tenant isolation. Use localhost or your own authenticated HTTPS access on a trusted network. Workspace encryption protects stored contents, not an unlocked browser or untrusted JavaScript served to it. See [data and trust](README.md#data-and-trust) for the complete deployment assumptions.

Security fixes target the current development line. Version 0.2.0 is being prepared; no published release or long-term maintenance promise is implied.

## Reporting a defect

If the hosting repository enables private vulnerability reporting, use **Security → Report a vulnerability**. Otherwise establish a private contact with the maintainer before sharing sensitive exploit details. No dedicated security inbox is configured in this unpublished checkout.

A useful report includes the affected commit/version, the precise operation, expected and observed behavior, and a minimal reproduction using public vectors or synthetic data. Explain which trust boundary is crossed. Never include RPC credentials, seeds, private keys, personal xpubs, workspace passwords, or private wallet exports in an issue or screenshot.

## Test boundaries

High-value checks include authenticated encryption and KDF limits, wallet/key/script/network binding, integer satoshi arithmetic, import shape and size limits, storage races and cancellation, read-only RPC allowlists, Electrum framing and response bounds, and TLS/Host/Origin validation. Heuristic errors and incomplete history also matter because misleading evidence can cause incorrect conclusions.

Use isolated browser contexts. Test processes may load authorized `.env.mainnet` and `.env.testnet4` files without printing them; never inspect or copy real credential files, including the retired `.env.live`. Verify cross-network request, response, cancellation and reconnect isolation with synthetic upstreams. Do not disable certificate verification. A mocked protocol test does not establish live-node completeness or prove that a deployment is safe for public hosting.
