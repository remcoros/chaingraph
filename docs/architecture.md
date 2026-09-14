# Architecture

Chaingraph is a browser-owned investigation workspace in front of a bounded,
read-only bridge to Bitcoin Core RPC and the Electrum protocol. The server has no
database, chain index, wallet import or workspace cache. Everything a user
creates lives in the browser, encrypted at rest.

```mermaid
flowchart LR
  UI[Browser workbench] --> Domain[Workspace and analysis modules]
  Domain --> Vault[Encrypted browser storage and workspace files]
  UI --> Scan[Browser key derivation and bounded scans]
  Scan --> API[Same-origin HTTP API]
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

See [source-map.md](source-map.md) for the directory tree, task entry points and
test locations. Source is grouped by product ownership.

| Location                                                           | Responsibility                                                                     |
| ------------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| `src/App/App.tsx`, `src/App/useAppState.ts`                         | App shell, session navigation, home and dialogs                                   |
| `src/App/Workspace/Workspace.tsx`, `useWorkspace.tsx`               | Shared state, selection, presentation and workbench switching/focus                |
| `src/App/Workspace/ChainData/`                                     | Bounded address and transaction loading, cancellation and evidence updates        |
| `src/App/Workspace/Workbenches/*Workbench.tsx`                      | Workbench composition and integration with shared Workspace state                 |
| `src/App/FrontPage/`, `Examples/`, `Help/`, `Dialogs.tsx`          | Workspace entry, example creation, help and dialogs                                |
| `src/App/Workspace/useWorkspaces.ts`                               | Unlocked sessions, undo/redo, autosave and locking                                 |
| `src/App/Workspace/Entities/`, `Inspector/`, `Selection/`, `Tags/` | Workspace panels and shared selection                                              |
| `src/App/Workspace/Workbenches/Wallet/`                            | Wallet overview, records, review UI, scan hooks and preparation cache              |
| `src/App/Workspace/Workbenches/Graph/`                             | Graph surface, filters, transaction flow and metadata projection                   |
| `src/App/Workspace/Workbenches/Graph/Renderer/`                    | Renderer-neutral contract, Three.js renderer, layout worker and picking            |
| `src/App/Workspace/Workbenches/Graph/ConnectionScan/`              | Connection panel, worker bridge and bounded scan fetching                          |
| `src/App/Workspace/Workbenches/Analysis/`                          | Analysis controls and reports                                                      |
| `src/Shared/`                                                      | Reused controls, evidence display and metadata editors                             |
| `src/Domain/types.ts`, `src/Domain/Workspace/`                     | Shared contracts, schema validation, migrations, removal and example snapshots     |
| `src/Domain/Chain/`, `Wallet/`, `Graph/`                           | Chain evidence, key derivation, wallet projections, graph membership and filtering |
| `src/Domain/Analysis/`, `ConnectionScan/`, `Metadata/`             | Heuristics, bounded connection search, pure annotation edits and BIP329 labels     |
| `src/Infra/Bitcoin/`                                               | Typed HTTP calls, ancestry/spending requests and prioritized fetch coordination    |
| `src/Infra/Storage/`                                               | Authenticated envelopes, encryption worker, compression and browser persistence    |
| `server/app.ts`, `rpc-schema.ts`                                   | HTTP routes, Host/Origin checks, limits, cancellation and read-only RPC allowlist  |
| `server/core.ts`, `electrum.ts`, `config.ts`, `limit.ts`           | Upstream adapters, chain identity, network configuration and concurrency           |

## Browser-owned state

### Sessions, undo and autosave

An unlocked session holds the workspace and its password in memory only.
Mutations increment a revision; autosave debounces, serializes an encrypted
snapshot in a worker and records which revision reached storage. Saves are
serialized. Graph gestures pause save dispatch, and the renderer coalesces
camera snapshots after 1.2 seconds of quiet. Lock, export and workspace switch
flush the current camera synchronously first. Locking waits for a current save
before dropping the session; a failed save leaves the session open with its
edits.

Undo and Redo hold up to 15 session-only steps, each a workspace snapshot with
a description derived by `undoDescription.ts`. Continuous typing in one field
coalesces. Chain-evidence changes (new transactions, refreshed histories) clear
both stacks so an undo cannot discard downloaded data; presentation writes
(camera, view, scan results) carry through both stacks. A batch edit is one step.

### Encrypted envelope and storage

`src/Infra/Storage/crypto.ts` fixes AES-256-GCM with PBKDF2-SHA256 at 600,000 iterations,
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
worker (`workspaceEncryption.worker.ts`); unlock and import use the same queue
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

`CURRENT_WORKSPACE_VERSION` is 4. `workspaceMigrations.ts` is the only
migration boundary, called by `parseWorkspace`: versionless and v1 data gain
explicit graph membership (v2), v2 gains connection scan records (v3), and v3
gains address-history records (v4). Migration builds a new root object and
never guesses at null, zero or unknown versions. Unlock never writes a
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
members and 20,000 wallet review decisions.

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
**Load previous** use `src/Infra/Bitcoin/tracing.ts`: breadth-first, one or two levels, a
shared 500-download budget, partial results on unavailable branches. The bulk
**Load missing input details** action fetches only parents whose prevout is
missing or conflicting, four at a time, up to 500. Automatically loaded parents
are recorded in encrypted `inputContext` (which outputs the flow uses) and
`contextTransactionIds` (ancestry provenance), so `buildGraph` can show them
without unrelated branches and removal can drop context nothing else needs.

Spending discovery (`loadSpending`) uses the spender index when enabled, then
Electrum script histories, checking at most 500 candidates per action with an
explicit continuation. When no spender is found it asks `gettxout` including
mempool and reports unspent-at-check, absent or unknown.

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

`src/Domain/Wallet/wallet.ts` accepts depth-3 account keys (`xpub`/`ypub`/`zpub`,
`tpub`/`upub`/`vpub`), derives non-hardened receive (0) and change (1)
branches, and builds P2PKH, P2SH-P2WPKH, P2WPKH or BIP86 P2TR scripts and their
Electrum script hashes. Testnet4 shares testnet encodings, so a key cannot prove
its network. Scanning is client-side: bounded address batches, gap and index
limits, concurrency limits, reuse of loaded transactions, and a retained
continuation queue of skipped transactions. Fetched addresses must be valid for
the workspace network and agree with their scripts. The backend never sees a
whole wallet. See [encryption-and-storage.md](encryption-and-storage.md)
and [performance-notes.md](performance-notes.md).

Refresh records checked bounds, scan time, pending downloads and an unreviewed
transaction queue. Unchanged evidence keeps analysis results usable; changed
evidence invalidates findings. Old annotated transactions are never removed
because a new history omits them. The optional 30-second monitor runs only
while unlocked.

Wallet UTXO observations (`useWalletUtxos`) are transient Workspace state keyed by
workspace, network, wallet and discovery revision. They come from bounded
Electrum `listunspent` queries over discovered scripts, require an exact
amount/script match with loaded outputs, survive workbench navigation and clear
on wallet or workspace change and lock. They are never persisted.

### Request scheduling

`src/Infra/Bitcoin/transactionScheduler.ts` coordinates transaction fetches: 12 physical jobs
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
nodes with stable IDs, shapes (cube, sphere, octahedron), colors, radii,
highlights, optional captions and coordinate hints; links with endpoints,
colors, widths, arrows and a `directed`/`flowSide` hint. Callers supply
`NodePresentation` overrides for tags, wallet matches and findings; selection
color wins, then tag color, then wallet color. Value sizing uses
`1.6 + 0.9 * log10(1 + sats / 10000)`.

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
hover/select (`{ type, id }` plus pointer coordinates and modifiers), activity
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

Layout runs in `flowLayout.worker.ts`. `groupedFlowLayout.ts` places the
transaction skeleton first (topological X order for fresh components), then
terminal inputs and outputs in rounded groups on opposite sides, sized by
member radii; up to eight members use balanced singleton/pair/ring footprints,
larger sides use collision-aware packing lifted onto a rounded shell. Shared
outpoints are single nodes bridging transactions. Incremental placement keeps
every cached coordinate exact, leaves a new branch along the clicked outpoint's
outward ray with at least one group radius of clearance, and never reserves
space for undisplayed siblings. Remaining associations use a stopped
`d3-force-3d` simulation anchored to grouped positions. Only visible nodes
affect spacing. **Repack** rebuilds the visible layout. A newer topology request
terminates obsolete worker work; views with cached positions restore without
simulation; worker failure keeps the scene and offers Retry. Flat mode keeps a
planar footprint.

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

## Wallet workbench

`walletReview.ts` derives one wallet's queue from loaded observations and an
optional verified UTXO check, in a fixed reason order: current UTXOs, used
addresses, receipts, source addresses, refresh activity, counterparties, then
active findings over verified wallet outputs. Counterparties come only from
transactions the wallet funded through loaded prevouts. Counts are bounded per
reason and coverage reports unloaded sources instead of filling them in.

Encrypted `walletReviews` maps `walletId|reason|subject` to `reviewed`,
`unknown` (legacy) or `later`, a timestamp and an evidence fingerprint. Refresh
keeps decisions; only a changed fingerprint re-queues an item, with its earlier
date. Address items key on the verified derivation slot so new receipts do not
undo a recorded purpose. Annotation edits never complete or change an item.
Removing a wallet prunes its decisions.

`walletRelationships.ts` projects one-hop counterparties: inputs funding
transactions that paid verified wallet scripts, and outputs of transactions
spending verified wallet outputs, grouped by canonical address and excluding the
wallet's own. Raw script hex is authoritative; histories alone never prove
direction or ownership. `useWalletCounterparties` resolves missing inputs in
bounded batches with explicit continuation. `walletSelectionIndex.ts` builds
per-snapshot indexes of scripts, outputs, spends and prevouts so row selection
does not rescan; `walletWorkbenchRows.ts` is the shared row contract for all six
tabs, and `walletReviewCategories.ts` defines finding categories with OR
semantics and pre-filter counts. Wallet **Analyze** reuses the Analysis registry
and merge path; it is distinct from history refresh.

Each unlocked session owns a `WalletPreparationCache` in
`src/App/Workspace/Workbenches/Wallet/walletPreparation.ts`. It shares one transaction index and script decoder
per current network/transaction snapshot and retains relationships and prepared
review items per wallet. Immutable source references invalidate only dependent
results; camera and workbench changes do not. Initial review and latest UTXO-check
variants are retained separately so returning to a wallet never presents an old
UTXO check as current. Warm returns bypass the preparation placeholder. These
results are not serialized, and successful locking disposes them; save failure
leaves the unlocked session and its preparation intact. The cache does not keep
separate wallet components mounted for every workspace or run analysis in the background.

## Analysis

`analysisTools` in `src/Domain/Analysis/analysis.ts` is the extension point. A tool
declares metadata, evidence category, source reference and typed parameters;
`analyze(workspace, transactionIds?, options)` returns findings, scope,
summary, coverage and a no-match explanation. Findings carry a stable identity,
algorithm version, explanation, affected nodes and supporting transactions.
Tools are pure and make no requests. `analysisScan.ts` resolves the selected
transaction, output, address or wallet (or the whole workspace) into loaded
transaction IDs and runs the registry with independent reports and cancellation
between tools. Exclusions survive reruns only with matching evidence; wallet
or transaction mutations mark findings stale. Only active, non-stale findings
color the graph, using the last active finding per node. See
[analysis-heuristics.md](analysis-heuristics.md).

The workbench mode (`wallet`, `graph`, `analysis`) is an encrypted view field.
Graph stays mounted while hidden so its adapter, camera and layout survive.
Analysis controls and reports live in a Workspace-owned map pruned on lock or close.
Handoffs (Show, Isolate, Back) record an origin and promote compact context
before selecting; if an outpoint has no loaded creator, navigation opens a
supporting transaction and says so rather than fetching.

## Connection scans

`src/Domain/ConnectionScan/connectionScan.ts` runs in `src/App/Workspace/Workbenches/Graph/ConnectionScan/connectionScan.worker.ts`. Automatic
scopes (`connectionScanNeighbours.ts`: breadth-first over loaded
creates/spends links, up to 1,000 nearest nodes; visible; all added) and custom
picks (`connectionScanTargets.ts`: exactly the picked transaction/outpoint IDs,
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

`connectionScanRecords.ts` upserts runs in stable order and deduplicates paths
across runs by source, kind, endpoint, meeting point and directed path
(reconnections by undirected edge union). The encrypted collection is bounded
to 20 runs, 50 results each, 200 extra path transactions and 2 MiB; hitting a
bound rejects the write instead of evicting. Frontier and transport state never
enter the schema. `connectionScanAddition.ts` plans Add and Add prefix as one
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

**Tags and wallet matches.** `tags.ts` indexes tag membership (canonical
transaction/output/address references, address members projecting onto loaded
outputs) and wallet-script matches (raw script over decoded address;
transactions associated through matching outputs or loaded prevouts, never a
heuristic). Both are presentation inputs and do not touch annotations.

**Transaction inspection.** `TransactionView` projects creating/spending
relationships through `transactionInspection.ts`. `ScriptInspector` decodes
saved scripts to opcodes; `src/App/Workspace/Inspector/transactionInspection.ts` fetches raw bytes on
demand, verifies them against the ID and loaded observations with bitcoinjs,
and keeps them in component memory only. Sources are in
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

**Guided tour.** `src/App/Help/steps.ts` lists steps with stable IDs,
copy, target selectors, fallbacks and optional `when` predicates; order is the
array order. `GuidedTour.tsx` overlays a measured spotlight and never launches
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

Release verification adds `npm run test:production`: HTTP checks of built
assets, CSP and security headers and network discovery, then a narrow browser
run of the bundled encryption worker under production CSP, a WebGL context, and
encrypted save/reload/unlock/export of a synthetic workspace. `npm run test:e2e`
is a deliberately small smoke suite (the app renders, a workspace opens and
shows its graph).

None of this establishes visual usability, live upstream health, complete
wallet coverage or mobile performance. Those need explicitly scoped browser QA
and read-only checks against real services (`npm run test:live`).
