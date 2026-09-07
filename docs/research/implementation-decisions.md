# First implementation decisions

Reviewed 2026-09-08. The accepted product brief is in `PROMPT.md`; the current
architecture and limitations are maintained in `../architecture.md`.

## Browser workbench

React and TypeScript provide the interface and shared contracts. The WebGL renderer
uses [3d-force-graph](https://github.com/vasturiano/3d-force-graph), built on
[Three.js](https://github.com/mrdoob/three.js), with a bounded force simulation and
an additional GPU points layer for highlighting. The renderer is loaded separately
from the workspace home screen. Graph data remains independent of the renderer's
mutable simulation state. Neither framework is a backend index or data store.

The visual design uses locally served Manrope and IBM Plex Mono fonts, distributed
through [Fontsource](https://github.com/fontsource/fontsource). Font licenses are
OFL-1.1; application code is MIT. The favicon is an original simple graph glyph,
not a fabricated upstream Bitcoin or wallet logo. The graph laboratory is explicitly
synthetic and is not presented as a real chain sample.

## Client discovery and live checks

The browser derives public wallet addresses, requests script histories, fetches
transactions and discovers funding/spending relationships. It retains its own scan
hints and can poll while a workspace is unlocked. HTTP polling is the first transport;
a WebSocket stream is not necessary to establish the stateless backend boundary.
Credentials never reach the frontend process in the development launcher.

[Electrum protocol methods](https://electrum-protocol.readthedocs.io/en/latest/protocol-methods.html)
define the queried history and transaction shapes. Protocol negotiation and installed
server capabilities matter: the client uses the 1.4 scripthash methods, not methods
introduced in newer protocol versions merely because they appear in current docs.

The sibling MIT application `mempool-api-proxy` informed the host-CA configuration,
network checks and transport review. [Node's system CA option](https://nodejs.org/api/cli.html#--use-system-ca)
is enabled in runtime scripts and npm lifecycle tools. Host certificate and hostname
verification remain enabled. See `backend.md` for the precise review and live evidence.

## Interpretation, not identity

Three initial analysis tools expose explicit findings: repeated output values,
tentative common-input clusters, and address reuse in loaded history. Findings can
be excluded or removed. Their source transaction IDs remain available to inspect.

[BIP78](https://github.com/bitcoin/bips/blob/master/bip-0078.mediawiki) describes how
collaborative transactions invalidate common-input ownership and change assumptions.
Our equal-output filter is intentionally a partial exclusion, not a CoinJoin detector
that makes other transactions safe to cluster conclusively.

[Boltzmann](https://github.com/Samourai-Wallet/boltzmann) and
[Am I Exposed](https://github.com/Copexit/am-i-exposed) are research references. No code
from either was copied or shipped. Rendering a 150-input transaction does not make
exact enumeration of its interpretations tractable. The first version does not
claim Boltzmann results, a universal privacy score, or perfect collaborative-spend
detection. Future implementations need explicit computational limits, cancellable
worker execution, result provenance, validation vectors, and a compatible license.

[BIP329](https://github.com/bitcoin/bips/blob/master/bip-0329.mediawiki) supplies label
interchange. A richer encrypted native format carries wallets, graph settings,
annotations and findings; plaintext JSONL is explicitly a separate export.

## Validation sources

Bitcoin key/script primitives use scure/noble and bitcoinjs; workspace encryption
uses browser Web Crypto. See `wallet-security.md` for specifications and vectors.
`../validation.md` records what actually ran, including mocked browser checks,
live testnet4 checks, and their practical limits.
