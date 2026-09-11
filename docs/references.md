# References and attribution

Primary sources consulted while building Chaingraph, grouped by topic, with the
decision each one informed and its licence where reuse matters. Application code
is original MIT code; test vectors and registry values are used as published.
Deeper topic notes: [encryption and storage](encryption-and-storage.md),
[analysis heuristics](analysis-heuristics.md), [spender index](spender-index.md),
[example workspaces](example-workspaces.md), [performance notes](performance-notes.md).

## Product direction

| Source | Applied |
| --- | --- |
| [Meiklejohn et al., A Fistful of Bitcoins (IMC 2013)](https://cseweb.ucsd.edu/~smeiklejohn/files/imc13.pdf) | Input and change clustering as hypotheses with evidence; no accuracy claims transferred |
| [BIP78 PayJoin](https://github.com/bitcoin/bips/blob/master/bip-0078.mediawiki) | Collaborative transactions break common-input ownership; findings stay reversible hypotheses |
| [BIP329 wallet labels](https://github.com/bitcoin/bips/blob/master/bip-0329.mediawiki) | Plaintext label interchange; the encrypted workspace format carries everything else |
| [Samourai Boltzmann](https://github.com/Samourai-Wallet/boltzmann), [Am I Exposed](https://github.com/Copexit/am-i-exposed) | Research references for linkability analysis. No code copied; no Boltzmann solver or privacy score shipped. Am I Exposed transaction IDs were used to discover public examples (MIT) |
| [Sparrow Wallet FAQ](https://sparrowwallet.com/docs/faq.html), [Spending privately](https://sparrowwallet.com/docs/spending-privately.html) | Gap-limit wording for wallet coverage; phrasing of the "combining outputs with different sources publishes a link" caution |
| [Bitcoin Design: units and symbols](https://bitcoin.design/guide/designing-products/units-and-symbols/) | Right-grouped eight-decimal BTC display with thin spaces; principles only, no images redistributed |

## Bitcoin protocol and Core RPC

| Source | Applied |
| --- | --- |
| [Core `getblockchaininfo`](https://bitcoincore.org/en/doc/30.0.0/rpc/blockchain/getblockchaininfo/) | Chain identity check before every proxied request (`main`/`testnet4`) |
| [Core `getrawtransaction`](https://bitcoincore.org/en/doc/31.0.0/rpc/rawtransactions/getrawtransaction/), [v31.0 source](https://github.com/bitcoin/bitcoin/blob/v31.0/src/rpc/rawtransaction.cpp), [review notes](https://bitcoincore.reviews/23319) | Verbosity 2 supplies `vin[].prevout` from undo data; block-hash hint retrieves without `txindex` and yields `in_active_chain`; mempool and coinbase carry no prevouts |
| [Core `getblockheader`](https://bitcoincore.org/en/doc/30.0.0/rpc/blockchain/getblockheader/) | Height for a containing block; negative confirmations mean outside the active chain |
| [Core `getblock`](https://bitcoincore.org/en/doc/30.0.0/rpc/blockchain/getblock/) | Verbosity 0-3 allowlisted with a response-size bound |
| [Core `gettxout`](https://bitcoincore.org/en/doc/30.0.0/rpc/blockchain/gettxout/) | Current UTXO check including mempool; null is absence from this node's view, not a spend |
| [Core 31 `gettxspendingprevout`](https://bitcoincore.org/en/doc/31.0.0/rpc/blockchain/gettxspendingprevout/), [release notes](https://bitcoincore.org/en/releases/31.0/) | Optional exact spender lookup; see [spender-index.md](spender-index.md) |
| [Core `transaction.h`](https://github.com/bitcoin/bitcoin/blob/master/src/primitives/transaction.h) | Null outpoint and coinbase definitions used when binding raw bytes to records |
| [Core `script.h`](https://github.com/bitcoin/bitcoin/blob/master/src/script/script.h), [`script.cpp`](https://github.com/bitcoin/bitcoin/blob/master/src/script/script.cpp) | Opcode and PUSHDATA encoding for the independent OP_RETURN parser |
| [Core testnet4 chain parameters](https://github.com/bitcoin/bitcoin/blob/master/src/kernel/chainparams.cpp) | `tb` prefix and testnet Base58/xpub version bytes shared with testnet3 and signet |
| [Bitcoin developer guide: transactions](https://developer.bitcoin.org/devguide/transactions.html), [BIP141](https://github.com/bitcoin/bips/blob/master/bip-0141.mediawiki) | Outpoints, fee accounting and virtual size for fee-rate reporting |

## Electrum protocol

| Source | Applied |
| --- | --- |
| [Protocol basics](https://electrum-protocol.readthedocs.io/en/latest/protocol-basics.html), [methods](https://electrum-protocol.readthedocs.io/en/latest/protocol-methods.html), [changes](https://electrum-protocol.readthedocs.io/en/latest/protocol-changes.html) | Newline-delimited JSON with ID correlation; `server.version` first, negotiate 1.4; `server.features` genesis compared with Core; script hash is reversed SHA256 of scriptPubKey; only 1.4 scripthash methods are used |
| [ElectrumX `get_history`](https://electrumx.readthedocs.io/en/latest/protocol-methods.html#blockchain-scripthash-get-history), [`listunspent`](https://electrumx.readthedocs.io/en/latest/protocol-methods.html#blockchain-scripthash-listunspent) | Heights 0/-1 mean mempool; `listunspent` includes mempool-created and excludes mempool-spent outputs and is not an atomic multi-address snapshot |
| [BIP44 address gap limit](https://github.com/bitcoin/bips/blob/master/bip-0044.mediawiki#address-gap-limit) | Discovery bounded by an unused-address gap and maximum index on receive/change branches |

## Keys, scripts and cryptography

| Source | Applied | Licence / reuse |
| --- | --- | --- |
| [BIP32](https://github.com/bitcoin/bips/blob/master/bip-0032.mediawiki) | Public derivation, depth-3 account keys, invalid-key vectors | BSD-2-Clause; vectors used, derivation delegated to scure-bip32 |
| [BIP49](https://github.com/bitcoin/bips/blob/master/bip-0049.mediawiki) | Nested SegWit script and testnet `upub` vector | Public domain |
| [BIP84](https://github.com/bitcoin/bips/blob/master/bip-0084.mediawiki) | Native SegWit account `zpub` and receive/change vectors; also the public demo wallet and browser test fixture | CC0-1.0 |
| [BIP86](https://github.com/bitcoin/bips/blob/master/bip-0086.mediawiki) | Single-key Taproot tweak and address vectors | BSD-2-Clause |
| [SLIP132](https://github.com/satoshilabs/slips/blob/master/slip-0132.md) | Extended-key version registry (`ypub`/`zpub`/`upub`/`vpub`) and reference addresses | CC-BY-SA-4.0; factual values consulted, no prose or code copied |
| [W3C Web Cryptography API](https://www.w3.org/TR/webcrypto/#aes-gcm) | AES-256-GCM and PBKDF2 through native browser crypto | Specification |
| [OWASP password storage](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html#pbkdf2) | 600,000-iteration PBKDF2-SHA256 baseline | CC-BY-SA-4.0; recommendation only |
| [WHATWG Compression Standard](https://compression.spec.whatwg.org/) | Native gzip streams, feature detection, truncation and integrity rules | Specification |
| [WHATWG Encoding Standard](https://encoding.spec.whatwg.org/#interface-textdecoder) | Fatal UTF-8 decoding for OP_RETURN text | Specification |
| [scure-bip32](https://github.com/paulmillr/scure-bip32), [noble-curves](https://github.com/paulmillr/noble-curves), [noble-hashes](https://github.com/paulmillr/noble-hashes), [scure-base](https://github.com/paulmillr/scure-base), [bitcoinjs-lib](https://github.com/bitcoinjs/bitcoinjs-lib) | BIP32, secp256k1 and TapTweak, hashes, Base58Check/Bech32m, transaction deserialization and script ASM | MIT; in `THIRD_PARTY_NOTICES.md` |

## Browser platform

| Source | Applied |
| --- | --- |
| [IndexedDB transaction lifecycle](https://w3c.github.io/IndexedDB/#transaction-lifecycle), [MDN `complete` event](https://developer.mozilla.org/en-US/docs/Web/API/IDBTransaction/complete_event) | Transaction completion, not request success, is the persistence boundary |
| [MDN storage quotas and eviction](https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria) | localStorage limits and origin eviction motivate IndexedDB overflow and exported backups |
| [MDN Web Workers](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Using_web_workers), [structured clone](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Structured_clone_algorithm), [W3C requestIdleCallback](https://www.w3.org/TR/requestidlecallback/) | Validation and encryption off the UI thread; dispatch waits for gestures to settle because cloning is not free |
| [Chromium password-form guidance](https://www.chromium.org/developers/design-documents/create-amazing-password-forms/), [form styles](https://www.chromium.org/developers/design-documents/form-styles-that-chromium-understands/), [security FAQ](https://chromium.googlesource.com/chromium/src/+/master/docs/security/faq.md) | Local encryption dialogs avoid native form submission and sign-in autocomplete hints; suppression of save-password prompts is not guaranteed |
| [Node HTTP `request.reusedSocket`](https://nodejs.org/docs/latest-v24.x/api/http.html#requestreusedsocket), [`--use-system-ca`](https://nodejs.org/api/cli.html#--use-system-ca) | One fresh-socket retry for keep-alive resets; system trust store without disabling verification |

## Rendering

| Source | Applied |
| --- | --- |
| [Three.js](https://github.com/mrdoob/three.js) ([InstancedMesh](https://threejs.org/docs/pages/InstancedMesh.html), [InstancedBufferGeometry](https://threejs.org/docs/pages/InstancedBufferGeometry.html), [OrbitControls](https://threejs.org/docs/pages/OrbitControls.html), [MIT](https://github.com/mrdoob/three.js/blob/dev/LICENSE)) | Instanced cubes/spheres/octahedra, one instance per connection with camera-space ribbons and arrowheads, damped orbit/pan/zoom |
| [d3-force-3d](https://github.com/vasturiano/d3-force-3d) (MIT), [D3 simulation](https://d3js.org/d3-force/simulation), [link force](https://d3js.org/d3-force/link) | Finite manual ticks in a worker with fixed anchors for non-transaction associations |
| [3d-force-graph](https://github.com/vasturiano/3d-force-graph) (MIT) | Earlier default renderer; still a dependency behind the retained `forceAdapter.ts` |
| [Babylon.js thin instances](https://doc.babylonjs.com/features/featuresDeepDive/mesh/copies/thinInstances/) (Apache-2.0) | Evaluated as an alternative engine; not adopted |
| [Fontsource](https://github.com/fontsource/fontsource) Manrope and IBM Plex Mono | Locally served fonts, OFL-1.1 |
| [Esplora](https://github.com/Blockstream/esplora) ([API](https://github.com/Blockstream/esplora/blob/master/API.md)) | Familiar input/output inspection pattern; UI is original and no public explorer API is used |

## Deployment

| Source | Applied |
| --- | --- |
| [Docker multi-stage builds](https://docs.docker.com/build/building/multi-stage/), [Compose environment files](https://docs.docker.com/compose/how-tos/environment-variables/set-environment-variables/), [attestations](https://docs.docker.com/build/ci/github-actions/attestations/), [build-push-action](https://github.com/docker/build-push-action) | Build stage plus slim runtime, read-only root, dropped capabilities, provenance and SBOM; build args hold only public metadata |
| [Official Node image](https://github.com/nodejs/docker-node/blob/main/24/bookworm-slim/Dockerfile) | Node 24 Debian slim, non-root `node` user, system CA package; digest pinned in the Dockerfile |
| [GHCR publishing](https://docs.github.com/en/actions/tutorials/publish-packages/publish-docker-images), [Actions secure use](https://docs.github.com/en/actions/reference/security/secure-use) | Repository-scoped token, actions pinned to commit SHAs, packages write only in the publish job |
| [mempool.space](https://mempool.space/) | Discovery and credit source for public example transactions; not used at runtime |
