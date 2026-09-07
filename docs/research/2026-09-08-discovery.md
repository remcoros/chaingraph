# Initial discovery — 2026-09-08

Purpose: identify architectural implications and questions before implementation.
These are research observations and proposals, not settled product decisions.

## Primary sources

| Source | Relevance and implications |
| --- | --- |
| [Samourai Wallet Boltzmann](https://github.com/Samourai-Wallet/boltzmann) | Transaction interpretations and input/output linkability. Runtime and transaction-size limits, algorithm options, and completion status need to accompany results. |
| [Copexit Am I Exposed](https://github.com/Copexit/am-i-exposed) | Browser-side Rust/WASM Boltzmann provides an implementation reference. Its privacy scoring is a separate heuristic model, not interchangeable with Boltzmann linkability. This review does not validate its implementation or scores. |
| [BIP78: PayJoin](https://github.com/bitcoin/bips/blob/master/bip-0078.mediawiki) | Collaborative transactions undermine common-input ownership and change assumptions. Clusters should retain their supporting evidence, assumptions, and reversible overrides. |
| [BIP329: Wallet Labels Export Format](https://github.com/bitcoin/bips/blob/master/bip-0329.mediawiki) | Interoperable labels for transactions, addresses, inputs, outputs, and extended public keys. A native versioned workspace format is still needed for graph presentation and analysis provenance. |
| [Electrum protocol methods](https://electrum-protocol.readthedocs.io/en/latest/protocol-methods.html) | History, transaction retrieval, subscriptions, and reorganization semantics inform the stateless backend/client storage boundary. Negotiate the actual Fulcrum protocol version before selecting methods; current documentation includes newer methods that may not be supported by the installed server. |
| [Bitcoin Core 30.0 getrawtransaction](https://bitcoincore.org/en/doc/30.0.0/rpc/rawtransactions/getrawtransaction/) | Historical transaction retrieval has index/block availability conditions. Verify the deployed node's version and capabilities rather than treating this reference version as the target installation. |

Sources reviewed online on the date above. These are references, not vendored code;
review licenses and pin revisions before incorporating implementations.

## Proposed foundations

- Preserve observed chain data, user annotations, and heuristic findings separately.
- Represent transactions and outputs as the underlying spend graph; spent outputs remain relevant. Address grouping is a view, not proof of ownership.
- Make analysis and scanning bounded, cancellable, and explicit about incomplete results.
- Keep workspace data in the client, as requested; backend operations must not introduce persistent indexes or workspace caches.
- Preserve 3D as the principal graph interface; consider a synchronized 2D projection and entity list for precise selection and mobile use.
- Keep network identity explicit in workspaces and backend connections.

## Local context checked

- The starting folder contains the product prompt and example environment configuration, with no application scaffold discovered.
- `.env.example` describes one network and matching Core/Fulcrum pair per backend process, with upstream concurrency and request bounds.
- `.env.live` was not opened or used during discovery. Future test processes may load it without printing credentials or configuration values.
- The parent workspace's `start-technologies` is a symlink; its checkout was not synced, per the workspace instructions.

This file records the initial discovery before implementation. Accepted decisions now live in [architecture](../architecture.md) and [implementation research](implementation-decisions.md); current evidence is in [validation](../validation.md).
