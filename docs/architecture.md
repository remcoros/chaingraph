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

## Module boundaries

| Location                                                 | Responsibility                                                                                                    |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `src/domain/types.ts`                                    | Workspace, transaction, wallet, annotation, finding, and graph contracts                                          |
| `src/domain/workspace.ts`                                | Input schema validation and derivation of graph nodes/links from loaded transactions                              |
| `src/domain/analysis.ts`, `src/domain/analysis/`         | Local analysis registry, parameter contracts, scoped evidence and run reports                                     |
| `src/domain/graphFilters.ts`                             | Shared list/canvas filtering, bounded neighborhoods and explicit connected context                                |
| `src/domain/workspaceTemplates.ts`                                     | Supported-network catalog and lazy real-chain template snapshots                                                                   |
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

An unlocked session holds its workspace and password in browser memory. Annotation fields update the workspace immediately, with continuous typing in one field grouped into an Undo step. Presentation writes preserve the latest view across Undo. Mutations increment a revision; autosave serializes an encrypted snapshot after a short debounce and records which revision reached storage. Saves are serialized to avoid races. Graph gestures pause automatic save dispatch and index publication until interaction settles. The adapter coalesces camera snapshots after 1.2 seconds of quiet and schedules publication during idle time, retaining immutable geometry across camera-only changes. Explicit lock/export/switch checkpoints flush the current camera synchronously. Full workspace validation, serialization and encryption run in a single-job browser worker; it returns only the encrypted envelope and is terminated on completion or failure. The versioned cryptographic format is unchanged. Transport still uses structured cloning, so dispatch waits for idle interaction; it is not zero-copy. Save failures retain unlocked edits. See [performance findings](research/graph-autosave-performance.md). Locking first flushes pending graph state, freezes edits, waits for a current encrypted save, then removes the unlocked session. Failed saves leave the session open. Evidence-changing chain-data refreshes clear snapshot undo history so an old undo cannot discard newly fetched transactions. Quiet checks and activity acknowledgments carry the latest scan metadata into retained snapshots, preserving unrelated user-edit undo without reviving an old activity queue. It is not a guarantee of secure erasure from JavaScript memory.

Small encrypted envelopes hold private workspace contents inline in `localStorage`. When the estimated combined index exceeds 1,048,576 characters or localStorage raises a quota error, envelopes move to IndexedDB; the outer saved-entry public name, identifier, timestamp and immutable payload reference remain visible. Existing inline envelopes migrate together. IndexedDB payload writes complete before the public index is published. A separate IndexedDB readwrite transaction serializes the synchronous index revision check and publication across contexts; Web Locks additionally coordinate the complete save where available. All index mutations, including deletion and small inline saves, use the same available coordinator. A transaction abort after successful synchronous index publication does not roll back its referenced ciphertext. Saving requires either IndexedDB coordination or Web Locks, rather than an unsafe localStorage check/write fallback. Failure retains the previous index and unsaved session; cleanup removes only replaced or deleted references after publication. A crash or cleanup failure may leave an unreferenced encrypted blob, so no claim of crash-proof garbage collection is made. The existing 32 MiB plaintext and 100-saved-workspace bounds remain. See [storage protocol and validation](research/encrypted-browser-storage.md). The optional description remains inside the encrypted payload. Old saved entries without a public name are accepted and acquire one after unlock and save. The existing encrypted-file envelope stays compatible; its filename uses the public name. Workspaces are portable through encrypted-file export/import. Imports and unlocks must pass envelope/domain validation and derive every supplied wallet address from its account key, script type, branch and index. Sparse paths derive only supplied indexes. Saving and exporting validate the complete workspace shape before encryption; scanner-produced addresses already pass the derivation boundary. Passwords and plaintext workspaces are not sent to the backend. Plaintext BIP329 export is an explicit separate operation and can include extended public keys.

The version-1 envelope fixes AES-256-GCM, PBKDF2-SHA256 with 600,000 iterations, a fresh 16-byte salt, and a fresh 12-byte IV per encryption. Metadata participates in authenticated additional data. Import cannot request arbitrary KDF work. The plaintext workspace limit is 32 MiB; browser quotas are a separate and usually tighter constraint. See [wallet and encryption research](research/wallet-security.md).

This deployment model trusts the person operating the backend and the JavaScript it serves. There is no backend login, authorization, or tenant isolation. Default loopback binding, browser Host/Origin checks, read-only RPC validation, and request budgets reduce specific exposure; they do not make public hosting supported. An unlocked browser session remains sensitive.

## Networks and scans

Each workspace declares mainnet or testnet4. A backend process can serve either or both through independent Core/Electrum pairs. `loadEnvironment` discovers `.env.mainnet` and `.env.testnet4` in `CHAINGRAPH_NETWORK_CONFIG_DIR` (the working directory by default), parses each file into its own immutable configuration, and requires at least one valid pair. It never merges upstream credentials into `process.env`, falls back to `.env.live`, or inherits another pair’s values. An optional `BITCOIN_NETWORK` declaration must match its filename. Shared HTTP host, port, origins and rate limits come from the process environment separately.

`GET /api/networks` reports configured capabilities without probing upstream health. `GET /api/status?network=...` checks one configured pair. Every `POST /api/rpc` includes a required `network`; missing, unknown and unconfigured networks are rejected before routing. Core chain information and Electrum genesis identity are checked for the selected pair, whose clients, limits and validation state remain separate. Switching a workspace cannot reconfigure or redirect an in-flight request.

The browser captures a network when starting a lookup, wallet/address scan or raw inspection and carries it through every request and Core-to-Electrum fallback. Ancestry traversal requires an explicitly bound fetch function. App connection state is indexed by network; a disconnected pair does not disable another. Creation offers only configured networks. Encrypted-file imports and browser unlocks still validate workspace data and its declared Bitcoin network, but backend support is checked separately: an unconfigured network opens for offline inspection and editing, displays a clear backend-network error, and cannot issue live queries. Network capabilities expose no upstream endpoints or credentials.

Fetched and imported transaction metadata must use addresses valid for the workspace network. Recognized addressable output scripts must agree with their reported addresses. Legacy bare multisig and P2PK participant addresses are checked for network compatibility without treating them as encodings of the full script. Script bytes alone do not prove which Bitcoin network contains a transaction.

Account-level public keys stay in the browser. The derivation module accepts supported extended-key encodings at depth 3 and derives the non-hardened receive/change branches. It builds P2PKH, P2SH-P2WPKH, P2WPKH, or BIP86 P2TR scripts and hashes scripts for Electrum queries. Testnet4 shares testnet key/address encodings, so a key's encoding cannot establish testnet4 provenance. Descriptors, arbitrary derivation paths, and multisig are outside this slice.

Scan orchestration is client-side. It queries addresses in bounded batches, stops using configured gap/index bounds, limits concurrent requests, and reuses workspace transactions where appropriate. The existing client snapshot therefore acts as the hint for avoiding unnecessary downloads. Skipped eligible transactions are retained as a client-side continuation queue; subsequent scans prioritize that queue and missing transactions. The backend remains unaware of complete wallets and does not retain scan progress or chain results. In-flight requests and connection state are operational state, not an application index.

Transaction loading tries Bitcoin Core and then Fulcrum. Spending discovery queries output-script histories (hashing raw scripts, with address fallback) and checks candidate transaction inputs; it cannot establish completeness when an output has no usable script or address or a history/candidate limit is reached. The optional activity monitor polls wallet/address histories every 30 seconds while unlocked. The first implementation polls status over HTTP and does not use Electrum subscriptions or a browser WebSocket feed.

## Graph semantics

The fundamental flow is `transaction → output → spending transaction`. Outputs persist as entities after spending. A missing funding transaction can still have an output placeholder referenced by a loaded input. The open transaction flow automatically fetches its direct parent transactions, in batches of at most 500 with four concurrent requests and cancellation on workspace or displayed-selection changes. This is independent of the lookup Previous setting, which defaults to Off. Optional encrypted `inputContext` maps automatically fetched parents to the outputs used by the displayed flow. `buildGraph` renders those parent transactions and relevant outputs without their unrelated branches. The full observed transactions remain available for analysis and inspection; explicit parent navigation promotes the transaction to its full graph context. Context validation bounds references and requires each referenced output to exist. Optional address nodes describe destinations; they do not imply a wallet or person.

The graph is derived from workspace transactions and annotations. Only active, non-stale analysis findings contribute separate cluster presentation; they do not rewrite the observed transaction graph. When multiple findings reference one node, the current projection uses the last active finding for its display color. The inspector remains the place to review actual findings and evidence.

`GraphView` owns semantic hit lookup, selection routing, keyboard details, node-only React hover cards with compact header actions, trace/edit callbacks, pointer-to-card placement and resize observation. Optional `toolbar`, `navigation` and `legend` React slots keep shared chrome inside GraphView. The display toolbar occupies layout space above the actual viewport, so picking and tooltip coordinates exclude its height. Navigation floats inside the viewport as a separate React overlay: only its controls accept pointer events, and entering them dismisses stale hover cards. The renderer canvas retains its full viewport and coordinate origin. The workbench supplies GraphControls through the toolbar slot; renderer implementations contain no toolbar or legend content. Transaction DOM views and inspector components remain independent consumers of domain data and selection callbacks.

`graph/presentation.ts` projects the visible domain graph into a `GraphFrame`: nodes contain stable IDs, resolved shapes/colors/radii/highlights, optional display text and transient coordinate hints; links contain stable IDs and string endpoints with resolved colors, widths and arrows. Neither workspace records nor domain action callbacks enter the engine. `GraphView.nodePresentation` accepts an optional `ReadonlyMap<string, NodePresentation>` with `color`, `highlight` and `scale` overrides. Callers interpret tags, wallet matches or findings. Selection color takes precedence, and the existing glow toggle gates halos. The renderer-neutral text projection independently includes labels, tags and icons according to saved display toggles; it does not mutate annotations. Missing overrides retain kind/cluster/value/degree defaults. The contract does not imply ownership from presentation.

`graph/adapter.ts` defines `update`, `resize`, `focus`, `fit`, `dispose`, optional `flushSnapshot`, and a canvas reference for shared accessibility focus. Factories receive hover/select events containing only `{ type: 'node' | 'link', id }` and container-local CSS pointer coordinates plus pointer type. Background events omit the hit. Lightweight activity events pause autosave during gestures and their quiet period. Error events expose the shared fallback, and an optional recovery event clears it after WebGL restoration. Adapters own picking, camera controls, gesture recognition, simulation/layout and all GPU resources. They suppress touch hover and prevent drag, cancellation or multiple-pointer gestures from becoming selections. `graph/defaultAdapter.ts` selects the default factory, while `GraphView.adapterFactory` permits an injected adapter; another renderer uses exactly the same React interaction surface.

Resize metadata optionally supplies the measured top inset occupied by floating
navigation without changing canvas or picking coordinates. The force adapter
frames mesh bounds together with current caption dimensions and offsets, shifting
the view into the remaining space. A view controlled by the latest Fit or focus
can adapt to panel resizing; manual camera input and snapshot restoration cancel
that automatic adjustment. Annotation updates refresh caption dimensions without
restarting the layout.

The force adapter clones incoming render data because the engine mutates positions and link endpoints. It preserves simulation identity and coordinates on presentation-only changes. Shared low-poly geometries distinguish transactions (cubes), outputs (spheres), and addresses (octahedra). A single points layer draws glow. Ordinary links use thin lines, with directional arrows on all transaction/output links and larger arrows on selected incident links. Pixel density is capped and simulation work cools after bounded ticks/time. Dispose releases the halo buffers, shared geometry/material caches, listeners and engine.

2D constrains depth and maps mouse/one-finger dragging to pan; 3D maps those gestures to orbit. Both modes retain two-finger pan/pinch and pointer-directed zoom. Empty data does not consume automatic fitting. Hidden canvases keep their last nonzero viewport and defer fit/focus until reveal, preventing a 1-pixel viewport from consuming first-data framing. New graphs receive an early fit once initial coordinates are valid and a final fit after layout settlement. Manual camera interaction cancels pending automatic fitting and completed gestures can save the current view before settlement. Restored snapshots bypass initial fitting. Reduced motion disables damping and camera transitions.

The entity list remains the alternative interaction path for keyboard access and WebGL failure. Individual node dragging remains disabled due to the verified upstream pointer-event incompatibility. Camera and node coordinates use a bounded, renderer-neutral snapshot inside the encrypted workspace. Selection, filters, pane choices and transaction-flow expansion are restored alongside display settings. The optional Lock to selection preference routes every shared selection change to the adapter’s focus API and reveals selections hidden by filters. Desktop Focus graph sits with the 3D/Flat controls and is hidden at mobile widths. Adapters may implement optional snapshot restoration and events without acquiring business logic. The custom Three.js and Studio proposals now use the shared feature foundation and remain separate local branches for comparison. Their renderer receives the same neutral display contract; the main default remains the force adapter. See the [running preview comparison](experiments/comparison.md). See [rendering research and validation](research/graph.md) and the [boundary report](experiments/graph-boundary.md).

## Analysis extension point

`analysisTools` in `src/domain/analysis.ts` is the extension point. Shared contracts and tool definitions live in `src/domain/analysis/`. A tool declares metadata, an evidence category, source reference and typed parameter descriptors. `analyze(workspace, optionalTransactionIds, options)` returns findings, scope IDs, summary, coverage statistics and a no-match explanation. `run` remains a convenience wrapper returning findings only. Pure tools make no network requests.

The seven built-in tools cover privacy patterns, value/structure and imported wallet intersections. Each finding records stable identity, algorithm version, explanation, affected nodes and supporting transactions. Exact equal-value groups control highlighting. CIOH exclusions are deliberately incomplete; missing input data is explicit, and change-like script patterns remain hypotheses. See [analysis methods and research](research/analysis-tools.md).

The browser passes the visible graph's loaded transaction IDs or the selected transaction as scope. Loaded parents may supply evidence without becoming analysis targets. Reruns replace that tool's results and preserve exclusions only for unchanged node/transaction evidence. Wallet evidence or transaction mutations mark findings stale and remove their overlays. Labels remain independent. Scan completion merges only scan-owned fields into the current wallet, preserving newer user labels. Annotation editor identity is stable across unrelated view/data changes and dirty conflicts require explicit reconciliation.

`useAnalysisUiState` retains temporary scope, parameter drafts, searches and panel
expansion per unlocked workspace outside the conditional Analysis panel mount.
Locking or closing a workspace prunes its entry; nothing is added to plaintext
storage. Run reports separately snapshot scope, options and time, and the panel
compares their transaction IDs and parameters with current controls. Selecting an
address without a transaction does not silently widen selected-transaction scope.
Persisted findings remain separate from these temporary controls and reports.

There is no runtime plugin loader, user-script execution, custom IDE, or Boltzmann computation in this implementation. Any future Boltzmann integration needs algorithm/performance work and a license-compatible implementation decision. Research references are catalogued separately from shipped code in [the discovery log](research/2026-09-08-discovery.md).

## Verification boundaries

Tests focus on protocol/security boundaries, derivation and encryption, domain behavior, and browser workflows. A passing build establishes type/bundle validity; it does not establish a healthy upstream service or a complete wallet scan.

The graph received an isolated Chromium/SwiftShader smoke check with 3,001 frozen synthetic nodes and 3,000 links, React StrictMode, live controls, node picking, and context-loss fallback. This is functional rendering evidence, not a mobile-device or frame-rate benchmark. Overall automated and live-node validation belongs in the implementation report and persistent test suite.

Browser ancestry traversal in `src/lib/tracing.ts` is breadth-first, deduplicates cached transactions, accepts only one or two levels, and shares a 500-download budget across levels. Individual unavailable branches retain successful results and report a partial result. Spending-history continuation is temporary per workspace/outpoint; sorted candidate IDs support bounded next batches, but changes to history can shift boundaries. New example workspaces use ordinary live tracing. A legacy `demo` flag is retained only to prevent previously saved synthetic IDs from reaching upstream services; no synthetic generator ships with the application.

## Renderer-independent transaction inspection

`TransactionView` projects loaded creating/spending relationships through `domain/transactionInspection.ts`. It uses shared selection, annotation and bounded tracing callbacks; an optional `renderMetadata(nodeId)` slot supports non-interactive tag or wallet badges. The panel occupies normal flow above the renderer and can collapse without changing selection. `ScriptInspector` is a separate inspector section. `lib/transactionInspection.ts` makes an explicit raw transaction request through the existing read-only RPC bridge, validates it against its ID and loaded input/output observations with bitcoinjs, and returns display data. Raw bytes and decoded witness stacks live only in the mounted inspector, with cancellation on transaction changes and unmount. No workspace schema or server cache is added. See [research and validation limits](research/transaction-inspection.md).

## Manual groups and wallet presentation

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
refit the camera. Value sizing uses an absolute bounded square-root radius, stable across filtering
and later additions: `2.4 + 17.6 * sqrt(sats / (sats + 1e12))`. Zero retains a
selectable radius of 2.4; unknown amounts use the default 3.2. The smooth upper
limit of 20 avoids an abrupt plateau for large outputs. This is visual emphasis,
not proportional sphere volume or projected area. Selected flow arrows are larger.

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

`workspaceTemplates.ts` exposes a small catalog filtered by the backend's configured networks. Home and Help share the same template cards and ordinary creation dialog. The template fixes its network; users choose a public name, encrypted description and password. `templateWorkspace.worker.ts` lazily loads the selected bundled snapshot, adds starter annotations and validates the resulting workspace off the UI thread. Closing the dialog cancels the worker, and supported networks are checked again before opening its result.

Every copy receives a fresh workspace ID and tag IDs; parsed data is independent of the cached snapshot. Templates are normal workspaces (`demo: false`) with the usual encryption, autosave, export, wallet and tracing behavior. There is no template storage mode or server-side workspace state. Initial direct parents are included, with unrelated parent outputs scoped out of the graph using existing input-context state. Snapshot dates, public references, verification and interpretation limits are recorded in [workspace template research](research/workspace-templates.md). The old synthetic generator now lives only in `tests/fixtures/laboratory.ts`.
