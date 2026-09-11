# Architecture

Chaingraph is a client-owned investigation workspace backed by a bounded, read-only bridge to Bitcoin Core RPC and Fulcrum's Electrum protocol. There is no application database, blockchain index, server-side wallet import, or backend workspace cache.

```mermaid
flowchart LR
  UI[Browser workbench] --> Domain[Workspace and analysis modules]
  Domain --> Vault[Encrypted browser storage and workspace files]
  UI --> Scan[Browser key derivation and bounded scans]
  Scan --> API[Same-origin HTTP API]
  API --> Core[Bitcoin Core RPC]
  API --> Fulcrum[Fulcrum Electrum protocol]
```

## Amount presentation

`src/domain/amountFormat.ts` is the shared monetary display boundary for Graph,
Wallet, Analysis, filter summaries and generated template text. It accepts integer
satoshis as safe numbers or bigint. Every amount uses BTC with exactly eight
decimal places grouped 2/3/3 from the right, including zero and amounts below one
BTC. Integer groups use narrow non-breaking spaces,
and a non-breaking space separates the amount from its unit. Bigint arithmetic
preserves every satoshi; missing, non-finite, fractional or unsafe numeric inputs
remain unknown. `src/components/Amount.tsx` owns dedicated amount markup, tabular digits,
non-wrapping text and the formatted sats tooltip. Its limited element choices
preserve semantic table/list/detail markup. Plain-text findings and native
select options use the same formatting helpers without React markup.

This presentation does not alter RPC values, calculations, numeric sats inputs,
exports or saved user annotations. Existing saved prose is not migrated; newly
generated findings and examples use the formatter. Fee rates remain decimal
sat/vB. There is no unit setting, fiat conversion or alternate-symbol preference.
See [the design reference](research/bitcoin-amount-display.md).

## Module boundaries

| Location                                                 | Responsibility                                                                                                    |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `src/domain/types.ts`                                    | Workspace, transaction, wallet, annotation, finding, and graph contracts                                          |
| `src/domain/workspace.ts`                                | Input schema validation and derivation of graph nodes/links from loaded transactions                              |
| `src/domain/analysis.ts`, `src/domain/analysis/`         | Local analysis registry, parameter contracts, scoped evidence and run reports                                     |
| `src/domain/graphFilters.ts`                             | Shared list/canvas filtering, bounded neighborhoods, explicit connected context and active-filter descriptions    |
| `src/domain/workspaceTemplates.ts`                       | Supported-network catalog and lazy real-chain template snapshots                                                  |
| `src/domain/walletReview.ts`                             | Wallet review queue derivation, encrypted review decisions and evidence invalidation                              |
| `src/domain/batchMetadata.ts`                            | Wallet record label, tag and icon batch edits returning one workspace per batch                                   |
| `src/domain/batchEdits.ts`                               | Pure graph label/icon/tag batch plans and appliers over explicit entity identifiers                               |
| `src/lib/useEntitySelection.ts`                          | Shared graph multiple-selection UI state: mode, explicit identifiers, pruning and workspace isolation             |
| `src/lib/wallet.ts`                                      | Account-key validation, receive/change derivation, script construction, and Electrum script hashes                |
| `src/lib/api.ts`                                         | Typed HTTP calls, transaction loading, bounded history scans, funding/spending expansion                          |
| `src/lib/crypto.ts`                                      | Versioned authenticated-encryption envelope and strict envelope decoding                                          |
| `src/lib/useWorkspaces.ts`, `src/lib/envelopeStorage.ts` | Unlocked sessions, encrypted autosave, small localStorage index with IndexedDB overflow, locking and session undo |
| `src/lib/useFlowInputs.ts`                               | Cancellable direct-input loading and bounded graph context for the displayed transaction                          |
| `src/lib/labels.ts`                                      | BIP329-compatible label subset import/export                                                                      |
| `src/components/GraphView.tsx`                           | Shared React graph interactions, semantic selection, tooltip and trace/edit actions                               |
| `src/components/graph/presentation.ts`                   | Renderer-independent shapes, colors, sizes and highlight projection                                               |
| `src/components/graph/adapter.ts`, `forceAdapter.ts`     | Small rendering contract and default force engine; clones, layout, camera, picking and GPU lifetime               |
| `server/app.ts`                                          | HTTP routes, origin/host controls, response limits, cancellation, static app serving                              |
| `server/rpc-schema.ts`                                   | Explicit read-only RPC method and parameter allowlist                                                             |
| `server/core.ts`, `server/electrum.ts`                   | Upstream protocol adapters and network checks                                                                     |
| `server/config.ts`, `server/limit.ts`                    | Validated environment configuration and bounded upstream concurrency/queues                                       |

## State and privacy

Undo and Redo share up to 15 session-only steps, each pairing a workspace
snapshot with a short action description. `src/domain/undoDescription.ts` derives
descriptions from changed fields; callers can supply an explicit action such as
Add path. Coalesced edits retain their initial snapshot and describe the combined
change. Undo and Redo move the step between their stacks. A new undoable edit clears
Redo; non-undoable chain-evidence changes clear both stacks. Presentation writes
carry current view, observation metadata and scan-result changes through both
stacks, preserving each snapshot's graph membership and visibility. Desktop and
mobile controls describe their next action; batch Undo shares the current Undo
description. Neither stack is persisted or exported.

An unlocked session holds its workspace and password in browser memory. Annotation fields update the workspace immediately, with continuous typing in one field grouped into an Undo step. Presentation writes preserve the latest view across Undo. Mutations increment a revision; autosave serializes an encrypted snapshot after a short debounce and records which revision reached storage. Saves are serialized to avoid races. Graph gestures pause automatic save dispatch and index publication until interaction settles. The adapter coalesces camera snapshots after 1.2 seconds of quiet and schedules publication during idle time, retaining immutable geometry across camera-only changes. Explicit lock/export/switch checkpoints flush the current camera synchronously. Full workspace validation, serialization, compression and encryption run in a single-job browser worker; saves return only the encrypted envelope. Unlock and file import use the same serialized worker queue for file JSON parsing, authenticated decryption, bounded decompression, schema migration and complete wallet derivation validation. Reads return validated workspace data only to browser memory. Workers terminate on completion, failure or timeout; closing a read dialog aborts queued work or terminates an active read and prevents late session opening. Error messages come from allowlisted codes, never raw platform or schema exception text. Transport still uses structured cloning, so dispatch waits for idle interaction; it is not zero-copy. Save failures retain unlocked edits. See [performance findings](research/graph-autosave-performance.md). Locking first flushes pending graph state, freezes edits, waits for a current encrypted save, then removes the unlocked session. Failed saves leave the session open. Evidence-changing chain-data refreshes clear snapshot undo history so an old undo cannot discard newly fetched transactions. Quiet checks and activity acknowledgments carry the latest scan metadata into retained snapshots, preserving unrelated user-edit undo without reviving an old activity queue. It is not a guarantee of secure erasure from JavaScript memory.

Create, unlock and encrypted-import dialogs use local encryption action groups
with explicit buttons and Enter handling, rather than native credential-form
submission. Password fields request autocomplete off. This mitigates a possible
delayed browser save-password prompt; Chromium can still infer submissions and
ignore that hint. No browser reproduction or suppression guarantee is claimed.
See [password prompt investigation](research/2026-09-10-local-password-prompts.md).

Small encrypted envelopes hold private workspace contents inline in `localStorage`. When the estimated combined index exceeds 1,048,576 characters or localStorage raises a quota error, envelopes move to IndexedDB; the outer saved-entry public name, identifier, timestamp and immutable payload reference remain visible. Existing inline envelopes migrate together. IndexedDB payload writes complete before the public index is published. A separate IndexedDB readwrite transaction serializes the synchronous index revision check and publication across contexts; Web Locks additionally coordinate the complete save where available. All index mutations, including deletion and small inline saves, use the same available coordinator. A transaction abort after successful synchronous index publication does not roll back its referenced ciphertext. Saving requires either IndexedDB coordination or Web Locks, rather than an unsafe localStorage check/write fallback. Failure retains the previous index and unsaved session; cleanup removes only replaced or deleted references after publication. A crash or cleanup failure may leave an unreferenced encrypted blob, so no claim of crash-proof garbage collection is made. The existing 32 MiB plaintext and 100-saved-workspace bounds remain. See [storage protocol and validation](research/encrypted-browser-storage.md). The optional description remains inside the encrypted payload. Old saved entries without a public name are accepted and acquire one after unlock and save. Legacy encrypted-file envelopes remain readable; new files use envelope v2 and their filename uses the public name. Workspaces are portable through encrypted-file export/import. Imports and unlocks must pass envelope/domain validation and derive every supplied wallet address from its account key, script type, branch and index. Sparse paths derive only supplied indexes. Saving and exporting validate the complete workspace shape before encryption; scanner-produced addresses already pass the derivation boundary. Passwords and plaintext workspaces are not sent to the backend. Plaintext BIP329 export is an explicit separate operation and can include extended public keys.

### Envelope format and workspace schema

These are independent contracts. The outer envelope `version` describes encryption and compression. The decrypted workspace `version` describes the domain schema. Neither is the app release version, public index key suffix, or IndexedDB database version.

| Contract | Reads | Writes |
| --- | --- | --- |
| Encrypted envelope | v1 raw UTF-8 JSON; v2 authenticated `compression: "none"` or `"gzip"` | v2 only |
| Decrypted workspace schema | versionless and v1 migrate to v2; explicit v2 | version 2 |
| Browser storage | existing public index and IndexedDB names/references | unchanged coordination and publication protocol |

Both envelope versions fix AES-256-GCM, PBKDF2-SHA256 with 600,000 iterations, a fresh 16-byte salt, and a fresh 12-byte IV per encryption. Keys are still derived per operation; compression does not change password or key lifetime. Import cannot request arbitrary KDF work. V1 additional authenticated data retains its exact original JSON key order: `format`, `version`, `cipher`, `kdf`, `iterations`, `salt`, `iv`. V2 uses that order with `compression` inserted before `salt`. The format version defines the codec contract, so a separate codec revision field would be redundant: v2 gzip means exactly one complete RFC 1952 member, and none means raw UTF-8 JSON. Unknown fields, unsupported versions/codecs/settings, and invalid encodings are rejected. Changing between supported codecs or stripping compression and changing to v1 fails authentication.

Saves validate the workspace, serialize UTF-8 JSON, and attempt native gzip before encrypting. Payloads below 1,024 bytes skip the compression attempt; larger payloads use gzip only if strictly smaller, otherwise v2 none. Both gzip APIs must be available even for tiny writes. Missing or unusable support fails the save without silently downgrading; legacy v1 and v2 none reads need no decompressor. V2 gzip reads need DecompressionStream. No library/WASM codec dependency or alternate Brotli writer is introduced. A local native-default Brotli probe produced smaller output but much greater compression cost; see [measurements and primary-source research](research/workspace-compression-benchmark.md). This is a size feature, not a general speed claim.

AES-GCM authentication completes before any decompressor is constructed. Compressed input is fed in at most 1 KiB chunks, and output chunks are counted before retention. Crossing 32 MiB cancels the stream immediately; no unbounded `Response.arrayBuffer()` collector is used. Truncated members, invalid checksums, trailing data, invalid UTF-8/JSON and excessive expansion reject before domain use. The same 32 MiB plaintext bound applies before encryption and to legacy reads; ciphertext/file bounds remain based on uncompressed capacity so old large backups stay readable. Native codec internals, structured cloning, JSON objects/strings and final bounded buffer assembly still consume memory beyond that byte count. Buffer zeroing is best effort and is not secure erasure from JavaScript memory. Browser quotas are separate limits.

`src/domain/workspaceMigrations.ts` is the single small migration boundary called by `parseWorkspace`. Versionless and v1 data migrate to schema v2; explicit null, zero, unknown or future values are not guessed. Migration creates a new root object without mutating the decoded original. After budget, Zod, network, prevout consistency and wallet-binding validation, legacy data receives explicit graph membership from its previous scoped graph. Current v2 data must include membership, including an empty list for an intentionally empty canvas. Existing supported domain fields retain their validation semantics. To add a data change, increment `CURRENT_WORKSPACE_VERSION`, update domain types/schema, and add explicit deterministic old-to-new steps here with round-trip, failure and data-preservation fixtures. New persisted fields or changed meanings must advance the schema version so an older reader rejects them instead of stripping unfamiliar data. Do not put migrations in UI components or persistence callbacks.

Unlock/import never writes a migration back by itself. The next successful write of edited data, or an export, uses envelope v2 and the current schema. An unchanged legacy workspace can remain v1 until a write is needed. Unsupported future inline formats make the saved index read-only rather than permitting overwrite; referenced-envelope and schema failures cannot open a session. Failed saves retain the previous encrypted index/blob, unlocked edits and the same transient transaction fetch scope. Compression workers receive only `Session.data`, never the session or its fetch scope. Scope disposal remains after successful lock publication, and reopening creates a fresh scope. Original imported files are never modified. Older app releases cannot read v2, so retain originals when crossing releases. See [wallet and encryption research](research/wallet-security.md).


This deployment model trusts the person operating the backend and the JavaScript it serves. There is no backend login, authorization, or tenant isolation. Default loopback binding, browser Host/Origin checks, read-only RPC validation, and request budgets reduce specific exposure; they do not make public hosting supported. An unlocked browser session remains sensitive.

## Networks and scans

Each workspace declares mainnet or testnet4. A backend process can serve either or both through independent Core/Electrum pairs. `loadEnvironment` discovers `.env.mainnet` and `.env.testnet4` in `CHAINGRAPH_NETWORK_CONFIG_DIR` (the working directory by default), parses each file into its own immutable configuration, and requires at least one valid pair. It never merges upstream credentials into `process.env`, falls back to `.env.live`, or inherits another pair’s values. An optional `BITCOIN_NETWORK` declaration must match its filename. Shared HTTP host, port, origins and rate limits come from the process environment separately.

`GET /api/networks` reports configured capabilities without probing upstream health. `GET /api/status?network=...` checks one configured pair. Every `POST /api/rpc` includes a required `network`; missing, unknown and unconfigured networks are rejected before routing. Core chain information and Electrum genesis identity are checked for the selected pair, whose clients, limits and validation state remain separate. Switching a workspace cannot reconfigure or redirect an in-flight request.

The browser captures a network when starting a lookup, wallet/address scan or raw inspection and carries it through every request and Core-to-Electrum fallback. Ancestry traversal requires an explicitly bound fetch function. App connection state is indexed by network; a disconnected pair does not disable another. Creation offers only configured networks. Encrypted-file imports and browser unlocks still validate workspace data and its declared Bitcoin network, but backend support is checked separately: an unconfigured network opens for offline inspection and editing, displays a clear backend-network error, and cannot issue live queries. Network capabilities expose no upstream endpoints or credentials.

Fetched and imported transaction metadata must use addresses valid for the workspace network. Recognized addressable output scripts must agree with their reported addresses. Legacy bare multisig and P2PK participant addresses are checked for network compatibility without treating them as encodings of the full script. Script bytes alone do not prove which Bitcoin network contains a transaction.

Account-level public keys stay in the browser. The derivation module accepts supported extended-key encodings at depth 3 and derives the non-hardened receive/change branches. It builds P2PKH, P2SH-P2WPKH, P2WPKH, or BIP86 P2TR scripts and hashes scripts for Electrum queries. Testnet4 shares testnet key/address encodings, so a key's encoding cannot establish testnet4 provenance. Descriptors, arbitrary derivation paths, and multisig are outside this slice.

Scan orchestration is client-side. It queries addresses in bounded batches, stops using configured gap/index bounds, limits concurrent requests, and reuses workspace transactions where appropriate. The existing client snapshot therefore acts as the hint for avoiding unnecessary downloads. Skipped eligible transactions are retained as a client-side continuation queue; subsequent scans prioritize that queue and missing transactions. The backend remains unaware of complete wallets and does not retain scan progress or chain results. In-flight requests and connection state are operational state, not an application index.

Transaction loading requests Bitcoin Core `getrawtransaction` verbosity 2, then falls back to Fulcrum when Core cannot find or serve the transaction. A sanitized `core_prevout_unavailable` response permits one narrower Core verbosity-1 retry when Core reports an internal block/undo read failure; unrelated Core errors do not trigger that extra request. Coinbase, mempool, and pruned observations can validly arrive without `prevout`. Default spending discovery queries output-script histories (hashing raw scripts, with address fallback) and checks candidate transaction inputs; it cannot establish completeness when an output has no usable script or address or a history/candidate limit is reached. The optional activity monitor polls wallet/address histories every 30 seconds while unlocked. The first implementation polls status over HTTP and does not use Electrum subscriptions or a browser WebSocket feed.

### Optional exact-output spender lookup

`CHAINGRAPH_USE_TXOSPENDERINDEX` defaults to false in each isolated network file.
`/api/networks` optionally advertises `spenderIndexNetworks`, describing configured
application use rather than index readiness. The browser captures this capability
at network discovery; configuration changes require backend restart and browser
reload. The server gates `gettxspendingprevout` before upstream access and allows
only `[outpoints, {mempool_only:false, return_spending_tx:false}]`. Batches are
strictly bounded to 500 outpoints, deduplicated and validated against complete,
correlated reply rows. Opted-in servers use a 64 KiB body limit; default servers
retain 16 KiB. No `getindexinfo` polling or raw-spender decoder is added.

Each pair retains only a 30-second operational failure cooldown, never spender
results. Unsupported methods/options, absent or syncing indexes, invalid replies
and upstream failures produce sanitized unavailable responses. A later explicit
action retries after expiry; caller cancellation does not disable the capability.
The direct RPC's explicit coverage requirement avoids silent mempool-only empties.
An all-mempool answer does not independently certify index readiness.

The browser's shared `fetchIndexedSpenders` validates exact outpoint correspondence,
deduplicates spending IDs, reuses loaded transaction bytes, and validates candidate
IDs, network-compatible addresses/scripts and requested input links. Confirmed
block hints flow through `fetchTransaction`, allowing retrieval without `txindex`;
`in_active_chain=false` becomes an outside-active-chain observation. Local confirmed
bytes require a fresh header observation, never cached active-chain status.
No lookup result or negative-spender cache persists between actions. Existing
competing exact spends remain saved observations rather than being erased.

`loadSpending` first uses this helper when opted in, then uses bounded Electrum history for incomplete lookups. Fallback always uses
the complete selected script set, and continuation pages skip the index so a
capability recovery cannot shift the candidate list addressed by an offset. At most 250 distinct direct
spender candidates reserve fallback capacity within its 500-candidate action
budget and four-way concurrency. Larger than 500-output selections retain history
search. Complete empty direct rows skip history, but cannot establish UTXO status;
failed history/candidate reads and unresolved known spenders remain partial.
History pagination retains explicit continuation and can change with upstream
history between actions. The browser continuation also carries known unavailable spender IDs until
validated by a later page; finishing history cannot silently clear that failure.
A failed fallback history or transaction read withholds continuation so retries
cannot skip failed bytes or advance an offset into an incomplete history union.
It is not a pinned chain snapshot.

Graph hover expansion, Inspector and TransactionView share the existing App
expansion/merge path. TransactionView cached navigation stays local. Retained
`searchTraceSpenders` also uses the helper while preserving its 12-candidate budget
and separate UTXO observation fallback; Trace UI remains disabled. Wallet loaded
spender indexes and relationships consume the merged exact inputs, with no new
wallet scan. Address discovery and activity remain Electrum based. Forward spender
discovery is independent from backward prevout enrichment. See [verified Core 31
research and limitations](research/core-31-spender-index.md).

## Graph semantics

The active instanced renderer gives node picking a 25% shape-preserving margin.
Exact visible-mesh intersections win before the padded fallback, which is shared
by hover and click/tap selection. Unrendered picking meshes share instance matrices
with the visible batches and refresh their bounds after layout or sizing changes.
They add no draw calls; misses perform a second raycast pass. Rendering geometry,
layout, camera state and workspace snapshots remain independent of this margin.

The fundamental flow is `transaction → output → spending transaction`. Outputs persist as entities after spending. A loaded input may retain optional validated `prevout` value and script evidence from Core without fabricating or loading the complete creating transaction. The shared `indexPreviousOutputs` and `resolvePreviousOutput` contract reports `loaded`, `attached`, `missing`, or `conflict` for each canonical outpoint. Conflicts remain unknown to consumers and imported workspaces containing them are rejected. Attached evidence supplies graph placeholders, flow values, wallet script matches, filters, and analysis, but creates no transaction node or `creates` edge and does not prove that an output is currently unspent.

Selecting one input still loads only its creating transaction when missing. Explicit backward navigation and Previous expansion load full parents, while the bulk flow action fetches only parents whose output details remain missing or conflicting. Requests are deduplicated within a cancellation scope, capped at 500 transactions with four concurrent requests, and cancelled on workspace or displayed-selection changes. Optional encrypted `inputContext` maps automatically fetched parents to the outputs used by the displayed flow. `buildGraph` renders those parent transactions and relevant outputs without their unrelated branches. The full observed transactions remain available for analysis and inspection; explicit parent navigation promotes the transaction to its full graph context. Context validation bounds references and requires each referenced output to exist. Optional address nodes describe destinations; they do not imply a wallet or person.

The graph is derived from workspace transactions and annotations. Only active, non-stale analysis findings contribute separate cluster presentation; they do not rewrite the observed transaction graph. When multiple findings reference one node, the current projection uses the last active finding for its display color. The inspector remains the place to review actual findings and evidence.

The output inspector lists outpoint, creating transaction, address, value and block
in that order. Identifiers can be copied; creating transactions open from the table,
and an address click admits and reveals just that address through the existing
graph membership action. Enabling address display also projects validated attached
prevout addresses when their creating transaction is absent, without fetching it
or adding a watched address. Loaded spending transactions remain below the trace
controls; the creator is not repeated there.

## Shared filtering, selection and batch actions

Filtering, multiple selection and batch metadata form one small layer over explicit
entity identifiers. `GraphFilters` keeps every user-visible dimension, including
entity type, label state, tag state or one tag, wallet membership or one wallet,
satoshi bounds, loaded spend and funding evidence, bookmarks, focus hops, isolation
and connected context. `GraphFilterButton` provides the floating Filters popover;
its `FilterFields` are shared with the entity list. `activeFilterChips` and `clearFilterKey` describe and remove
one dimension at a time, so the workbench renders removable chips and a filters-only
reset. Membership dimensions resolve to `includeIds` intersections and `excludeIds`
unions in the workbench, using the existing wallet-match and tag indexes; the domain
filter never derives membership itself. Manual hiding stays in `view.hiddenNodeIds`
and is unaffected by any filter reset. Wallet membership is derived-address evidence,
not an ownership claim, and an output without a loaded spend remains unknown.

`GraphConnectionsAction` offers **Show connections (+N)** beside filtered results
in the entity list and graph filter summary only when eligible loaded one-hop
neighbors exist. **Hide connections** stays available while enabled, including
pending changes or zero extra nodes. This action replaces the context checkbox in
Filters; selection exploration continues to use Isolate/Paths. It retains the
existing `preserveContext` field and removable scope chip. Expansion is nonrecursive and respects
manual hiding, address visibility and the selected path scope. A graph-scoped lazy
index reuses adjacency and spend/funding evidence; neighbor expansion scans links
once. The ordinary entity list reuses the canvas filter result when their scopes
agree. React defers graph-filter projection behind immediate control updates,
keeping each deferred request paired with its fit token and workspace identity.
Pending result sets show a filtering status and cannot replace batch selection
until current. Explicit individual selection remains available.

`useEntitySelection` holds selection mode and an ordered set of identifiers as shared
UI state. It is cleared when the active workspace changes, is pruned only for entities
that no longer exist, and never grows because results changed. Renderers stay free of
selection semantics: adapters report modifier keys on their pointer events, and
`GraphView` decides whether a click inspects or toggles. Batch highlighting is
projected through the existing neutral `NodePresentation` overrides.

`src/domain/batchEdits.ts` contains the pure batch operations. Each returns the same
workspace object when nothing changes, canonicalizes supplied identifiers, writes only
the targeted field, and respects the existing tag and membership budgets. The workbench
applies one batch through a single workspace update, so an applied batch is exactly one
Undo step and one autosave. `describeMatchScope` produces the exact wording used before
selecting a filtered scope, for example "28 matching outputs".

`GraphView` owns semantic hit lookup, selection routing, keyboard details, node-only React hover cards with compact header actions, trace/edit callbacks, pointer-to-card placement and resize observation. Optional `toolbar`, `navigation` and `legend` React slots keep shared chrome inside GraphView. The display toolbar occupies layout space above the actual viewport, so picking and tooltip coordinates exclude its height. Navigation floats inside the viewport as a separate React overlay: only its controls accept pointer events, and entering them dismisses stale hover cards. The renderer canvas retains its full viewport and coordinate origin. The workbench supplies GraphControls through the toolbar slot; renderer implementations contain no toolbar or legend content. Transaction DOM views and inspector components remain independent consumers of domain data and selection callbacks.

Hover-card titles use the explicit human label/icon projection when supplied,
falling back to the shared `short()` identifier formatter when no label exists.
Legacy callers retain their display labels, with exact raw references shortened.
Full identifiers remain in tooltips and canonical action targets. Card-local grid
tracks and wrapping keep close/actions and long metadata within the viewport;
the existing resize observer clamps placement after content or viewport changes.

`graph/presentation.ts` projects the visible domain graph into a `GraphFrame`: nodes contain stable IDs, resolved shapes/colors/radii/highlights, optional display text and transient coordinate hints; links contain stable IDs and string endpoints with resolved colors, widths and arrows. Neither workspace records nor domain action callbacks enter the engine. `GraphView.nodePresentation` accepts an optional `ReadonlyMap<string, NodePresentation>` with `color`, `highlight` and `scale` overrides. Callers interpret tags, wallet matches or findings. Selection color takes precedence, and the existing glow toggle gates halos. The renderer-neutral text projection independently includes labels, tags and icons according to saved display toggles; it does not mutate annotations. Missing overrides retain kind/cluster/value/degree defaults. The contract does not imply ownership from presentation.

`graph/adapter.ts` defines `update`, `resize`, `focus`, `fit`, `dispose`, optional `flushSnapshot`, and a canvas reference for shared accessibility focus. Factories receive hover/select events containing only `{ type: 'node' | 'link', id }` and container-local CSS pointer coordinates plus pointer type. Background events omit the hit. Lightweight activity events pause autosave during gestures and their quiet period. Optional layout events report busy state, requested node count and recoverable failure to the shared navigation status. Error events expose the shared fallback, and an optional recovery event clears it after WebGL restoration. Adapters own picking, camera controls, gesture recognition, simulation/layout and all GPU resources. They suppress touch hover and prevent drag, cancellation or multiple-pointer gestures from becoming selections. `graph/defaultAdapter.ts` selects the default factory, while `GraphView.adapterFactory` permits an injected adapter; another renderer uses exactly the same React interaction surface.

Resize metadata optionally supplies the measured top inset occupied by floating
navigation without changing canvas or picking coordinates. The force adapter
frames mesh bounds together with current caption dimensions and offsets, shifting
the view into the remaining space. A view controlled by the latest Fit or focus
can adapt to panel resizing; manual camera input and snapshot restoration cancel
that automatic adjustment. Annotation updates refresh caption dimensions without
restarting the layout.

The force adapter clones incoming render data because the engine mutates positions and link endpoints. It preserves simulation identity and coordinates on presentation-only changes. Shared low-poly geometries distinguish transactions (cubes), outputs (spheres), and addresses (octahedra). A single points layer draws glow. Ordinary links use thin lines, with directional arrows on all transaction/output links and larger arrows on selected incident links. Pixel density is capped and simulation work cools after bounded ticks/time. Dispose releases the halo buffers, shared geometry/material caches, listeners and engine.

2D constrains depth and maps mouse/one-finger dragging to pan; 3D maps those gestures to orbit. Both modes retain two-finger pan/pinch and pointer-directed zoom. Empty data does not consume automatic fitting. Hidden canvases keep their last nonzero viewport and defer fit/focus until reveal, preventing a 1-pixel viewport from consuming first-data framing. New graphs receive an early fit once initial coordinates are valid and a final fit after layout settlement. Manual camera interaction cancels pending automatic fitting and completed gestures can save the current view before settlement. Restored snapshots bypass initial fitting. Reduced motion disables damping and camera transitions.

The entity list remains the alternative interaction path for keyboard access and WebGL failure. Individual node dragging remains disabled due to the verified upstream pointer-event incompatibility. Camera and node coordinates use a bounded, renderer-neutral snapshot inside the encrypted workspace. Selection, filters, pane choices and transaction-flow expansion are restored alongside display settings. The optional Lock to selection preference routes every shared selection change to the adapter’s focus API and reveals selections hidden by filters. Desktop Focus graph sits with the 3D/Flat controls and is hidden at mobile widths. Adapters may implement optional snapshot restoration and events without acquiring business logic. The custom Three.js and Studio proposals now use the shared feature foundation and remain separate local branches for comparison. Their renderer receives the same neutral display contract; the main default is FlowRenderer, described below. See the [running preview comparison](experiments/comparison.md). See [rendering research and validation](research/graph.md) and the [boundary report](experiments/graph-boundary.md).

## Bounded graph connection scans

The right inspector's Scan form follows the current selection. Its primary action
starts a new run from that selection without clearing earlier results. Each card
provides clickable source and target rows; the latest status and checked count
stay with the scan controls above the results divider. Known nodes in expanded
paths are also selectable. Each run owns its frozen source, target snapshot and
settings. Custom targets use a transient App-owned picker with its own IDs and
draft, independent from graph selection and batch metadata selection. Graph and
shared selection actions toggle picks while the source remains fixed. Done commits
the draft, Escape discards it, and leaving Scan or changing workspace ends picking.
The floating bar follows the existing selection toolbar placement. The picker
does not add graph members or fetch evidence. `domain/connectionScanTargets.ts`
freezes only explicitly picked transaction/outpoint IDs without inspecting or
expanding transaction evidence. It deduplicates, excludes the source and rejects
more than 1,000 targets. Only the custom scope and frozen target IDs enter the
existing encrypted run record; picks and picker state reset on workspace changes.

`domain/connectionScanNeighbours.ts` indexes the existing full loaded graph before
membership, visibility and canvas filters. It admits only transaction/outpoint
nodes and observed creates/spends links, treating those links as undirected for
target selection. A breadth-first walk freezes up to 1,000 nearest nodes, excluding
the source and disconnected components. Sorted adjacency gives deterministic ties;
the queue admits at most 1,001 nodes including the source. A further candidate marks
the preview as capped without adding it. No RPC, search-direction bias or scan-limit
pruning enters target preparation. The index is transient, rebuilt with loaded
graph changes, and only the frozen IDs enter the existing run record. Neighbours
is the default scope for new settings; saved scopes retain their prior choice.

`domain/connectionScan.ts` runs in `lib/connectionScan.worker.ts`:
deterministic FIFO fronts alternate source/target work and requested directions.
Each walk preserves its direction. Shared-ancestor/descendant results join
same-direction walks at a meeting point and retain per-edge directions; no
alternating-direction flood fill, ownership claim or value allocation is used.
Automatic scopes freeze loaded node IDs and observed creates/spends links separately
from canvas membership and visibility. With source, targets and loaded evidence
fixed, showing or hiding I/O does not change findings. `connectionScanContext.ts`
indexes that baseline once inside the worker, yielding and checking the same
deadline. Newly fetched evidence never becomes baseline context.

Automatic connections must add an observed edge. A known outpoint already
identifies its creating transaction, so merely loading that creator is not a new
relationship. For an endpoint in the source's loaded component, a result also
retains a distinct existing source-to-target route. The union explains the
reconnection and closes its loop when added. The existing witness is capped at
8 entered transactions and 19 nodes independently of the found route's configured
hop limit. A connected endpoint whose baseline exceeds this witness bound is
omitted, never misclassified as a disconnected bridge. Targets in separate loaded
components can produce funding/spending or shared-ancestor/descendant bridges.
Custom picks retain directed-path query semantics without requiring a loop,
using the same loaded node snapshot rather than canvas visibility for novelty.

Both search fronts keep transient directed edges at reconvergences. Meeting
reconstruction pairs disjoint source and target legs, retaining at most two
novelty states per node. Automatic novelty uses edges; legacy standalone callers
without a baseline and custom scans retain their node-based rule. Short known
routes cannot erase a longer new route. Late branch arrivals refresh already
reached intersections and stream findings before later timeouts. Rejected targets
remain traversable; accepted novel direct routes stop at their target, while
known arrivals can continue. Reconstruction shares the deadline, hop and result
caps and performs no extra fetching. Alternatives are bounded, not exhaustive.
Only the found path, its optional bounded existing route, and their proof persist;
all baseline and exploration indexes are discarded.

All fronts share one unique-transaction budget, a deadline, total path-hop and
result bounds. Defaults are 3 hops, 200 transactions, 30 seconds and a 50-branch
boundary; hard limits are 8 hops, 1,000 transactions, 60 seconds, 200 branches,
1,000 targets and 50 results. Depth stops before further spender lookups and
records a run-level reason without producing result rows or consuming the result
allowance. Time limits also produce only a global stopping reason; earlier
actionable findings remain available. The run status distinguishes normal
completion within configured branch bounds from early stops and unavailable data.
Typed observations distinguish four connection relationships, many-input/output
branch decisions, three natural endpoints, and four evidence problems. Connections
retain their exact meeting node. The adapter emits counts, positive UTXO check
metadata and safe error categories; the traversal supplies path direction.
Legacy global-limit rows are hidden; ambiguous legacy root fan-out rows are not
guessed into input/output findings. Backend-unavailable and rate-limit responses
stop all fronts; offline coverage skips unavailable reads but continues loaded
work. None of these run states produces a node card. Each scan admits at most 10
endpoint paths and 10 issue paths within the 50-path total, recording omitted
counts without terminating the other fronts. This preserves room for primary
findings. Rechecks may recategorize already-retained paths within the overall cap.
Partial results remain bounded observations, without exhaustive or globally
shortest-path guarantees.

`lib/connectionScanFetch.ts` reuses loaded transactions and attached prevouts in
a transient per-run pool. It reuses the graph's existing spender relationships
and a bounded index of saved path evidence. Standalone callers without that index
charge and yield while preparing loaded relationships within the scan budget.
The worker requests neighbors over a small bridge; the adapter mirrors and
returns budget charges for every cached or fetched candidate. Existing scheduler
background priority, session scope, optional Core spender-index lookup and
bounded Electrum histories are reused. `fetchIndexedSpenders` has an optional
pre-inspection gate so its candidate work consumes the same scan allowance.
An empty spender reply remains unknown. A non-null validated Core UTXO observation
can establish an unspent endpoint only with creator proof, check time, best-block
identity and mempool inclusion. Cached spend observations take priority; contradictory
or multiple spending observations produce a conflict. Exact indexed spending
proof can be used without downloading an absent creator. Coinbase detection uses
actual coinbase input structure; unspendable detection requires the raw OP_RETURN
script. Script labels alone do not establish terminality. Identity, network and
edge mismatches never become accepted path edges. Safe typed error codes distinguish
systemic outages/rate limits from local unavailable transactions and failed reads;
no upstream exception text enters a result. The first verified fallback spender is
sufficient; every history candidate still shares the run's transaction budget. There are
no new backend endpoints, jobs, indexes or caches.

`lib/connectionScanRunner.ts` aborts leaf requests on cancellation/deadline and
rejects replies after session changes. User cancellation can retain a partial
result; closing a workspace discards late replies. New findings bypass progress
throttling and stream with only their path evidence. The UI retains them during
the run; dismissal is applied to subsequent snapshots and completion, while clear
cancels the run and rejects late updates. Count-only progress stays transient.
The UI stores a running marker before dispatch. Workspace schema v3 migrates v2
membership without reseeding it; worker validation restores running markers as
interrupted, never as jobs.
The existing encrypted envelope format remains unchanged.

`domain/connectionScanRecords.ts` upserts runs by ID in stable order, retaining
distinct findings from earlier scans. Exact finding paths are deduplicated across
runs by source, finding kind, endpoint, meeting point and directed path.
Reconnections use the source and union of undirected route edges, so opposite
presentations of the same loop do not consume another result or card. Run IDs,
settings and observation timestamps do not change identity. The latest copy
supplies current observation metadata; an explicit dismissal stays attached to
that identity until results are cleared. The same compaction runs for live
snapshots, saved records and validated imports, before retained-record budgets
and evidence pruning. Different paths retain their own original run context. Streaming, dismissal and rechecks update their own
run without changing the latest scan's status. Only empty non-latest runs are
pruned. The encrypted collection is bounded to 20 runs, 50 results per run,
200 extra path transactions and 2 MiB total; reaching a bound rejects the write
without evicting older findings. Restoring retains all validated records. There
is no history picker, manual save/restore or rerun archive. Run fields are
strictly validated. Path direction, observed edges, network addresses and prevout
consistency are validated at the existing encryption-worker boundary. Shared
evidence is retained only for saved result paths and reused from normal workspace
observations where present. Frontier queues, visited maps and transport state
cannot enter the record schema. UI-time edits check compact limits; full workspace
validation remains off the UI thread. `domain/connectionScanAddition.ts` plans
and adds both routes of a reconnection plus its terminal creating transaction without changing
the saved result or search hop count. A creator already in the path is not repeated.
Its union of graph nodes drives Add, and the whole addition is one Undo step.
Conflicting observations use the preceding verified prefix, labeled Add prefix.
Cards have no path-length selector.
Single-node clicks add only the requested node. Both actions validate required
proof and conflicts before admission, preserving unrelated graph membership.
`lib/connectionScanActionEvidence.ts` reuses available evidence and fetches only
missing requested transactions through the network-scoped navigation scheduler,
with at most 20 requested transactions across both routes and a 30-second action deadline. Selection changes,
Clear, leaving Scan, workspace changes and scope closure cancel pending actions;
stale replies cannot select or add nodes. Missing offline proof remains an
explicit retryable action error. No ancestry expansion accompanies these loads.
There is no automatic scan resumption. Clear all results cancels active work and
clears the retained result set. Accumulation, dismissal and clearing carry through
undo snapshots so an unrelated edit undo cannot restore an older scan. Each
snapshot retains path proof absent from its own observations within the same
record caps; undoing Add therefore keeps retained results usable when that
evidence fits. Missing proof remains explicit if a snapshot reaches those caps.

Accepting a complete path or explicit prefix merges only supporting transactions
and uses existing graph membership APIs, producing one Undo step. It reveals
those nodes, resets graph filters, and preserves annotations and camera geometry.
Sidebar controls and result cards use their own CSS namespace and a vertical layout.
Cards group alternative paths to the same finding using their type, endpoint,
direction and meeting node. Alternative paths remain flat bounded records;
there is no persisted grouping index. Connections precede branch decisions and
evidence problems; natural endpoints have a separate filter. Each card groups
an always-visible Path section in the body, with actions at the bottom right.
Each transaction step includes its input/output counts, including the terminal
creator. The stored closing route is used for Add without a separate card section.
Distinct root input/output branches get a reconnection title and clickable branch
identifiers. Other cycles use Reconnection; direct bridges use Funding/Spending
path. Old automatic direct cards lacking context or a bridge marker are hidden. Clearing the latest
results does not remove accepted nodes or annotations. Scan details
never enter the public saved-workspace index.

`lib/connectionScanRetry.ts` rechecks one endpoint with fresh evidence under the
original time and transaction bounds. It does not resume traversal. Other findings
and dismissals remain intact; success updates or removes only matching alternative
paths. Clear, cancellation, tab/workspace changes and late-session replies remain
guarded. The run's original coverage flags describe the original search, even if
a later endpoint check resolves a local problem. Only retained path proof is
carried back from the retry. `prepareScanPath` checks the selected prefix against
available evidence and blocks disputed edges, full conflict findings and explicitly
out-of-chain transactions. Missing proof remains a separate recoverable state.

Search changes are checked against named input/output reconvergence fixtures and
an independent small-graph path oracle. See [scan regression checks](connection-scan-testing.md)
for the focused command, protected contracts and coverage limits.

## Analysis extension point

`analysisTools` in `src/domain/analysis.ts` is the extension point. Shared contracts and tool definitions live in `src/domain/analysis/`. A tool declares metadata, an evidence category, source reference and typed parameter descriptors. `analyze(workspace, optionalTransactionIds, options)` returns findings, scope IDs, summary, coverage statistics and a no-match explanation. `run` remains a convenience wrapper returning findings only. Pure tools make no network requests.

The seven built-in tools cover privacy patterns, value/structure and imported wallet intersections. Each finding records stable identity, algorithm version, explanation, affected nodes and supporting transactions. Exact equal-value groups control highlighting. CIOH exclusions are deliberately incomplete; missing input data is explicit, and change-like script patterns remain hypotheses. See [analysis methods and research](research/analysis-tools.md).

`domain/analysisScan.ts` resolves the selected transaction, output, address or wallet into loaded transaction IDs, or uses the complete loaded workspace. It runs the existing registry with independent reports and cancellation between tools. Loaded parents can supply evidence without becoming targets. Exclusions survive reruns only with matching node/transaction evidence. Wallet evidence or transaction mutations mark findings stale; labels remain independent.

The workbench mode is an optional encrypted view field. Old `rightTab: analysis` restores Analysis and an Inspector right tab. Graph stays mounted while hidden, retaining its adapter, camera and layout. Workbench transitions flush the current camera. Wallet, Graph and Analysis are the enabled modes. The Trace workbench is disabled, and saved `workbench: trace` opens Graph. A saved `workbench: wallet` opens Graph when the workspace has no wallets. The return control appears whenever a workbench handoff recorded an origin, beside the mode buttons so the floating workspace actions cannot cover it. Analysis consumes the shared workspace and selection, with no alternate graph, annotation store or server state. Analysis controls and reports use an App-owned memory map, pruned when a workspace locks or closes. Locking cancels pending work. The displayed **Selection (type)** scope retains the existing `context` session value for compatibility. An absent scope value remains automatic: `context` when a wallet is selected, otherwise `workspace`. Existing session values are explicit choices and are preserved, including after Wallet scans. Context retains graph-entity precedence over the wallet, and its option label comes from the resolved scope. Missing selections disable Scan without falling back to all transactions; selections with no loaded evidence remain empty. No scope preference is added to the encrypted workspace schema. Every affected entity and supporting transaction in a finding has an individual graph navigation control; output values and addresses come from the same loaded workspace records. Handoffs promote compact loaded context before selecting it. If a requested outpoint has no loaded creator, navigation opens a loaded supporting transaction and explains the fallback, preserving unknown inputs without automatically fetching parents. If neither exists, Analysis keeps the finding open with a recovery message.

The dormant `domain/traceWorkbench.ts` and Trace component remain for a later iteration; they are not mounted or reachable through the current workbench navigation. Their original bounded lookup design and limitations remain documented in [Trace semantics and limits](research/simple-trace.md). Existing graph transaction traversal is independent of this disabled workbench.

Graph filter status exposes isolation, focus and other include filters; reset clears filters and the graph amount threshold while preserving manual hiding. **Isolate selection** reuses the existing Paths focus filter, defaults to one hop and follows shared selection changes. Paths can expand it to two hops. Turning the toggle off clears only its focus restriction, preserving other filters and manual hiding. Finding isolation and the graph batch toolbar use explicit include IDs with connected context, with separate chips for isolation and context. Removing a chip clears its own filter dimension; other filters and manual hiding remain in effect.

## Verification boundaries

Tests focus on protocol/security boundaries, derivation and encryption, domain behavior, and browser workflows. A passing build establishes type/bundle validity; it does not establish a healthy upstream service or a complete wallet scan.

The graph received an isolated Chromium/SwiftShader smoke check with 3,001 frozen synthetic nodes and 3,000 links, React StrictMode, live controls, node picking, and context-loss fallback. This is functional rendering evidence, not a mobile-device or frame-rate benchmark. Overall automated and live-node validation belongs in the implementation report and persistent test suite.

Browser ancestry traversal in `src/lib/tracing.ts` is breadth-first, deduplicates cached transactions, accepts only one or two levels, and shares a 500-download budget across levels. Individual unavailable branches retain successful results and report a partial result. Spending-history continuation is temporary per workspace/outpoint; sorted candidate IDs support bounded next batches, but changes to history can shift boundaries. New example workspaces use ordinary live tracing. A legacy `demo` flag is retained only to prevent previously saved synthetic IDs from reaching upstream services; no synthetic generator ships with the application.

## Renderer-independent transaction inspection

`TransactionView` projects loaded creating/spending relationships through `domain/transactionInspection.ts`. It uses shared selection, annotation and bounded tracing callbacks; an optional `renderMetadata(nodeId)` slot supports non-interactive tag or wallet badges. The panel occupies normal flow above the renderer and can collapse without changing selection. `ScriptInspector` is a separate inspector section. `lib/transactionInspection.ts` makes an explicit raw transaction request through the existing read-only RPC bridge, validates it against its ID and loaded input/output observations with bitcoinjs, and returns display data. Raw bytes and decoded witness stacks live only in the mounted inspector, with cancellation on transaction changes and unmount. No workspace schema or server cache is added. See [research and validation limits](research/transaction-inspection.md).

## Manual groups and wallet presentation

Graph wallet filters store a bounded `walletIds` selection, with `walletId` retained
as a legacy fallback. Matching nodes are the union across the chosen wallets,
intersected with existing tag/isolation membership before the normal value, search,
type, visibility and context projection. An empty wallet selection adds no restriction.
The toolbar dropdown and full filter panel share checkbox controls and the same state.
Wallet-match and tag-state dimensions also survive encrypted workspace validation.
The graph Isolate toggle adds/removes its path restriction while preserving other
filters and the canvas amount threshold.

Optional version-1 workspace tags hold bounded named/color groups of canonical
transaction, output and address references. References may precede loaded graph
data. Address membership projects onto loaded outputs at that address; it does
not propagate to whole transactions. Tags are independent of annotations so
changing membership cannot overwrite label/note edits. Import validates
network addresses, unique identities and names, 200 tags and 50,000 total members.
Tags remain inside authenticated encrypted workspace data.

`src/domain/tags.ts` builds indexes for tag membership and verified wallet-script
matches. Raw output scripts take precedence over decoded address text for wallet
matches. Transactions are associated through matching outputs or loaded input
prevouts, never from a common-input heuristic or a history entry alone. The App
resolves optional node color/highlight presentation outside the renderer. Manual
tag colors take precedence over wallet colors; selection stays visible. These
projections do not mutate findings, labels or observed chain data.

The Inspector reuses the App's wallet-match projection in a Wallet section below
Annotations. Wallet names open the existing wallet inspector through local selection,
without putting workspace identifiers into URLs. Optional help explains script
matching and transaction association. The
annotation form contains label, notes, tags and compact icon/bookmark controls.
Tag assignment retains the shared popup and explicit output/address scope;
wallet association is not an editable tag. Metadata edits keep their existing
immediate-save and undo grouping behavior.

## Returning-wallet activity

Successful browser scans record checked bounds, scan time, pending downloads and
a bounded unreviewed-transaction queue. A quiet refresh preserves equal address
evidence and transaction objects so analysis results remain usable. Changed
history/transaction evidence invalidates findings. Acknowledging activity only
updates review metadata. Disabling the optional monitor aborts its own pending
requests; manual work remains independent. The graph never removes old annotated
transactions merely because refreshed histories omit them. See
[refresh behavior and verification](research/wallet-refresh.md).

### Manual visibility and removal

`domain/visibility.ts` stores canonical hidden node IDs in the encrypted view. Canvas
filtering excludes them before connected-context expansion, while the entity browser
can list visible, hidden or all records. Hidden selection remains inspectable; camera
locking does not implicitly reveal it. Explicit show-and-center does. View writes
preserve each undo snapshot's visibility so camera autosaves do not erase visibility undo.

`domain/graphBranch.ts` computes transaction removal closure over the whole requested
batch. Adjacent outpoints join the action only when no other participating connection
survives, including admitted address associations. Graph removal checks full membership;
hiding checks membership minus manually hidden nodes. Temporary filters, amount thresholds,
address display and input-context scopes do not change the connection evidence used for
cleanup. Only neighbors of requested participating transactions qualify; existing unrelated
orphans remain. `domain/graphMembership.ts` applies this to hide/remove actions without
changing observations, annotations or saved geometry. Revealing remains explicit; Show all
hidden restores the whole hidden group. Workspace transaction deletion applies the same
membership cleanup before pruning vanished entities.

`domain/entityRemoval.ts` plans transaction and watched-address removals, counting affected
annotations and tag memberships before confirmation. Removal keeps complete remaining
transaction records and clears affected user metadata. Stopping an address watch retains
shared transaction facts. Individual inputs/outputs are never deleted or renumbered.

### Transaction confirmation observations

Optional encrypted `blockHeight` and `mempool` fields describe observations, not a live
confirmation feed. Direct transaction loads use matching Core block headers; address and
wallet histories supply explicit Electrum heights where appropriate. A bounded 512-entry
browser map reuses immutable blockhash-to-height coordinates per network, never active-chain
status. History changes clear unrelated stale block metadata. Missing or unavailable metadata
retains the transaction with an unknown or height-unavailable status. See
[provenance and limits](research/transaction-status.md).

### Input context lifetime and value filtering

Optional encrypted `contextTransactionIds` records ancestry lifetime independently
from `inputContext`, which only controls graph projection. Rendering promotion
retains provenance; direct lookup and address/wallet discovery clear it.
Automatically loaded and explicitly prefetched ancestors are eligible for removal
only when they belong to the removed branch and no retained observation, human
metadata or wallet evidence needs them. Remaining transaction records are never
partially edited. Legacy scoped context supplies provenance when expanded; already
expanded legacy data without that evidence stays independent. Hydration discards
late parent results after its displayed transaction was removed.

`domain/smallAmounts.ts` filters known output values before normal graph context
expansion. It preserves unknown values, selected outputs and outputs associated
with the selected address. It never modifies cached observations, manual hidden
IDs or analysis inputs. The entity list remains available for recovery. The flow
uses its own encrypted `view.flowAmountThreshold`; the canvas retains
`view.smallAmountThreshold`. Missing preferences mean All amounts, including the
flow preference in older workspaces. The flow control unmounts while collapsed,
reports omitted rows while open, and keeps selected rows visible even beyond
the collapsed window.

New successful lookups issue an explicit adapter focus request, independently of
selection locking. Requests wait for finite node coordinates and run once; manual
navigation or Fit cancels pending focus. Input loading and failed tracing do not
refit the camera. Value sizing uses the fixed logarithmic radius
`1.6 + 0.9 * log10(1 + sats / 10000)`, stable across filtering and additions.
Zero retains a selectable radius of 1.6; unknown amounts use the default 3.2.
20,000 sats has radius 2.03 and 150,000,000 sats radius 5.36; the full Bitcoin
supply remains below radius 12. There is no high-value plateau. This is logarithmic
visual emphasis, not proportional sphere volume or projected area. Selected flow arrows are larger.

Amount presets use strict greater-than semantics. `filterSmallAmounts` compares
reachability from independent transaction roots and the selection before/after
filtering. This removes automatic branches detached by filtered outputs, including
branches with their own retained outputs. Previously disconnected investigations
stay independent. A final canvas pass drops isolated transaction/address nodes
while amount filters are active, including legacy records without provenance.
These passes never mutate cached data, annotations or manual visibility. All flow
links have low-poly arrows; selected incident links have larger arrows and thicker
accent lines. Address associations remain arrowless.

## Recording-driven interaction refinements

New workspace names select their initial suggestion on focus. Pointer-down keeps
that replacement selection intact until the user edits the field; subsequent
editing retains ordinary caret behavior. This applies to empty and example
workspace creation.

`view.entityVisibility = 'graph'` makes the Entities list consume exactly the
canvas projection, including retained context. Other visibility modes continue
to use loaded observations for recovery. This optional encrypted preference does
not change the graph, data ownership or stored transaction provenance.

The Inspector's current UTXO check uses a validated `gettxout` response through the
existing network-specific RPC proxy. `useUtxoStatus` binds an abortable request to
workspace, network, outpoint and expected output facts. Results are timestamped,
include mempool scope, and are cleared on selection changes. Neither a result nor
a failed check mutates workspace data or graph state. Null is described as absence
from the queried UTXO set, not proof of a spending transaction. See the
[Core reference and validation scope](research/current-utxo-status.md).

`graph/cameraFraming.ts` projects actual mesh bounds into the current camera's
viewing axes. Focus includes the selected node and immediate neighbors; Fit uses
all displayed nodes and centers their bounds rather than world origin. Field of
view, aspect ratio, shape dimensions and padding determine distance. Explicit
framing preserves viewing direction. It retains existing pending-focus, gesture
cancellation, snapshot flush and autosave scheduling behavior.

### Example workspace creation

`workspaceTemplates.ts` exposes a small catalog filtered by the backend's configured networks. Home and Help share the same template cards and ordinary creation dialog. The gallery groups six mainnet cases above three testnet4 cases, with a separator only when both networks are supported. Container-based columns preserve the three-column desktop layout in both surfaces and reduce columns on narrow screens. The template fixes its network; users choose a public name, encrypted description and password. `templateWorkspace.worker.ts` lazily loads the selected bundled snapshot, adds starter annotations and validates the resulting workspace off the UI thread. Closing the dialog cancels the worker, and supported networks are checked again before opening its result.

Every copy receives a fresh workspace ID and tag IDs; parsed data is independent of the cached snapshot. Templates are normal workspaces (`demo: false`) with the usual encryption, autosave, export, wallet and tracing behavior. There is no template storage mode or server-side workspace state. Initial direct parents are included, with unrelated parent outputs scoped out of the graph using existing input-context state. Snapshot dates, public references, verification and interpretation limits are recorded in [workspace template research](research/workspace-templates.md). The old synthetic generator now lives only in `tests/fixtures/laboratory.ts`.

### Extending the guided tour

`src/features/tour/steps.ts` defines named steps with a stable ID, navigation label,
copy, icon, target selector and optional fallback selector. Order is a property of
the array, never a numeric condition elsewhere. `availableTourSteps` applies each
step's optional `when(context)` predicate before both navigation and presentation.
Context exposes current selection/data availability and a feature capability list;
the current adapter advertises no experimental capabilities.

`GuidedTour.tsx` renders the supplied steps without knowledge of wallets, analysis
engines or individual tab names. Its spotlight is a measured overlay, rather than
changing the target's stacking order. Resize and scroll observers maintain target
bounds and are removed when the step changes or the tour closes. Missing targets
can use a visible fallback area and prerequisite copy. The topic navigator,
progress and Back/Next controls derive from the available steps.

To add trace/canvas or another feature:

1. Add a stable `data-tour` anchor to the real control or panel.
2. Add a step with a unique ID, useful workflow copy and a prerequisite/fallback
   for an empty selection. Use `when` if the whole feature is optional.
3. Extend the App presentation adapter if the feature needs a new view. Existing
   `view` hints project displayed tabs, mobile panels, focus mode and flow expansion
   without writing those previews into saved presentation state. Keep feature
   preparation out of the renderer and never launch scans from a tour step.
4. Test direct jumps, missing data, skip/Escape, layout restoration and narrow
   viewports. Do not assume the preceding step ran: users can jump to any topic.

The tour starts once per browser, remains skippable and restarts from Help. The
existing `chaingraph.tour.seen` preference stays compatible. Graph data, annotations
and selection are not changed by stepping through the tour.

### Wallet record navigation

The encrypted selected-wallet context remains set while entity selection changes.
Optional `view.rightTab` values `addresses`, `transactions` and `utxos` expose the wallet's
read-only record panels. The Inspector prioritizes an actual entity selection;
selecting the wallet row returns to wallet settings. Historical records union
known address histories and verified loaded script matches, without requiring all
transactions to be present. Selecting an unloaded row fetches one transaction and
uses the shared selection/focus path. Failed or cancelled loads retain the graph.

Wallet UTXO observations are App-owned transient state, keyed by workspace, network,
wallet and discovery revision. Completed checks survive workbench navigation but
clear on wallet/workspace changes and locking. Wallet, Graph records, Inspector
and transaction flow share the same controller. Positive observations retain their
check timestamp and require an exact loaded amount/script match; absence from a
check never establishes spending. They are not persisted in the workspace.
Electrum queries use already discovered scripts in bounded batches; leaving an active check,
wallet changes and discovery updates cancel pending work. Coverage and failure
counts stay explicit. Loaded outpoints must match observed amount and script before
being displayed or selected. They are never inferred from missing loaded spends.
See [protocol and record validation](research/wallet-records.md).

Flow input hydration now loads only the creating transaction of a selected
outpoint. Selecting a transaction performs no automatic parent fan-out. The
flow panel's explicit bulk action loads up to 500 missing parents with four
concurrent requests; progress, partial errors and continuation remain visible.

Wallet address records reuse verified script claims and count matching outputs in one
pass over loaded transactions, without RPC. Selecting an address enables address
display and adds it to the watched-address set, allowing an isolated node even when
no matching transaction is loaded. The graph memo includes that set so subsequent
address selections appear immediately.

### Wallet review and batch metadata

`domain/walletSelectionIndex.ts` projects loaded transaction contexts by script,
address outputs, spending relationships and conflict-aware prevouts once per
immutable transaction snapshot and network. `WalletReview` owns this memory above
the keyed detail panel, alongside verified wallet addresses keyed by address array
and network. Row selection and metadata edits reuse the indexes; new observations
rebuild them. The context, related-record and visible-input planners accept these
indexes while retaining their uncached paths for other callers. Empty visible-input
plans skip prevout indexing entirely. No index is persisted or shared globally;
locking or closing the workspace releases it with the component. Script authority,
network validation and loaded/attached/conflicting evidence semantics are preserved.
See [selection performance validation](reviews/2026-09-09-wallet-selection-performance.md).

`domain/walletReview.ts` derives a review queue for one wallet from loaded
observations and an optional verified UTXO check. Reasons are ordered: current
UTXOs, used wallet addresses, receipts spent into them, source addresses, refresh activity,
counterparties, and active non-stale findings covering verified wallet outputs.
Counterparty items come only from transactions the wallet funded through loaded
prevouts, so the outputs of a batch that merely paid the wallet are never
presented as the owner's counterparties. Item counts are bounded per reason and
coverage reports unloaded UTXO sources instead of filling them in. A missing
spend never implies an unspent output.

Optional encrypted `walletReviews` maps `walletId|reason|subject` to a status of
`reviewed`, `unknown` or `later`, a timestamp and a fingerprint of the item's
evidence. Old workspaces without the field load unchanged, and the record is
bounded at 20,000 decisions. A refresh keeps decisions; only a changed evidence
fingerprint marks an item as needing review again, with its earlier decision date.
Completing a refresh-activity item also removes that transaction from the wallet's
existing unreviewed queue in the same workspace transform. Deferral does not
acknowledge it. The UI separates deferred items into Review later; changed evidence
returns an item to To review. Annotation changes do not remove candidates or change
their evidence fingerprint. Removing a wallet
prunes its decisions.

Used wallet addresses have address-only review keys based on their verified
derivation slot, so new receipts do not undo an already recorded address purpose.
Unused gap-discovery addresses are not queued. Source/destination address reviews
remain independent of older output decisions. New output-only counterparty tasks
are no longer generated; existing saved output decisions remain compatible and
are exposed separately as history.

`domain/batchMetadata.ts` plans and applies label, tag and icon edits over an
explicit list of canonical entity references. Each helper returns one workspace,
so a batch is a single undoable autosaved step, and returns the same workspace
when nothing changes. Labels and icons are preserved unless replacement is
requested, and plans expose the affected and preserved counts before applying.
Tag membership reuses the existing tag budgets, canonical references and name
uniqueness. Filtering in the workbench never widens a selection; it only offers a
new explicit scope, and selected records outside the current filter are reported
beside the batch controls. `useRecordSelection` handles explicit toggles and ranges
limited to the displayed ordering. Single-item editors opt into replacement and
start with the current annotation; batch editors keep existing metadata by default.
`MetadataEditors` supplies the shared quick label, tag and note controls for
Wallet and Graph. `MetadataPopover` also positions `IconPicker`, tracking content,
scroll and visual viewport changes outside panel clipping boundaries. Its
nonmodal focus lifecycle closes on focus leaving the editor, without pulling
focus away from the next control; Escape and Done return focus to the invoker.
Selection changes discard unfinished drafts and close icon palettes.

The Inspector's tag adapter retains explicit output/address scope and inherited
membership hints. All tag popups search names/descriptions and support explicit
color selection, direct Add/Remove membership and create-and-assign in one update.
Global tag management retains descriptions/member management and shares the color
palette. The Inspector's always-visible label/note inputs still autosave per edit;
graph hover, flow and retained Trace actions lead to that editor. Analysis owns
no separate quick editor.

`batchMetadata` keeps preservation defaults and its forgiving canonical-record
adapter, delegating mutations to the bounded primitives in `batchEdits`. The
Graph toolbar validates its full explicit selection strictly before calling the
shared updates, retaining network validation and the supplied-reference cap.
Its Undo remains tied to the specific undo-head token.

`walletReviewContext` projects the creating transaction into full input/output
arrays with selected-output markers. Membership uses verified discovered wallet
scripts, never labels or transaction-history membership. Script hex is authoritative
for displayed/related-selection addresses; address-only observations are validated
against the workspace network. Missing prevouts remain unknown. Source items carry
explicit descendant output IDs, and the projection verifies direct spending links
and wallet matches before showing them. These edges do not allocate individual
inputs to outputs or independently establish unspent status.

`WalletReviewFlow` bounds visible rows without altering counts, keeps a selected
output visible, and exposes explicit graph magnifiers rather than clickable cards.
Compact metadata, navigation and decision actions precede a collapsible full-width
flow. Magnifiers use the existing
Wallet handoff with an explicit frame request independent of selection lock.
Exact related
selection runs only over supplied filtered candidates, including undisplayed pages.
All-results and related selection replace the explicit selection. The wallet name
dialog is workspace/wallet scoped, updates only `name`, and masks its read-only key
again each time it opens.

`walletRelationships` projects direct funding inputs of transactions paying
verified wallet scripts and outputs of transactions spending verified wallet
outputs. Canonical subjects retain all direct transaction contexts, including
missing-prevout placeholders. Raw script evidence is authoritative. Histories
alone never prove direction, ownership or an input-to-output value allocation.
This is a client-owned loaded one-hop projection, not a scan or backend index.
The Wallet-facing projection groups those observations by canonical address.
Address groups retain their constituent outpoints and per-transaction contexts;
missing/non-address scripts remain exceptions in the observation model, not
counterparty address rows. `walletCounterparties` excludes the selected wallet's
matched addresses. Metadata targets the address.
Address-level review keys are direction- and wallet-scoped, so an old output
decision cannot silently complete a broader address group.

`walletWorkbenchRows` supplies the shared row contract for all six Wallet tabs.
The selected row and explicit batch keys are independent. Single clicks open
details; modifier/checkbox selection replaces only the detail footprint, never
the list width. Filters retain hidden batch targets and report them next to the
actions. Address context choices use verified loaded input/output matches,
not an arbitrary history transaction. The default context is newest by observed
mempool status, block height and timestamp, with a stable identifier fallback
when ordering evidence is absent. Manual choices persist for the selected item.
No related loaded transaction produces an explicit info state, separately noting
known unloaded wallet history.

Wallet Scan reuses the local analysis scope, registry and findings merge used by
Analysis. It is distinct from chain-history refresh. Visible flow prevouts use
bounded, cancellable client requests and focused input-context merges. Cache-only
navigation performs no evidence update; new transactions use the existing
workspace evidence invalidation path. No previous levels beyond the displayed
flow are traversed.

`useWalletCounterparties` resolves a bounded batch of known source inputs on
activation, with explicit continuation rather than an automatic ancestor cascade.
Its fetch/update adapters remain separate from transport and the forthcoming
shared prevout resolver. Queued history, address scan limits, failed lookups and
non-address scripts have separate UI states rather than one permanent partial flag.

The Wallet component pauses hidden updates after deactivation. Derived models
depend on evidence/annotation references, not camera snapshots; only the active
record tab is built. Row tag lookup reuses `buildTagIndex`. Tooltip focus targets
remain keyboard reachable without introducing another modal focus trap.

`walletReviewCategories` describes supported observation and existing heuristic
categories with stable IDs, definitions and counts, including zero. The UI uses
union (OR), with no selections matching no items. Counts are computed before the
category filter but after status/search/metadata filters; categories can overlap.
Missing labels and effective tags are independent conditions. Scan availability
and bounded/partial observations qualify counts rather than implying a fresh,
complete zero. Legacy encrypted `unknown` decisions remain completed even though
the UI no longer offers them as a new action.

`useWalletUtxos` holds the transient Electrum observations shared by the wallet
record panel and the wallet workbench. They are discarded when discovered
addresses or the scan time change and never enter storage.

### Default flow renderer

Workspace schema v2 stores explicit `view.graphNodeIds`, independently of complete
transaction observations and manual hiding. Graph derives full loaded evidence
without `inputContext` restrictions, then projects membership before canvas filters.
The address display toggle filters admitted address nodes; it does not expand
address associations automatically. Addresses enter the graph through explicit selection
or lookup, like other entities.
Selection admits only the clicked node; explicit tracing admits requested transactions
and connecting outpoints. New examples seed a curated canvas with their root transactions,
selection, annotations and connecting outpoints. Small root transactions show all I/O;
dense roots show up to 20 inputs and 20 outputs, prioritizing annotated outpoints,
bridges, script variety and pairs from tagged groups. Annotated context-parent siblings
include their creator so they remain connected. This is creation-time membership only;
omitted observations remain loaded, and later selection does not expand transaction I/O.
Disposal before initial framing does not publish an untouched default-camera snapshot,
so development remounts retain automatic initial Fit. Explicit checkpoints still capture
the current view, including while layout is pending.
The icons-only right toolbar exposes exact input/output group and batch actions;
branch removal keeps outpoints connected to another admitted transaction. Removing
from the graph preserves evidence, annotations and cached geometry. Membership undo
survives camera/selection autosaves. Migration and canonical network validation run
at the existing worker boundary; no backend state is added.

The side toolbar's Hide/Remove I/O actions retain nodes with a further connection.
`graphUnconnectedOutputIds` counts distinct participating neighbors, including
address associations; zero or one neighbor qualifies. Hiding uses membership minus
manual hiding, while removal uses full membership. Temporary filters never turn a
bridge into a terminal. The global Show all I/O action restores direct loaded I/O
of manually visible admitted transactions, clears canvas filters and amount limits,
and does not fetch or recursively admit neighboring transactions. Global I/O actions
paint their busy state before updating membership and remain undoable.

Selection history changes selection without resetting filters or moving the camera,
including when Lock is enabled. Center targets a mesh width of approximately
24 CSS pixels while preserving the viewing direction. Lock translates the camera
and orbit target together, retaining the current zoom distance. Isolation clears pending
node focus and fits the entire resulting graph after layout settles. Clearing a
focus request cancels deferred focus so an earlier action cannot move the camera
after selection-only navigation. Successful graph opening and tracing are silent;
partial and unavailable results retain recovery feedback.

The contextual input/output experiment indexes loaded `creates`/`spends` relationships
in `graph/flowContext.ts`. Transaction selection establishes the context; outpoint
selection retains a related transaction from the saved flow-panel choice, falling
back to its loaded creator or first loaded spender. Address selection is neutral.
Roles are projected before canvas filtering and remain transient presentation.
Screen-space bracket/ring markers and edge colors distinguish roles without changing
mesh shapes, radii, node identity or layout signatures. Annotation/finding colors
retain node-fill precedence, and the selection accent remains independent.
An optional stable `RenderLink.directed` hint carries observed source-to-target
relationships into `graph/groupedFlowLayout.ts`. It separates terminal outpoints
from shared bridge outpoints using visible directed relationships. Terminal inputs
and outputs occupy bounded local groups attached to their transaction. Fresh sides
with up to eight terminal outpoints use a count-aware balanced footprint: a centered
singleton, a symmetric pair, or an evenly spaced ring with balanced depth in 3D.
Pairwise glyph radii determine clearance, independently for each side. Onward
connections reserve a central corridor between the side's upper and lower groups.
The complete proposal must clear existing geometry before any member is placed.
Larger sides, obstructed proposals and partially positioned sides retain the existing
collision-aware packing. That packing uses actual node radii and spaced X/Y
footprints, then lifts new nodes onto a rounded front/back shell with depth
proportional to the occupied group radius. Flat mode keeps the two-dimensional
footprint. Cached positions remain exact; Repack applies the new spacing to an
existing layout. Address associations do not change
an outpoint's directed role. Shared outpoints remain single canonical nodes.

The transaction skeleton determines branch placement before terminal groups are
filled. Fresh components use topological X ordering so reconvergent paths remain
forward. Multiple shared outpoints use a rounded shell oriented along their
transaction connection in 3D; Flat mode retains a planar peer grid. Fresh fans of
three or more sibling transactions use a curved 3D arrangement so outpoints shared
with distinct neighbors also retain depth after Repack.
Bridge edges keep stronger strokes and arrowheads even beside dense local fans.
Incremental placement keeps all cached coordinates exact, searches near anchored
outpoints for new transactions, and avoids occupied group envelopes.
Consequently, a previously terminal outpoint can stay inside a group when it becomes
a bridge. Explicit Repack rebuilds the visible skeleton and groups together.
Incremental expansion uses the connected transaction-to-outpoint vector as a
preferred outward direction, with a small contribution from the established branch
axis. New terminal groups use a local coordinate frame so their inputs face upstream
and outputs downstream even when the branch leaves the global X axis. Cached
geometry provides the frame on subsequent additions; no orientation is persisted.
The renderer passes a transient `LayoutRequest.expansionOrigin` when a selected
outpoint leads to a new adjacent transaction. This disambiguates multiple attached
outpoints, including actions that retain outpoint selection. The hint is excluded
from the topology signature and cannot trigger a layout on selection changes.
Fresh layouts and explicit Repack retain the common-axis transaction skeleton.
No space is reserved for undisplayed siblings. Role outlines are restrained and
omitted when too small to read, while node colors, selection and hover remain.
Fit and focus reserve the right toolbar and top navigation without changing nodes.
No ownership or individual input-to-output value allocation is inferred.

Right-toolbar creator/spender expansion suppresses automatic selection focus for that
action, even with Lock enabled. Normal selection, explicit Center and toggling Lock
restore camera following. Toolbar inset changes update future framing allowances without
reframing the current camera. Graph edits retire the previous completed framing request,
so later content-driven resizing cannot fit an expanded graph implicitly. Pending explicit
Fit/focus requests survive; unchanged graphs retain viewport-resize fitting behavior.
Incremental transaction placement identifies the clicked outpoint's visible group by
transaction, input/output side and member IDs. It measures the group's sphere using
cached positions and each member's glyph radius, exits that sphere along the local
branch ray, then leaves at least one group radius of clearance (minimum 40 world units,
plus the new transaction's glyph clearance). Previously traced outpoints inside the
terminal sphere remain members; separate remote bridge groups do not inflate it.
Other groups provide collision clearance only. Saved positions and fresh/Repack spacing
remain unchanged. This uses displayed geometry, without reserving space for undisplayed
siblings or assuming how many I/O a future transaction will add.

The Motion control is transient GraphView state, rendered as an icon before Show
labels in the panel bar, and calls the optional adapter `setMotion` capability.
It defaults on for each mount. `RenderNode.flowActive` carries active/batch flow
emphasis separately from focus and annotation glow. Only directed creation/spending
links are eligible; address associations never animate as transaction flow.

`graph/flowSelection.ts` indexes visible transaction-to-outpoint creation links and
outpoint-to-transaction spending links using stable `RenderLink.flowSide` hints.
Selection, node hover and edge hover share one traversal. For active transactions,
separate upstream and downstream walks retain every complete visible transaction
bridge across the loaded trace. A visited set per direction prevents repeated work;
segment IDs deduplicate shared paths. A walk never reverses direction at a reached
transaction to enter an unrelated sibling branch. Outpoint/edge interaction starts
with that outpoint's visible creating/spending segments, then follows its creators
upstream and spenders downstream. Missing or hidden endpoints stop traversal.
No observations are fetched or graph members added by animation.

All reached bridges animate, including when there are more than 50 in a direction.
Fifty is a per-direction branch target for the active context: reached bridges reserve
slots first, and terminal branches at active nodes fill the remainder. Direct hover
is included first. Terminal choices cycle across angular/elevation sectors of their
visible sphere, with stable per-link random ranks inside sectors and fair sharing
between active nodes. Camera movement does not change the sample. Terminal siblings
of a merely traversed transaction are not added to the animation scope.

`graph/flowParticles.ts` renders every chosen visible segment. Dot density adapts
from four to one per segment, aiming for about 400 particles while retaining at least
one per segment even above that target. Instance buffers grow/shrink with the chosen
scope; no fixed edge-count slice can silently truncate complete paths. Animation
advances shader time without changing layout, camera, geometry snapshots or activity
signals. Motion off disables dots and camera damping; the static layout worker still
places explicitly added nodes. Hidden/lost/disposed renderers stop animation. Hover
picking reuses cached projected connections after node-first hits. This adds no
workspace fields, backend state or dependencies.

`graph/defaultAdapter.ts` selects `FlowRenderer`, adopted from the flow renderer v2
experiment. Recognized transaction/outpoint topology uses the grouped layout.
Remaining associations use a stopped d3-force-3d simulation anchored to the grouped
positions. Fixed links act as tethers and spatial grids resolve nearby collisions.
Existing coordinates never receive simulation ticks. One worker job runs at a time. A newer topology terminates
obsolete work immediately; stale or duplicate replies cannot replace the latest
request. Views whose nodes already have cached positions restore synchronously
without simulation, including turning off a large neighbor expansion.

Automatic quiet-period snapshots wait for layout completion. Explicit flush saves
the current camera and last displayed geometry without running an unfinished
layout on the UI thread. Worker construction, dispatch or execution failure keeps
the displayed scene, reports a recoverable layout error and permits Repack/Retry;
there is no synchronous simulation fallback. Instanced node/edge buffers reuse
geometric capacity between expansions and release resources when resized or
disposed. Presentation-only updates skip unchanged edge projection and GPU matrix
uploads. Hover picking considers nodes without projecting every edge; explicit
edge selection remains available on click. GraphView indexes loaded spenders once
per transaction collection instead of scanning all inputs for every hover update.
See the [responsiveness measurements and checks](reviews/2026-09-10-graph-responsiveness.md).

GraphView owns floating Fit/zoom/Repack controls and the separate status footer.
Optional adapter `zoom(factor)` and `repack()` methods expose only renderer actions;
other adapters can omit them. The `navigationStatus` React slot keeps filter and
visibility context after every control group in DOM and visual order. Shared
selection, hover actions, annotations and visibility logic remain unchanged.
Selected-address focus waits for final geometry even if selection precedes its
graph frame; subsequent manual camera input cancels that deferred focus.
Version-1 snapshots restore exact geometry and cameras. Compact has separate
in-memory 3D/Flat views; explicit Repack clears layout caches and fits visible
nodes. No layout-strategy schema or picker remains. See the
[decision and limitations](experiments/flow-renderer-v2.md).

### Frontend transaction scheduler experiment

`lib/transactionScheduler.ts` coordinates existing transaction fetches. Twelve physical
jobs can run globally, eight per network. Non-navigation work uses at most three
slots per network, leaving capacity for explicit navigation. Only direct transaction
opening uses navigation priority; bulk ancestry and spending searches use background
priority.
Queued navigation precedes visible input evidence, which precedes refresh and
bounded source-input work. Equal-priority admissions alternate eligible networks;
there is no preemption. The queue holds at most 128 jobs, with its last 16 places
reserved for navigation; excess callers get a retryable error. Each job accepts at
most 64 consumers. Transaction batches use four caller workers; history discovery
retains four. Per-network backend concurrency defaults to 16 for both Core and
Fulcrum, with 256 pending requests per transport; explicit configuration overrides
still apply.

`fetchTransaction` accepts optional `TransactionFetchHints` after `historyHeight`,
then an optional containing-block hash. Identity includes the unlocked session
token, network, normalized transaction ID, exact history height, block hint and
observation token. Wallet/address scans and explicit spender actions create a new
observation token on every invocation by default. A spender action carries the
same token, session scope and background priority through indexed transaction
loading and history fallback. Refresh cannot join an earlier navigation
or refresh observation. There is no resolved transaction cache or TTL. Callers
reuse loaded facts before requesting; each fetched consumer receives a deep copy.

Consumer abort detaches only that caller. The final departure removes queued work
or aborts the physical request, whose slot remains occupied until transport settles.
A queued shared job inherits its highest remaining consumer priority. Fallback and
optional header requests execute inside that slot, avoiding nested-queue deadlocks.
Header requests coalesce within a session or refresh with independent cancellation;
the existing bounded immutable block-coordinate cache remains unchanged.

Each `WorkspaceSessionStore` session owns a transient fetch scope. Successful lock
closes it synchronously before removing the session, rejecting its consumers and
clearing scoped jobs. Its lifecycle AbortSignal also cancels spender-index RPCs,
history discovery and fresh header checks for reused spender bytes, which do not
acquire transaction scheduler slots. These bounded leaf requests combine caller
and session cancellation, and reject mismatched or closed scopes before network
access. A reopened workspace gets a different token. React callbacks
capture their token; existing cancellation and selection/source guards govern all
workspace mutations. The scheduler itself never adds graph branches or annotations.
Unscoped library callers use a standalone scope; every currently mounted workspace
transaction-fetch path supplies its session scope. Retained, unmounted Trace code
can use the API default and must receive a session scope if restored to the UI.

The scheduler keeps only in-flight jobs and consumer ownership, with no activity
history, UI subscription or notification timer. Existing statusbar progress and
its Cancel action remain attached to the current operation. Explicit previous-depth
navigation retains its traversal budget and does not add speculative prefetch.

Parsing and per-consumer cloning remain synchronous and no end-to-end
latency or rendering improvement is claimed. Reservation can reduce background-only
throughput, and sustained higher-priority traffic can defer background work.
