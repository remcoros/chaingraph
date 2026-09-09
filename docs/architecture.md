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

Transaction loading requests Bitcoin Core `getrawtransaction` verbosity 2, then falls back to Fulcrum when Core cannot find or serve the transaction. A sanitized `core_prevout_unavailable` response permits one narrower Core verbosity-1 retry when Core reports an internal block/undo read failure; unrelated Core errors do not trigger that extra request. Coinbase, mempool, and pruned observations can validly arrive without `prevout`. Spending discovery queries output-script histories (hashing raw scripts, with address fallback) and checks candidate transaction inputs; it cannot establish completeness when an output has no usable script or address or a history/candidate limit is reached. The optional activity monitor polls wallet/address histories every 30 seconds while unlocked. The first implementation polls status over HTTP and does not use Electrum subscriptions or a browser WebSocket feed.

## Graph semantics

The fundamental flow is `transaction → output → spending transaction`. Outputs persist as entities after spending. A loaded input may retain optional validated `prevout` value and script evidence from Core without fabricating or loading the complete creating transaction. The shared `indexPreviousOutputs` and `resolvePreviousOutput` contract reports `loaded`, `attached`, `missing`, or `conflict` for each canonical outpoint. Conflicts remain unknown to consumers and imported workspaces containing them are rejected. Attached evidence supplies graph placeholders, flow values, wallet script matches, filters, and analysis, but creates no transaction node or `creates` edge and does not prove that an output is currently unspent.

Selecting one input still loads only its creating transaction when missing. Explicit backward navigation and Previous expansion load full parents, while the bulk flow action fetches only parents whose output details remain missing or conflicting. Requests are deduplicated within a cancellation scope, capped at 500 transactions with four concurrent requests, and cancelled on workspace or displayed-selection changes. Optional encrypted `inputContext` maps automatically fetched parents to the outputs used by the displayed flow. `buildGraph` renders those parent transactions and relevant outputs without their unrelated branches. The full observed transactions remain available for analysis and inspection; explicit parent navigation promotes the transaction to its full graph context. Context validation bounds references and requires each referenced output to exist. Optional address nodes describe destinations; they do not imply a wallet or person.

The graph is derived from workspace transactions and annotations. Only active, non-stale analysis findings contribute separate cluster presentation; they do not rewrite the observed transaction graph. When multiple findings reference one node, the current projection uses the last active finding for its display color. The inspector remains the place to review actual findings and evidence.

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

`domain/analysisScan.ts` resolves the selected transaction, output, address or wallet into loaded transaction IDs, or uses the complete loaded workspace. It runs the existing registry with independent reports and cancellation between tools. Loaded parents can supply evidence without becoming targets. Exclusions survive reruns only with matching node/transaction evidence. Wallet evidence or transaction mutations mark findings stale; labels remain independent.

The workbench mode is an optional encrypted view field. Old `rightTab: analysis` restores Analysis and an Inspector right tab. Graph stays mounted while hidden, retaining its adapter, camera and layout. Workbench transitions flush the current camera. Wallet, Graph and Analysis are the enabled modes. The Trace workbench is disabled, and saved `workbench: trace` opens Graph. A saved `workbench: wallet` opens Graph when the workspace has no wallets. The return control appears whenever a workbench handoff recorded an origin, beside the mode buttons so the floating workspace actions cannot cover it. Analysis consumes the shared workspace and selection, with no alternate graph, annotation store or server state. Analysis controls and reports use an App-owned memory map, pruned when a workspace locks or closes. Locking cancels pending work. The displayed **Current selection** scope retains the existing `context` session value for compatibility. Every affected entity and supporting transaction in a finding has an individual graph navigation control; output values and addresses come from the same loaded workspace records.

The dormant `domain/traceWorkbench.ts` and Trace component remain for a later iteration; they are not mounted or reachable through the current workbench navigation. Their original bounded lookup design and limitations remain documented in [Trace semantics and limits](research/simple-trace.md). Existing graph transaction traversal is independent of this disabled workbench.

Graph filter status exposes isolation, focus and other include filters; reset clears filters and the graph amount threshold while preserving manual hiding. **Isolate selection** reuses the existing Paths focus filter, defaults to one hop and follows shared selection changes. Paths can expand it to two hops. Turning the toggle off clears graph filters, leaving manual hiding intact. Finding isolation and the graph batch toolbar use explicit include IDs with connected context, with separate chips for isolation and context. Removing a chip clears its own filter dimension; other filters and manual hiding remain in effect.

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

Wallet UTXO observations are component-local, keyed by workspace and wallet.
Electrum queries use already discovered scripts in bounded batches; tab changes,
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
not an arbitrary history transaction.

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

### Isolated flow renderer v2 experiment

On this experiment branch, `graph/defaultAdapter.ts` selects `FlowRenderer`.
Fresh layouts use a stopped d3-force-3d simulation. Incremental layouts simulate
only new nodes: fixed links act as tethers, and a static spatial grid resolves
nearby fixed-node collisions. Existing coordinates never receive simulation ticks.
One worker job runs at a time, with at most one latest replacement request.
Automatic quiet-period snapshots wait for layout completion; explicit flush still
resolves pending geometry. Instanced node/edge buffers reuse geometric capacity
between expansions and release resources when resized or disposed.

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
