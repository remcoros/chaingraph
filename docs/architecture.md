# Architecture

Chaingraph is a browser-owned investigation workspace in front of a bounded,
read-only bridge to Bitcoin Core RPC and the Electrum protocol. The server has no
database, chain index, wallet import or workspace cache. Everything a user
creates lives in the browser, encrypted at rest.

```mermaid
flowchart LR
  UI[App: React workbenches] --> Runtime[Core: workspace concepts and operations]
  Runtime --> ChainData[Core ChainData: models, observation rules and queries]
  ChainData --> Bitcoin[Core Bitcoin: native primitives]
  Vault[Persistence: encrypted storage and files] --> Runtime
  Runtime --> Scan[Browser key derivation and bounded scans]
  Scan --> ChainData
  ChainData --> API[Same-origin HTTP API]
  API --> Core[Bitcoin Core RPC]
  API --> Fulcrum[Electrum server]
```

Three principles run through every module:

- **Observations, annotations and hypotheses stay distinct.** Chain data is
  recorded as observed; user labels never alter it; analysis findings are
  overlays with evidence that can be excluded or go stale.
- **Missing is not zero.** An output without a loaded spend is unknown, not
  unspent. A bounded scan that stopped is partial, not empty. Every fetch and
  scan has explicit limits and reports when it reached them.
- **The renderer knows nothing about Bitcoin.** Graph engines receive a neutral
  frame of shapes, colors and links; selection, metadata and workspace logic live
  above them.

## Module map

App owns React UI, presentation behavior and application wiring. Core Workspace
owns framework-independent capabilities grouped by concept. Each concept owns its
canonical types, current schemas and pure validity rules. The Workspace root
composes the aggregate document; `Persistence` owns historical formats, codecs
and physical storage. Canonical validation does not load execution capabilities
or Persistence. Persistence consumes the canonical types and validity rules,
never App or Session implementation. Domain has been removed. Core Bitcoin owns
native mechanisms, Core ChainData owns shared application chain data, and
Workspace owns entity references and account-wallet constraints. Bitcoin
has no application dependencies; ChainData consumes Bitcoin, not Workspace.
Shared display formatting now lives in Core Formatting; UI-specific display
choices, such as entity-removal titles, belong in App. ChainData owns typed Bitcoin RPC
queries, response decoding and fetch scheduling alongside the models they serve.
It remains workspace-independent: Session creates/closes request scopes and owns
accepted workspace publication. Live query files are independently imported and
are not re-exported through the model/validation index, keeping document parsing
independent of transport initialization. No hypothetical adapter layer is introduced.

ConnectionScan is a Core workspace capability. Its retained data and validity
rules live beside its transient search execution, in independently importable files.
Graph owns target selection, presentation and
adding paths to the graph. One canonical plain WorkspaceDocument remains both
live data and the current decrypted file shape; this separation does not create
duplicate storage models. Pure presentation helpers still belong to App.

See [source-map.md](source-map.md) for the directory tree, task entry points and
test locations. Source is grouped by product ownership.

| Location                                                       | Responsibility                                                                      |
| -------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `src/App/App.tsx`, `src/App/useAppState.ts`                    | App shell, session navigation, home and dialogs                                     |
| `src/App/Workspace/Workspace.tsx`, `useWorkspace.tsx`          | Shared state, selection, presentation and workbench switching/focus                 |
| `src/Core/Workspace/Analysis/`, `Annotations/`, `Wallets/`     | Analysis, metadata and wallet operations                                            |
| `src/Core/Workspace/ConnectionScan/`                           | Bounded connection scanning                                                         |
| `src/Core/Formatting/`                                         | Shared exact BTC/satoshi formatting and reference abbreviation                      |
| `src/Core/Workspace/workspace.ts`, `chainData.ts`, `view.ts`   | Aggregate document, workspace chain collection and saved view                       |
| `src/Core/Workspace/transactionContext.ts`                     | Context retention, promotion and compact saved input scope                          |
| `src/App/Workspace/Annotations/`, `GraphState/`, `Selection/`  | Editing hooks, Graph projection/actions and transient selection                     |
| `src/App/Workspace/Workbenches/Graph/`, `Wallet/`, `Analysis/` | Each workbench composes its own views and binds shared Workspace state              |
| `src/App/FrontPage/`, `Examples/`, `Help/`                     | Workspace entry, example creation and help                                          |
| `src/App/Workspace/Dialogs/`, `Wallets/Dialogs/`               | Workspace lifecycle and wallet dialogs                                              |
| `src/Core/Workspace/Session/`                                  | Unlocked sessions, undo/redo and save lifecycle                                     |
| `src/App/Workspace/`                                           | React workspace subscriptions, autosave timer and fetch-scope context               |
| `src/Core/Workspace/Persistence/`                              | Public facade, full-cycle document parser and public result/error contracts         |
| `src/Core/Workspace/Persistence/Migrations/`                   | Historical document conversion and legacy membership                                |
| `src/Core/Workspace/Persistence/Codec/`                        | Validation/restoration workflow, envelope, compression and worker execution         |
| `src/Core/Workspace/Persistence/Browser/`                      | Browser index, IndexedDB envelopes and cross-tab publication                        |
| `src/App/Workspace/Workbenches/Wallet/`                        | Wallet overview, records, review UI, scan hooks and preparation cache               |
| `src/App/Workspace/Workbenches/Graph/`                         | Graph surface, side panels, filters, transaction flow and metadata projection       |
| `src/App/Workspace/Workbenches/Graph/Renderer/`                | Renderer-neutral contract, Three.js renderer, layout worker and picking             |
| `src/App/Workspace/Workbenches/Graph/ConnectionScan/`          | Scan panel, target projection, grouping and Graph path-add actions                  |
| `src/App/Workspace/Workbenches/Analysis/`                      | Analysis controls and reports                                                       |
| `src/App/Controls/`                                            | Reused App-owned controls, evidence display and metadata editors                    |
| `src/Core/Bitcoin/`                                            | Native network encodings, public-key derivation, scripts and outpoints              |
| `src/Core/Browser/`                                            | Generic browser mechanisms not owned by workspace persistence                       |
| `src/Core/ChainData/`                                          | Chain models, validity, observation merging, typed RPC queries and fetch scheduling |
| `server/app.ts`, `rpc-schema.ts`                               | HTTP routes, Host/Origin checks, limits, cancellation and read-only RPC allowlist   |
| `server/core.ts`, `electrum.ts`, `config.ts`, `limit.ts`       | Upstream adapters, chain identity, network configuration and concurrency            |

## Browser-owned state

The canonical decrypted `Workspace` model lives with its validation in `workspace.ts`;
its creation factory is independent of storage. `WorkspaceStore` consumes the
public `WorkspacePersistence` contract. `App/appServices.ts` creates one facade
and supplies it to the runtime and file-import UI. Its contract and implementation
share `workspacePersistence.ts`; there are no files distinguished only by case.

The facade exposes list/load/save/remove and encrypted file read/export. A
standalone `parseWorkspace` is the shared full-cycle parser for decrypted saved
documents, including examples that may use historical formats. It migrates,
validates through the canonical workspace rules and applies reopening transitions. Save/export reuse
the same document decoding and validation without interrupting live scans.
File operations and parser use do not initialize browser storage; a denied or
malformed browser index does not prevent opening or exporting portable files.
The session still owns unlocked data, password lifetime, undo and save scheduling.

An explicit public interface need not be a single root index. Bitcoin, ChainData
and workspace concepts allow named-file imports. Persistence and Formatting keep
root-only interfaces; lint prevents outside callers from importing their private
files through type imports, re-exports or literal dynamic imports. Internal imports
remain direct. No Browser/Codec public
indexes or duplicate Persistence/Schema exist. Canonical schema composition
stays with workspace concepts; private envelope/index validation stays beside its actual
codec/storage owner. Tests requiring internal persistence fault injection live
in its module-owned Integration suite; production code cannot depend on that suite.

### Sessions, undo and autosave

An unlocked session holds the workspace and its password in memory only.
Mutations increment a revision; autosave debounces, serializes an encrypted
snapshot in a worker and records which revision reached storage. Saves are
serialized. Graph gestures pause save dispatch, and the renderer coalesces
camera snapshots after 1.2 seconds of quiet. Lock, export and workspace switch
flush the current camera synchronously first. Locking waits for a current save
before dropping the session; a failed save leaves the session open with its
edits.

`Session/chainDataAcquisition.ts` binds acquisition to the original unlocked
session and network. Its `read` operations retrieve transactions, address
observations and spending relations without changing workspace membership.
Its `observe` operations publish accepted data and own refresh, progressive
address-history loading, completed wallet scans and watched-address checks.
Wallet derivation/discovery rules remain in Wallets; Graph keeps navigation,
selection and source eligibility. React supplies progress and interaction guards.
App composes one capability per active session and adapts it through context
for transaction-detail consumers. Captured workspace operations also check the
session token, so callbacks cannot borrow a later reopening of the same ID.
App supplies transient network admission separately from session validity:
cached transaction reads and saved spending links work without live admission.
Graph ancestry can reveal only saved parents while offline, without trying
missing transactions. Inspector navigation checks saved parents and exact spend
links across all saved transactions, independently of canvas membership; live
refresh and UTXO checks still require network admission.
The demo build omits discovery and polling and the live
ChainData HTTP entries reject requests before transport. This policy is not
persisted on captured documents. See [static demo](static-demo.md).

Request order comes from the existing fetch scope, not persisted sequence
numbers. A late older result cannot overwrite a newer accepted observation;
a failed newer request does not suppress an earlier successful response.
Progressive history retains completed checkpoints on cancellation, while bounded
wallet and navigation actions keep their existing completed-result boundaries.

Undo and Redo hold up to 15 session-only steps, each a workspace snapshot with
a description derived by `undoDescription.ts`. Continuous typing in one field
coalesces. Accepted transaction and wallet-observation refreshes carry through
both stacks so undo does not discard downloaded data or erase pending redo.
Wallet scan metadata, including the last completed refresh timestamp, carries
through both stacks independently of reversible human edits.
Explicit user removals remain undoable. Presentation writes (camera, view, scan
results) carry through history. A batch edit is one step.

### Encrypted envelope and storage

`src/Core/Workspace/Persistence/Codec/encryptedEnvelope.ts` fixes AES-256-GCM with PBKDF2-SHA256 at 600,000 iterations,
a fresh 16-byte salt and 12-byte IV per encryption. Imports cannot request
different KDF work. The envelope's own `version` describes encryption and
compression and is independent of the workspace schema version:

| Envelope | Contents                                                                      | Written             |
| -------- | ----------------------------------------------------------------------------- | ------------------- |
| v1       | Raw UTF-8 JSON                                                                | No (still readable) |
| v2       | `compression: "none"` or `"gzip"` (one RFC 1952 member), authenticated in AAD | Yes                 |

Payloads of at least 1 KiB attempt native gzip and keep it only when strictly
smaller. Both `CompressionStream` and `DecompressionStream` must exist for any
save; missing support fails the save rather than downgrading. On read, GCM
authentication completes before a decompressor is constructed; output is counted
in bounded chunks and aborts past the 32 MiB plaintext limit. Buffer zeroing is
best effort, not secure erasure. See
[encryption-and-storage.md](encryption-and-storage.md).

Validation, serialization, compression and encryption run in a single-job
worker (`workspaceCodec.worker.ts`); unlock and import use the same queue
for parsing, decryption, decompression, migration and full wallet-derivation
checks. Errors surface as allowlisted codes, never raw exception text.

Storage keeps a small public index in localStorage: name, identifier, timestamp
and either an inline envelope or a reference to an IndexedDB payload. Envelopes
move to IndexedDB when the estimated index exceeds 1 MiB or a quota error is
raised. Payload writes complete before the index is published; an IndexedDB
readwrite transaction (plus Web Locks where available) serializes index
revision checks across tabs. Saving requires one of those coordinators. The
bounds are 32 MiB plaintext and 100 saved workspaces. Workspace names are the
only user-chosen public metadata; descriptions, wallets, chain data, annotations
and results are inside the envelope.

### Workspace schema and migrations

`CURRENT_WORKSPACE_VERSION` is 8. `WorkspaceDocument` is both the plain encrypted
document and the in-memory document. Chain data, wallet definitions/reviews,
annotations/tags and analysis findings have explicit nested groups; there is no
second flattened runtime model. `workspaceMigrations.ts` transforms supported
flat versionless/v1-v4 and nested v5-v7 payloads before validation. Version 6 groups
transaction placement under `status` and compact input scope under `view.inputContext`.
Version 7 replaces the transient new-transaction review queue with an activity
summary. Version 8 adds Counterparties and precise goal/assessment decisions,
retaining historical acknowledgments and validated assessment support. Only
versionless/v1 documents may have graph membership seeded after validation;
v2-v8 require explicit membership. Migration never invents observation timestamps or sources, mutates
the input, or guesses at null, zero or unknown versions. Unlock never writes a
migration back by itself; the next edited save or export uses the current
schema and envelope v2. Backward-compatible optional observations can be
added within the existing schema contract; a breaking persisted-data change
still requires a version bump, updated types and schema, and deterministic
old-to-new steps with round-trip, failure and preservation fixtures. Migrations
do not belong in components or persistence callbacks.

Every parse validates budgets, Zod shape, network-consistent addresses, prevout
consistency and wallet binding: each supplied address must derive from its
account key, script type, branch and index. Workspaces are bounded to 10,000
transactions and 50,000 transaction/input/output records, 200 tags with 50,000
members, 20,000 wallet review decisions, 1,000 counterparties and 50,000
counterparty association references.

## Backend: networks and the read-only bridge

`loadEnvironment` discovers `.env.mainnet` and `.env.testnet4` in
`CHAINGRAPH_NETWORK_CONFIG_DIR` (default: working directory), parses each file
into an immutable per-network configuration and requires at least one. Upstream
credentials never enter `process.env`; `.env` and `.env.live` are not read. An
optional `BITCOIN_NETWORK` in a file must match its name. Shared HTTP settings
(host, port, origins, timeouts, rate limit) come from the process environment.

`GET /api/networks` lists configured networks and capabilities without probing.
`GET /api/status?network=` checks one pair. `POST /api/rpc` requires a `network`
and rejects unknown or unconfigured ones before routing. `server/rpc-schema.ts`
is an explicit allowlist of read-only methods and parameter shapes; Core chain
identity and Electrum genesis are checked per pair. Responses are bounded by
`MAX_RESPONSE_BYTES`, requests by a 16 KiB body limit, and each transport by
configured concurrency and queue depth. Host and Origin are validated against
loopback or `CORS_ALLOW_ORIGINS`. None of this is authentication: the deployment
model is one trusted user. See [deployment.md](deployment.md).

### Browser build and asset caching

Vite groups React and its runtime, Zod, Bitcoin/crypto dependencies and Three.js
into separate vendor chunks so application edits can reuse unchanged dependencies
from the browser cache. Three.js remains behind GraphView's dynamic import.
Other dependencies retain automatic chunking; workers have separate build graphs.
This improves cache reuse across updates without reducing the total startup code.

The existing static-file server gives content-hashed files under `assets/` a
one-year immutable cache lifetime. HTML and unversioned files use `no-cache` so
they revalidate, including the application document served for client routes.
API responses use `no-store`. Asset recognition follows Vite's default
eight-character filename hash and uses the served file rather than the request
path, preventing an HTML fallback from inheriting immutable caching.

### Optional exact-output spender lookup

`CHAINGRAPH_USE_TXOSPENDERINDEX=true` in a network file lets the server pass
`gettxspendingprevout` (Core 31+) for up to 500 deduplicated outpoints, with
`mempool_only:false, return_spending_tx:false`, and raises that network's body
limit to 64 KiB. Discovery advertises the opt-in, not index health. Failures
pause further attempts for 30 seconds and the browser falls back to bounded
Electrum history. Nothing is cached server-side. `fetchIndexedSpenders`
validates exact outpoint correspondence and candidate transactions before they
join the graph; a missing spender is never evidence of an unspent output. See
[spender-index.md](spender-index.md).

## Chain data in the browser

### Transactions, previous outputs and ancestry

Transactions are fetched with Core `getrawtransaction` verbosity 2 where
available, so inputs carry validated `prevout` value and script without their
parent transaction. `indexPreviousOutputs` / `resolvePreviousOutput` report
`loaded`, `attached`, `missing` or `conflict` per outpoint; conflicts stay unknown
and imported workspaces containing them are rejected. Attached evidence feeds
flow values, wallet matches, filters and analysis but creates no transaction
node.

Selecting an input loads only its creating transaction. **Previous** levels and
**Load previous** use `src/App/Workspace/Workbenches/Graph/Navigation/ancestry.ts`: breadth-first, one or two levels, a
shared 500-download budget, partial results on unavailable branches. The bulk
**Load missing input details** action fetches only parents whose prevout is
missing or conflicting, four at a time, up to 500. Automatically loaded parents
are recorded in encrypted `inputContext` (which outputs the flow uses) and
`contextTransactionIds` (ancestry provenance), so `buildGraph` can show them
without unrelated branches and removal can drop context nothing else needs.

Spending discovery (`loadSpending`) records structured exact-lookup provenance:
complete exact coverage, no configured opt-in, or an exact lookup that could not
be used. Complete rows, including an empty row, never query Electrum. Otherwise
it uses bounded Electrum script histories, checking at most 500 candidates per
action with an explicit continuation. A typed address-history-limit result keeps
already verified spenders and lets Graph show persistent configuration guidance
only when there was no opt-in, or bounded causal feedback when a configured
lookup could not be used. For an exact output with no loaded spender it then asks
`gettxout` including mempool and reports unspent-at-check, absent or unknown.

Address history is a browser-owned observation. Direct address lookups retain a
bounded Electrum history and whether transaction-detail loading reached its
500-transaction limit in `addressHistories`; wallet-derived address histories
remain on their wallet records. `addressHistory.ts` combines those observations
with loaded script-verified outputs and previous outputs to show received, spent,
both or unknown activity. It never infers a balance or ownership. Directly
selected addresses may also have bounded, encrypted `get_balance` and
`listunspent` observations in `addressBalances` and `addressUtxos`, each with a
network and check timestamp. These are fetched on demand for one selected
address, cached for the session/workspace, and refreshed only explicitly. A
missing or failed observation remains unknown. History and UTXO rows can
navigate to an unloaded transaction, which is then fetched and explicitly
admitted to the graph. An observed address balance supplies only that address
node's optional graph value for value-based sizing; address nodes are not
traversed by connection scans.

The UTXO projection counts only entries returned by `listunspent`, separating
positive observed heights from height-zero mempool entries. Confirmed UTXO
creating transactions may be loaded, bounded to 500 missing details per
action, so their block timestamps can be displayed; a missing timestamp remains
unknown rather than being inferred from the UTXO height.

For a selected or directly looked-up address, the browser admits and selects the
address before loading its history details when no direct history is available.
The bounded raw history observation is persisted
as soon as it arrives, then transaction details are persisted in small
progressive batches. Jobs are keyed by workspace, network and address, may
continue after selection changes, and are cancelled when the workspace changes.
The backend remains a bounded read-only proxy with no address-history jobs or
cache.

Optional encrypted `blockHeight` and `mempool` fields are observations. Direct
loads use the containing block header; histories supply Electrum heights. A
bounded 512-entry blockhash-to-height map per network caches immutable
coordinates, never active-chain status. Sources are listed in
[references.md](references.md).

### Wallets and scanning

`src/Core/Workspace/Wallets/walletDerivation.ts` accepts depth-3 account keys (`xpub`/`ypub`/`zpub`,
`tpub`/`upub`/`vpub`), derives non-hardened receive (0) and change (1)
branches, and builds P2PKH, P2SH-P2WPKH, P2WPKH or BIP86 P2TR scripts and their
Electrum script hashes. Testnet4 shares testnet encodings, so a key cannot prove
its network. Scanning is client-side: bounded address batches, gap and index
limits, concurrency limits, reuse of loaded transactions, and a retained
continuation queue of skipped transactions. Fetched addresses must be valid for
the workspace network and agree with their scripts. The backend never sees a
whole wallet. See [encryption-and-storage.md](encryption-and-storage.md)
and [performance-notes.md](performance-notes.md).

Session's `observe.walletRefresh` is the single Wallet intention: bounded history
and admitted transaction loading, all discovered-address coin batches, then the
existing analysis scan/merge path when material inputs change. Completed history
and coin batches publish independently, preserving checkpoints if later work
fails or is cancelled. Session/key/address bindings reject late results. Analysis
fingerprints are transient per acquisition/session; findings remain in the existing
analysis collection. An unchanged completed fingerprint skips recomputation; failed
tools are eligible for retry. Wallet `refreshedAt` records completion only after
history, coin checks and required analysis succeed; it is separate from history
scan dates and contributing coin-check dates. Old annotated transactions are not removed because
a later history omits them.

UTXO checks publish native observations into encrypted `chainData.addressUtxos`,
shared with Graph. Wallets projects them over verified scripts; there is no second
persisted balance or coin collection. Refresh automatically continues 100-address
batches. Exact amount/script matching governs loaded outputs. Failed checks retain
prior observations and dates. The aggregate date is the oldest contributing check.
Loaded exact spenders exclude saved coins from current candidates while preserving
the historical observation and review decision. Coverage distinguishes conflicts,
missing data and incomplete discovery and points to Refresh recovery.

`useWalletActivity` schedules the existing Session intention. The encrypted view
setting defaults on. All wallets run sequentially every 60 seconds by default,
selected first; the encrypted View owns the editable interval,
while unlocked and visible. A newly imported wallet gets an initial refresh even
with the setting off. Per-session attempts avoid repeated runs on presentation
edits. The existing `useWorkspaceOperation` accepts background work, preempts it
for foreground work and waits for cancellation before admitting that work. It is
the single operation arbiter; React retains only progress and accepted-check
projections. Lock/switch drops transient state and cancels owned requests.

### Request scheduling

`src/Core/ChainData/transactionScheduler.ts` coordinates transaction fetches: 12 physical jobs
globally, 8 per network, at most 3 per network for background work so explicit
navigation keeps capacity. Navigation precedes visible input evidence, which
precedes refresh and counterparty lookups. The queue holds 128 jobs with the
last 16 reserved for navigation; each job fans out to at most 64 consumers, each
receiving a deep copy. Identity includes the session token, network, transaction
ID, history height and an observation token, so a refresh never joins an earlier
observation. Each session owns a fetch scope whose abort cancels every leaf
request on lock. There is no resolved-transaction cache or TTL.

## Graph

### Membership, visibility and removal

The graph shows only explicitly added nodes. Schema v2+ stores
`view.graphNodeIds`; selection admits the clicked node, tracing admits requested
transactions and connecting outpoints, and new examples seed a curated canvas
(all I/O for small roots, up to 20 per side for dense ones). Later selection
does not expand I/O. Address nodes enter only through explicit selection or
lookup.

Manual hiding (`visibility.ts`) stores canonical IDs in the encrypted view and is
independent of filters: resetting filters never unhides. `graphBranch.ts`
computes hide/remove closure over a batch: an outpoint leaves with its
transaction only when no other participating connection survives. Hiding checks
membership minus hidden nodes; removal checks full membership. Removing from the
graph keeps evidence, annotations and geometry. `entityRemoval.ts` plans
workspace-level transaction deletion and address unwatching, counting affected
annotations for confirmation; inputs and outputs are never deleted individually.

### Presentation and adapter contract

`src/App/Workspace/Workbenches/Graph/Renderer/presentation.ts` projects the visible domain graph into a `GraphFrame`:
nodes with stable IDs, shapes (cube, sphere, octahedron, grouped output), colors, radii,
highlights, optional captions and coordinate hints; links with endpoints,
colors, widths, arrows and a `directed`/`flowSide` hint. Callers supply
`NodePresentation` overrides for tags, wallet matches and findings; selection
color wins, then tag color, then wallet color. Value sizing uses the fixed
bounded curve `2 + 10 * m / (1 + m)`, where `m = (sats / 100000000)^0.7`.
It emphasizes ordinary wallet magnitudes while approaching a radius ceiling of
12; zero has radius 2. Unknown or invalid values retain the neutral radius of
3.2 and an independent `?` indicator. The shared presentation owner supplies its
availability rule to the hover card. Batch selections and scan targets use
selection colour/rings without the body-scale boost in Value mode. Other modes
retain their existing boost. The renderer's appearance-only `selectionRing`
leaves the focused item and expansion anchor unchanged. The independent
`indicator` remains visible with captions hidden and never changes mesh geometry
or picking. Size changes preserve established node positions and the camera;
Repack remains explicit.

`outputGroups.ts` derives an optional presentation-only compaction when at least
three visible output-only bridges connect the same creating and spending
transactions. It replaces those render nodes and links with one deterministic
group glyph and two render links. The canonical graph remains unchanged, and
the group hit carries the exact canonical member IDs into the existing multiple
selection owner. Outputs with another visible relationship, including an address
association, stay individual. The transient GraphView toggle is on by default;
disabling it restores the individual projection and hides the legend key. Group
sizing first resolves every member under the selected sizing mode and then uses
the cube root of the sum of their cubed radii. The compact glyph therefore
preserves the combined rendered volume, including member scale overrides,
rather than applying a nonlinear sizing curve to aggregated facts.
`outputGroupGlyph.ts` supplies the same geometric measurements to presentation
and geometry creation. The radius calculation divides by the sparse glyph's
filled-volume ratio before taking the cube root, while collision bounds remain
normalized to the glyph's true outer radius.

The browser remembers its accent preference separately from encrypted workspaces.
`accentTheme.ts` applies it before mounting the app; `GraphView.tsx` observes the
root accent attribute and refreshes presentation colors on the existing renderer.

The application keeps chain topology separate from human metadata. Its bounded
`GraphMetadataProjection` retains unchanged node appearances and projects labels
for inspector and entity-list use without rebuilding chain, wallet or scan indexes.
Bookmarks and notes only invalidate canvas membership when a relevant filter is
active. `GraphPresentationUpdates` projects changed visible appearances and uses
the optional `updateNodeAppearance` adapter method for caption, color and highlight
patches. The Three.js renderer updates those node instances without restarting
layout, edges, flow particles or camera persistence; pending layouts retain patches.
Topology, selection, sizing and other global changes still use complete frames,
as do adapters without the patch method.

`Renderer/adapter.ts` defines `update`, `resize`, `focus`, `fit`, `dispose`,
optional `flushSnapshot`, `zoom`, `repack`, `setMotion`, and events for
hover/select (node, link or grouped-output hits plus pointer coordinates and modifiers), activity
(pauses autosave), layout status and WebGL errors/recovery. Adapters own
picking, camera, gestures, layout and GPU resources. `GraphView.tsx` owns
semantic hit lookup, selection routing, hover cards, keyboard details, floating
navigation, toolbar/legend slots and resize observation. Node dragging is
disabled because of an upstream pointer-event incompatibility; the entity list
is the keyboard and no-WebGL path. Camera and node coordinates are saved as a
bounded renderer-neutral snapshot inside the encrypted view.

### Flow renderer

`Renderer/defaultAdapter.ts` selects `FlowRenderer`, a purpose-built Three.js
instanced renderer. Picking uses exact mesh hits first, then a 25% padded
fallback shared by hover and tap.

Layout runs in `flowLayout.worker.ts`. `transactionSkeleton.ts` derives one
spatial hierarchy from the visible transaction DAG without changing its factual
edges. It estimates descendant mass from transaction count and visible local
geometry, gives substantial sibling subtrees deterministic solid-angle cones,
and carries each chosen branch direction through single-child runs while every
factual spend still advances on world X.
Each transaction and its terminal input/output envelope occupies a branch-local
temporal band. Factual edges separate complete neighboring envelopes, rather
than only their transaction centers. Confirmed block height orders compact
sibling bands without converting missing blocks into distance; equal heights
can share a band, and mempool or unknown-order siblings use the last band.
Factual causality takes precedence when an unknown-order transaction is visibly
upstream of a confirmed transaction.
Reconnectors choose one primary spatial parent while every real cross edge and
canonical transaction remains in the rendered graph. `groupedFlowLayout.ts`
then places terminal inputs and outputs in rounded groups on opposite sides of
each transaction along world X, sized by member radii; up to eight members use
balanced singleton/pair/ring footprints, and larger sides use collision-aware
packing lifted onto a rounded shell. Shared outpoints are single nodes bridging
their creating and spending transactions in the connection's local frame.
Incremental placement keeps every cached coordinate exact, leaves a transaction
opened from a visible outpoint along that established outward ray with at least
one group radius of clearance, and never reserves space for undisplayed
siblings. Remaining associations use a stopped `d3-force-3d` simulation anchored
to grouped positions. Only visible nodes affect spacing. **Repack** rebuilds the
visible layout and applies newly observed chronology to all bands. A newer
topology request terminates obsolete worker work; views with cached positions
restore without simulation; worker failure keeps the scene and offers Retry.
Flat mode uses the same hierarchy in a planar footprint.

`flowContext.ts` marks the selected transaction's inputs and outputs with
screen-space brackets/rings and colored edges; `flowSelection.ts` walks visible
creation/spending links upstream and downstream from the active node without
reversing into sibling branches, targeting 50 terminal branches per direction;
`flowParticles.ts` animates the chosen segments with adaptive dot density
(about 400 particles). Motion is transient GraphView state, on by default, and
never fetches or admits nodes. Engine references are in
[references.md](references.md#rendering).

### Filtering, selection and batch edits

`GraphFilters` holds every user-visible dimension: entity type, label and tag
state, wallet membership, satoshi bounds, loaded spend and funding evidence,
bookmarks, focus hops, isolation and connected context. Membership dimensions
resolve to `includeIds`/`excludeIds` in the workbench using the tag and
wallet-match indexes; the domain filter never derives membership. `activeFilterChips`
and `clearFilterKey` remove one dimension at a time. **Show connections** adds
one-hop loaded neighbours nonrecursively, respecting hiding and the path scope.
Amount thresholds (`smallAmounts.ts`) are strictly greater-than, preserve
unknown and selected values, and drop branches that become detached; the canvas
and flow thresholds are separate encrypted preferences.

The **Entities** panel reads the graph filters and shared selection by default.
Its link toggle can detach panel-only filter state while leaving graph filters,
graph scope and selection unchanged. Re-enabling the link switches the panel back
to the graph's current filter and selection state.

`useEntitySelection` holds selection mode and an ordered ID set as UI state,
cleared on workspace change and pruned only when entities disappear. Adapters
report modifier keys; `GraphView` decides inspect versus toggle. `batchEdits.ts`
contains pure operations that return the same workspace when nothing changes,
canonicalize IDs and write only the targeted field; `batchMetadata.ts` wraps
them for wallet records with preserve-by-default semantics and affected counts.
One batch is one workspace update, one autosave and one Undo step.
`MetadataEditors` and `MetadataPopover` provide the shared quick editors used by
Wallet, Graph and the Inspector; `tagColors.ts` owns the 16 presets.
Single-record controls accept one entity ID. Batch controls accept an explicit
ID list, even for a batch of one, and retain their preserve-existing policy until
the user selects replacement. The label and tag variants share private forms
and the existing annotation operations. Wallet's `WalletMetadataFields` and
`WalletIconEdit` attach those single-record editors to their reading fields;
`BatchMetadataBar` exposes explicit batch scope and replacement controls.
The unused single-record toolbar has been removed. The batch toolbar owns one
open-editor state, including its icon palette.
`IconPickerControl` accepts that state and replaces capture-event coordination
between the toolbar and picker. The standalone `IconPicker` retains local state
and programmatic opening for Inspector fields. Both use the same trigger and
palette, with the existing focus and annotation operations.

BIP329 inspection, profile mappings, scope, budgets and atomic application belong
to the existing Annotations capability. `labels.ts` replaces immediate label
import/export with inspection and reviewed plans. App supplies options and applies
one metadata mutation; it does not sequence annotation, tag and wallet setters.
File decoding and projection run in cancellable, short-lived Web Workers.
Export's serialized content is the single source for download and both file
preview views. The UI decodes only the visible table page; the JSONL view uses
those exact lines in their original order. Export plans retain only changed text
for the separate original/exported review, replacing the former representative
metadata preview. Import issues distinguish protected existing text from values
already up to date, and carry the text comparison needed to explain preservation.
Conflict issues carry candidate text and origin for comparison before selection.
The reviewed plan retains its main-thread source references so application can
reject changed metadata or evidence and preserve unrelated current state.
The worker returns reviewed wallet-name changes instead of cloned wallet definitions;
App applies those changes to the original definitions and restores unchanged
annotation/tag identities. Annotation-only imports therefore retain wallet evidence
identity. Native text boundaries share Annotations' Unicode-safe clamp.
The transfer is bound to the existing unlocked session's fetch scope, including
same-ID reopenings. One completed plan supplies retained review content during
recalculation; only a plan for the current source and settings can be applied or
downloaded. Close releases both transfer and preview, and Retry uses the same
inspection/options with a fresh cancellable job.
Origins, profiles and transfer previews live only for the dialog; no persistent
per-account labels or alternative wallet-name source of truth are introduced.
Equivalent public key encodings share a canonical BIP32 payload identity while
explicit script-policy encodings still constrain wallet matching. Exported key
labels are opt-in, and wallet-name fallback is separate from explicit key labels.

## Wallet workbench

The product contract is [wallet-experience.md](wallet-experience.md). The existing
list/detail layout renders Transactions, Coins, Addresses, Counterparties and
Review. Sources/Destinations remain scopes under Addresses. `view.ts` owns
validated encrypted per-tab browsing positions, plus the automatic refresh
preference. Optional `tabs` entries load older `browsing`/`review` positions as a
compatibility fallback; subsequent presentation writes use only per-tab entries.
Background updates preserve inspected records and editors.

`walletRecords.ts` owns wallet-relative accounting from canonical scripts and
loaded prevouts. Missing/co-input evidence stays unknown. It exposes matching
inputs/outputs, signed net change, direction and whole transaction fee without
allocating collaborative fees. Shared `Amount` renders monetary values.

`walletReview.ts` derives annotation goals and finding assessments, grouped around
exact records. Transaction label, note or tag satisfies the purpose goal;
counterparty associations satisfy the separate sender/recipient goal. Neither
fabricates a judgment. Findings
enter through explicit subjects; broader evidence is not an assessment subject.
Encrypted decisions distinguish reviewed, cannot-identify, not-needed and later.
`walletReviewEvidence.ts` owns material support fingerprints. Changed support can
reopen attention while preserving the decision; routine dates do not. Migration
retains historical acknowledgments and establishes baselines only from eligible
validated finding support. Removing a wallet prunes its decisions, not reusable
counterparty identity or concrete associations.

The existing review generator also owns `address-context` goals, presented through
the new `address-description` reason rather than reusing legacy address
acknowledgments. Verified wallet addresses become eligible through reported history,
script-matching loaded/attached outputs or verified coin observations on either
derivation branch. One canonical address goal retains its transaction context but
groups under the address itself. Its support fingerprint represents the question
and stable network/script identity; more activity does not invalidate an explicit
address-purpose disposition. The address's own label, note or tag supplies context.
Coin context reuses that exact address subject through the existing bounded receipt
links, without copying metadata or satisfying transaction purpose. The saved decision
shape is unchanged; no second queue or completion state is added.

`WalletRow.walletAddress` reuses the verified prepared address record for list and
inspector derivation facts, branch filtering and Review presentation. View retains
an optional `addressBranch` choice separately in browsing and Review; the existing
Addresses selector combines it with the Wallet/Sources/Destinations scope. Missing
choices default to all branches, so older documents require no format migration.
Only account-relative paths are shown, with no inferred master origin.

`Counterparties/` owns identities and exact receipt/payment, address and output
association validity. `Annotations/` owns their ordinary human metadata through
`annotationReferences.ts`; chain entity references remain factual. Party names
never prove ownership. Exact association lookup is reused by review goals and
Wallet display/search. Entity removal distinguishes associations from identity
and reports concrete association consequences. `counterpartySelectionLinks` finds
editable links for one exact wallet-anchor group. `setCounterpartySelection`
changes that group's checklist selection or output scope atomically, preserving
other anchor groups and inherited receipt links. UI callers express the selection
without coordinating removals and additions. Persistence validates schema
version 8 and migrates earlier workspaces without replacing observations.

`CounterpartyPicker` keeps name selection and optional output assignment inside
one anchored popover. Its private scope editor holds unsaved choices locally;
Back/Cancel discard them and Apply uses `setCounterpartySelection`. The optional
`walletScripthashes` display input reuses prepared verified wallet scripts from
the inspector and row-action callers to separate wallet outputs from other
payment outputs. It adds no ownership inference, persistence state or review rule.

`walletRows.ts` links factual rows to exact goals/assessments. Context navigation
uses exact keys and transaction scopes rather than search. Decision mutation
deduplicates persisted keys. `WalletItemDetail` is the single inspector used by
factual and Review tabs. Its private frame owns evidence and transaction-flow
state; `WalletMetadataFields` owns the common reading layout and inline editors.
Transaction facts move into the header, with Metadata and independent Review
findings in two responsive columns below. Confirmations remain saved placement
observations; the inspector does not infer them from loaded block heights.
`RelativeTime` owns a disposable display clock, isolated from its containing
inspector, and uses the shared Formatting calendar-age helper.
Transaction flow remains in the same
private frame, starts expanded for transactions, and spans the content width
without an enclosing card. Addresses share the header and metadata/findings
styling, with account-relative derivation and activity in their own factual header.
Address balance uses the latest matching-network balance or UTXO observation in
`chainData`; zero is established by a successful observation, never by absent
loaded activity. `ChainData/observations.ts` owns the shared balance projection
used by Graph and Wallet. The existing address-evidence balance action accepts
an exact address for Wallet while retaining Graph's selected-address default;
both publish through session acquisition and the existing operation owner.
Coins and outputs share the same factual header and metadata/findings columns.
Coin dates come from exact matching address-UTXO observations; the existing
wallet-record block projection reconciles their heights with loaded timestamps.
Counterparty details use the same header/facts and metadata styles, with their
existing related transactions beside metadata. Their counts remain projections
of saved associations and wallet activity. No new persisted summary is added.
Values derive from annotations and exact association sources,
with no stored answer state. Automatically satisfied annotation goals disappear;
explicit decisions retain compact reopening controls. The separate factual and
review detail variants and single-record toolbar have been removed.
`WalletReviewInteractions` owns reusable field review indicators and the compact
independent checklist, plus the existing decision controls shared with batch
review. `WalletItemDetail` maps exact annotation goals to their editable fields:
record-local description goals attach once to Label, while relationship goals
attach to the matching sender/recipient or counterparty field. Other annotations
can still satisfy a goal through the existing Core rules. No answer state or
review mutation owner is added. Explicit decisions remain discoverable at their
field; automatically satisfied goals disappear.
One outer Review disclosure retains independent findings and linked review
navigation, with status icons and direct assessment actions per finding. Existing
decision controls supply the same outcomes in batch, inline and annotation-context
presentations. Annotation popovers put the preferred edit shortcut above a row of
alternative resolutions. Finding rows use concise presentation of saved analysis
classifications, with longer evidence in the existing help tooltip. No analytical
rule or stored finding is changed. The
field editor shortcut invokes the ordinary trigger in the same annotation row,
preserving the editor owner and exact association source. Popovers and tooltips
remain local UI state, not a second review-state source. Address/coin navigation
calls the panel's existing exact-key review operation. A focused review jump opens
its field context or the outer section; there is no nested disclosure per item.

`WalletReviewPanel` consumes its Wallet-owned `WalletNavigation` through
`useSyncExternalStore`. This replaces its individual tab, filter, selection and
trail states with one presentation owner and atomic navigation intentions.
`useRecordSelection` owns the shared range/toggle rules, reused by Wallet navigation.
The workspace controller retains Wallet navigation per wallet in a session map keyed by the
existing unlocked fetch scope, pruned on lock and wallet removal; Core Session
does not acquire UI types or navigation responsibilities. `walletNavigationFor`
owns lazy creation and reuse for both
mounted panels and external entries, so Graph bookmarks can enter Wallet before
its panel mounts. A counterparty handoff selects the current wallet's Counterparties
tab and identity through one navigation intention, clearing a search that could
hide it. Workspace owns the cross-workbench return point. Inspector links retain
canonical references and contextual jumps retain the origin and destination's
normal presentation, replacing any suspended temporary destination. The named
context return restores those positions directly, while inspector Back pops one
record. Both restore keyboard focus without
rolling back annotations or evidence. Only normal per-tab positions enter View;
temporary scopes, checked IDs, range anchors and return trails are not persisted.
Back labels derive from the subscribed immutable snapshot, not an implicit read
of the navigation instance. Wallet panel interaction tests use the app's React
compiler so memoization regressions are covered alongside state transitions.
Counterparty inspector activity uses prepared wallet transaction records and
review context regardless of the active tab, building its transaction projection
on demand when that tab has not already built it.
The panel resolves related wallet records from current rows and the verified
loaded output index. Navigation stores no chain-data snapshots. External or unavailable
records retain explicit Graph navigation. State changes keep the inspected record
available for reversal. Batch selection retains its existing exact related-row
shortcuts and preserve-existing metadata policy, including a batch of one.
Counterparties composes the same inline field and list/detail styles; category
drafts and removal confirmation remain local UI state. Its overflow menu retains
bookmarking and removal. Record links inspect records, while checkboxes and modifier
clicks retain batch selection.

`walletRelationships.ts` continues to project observed one-hop addresses using
raw scripts and loaded prevouts, excluding wallet scripts. Histories do not prove
direction or ownership. `useWalletCounterparties` resolves missing source inputs
in bounded batches. `walletSelectionIndex.ts` shares snapshot indexes.
`reviewCategoryDefinitions.ts` owns filter copy and order; `reviewCategories.ts`
owns OR matching and counts. Session-owned Refresh runs default wallet analysis
when its inputs change and retries failed tools. Wallet has no separate scan
controller; custom scopes and tool options remain in the Analysis workbench.

Each unlocked session owns `WalletPreparationCache`. Immutable references
invalidate dependent indexes, relationships, goals and coin projections, including
counterparty context. Camera/workbench changes do not. Warm returns reuse prepared
results. Transaction/address accounting and material finding support survive
human context edits; chain snapshots and derivation anchors invalidate them.
Finding support includes every wallet for wallet-intersection evidence. Checked
and unchecked review projections are prepared only when requested. These are not serialized; locking disposes them, while save failure keeps
the unlocked session. There is no second metadata store, findings collection or
operation runtime.

## Analysis

`analysisTools` in `src/Core/Workspace/Analysis/analysis.ts` is the public registry view.
`toolRegistry.ts` composes one file per tool and owns functional scan order;
`toolGroups.ts` separately owns filter grouping and display order, so presentation changes
do not change execution. A tool declares metadata, source reference and typed parameters;
`analyze(workspace, transactionIds?, options)` returns findings, scope,
summary, coverage and a no-match explanation. Findings carry a stable identity,
algorithm version, explanation, explicit factual subjects, affected evidence
nodes and supporting transactions.
Tools are pure and make no requests. `analysisScan.ts` resolves the selected
transaction, output, address or wallet (or the whole workspace) into loaded
transaction IDs and runs the registry with independent reports and cancellation
between tools. Exclusions survive reruns only with matching support. Analysis
compares each finding's relevant inputs, outputs, resolved previous outputs and
wallet bindings. Observation timing or another confirmation alone does not
invalidate a structure-only finding. Session history carries accepted observation
deltas through Undo and Redo while preserving user-owned membership. Only active, non-stale findings
color the graph, using the last active finding per node. See
[analysis-heuristics.md](analysis-heuristics.md).

The workbench mode (`wallet`, `graph`, `analysis`) is an encrypted view field.
Graph stays mounted while hidden so its adapter, camera and layout survive.
Analysis controls and reports live in a Workspace-owned map pruned on lock or close.
Workspace navigation distinguishes a direct workbench switch from a contextual
handoff and return. A handoff keeps one transient return point containing the
origin workbench and focused control. The destination workbench resolves its own
semantic entry target, such as Graph's stage or Inspector, without exposing its
DOM to Workspace. Show and Isolate promote compact Graph context before
selecting; if an outpoint has no loaded creator, navigation opens a supporting
transaction and says so rather than fetching.

## Connection scans

`src/Core/Workspace/ConnectionScan/connectionScan.ts` runs in the worker beside
it. The same concept owns live/retained run models, result classification,
identity, deduplication, support retention and endpoint rechecks. Graph consumes
these rules rather than maintaining separate copies. Automatic
scopes (`connectionScanNeighbours.ts`: breadth-first over loaded
creates/spends links, up to 1,000 nearest nodes; visible; all added) and custom
picks (`App/Workspace/Selection/connectionScanTargets.ts`: exactly the picked transaction/outpoint IDs,
deduplicated, source excluded, at most 1,000) freeze their targets and the
loaded-link baseline before the run. FIFO fronts alternate source and target
admission per requested direction, with up to four neighbour lookups in flight.
Ready responses are applied serially; a front finishes its current breadth level
before advancing deeper, while other fronts remain free to progress. The worker
bridge reserves transactions against one shared run budget, including overlapping
requests and failed lookups. Pending transaction and UTXO lookups are deduplicated
within the run and aborted on completion. Exhausting the transaction budget stops
admission while allowing already-admitted lookups to finish within the deadline.
Shared ancestors/descendants join
same-direction walks at a meeting point. Automatic connections must add an
observed edge and, for targets in the source's component, retain a distinct
existing route (bounded to 8 transactions) so Add closes a loop; merely loading a
known creator is not a finding.

Defaults are 3 hops, 200 transactions, 30 seconds and a 1,000-branch boundary;
hard limits are 8 hops, 1,000 transactions, 60 seconds, 1,000 branches, 1,000
targets and 50 results, with at most 10 endpoint and 10 evidence-problem paths
per run. Time and depth limits produce a run-level reason, never cards.
Run details show grouped connections found and optional deepest transaction-hop
distance reached from either search side; older saved runs omit unknown depth.
`connectionScanFetch.ts` reuses loaded evidence and the scheduler's background
priority. Downstream indexed spender requests collect up to four exact outpoints
over a 2 ms window, validate the returned evidence against the requested points,
and distribute each spender and unresolved point to the matching lookup.
Candidates beyond the shared budget are skipped without discarding admitted
spenders from the same batch. Script
histories share pending and completed requests by script hash within this run;
failed requests are evicted for retry. This transient lookup state stays in browser
memory and is discarded with the run. An unspent endpoint needs a validated
`gettxout` observation with
creator proof; coinbase and OP_RETURN endings need the actual script bytes.
Typed error codes separate outages from local failures and no upstream text
enters a result.

Core `ConnectionScan/updates.ts` upserts runs in stable order; its record rules deduplicate paths
across runs by source, kind, endpoint, meeting point and directed path
(reconnections by undirected edge union). The encrypted collection is bounded
to 20 runs, 50 results each, 200 extra path transactions and 2 MiB; hitting a
bound rejects the write instead of evicting. Frontier and transport state never
enter the schema. `ConnectionScan/connectionScans.ts` owns the run and collection schemas;
the same validation is reused for live writes and imported documents.
Graph `connectionScanAddition.ts` plans Add and Add prefix as one
Undo step using existing membership APIs; `connectionScanActionEvidence.ts`
fetches at most 20 missing transactions per action with a 30-second deadline;
`connectionScanRetry.ts` rechecks one endpoint under the original bounds without
resuming traversal. Interrupted runs restore as interrupted, never as jobs.
Regression suites and an independent path oracle are described in
[connection-scan-testing.md](connection-scan-testing.md).

## Smaller contracts

**Amounts.** `amountFormat.ts` renders integer satoshis (number or bigint) as
BTC with eight decimals grouped 2/3/3 by thin spaces; `Amount.tsx` adds tabular
digits and the sats tooltip. Nothing else formats money. Fee rates stay sat/vB.
See [references.md](references.md#product-direction).

**Transaction metadata.** `TransactionBlockTime.tsx` provides explicit block,
separated block and timestamp variants, with named fee variants. They compose
one private markup frame rather than combining display-mode flags. Status,
timestamp and fee interpretation remain in their existing display helpers.
Missing timestamps stay absent, and incomplete fee evidence stays unknown.

**Tags and wallet matches.** `tags.ts` indexes tag membership (canonical
transaction/output/address references, address members projecting onto loaded
outputs) and wallet-script matches (raw script over decoded address;
transactions associated through matching outputs or loaded prevouts, never a
heuristic). Both are presentation inputs and do not touch annotations.

**Flow panel.** `FlowPanelShell` is the frame: a collapsible surface and its
height controls, taking a header and a body and knowing nothing about either.
`FlowPanel` chooses the view for what is selected, through an exhaustive switch
that fails to compile when a node kind has no view. The workspace persists the
left and right tabs and collapse state, mobile panel choice, and flow height
under `view.panels`; the toolbar's combined action changes only the two side
panels. A selected unknown outpoint may hydrate its one missing creator while
the flow panel stays collapsed; navigation never changes panel presentation to
trigger data loading. `FlowPanelTransactionView`,
`FlowPanelAddressView` and the wallet stub each supply their own title bar,
status line and body, and keep their downstream components in their own file.
Transaction choice and quick editors have panel lifetime; address tabs and
pagination have address lifetime.
Transaction connectors are decorative cubic curves owned by
`FlowPanelTransactionView` in Graph and `WalletReviewFlow` in Wallet.
Graph's existing layout effect applies sticky offsets before measuring card
edges in a viewport-anchored SVG, so one observer and animation frame batch own
both layout and connectors. Decorative paths update directly in that paint frame,
without a React geometry commit. Selected curves paint last at the shared junction.
Strokes end at an arrowhead's base; the matching-color head finishes 2px before
the card. Clipping excludes obscured rows, confines Graph curves to the panel
viewport and fades the last visible pixels before a row disappears.
Wallet measures its independent lane scrollers, observes paging and annotation
changes, and uses vertical curves when the detail container stacks its lanes.
Geometry stays transient; neither workbench shares a layout coordinator or stores it.
Wallet flow cards are informational and retain exact copy actions. Their Graph
handoff stays in the enclosing detail disclosure header. Wallet's transaction
card arranges the existing status, timestamp and fee projections independently,
so an absent block timestamp cannot hide a known fee. The flow component no
longer consumes wallet names, active-state help or Graph navigation callbacks.
`WalletReference` exposes the existing responsive identifier expansion for flow
inputs/outputs; local card styling uses available width while retaining the
suffix and copy action. Other reference callers retain their compact display.
Arrows express input/transaction/output relationships, never ownership or an
input-to-output allocation. CSS rails, branches and endpoint caps are removed.
The Inspector derives selected transactions and their loaded relationships through
`relatedTransactions.ts`. `ScriptInspector` renders Core Bitcoin's saved-script
decode; `src/Core/ChainData/rawTransactionInspection.ts` fetches raw bytes on
demand, delegates native decoding to Core Bitcoin, verifies them against the ID
and loaded observations, and keeps them in component memory only. Sources are in
[references.md](references.md).

**UTXO status.** `useUtxoStatus` binds an abortable `gettxout` (with mempool)
to workspace, network and outpoint; results are timestamped, cleared on
selection change and never written to the workspace. See
[spender-index.md](spender-index.md).

**Examples.** `workspaceTemplates.ts` filters a nine-entry catalog by configured
networks; `templateWorkspace.worker.ts` loads the bundled snapshot, adds starter
annotations and validates off the UI thread. Copies get fresh IDs and behave as
ordinary workspaces. A legacy `demo` flag only stops previously saved synthetic
IDs from reaching upstreams. See
[example-workspaces.md](example-workspaces.md).
The separate compile-time demo build exposes three dedicated captured
investigations, including canonical dated address-UTXO observations. They use
the same worker, parser and encrypted lifecycle and remain `demo: false`.

**Guided tour.** `src/App/Help/steps.tsx` lists steps with stable IDs,
copy, target selectors, fallbacks and optional `when` predicates; order is the
array order. `useTour` owns first-use admission and scopes the active topic to
the current workspace visit. Switching workspaces or returning home dismisses
the tour without resuming it on return. The origin-local seen flag records the
first automatic offer; manual starts remain available. Workspace presentation
reset does not close the tour, so first use is independent of effect order.
`GuidedTour.tsx` overlays a measured spotlight and never launches
scans or edits data. Add a `data-tour` anchor and a step; test direct jumps,
missing targets and narrow viewports.

**Password dialogs.** Create, unlock and import use explicit buttons and Enter
handling rather than form submission, with autocomplete off, to reduce browser
save-password prompts. No guarantee is claimed. See
[encryption-and-storage.md](encryption-and-storage.md#password-dialogs).

## Verification boundaries

`npm test` covers protocol and security boundaries, derivation and encryption,
domain behavior, persistence coordination and scheduler/worker contracts with
synthetic or public fixtures. `npm run build` proves types and bundling. Push
and PR CI run these plus formatting, portability and license checks; no
browser is launched.

`tests/integration/devWorkers.test.ts` also exercises the real Vite development
transforms without a browser. It checks every worker's transitive source imports
for React instrumentation and evaluates the example tag palette without window
globals. React Compiler and Fast Refresh target JSX and `use*.ts` hook modules,
not all of `App`: pure App-owned helpers can also run in workers. The test guards
hook compilation coverage so the narrower filter cannot silently drop existing
memoization. Production builds and SSR example tests alone do not cover this
development-only boundary.

Release verification adds `npm run test:production`: HTTP checks of built
assets, CSP and security headers and network discovery, then a narrow browser
run of the bundled encryption worker under production CSP, a WebGL context, and
encrypted save/reload/unlock/export of a synthetic workspace. `npm run test:e2e`
is a deliberately small smoke suite (the app renders, a workspace opens and
shows its graph).

None of this establishes visual usability, live upstream health, complete
wallet coverage or mobile performance. Those need explicitly scoped browser QA
and read-only checks against real services (`npm run test:live`).
