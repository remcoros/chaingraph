# Security

Chaingraph targets a trusted, single-user, self-hosted environment. The backend
has no login or tenant isolation; use it on localhost or behind your own
authenticated HTTPS access. Workspace encryption protects stored contents, not
an unlocked browser tab or untrusted JavaScript served to it. See
[data and trust](README.md#data-and-trust) for the full assumptions.

Security fixes target the current development line. There is no long-term
support promise.

## Reporting a vulnerability

Use **Security → Report a vulnerability** on
[github.com/remcoros/chaingraph](https://github.com/remcoros/chaingraph) to open
a private report. Include the affected commit or version, the precise operation,
expected and observed behavior, which trust boundary is crossed, and a minimal
reproduction using public vectors or synthetic data. Never include RPC
credentials, seeds, private keys, personal extended public keys, workspace
passwords or private wallet exports.

## What matters most

Authenticated encryption and KDF parameters, wallet/key/script/network binding,
integer satoshi arithmetic, import shape and size limits, storage races and
cancellation, the read-only RPC allowlist, Electrum framing and response bounds,
and TLS/Host/Origin validation. Misleading heuristics and incomplete history
also matter, because they lead to wrong conclusions.

Tests may load real `.env.mainnet` and `.env.testnet4` files without printing
them; never inspect or copy them. Do not disable certificate verification. A
mocked protocol test does not prove a deployment is safe for public hosting.
