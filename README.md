# Chaingraph

A self-hosted Bitcoin analysis workbench for personal wallets and on-chain investigations. Explore transactions and outputs in an interactive 3D graph, follow funding and spending paths, annotate what you find, and compare tentative ownership hypotheses. Workspaces and wallet data live in your browser. Returning-wallet refresh keeps new activity visible until reviewed, without disrupting labels or the current graph selection.

Version 0.2.0 includes multiple encrypted workspaces and watch-only wallets, browser-side receive/change scanning, labels, notes, a searchable icon palette, bookmarks, and BIP329 label exchange. Workspace tags group counterparties independently from labels and notes, while separate wallet-match highlights identify derived addresses and their loaded outputs. Seven analysis tools cover equal outputs, common-input ownership, address reuse, value flow and fees, consolidation and fan-out, script types, and imported-wallet intersections. Each tool exposes its scope, parameters, assumptions and coverage.

Filter the graph by entity type, labels, tags, wallet membership, notes, bookmarks, value and loaded funding/spending evidence. The floating **Filters** popover collects those controls, and removable chips show every active filter beside a **Reset filters** action. Follow a selection's neighborhood, navigate selection history, isolate findings, or use a paginated entity list. Select several entities and apply a label, tag or icon to exactly that set. Wallet and Graph share quick editors with searchable tags, explicit color choices, and responsive rows for long names. Batch labels and icons preserve existing values unless replacement is enabled. Nine example workspaces offer real transactions across six mainnet and three testnet4 cases with starter labels, tags, icons and bookmarks. Only examples for networks configured on your backend are shown.

![Compact main workbench with public testnet4 transaction tracing and floating navigation](docs/screenshots/compact-main-desktop.png)

## Docker and Compose

```sh
mkdir -p config
cp -n .env.example config/.env.testnet4
chmod 750 config
chmod 640 config/.env.testnet4
sudo chgrp 1000 config config/.env.testnet4
# Set testnet4 upstreams reachable from the container; add .env.mainnet for mainnet.
docker compose --env-file /dev/null up --build -d
```

Open **http://127.0.0.1:3000**. The container runs without root privileges and Compose restricts the published port to loopback. See [deployment and release instructions](docs/deployment.md) for HTTPS, private CAs, cookie authentication, backups and the GitHub container release workflow. No GitHub repository or published image is assumed yet.

## Run locally

Use Node.js 24 or newer and npm. One backend can serve **mainnet, testnet4, or both simultaneously**, using an isolated Bitcoin Core/Fulcrum pair for each configured network.

```sh
npm ci
cp -n .env.example .env.testnet4
chmod 600 .env.testnet4
# Set testnet4 upstream connection details. Add .env.mainnet for mainnet support.
npm run dev
```

Open **http://127.0.0.1:3001**. The development launcher reads the configured backend port and proxies API calls to it; the browser UI stays on port 3001. Vite receives no upstream credentials. Example workspaces use bundled chain snapshots and need no initial transaction downloads. Network discovery requires the backend; live lookups need both upstream services.

The backend discovers `.env.mainnet` and `.env.testnet4` in the working directory, or in `CHAINGRAPH_NETWORK_CONFIG_DIR` when set. At least one valid file is required. Each file is parsed independently, and its filename selects its network; upstream credentials are never merged into the process environment. `.env` and `.env.live` are not loaded. `dev:live` and `start:live` are aliases for the same discovery-based launchers. RPC accepts either a user/password pair or a cookie file, as shown in [.env.example](.env.example).

The frontend discovers configured networks before creating a workspace and routes every lookup through that workspace’s network. A disconnected upstream does not remove its configured network or disable another pair. Importing or unlocking a workspace for an unconfigured network still opens its saved data for offline inspection and editing. A clear backend-network error explains why live queries are disabled.

To serve the built application from one local origin:

```sh
npm run build
npm start
# Or: npm run start:live
```

Open **http://127.0.0.1:3000** (or the port configured by `SERVER_PORT`). `npm start` serves `dist/` and the API; rebuild after frontend changes. The TypeScript backend runs through `tsx`, so retain the project's installed dependencies.

All launch scripts enable Node's system CA store (`--use-system-ca`), including
npm lifecycle tools through `.npmrc`. Certificates trusted by the operating system
remain verified. A separate private CA can be supplied with `NODE_EXTRA_CA_CERTS`;
TLS certificate and hostname checks are never disabled.

## Data and trust

The backend is a bounded, read-only RPC/Electrum proxy. It stores no workspaces, wallet indexes, labels, or chain-data cache. Address derivation, scan orchestration, analysis, and encryption run in the browser. The proxy and upstreams still see the requested script hashes and transaction IDs.

Workspace names are public so locked workspaces remain identifiable. Optional descriptions, wallets, graph data, and annotations are encrypted before browser persistence and encrypted-file export, using AES-256-GCM and PBKDF2-SHA256. Workspace passwords stay in the unlocked browser session; there is no password recovery. Small encrypted saves use localStorage; larger saves use IndexedDB with a compact public index. Browser storage is origin-specific and subject to quota and deletion, so keep exported backups. **BIP329 label exports are plaintext** and can contain extended public keys. See [the user workflow](instructions.md) for the distinction.

This is a trusted, single-user, fully self-hosted application. The backend has **no user authentication** and binds to loopback by default. Public or shared hosting is unsupported. Browser-origin checks and upstream request limits do not provide a user authorization system. Workspace encryption protects saved data, not an unlocked session or untrusted code served to the browser. Web Crypto requires localhost or HTTPS.

Workspace creation shows the eight-character password minimum before submission.
Use the eye buttons to reveal or hide passwords while entering them. Validation
appears inside the dialog. Reloading locks workspaces because Chaingraph never
stores the password; reopen a saved workspace to unlock it. The header **Export workspace**
button saves an encrypted workspace backup; **Export BIP329 labels · plaintext**
in the workspace menu saves unencrypted labels.

## Current boundaries

- Wallet import accepts account-level public keys at depth 3: `xpub`/`ypub`/`zpub` on mainnet and `tpub`/`upub`/`vpub` on testnet4. Supported single-key scripts are legacy P2PKH, nested SegWit, native SegWit, and BIP86 Taproot. Descriptors, multisig, private keys, signing, and spending are unsupported.
- Loaded transactions are a **history snapshot**. Status polling does not refresh every saved confirmation count or detect every reorganization. Scans have address, history, and transaction bounds; a partial result is not proof that no further activity exists.
- CIOH produces a hypothesis. Skipping conspicuous equal-output transactions does not detect all collaborative spends or PayJoin. No tool identifies a person or proves wallet ownership.
- Transactions use cubes, outputs use spheres, and optional addresses use diamonds. Hover a node for details and compact tracing/editing actions; connection lines do not open hover cards. The lookup toolbar defaults to Previous Off, with 1 and 2 levels available, bounded to 500 downloads per action. Loaded spending transactions can carry validated previous-output values and scripts without loading or displaying every creating transaction. Selecting an input still loads only its creating transaction when needed. Use **Load missing input details** in the flow panel for a bounded batch when enriched details are unavailable. Automatically fetched parents initially show only relevant outputs in the graph, keeping unrelated branches out of the current view. Workspaces share the main header; Help and samples holds the tour, examples and About. Graph navigation floats over the canvas. The Flat graph layout still requires WebGL; the transaction inputs/outputs panel does not. The entity list provides a keyboard-friendly inspection path. Individual node dragging is disabled because of an upstream pointer-handling issue; camera orbit, pan, zoom, and node selection remain available.
- Tools are extensible through [`src/domain/analysis.ts`](src/domain/analysis.ts). There is no custom-script IDE, Boltzmann implementation, service worker, or WebSocket live feed in this version. Boltzmann-related research and license compatibility remain research work.

The guided tour has a floating **Tour contents** navigator with ten workflow topics. Jump directly to wallet refresh, transaction flow, annotations, tags or other controls. Panel previews are temporary; closing the tour returns to your original layout and selection. Restart it from Help.

Choose an example on the welcome screen or under **Help and samples → Example workspaces**. The usual creation dialog prefills an editable public name and encrypted description; the example fixes the network. Set a password to create an independent, autosaved workspace. The desktop gallery has two rows of mainnet examples and a third testnet4 row, separated by a fine rule; smaller screens use fewer columns. Explore a Whirlpool example, a large WabiSabi CoinJoin, a public xpub wallet, a large-value split, batched outputs and an OP_RETURN message on mainnet. Follow exact spending links, compare a 53-output fan-out or explore a mixed-script spending path on testnet4. The wallet case uses a deliberately published BIP84 test zpub; never deposit funds to its addresses. Its preloaded scan is incomplete and can be continued through your backend. Labels, tags, icons and bookmarks are editable. Snapshots include the starting transaction's direct input data; trace further or refresh through your backend. Confirmation counts describe the snapshot, and missing spending data does not establish current UTXO status.

See [template sources and verification](docs/research/workspace-templates.md). Examples are real chain observations, not attributed wallets or proof of ownership. The former synthetic laboratory is no longer offered; existing saved synthetic workspaces remain readable with live lookups disabled.

This branch enables three compact workbenches: **Wallet**, **Graph** and **Analysis**. Graph retains the accepted renderer, Inspector, wallet tabs and transaction flow. Analysis runs all applicable registry tools in one loaded-data scan using **Selection (Wallet/Transaction/Output/Address)** or **Loaded workspace** scope, with individual links to affected outputs, addresses and supporting transactions. Show on graph reveals a selection; explicit isolation exposes a resettable filter. **Isolate selection**, beside **Lock to selection**, follows the current selection with the same one- or two-hop filter as **Paths**. Turning it off or resetting filters preserves manual hiding. The Trace workbench is disabled for now; saved Trace mode opens Graph. Its source remains available for later work. Shared annotations remain encrypted. See [the workflow](instructions.md#run-analysis) and [proposal validation](docs/experiments/simple-workbenches.md).

### Review a wallet (experimental)

**Wallet** works on one imported wallet at a time and reuses the existing import,
scan and record code. A switcher moves between wallets; **Add wallet** imports
another one. The pencil beside a wallet name, here or in the Graph sidebar, opens
a name-only editor. Names autosave encrypted; the read-only public key stays masked
until explicitly shown. Derivation settings and existing data are unchanged.
The coverage strip states
the last check, partial discovery, used and discovered addresses, loaded versus
known transactions, and the current UTXO count and balance from a verified check.
There is no completeness percentage; when no UTXO check has run, the workbench
says so and offers the action.

Row navigation reuses a browser-memory index of loaded transactions and wallet
scripts, avoiding repeated history scans when selecting records in larger wallets.
Newly loaded evidence refreshes the index automatically.

**To review** starts with current UTXOs and used wallet addresses, followed by
earlier receipts, source addresses, refreshed activity, destination addresses and
findings from your last analysis scan. Each
item explains its reason and shows its evidence. Review filters include counts;
larger lists offer an explicit Show more action. The compact transaction flow
separates verified wallet-script matches from **No wallet match** and unknown
prevouts. Unmatched scripts may be undiscovered wallet addresses; transaction
links do not prove who controls an output or exactly which input funded it.
The side toolbar orders **Label, Tags, Icon**, review actions, **Select related**,
then **Show** and **Isolate**. Show switches to Graph and frames the selection;
Isolate also applies the existing resettable graph isolation. A collapsible flow
follows, then common information and visible lists of related transactions and
outpoints. Its cards are not navigation
targets: use a card's magnifier to **Show on graph**, reveal and frame that transaction or outpoint,
even with selection lock off. **Back to Wallet** returns to the same invoker.
Choose **Mark reviewed** or **Review later**. Previously saved **Source unknown**
decisions remain completed and appear under Reviewed; new decisions use the two
explicit actions. Review later
advances to the next item and sets the deferred item aside in **Show → Review later**;
it remains pending, but is excluded from **To review**. Reopen returns it to To review.
Labels, notes, tags and icons stay visible in the list and details. Adding metadata
does not complete a review or remove an item. Decisions are stored inside the encrypted workspace, so a
refresh keeps them. Only an item whose underlying observations actually changed is
flagged for another look, with the date of your earlier decision. A scan never
resets the queue.

A short sentence under the actions explains why each item is here and what to do
next. Used wallet addresses can be labelled by purpose; unused gap-discovery
addresses are not added to the queue. Source and destination guidance asks for a
sender, exchange, shop or recipient the user recognizes, not an inferred identity.
Individual counterparty outputs are no longer offered as new review tasks.
Compatible older output decisions remain as history under **Previous output decisions**,
not as new work to complete.

One Wallet navigation row offers **To review**, **UTXOs**, **Transactions**,
**Addresses**, **Sources** and **Destinations**. All six tabs use the same selectable
list and detail panel, with direct single-entity label, tag and icon editing.
Identifiers and tags stay visible. Address flow contexts with several verified
loaded transactions require an explicit transaction choice.

**Finding types** in To review is a multi-select, including zero-count categories.
Selected types match by union (OR); counts overlap and are computed before the
type filter, after the other filters. Missing labels, missing tags and neither
are distinct conditions. Clear types selects none; Reset to all types restores
the full catalog. Heuristic categories describe existing scan results, not a new
or automatically run scan. Definitions appear on hover, keyboard focus or a touch tap.

Sources and Destinations group one-hop observations by **address**. Sources are
funding addresses of transactions paying verified wallet scripts; Destinations
are addresses paid by transactions spending verified wallet outputs. Both lists
exclude addresses matching the currently selected wallet. Labels,
tags and icons edit the address, while constituent outpoints and transaction
contexts remain visible records. Missing inputs are resolved in bounded background
batches on opening Sources, with explicit continuation and retry. Unresolved
outpoints and non-address scripts are not shown as counterparty addresses.
No-match scripts are possible counterparties, not
identified owners; names such as an exchange or shop are user annotations.
An address review does not silently acknowledge its individual outputs or another
direction's review. Compatible earlier output decisions remain stored.

**Scan** runs the existing supported analysis on loaded wallet data, separately
from **Refresh**, which checks new chain activity. Opening a flow lazily loads only a bounded set of relevant visible
previous transactions, with cancellation and retry. Cached observations do not
trigger another request or discard Undo; genuinely new evidence follows the
existing invalidation rules. Status distinguishes queued history, address search
limits, unfinished UTXO checks and unavailable inputs rather than labelling
everything partial. No deep scan or backend index is involved.

Filters cover text, labelled or unlabelled, To review, Review later, Reviewed,
tag state, plus visible counts.
Tick rows, Ctrl/⌘ click to toggle, Shift click to select a displayed range, or use
**Select all (N)**. This replaces the selection with the current filtered
results, including rows under Show more. It becomes **Unselect all (N)**, which
clears those matching rows while retaining selections outside the filter.
**Select related** offers exact address
and creating-transaction matches within those same results, with counts shown
before selection. Same transaction can include both wallet outputs and possible
counterparties; it is not an ownership grouping. Batch details replace the single
detail in the same right-side footprint; the list never grows wider. This panel
shows unique targets and hidden-selection warnings beside label, tag and icon
actions. Review queue checkboxes offer the same batch
controls, plus marking the selected items reviewed or deferring them together.
A single item's label editor starts with its current label and replaces it when applied.
Existing labels and icons are preserved unless you tick Replace, and
the number of records that will change is shown first. Each batch is one autosaved
step that a single Undo reverses. Filtering never widens a selection, and switching
wallet or tab clears it.

Review items and rows carry **Show** and **Isolate**; Graph offers **Back to Wallet**.
Shortened addresses and outpoints expose the full value on hover and have a copy control.
When the selected outputs carry
different recorded sources, one sentence notes that combining them in an ordinary
spend would publish that link. This is experimental local behaviour, not a release
claim: there is no spend composer, coin selection, fee estimate, PSBT, signing,
broadcast, exchange integration or privacy score. Grouping items are heuristic
hypotheses with evidence, never proof of common ownership, and a personal label on
a payment never claims who controls an address. See
[proposal and limits](docs/experiments/wallet-review.md) and
[sources](docs/research/2026-09-09-wallet-review.md).

## Renderer experiment

This isolated branch uses a purpose-built Three.js adapter with a compact, static
force layout. Only additions are simulated when extending an investigation; saved
nodes remain anchored. The floating toolbar brings Fit, zoom and an explicit
Repack action beside selection history, selection lock and the existing path
filter. Repack rearranges visible nodes, including older saved layouts. There is
no layout picker. Filters and hidden-selection status sit below the controls.
The rest of the workbench remains shared.
See the [scope, review and limitations](docs/experiments/flow-renderer-v2.md).

## Development

See [CONTRIBUTING.md](CONTRIBUTING.md) for isolated worktrees, configurable browser-test ports, frontend-only previews and review expectations. Security reporting and deployment boundaries are in [SECURITY.md](SECURITY.md).

```sh
npm run build     # TypeScript check and frontend build
npm test          # Unit and integration tests
npm run test:e2e  # Browser tests; requires Playwright Chromium
npm run check    # Build and unit/integration tests
npm run test:live # Read-only smoke for configured network pairs
npm run test:production # Browser smoke against built server on port 4300
```

Use `npx playwright install chromium` if the browser required by the installed Playwright version is missing. Test commands are separate from claims about a live node or mobile performance.

See [verified results and limits](docs/validation.md) for automated, live mainnet/testnet4, and production-browser evidence.

The dependency license notices are retained in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md); regenerate them with `npm run licenses` after dependency updates.

The [review records](docs/reviews/2026-09-08-response.md) and [validation report](docs/validation.md) distinguish implemented features, tested behavior and release limitations.

Read [architecture and extension points](docs/architecture.md), [user instructions](instructions.md), and the [research log](docs/research/2026-09-08-discovery.md). Research notes credit upstream specifications, papers, and libraries; third-party code retains its own license. Chaingraph is MIT-licensed.

## Transaction and script inspection

Transaction rows show input/output counts and a compact confirmation status. Block heights
come from recorded chain observations. **Unconfirmed** means a mempool observation was
loaded; missing information stays **Status unknown**. Refresh to check the current state.

Select a transaction or output to open the collapsible inputs/outputs view above the graph. Selecting an input follows its previous output while retaining the transaction being examined. For a selected output, the transaction chooser includes its creating transaction and all loaded spending transactions. Large lists start collapsed, with expand/collapse controls above the rows and the selected row kept visible. A loaded spend can show a previous output's value, address, and script before its creating transaction is loaded. Selecting an input still loads only its creating transaction when missing. Use **Load missing input details** for a bounded batch when attached evidence is unavailable, with explicit retry or continuation for partial results. Click the central transaction block to select it, or use its label, tag and icon controls to edit it. Historical previous-output content is not current unspent status, and missing spending data does not prove an output is unspent.

Following an input inside a compact parent exposes its input placeholders without
downloading every previous transaction. If the selected input's creator cannot be
loaded, the input stays selected, the displayed transaction remains open, and the
flow shows an error with **Retry previous outputs**.

The Inspector’s **Scripts and raw transaction** section shows saved output script hex and normalized opcodes. **Load raw transaction** explicitly fetches and verifies serialized bytes for scriptSig, witness, version, locktime and size inspection. Raw data stays in memory only for that inspected selection. Script decoding does not execute scripts or verify signatures. See [inspection research and limits](docs/research/transaction-inspection.md).

Edits to labels, notes, icons, bookmarks, tags and workspace details save automatically.
The status bar confirms when the encrypted copy has reached browser storage; locking
flushes pending edits first. Graph camera/layout, filters, selection and transaction-flow
expansion are encrypted and restored when reopening. Export remains an explicit action
for keeping a portable backup. Camera snapshots wait until navigation is idle; workspace
validation and encryption run in a browser worker. Locking, exporting or switching
workspaces captures the latest view first.

The compact transaction flow places inputs and outputs around the current transaction.
Select an output to see adjacent creating/spending transactions and use its arrows to
follow the exact outpoint. Selection resolves only the chosen outpoint; explicit navigation opens its creating transaction. Other input details load through the explicit bulk control.
OP_RETURN outputs show decoded text when possible, with a short preview and expandable,
selectable, copyable full data. Binary data stays hex; script decoding never executes it.
Tags can be searched, created and assigned from **Add or choose tags** in the inspector.

Graph hover cards wrap long annotations and metadata within the graph viewport.
Identifiers use the shared seven-character ends, with the complete outpoint index;
hover the title or identifier for its full value. Close stays above the wrapping action row.

**Lock to selection** keeps the graph centered as you select items anywhere in the
workbench. Graph controls independently show or hide labels, tags and icons. On
desktop, **Hide panels** sits beside the 3D/Flat toggle and temporarily hides the
side panels; it is hidden on mobile, where panels already have separate views.

### Filters, multiple selection and batch metadata

The floating **Filters** popover holds the shared filter set: entity type, labels,
tags, wallet membership, satoshi bounds, loaded spend and funding evidence,
bookmarks and connected context. **More filters** in **Entities** opens the same
controls. Active filters appear as removable chips under the graph navigation,
with **Reset filters** clearing all of them. Manual hiding is separate: its own
chip counts manually hidden entities and restores them, and **Reset filters**
never unhides anything. Isolation appears as its own **Isolated N entities** chip.
Wallet membership comes from derived addresses; it is not proof of ownership, and
a missing loaded spend still means unknown rather than unspent. The canvas amount
threshold and the transaction flow threshold stay independent.

**Select** in the graph navigation or in **Entities** turns on selection mode,
which adds checkboxes to entity rows and transaction flow rows. Ctrl or Cmd click
toggles an entity on the canvas, in the list and in the flow; a plain click still
inspects and navigates. The floating selection toolbar reports the count, how many
selected entities are not on the canvas, and offers **Select N matching …** for the
current filter scope. Select matching excludes connected context, while a context
entity you select explicitly stays a batch target, and results changing never
grows a selection. Selections are cleared when you
switch workspaces and pruned only when an entity is actually removed.

Label, Tags and Icon share the Wallet quick editors. Batch labels and icons keep
existing values unless you enable replacement. The label editor shows its target
count and single-item editing starts with the current label. Tag rows show full
names, colors and direct membership counts; choose a color before **Create and
assign**. Existing-tag Add/Remove keeps the popup open. Each applied batch saves
automatically and is one Undo step, available from the toolbar or the header.

Choose **Entities → Match graph** to keep the list aligned with the filtered
canvas. The existing visibility modes remain available to recover hidden and
amount-filtered observations. Workspace-name suggestions select automatically
so typing replaces the default.

Use the eye buttons in **Entities**, the Inspector or graph cards to hide individual
entities without losing their annotations. **Hidden** lists them for quick restoration;
**Show all hidden** restores manual visibility. Transactions and explicitly watched
addresses also offer removal. Removing annotated or tagged data asks for confirmation,
and Undo restores a removal. Stopping an address watch retains shared transaction data.
Individual inputs and outputs can be hidden, while complete transaction records stay intact.

**All amounts** in the graph toolbar and transaction flow controls each view
independently. Both preferences are saved; the flow control hides when its panel
is collapsed. Choose a satoshi threshold to show amounts strictly greater than it; the
selected output and unknown values remain visible. Isolated transaction/address
nodes and prefetched branches cut off by the amount filter are omitted from the
canvas; their data stays in the workspace. The flow reports omitted rows
and offers **Show** to restore them. The entity list stays available for selecting
filtered outputs. **Size by Value** uses a bounded square-root curve so small
outputs remain selectable while large transfers stand out. Sizes stay stable
when filtering or adding data.

The Inspector offers **Check current UTXO status** for outputs. It queries Core
with mempool spends included and shows a timestamped, temporary observation.
A missing UTXO result is not treated as proof of spending.

Successful transaction, output and address lookups focus their target even with
Lock to selection off. **Load previous** distinguishes new downloads from expanding
already cached input context. Removing a transaction also removes its unused input
context, including previously expanded context. Shared, independently
added, annotated and wallet-related context is retained. Older saved workspaces
without ancestry provenance are handled conservatively.

Flow arrows are visible on every transaction/output connection. Connections touching
the selected entity use larger arrows and thicker highlighted lines. Address
associations remain undirected.

### Browse a wallet

Select a wallet to reveal **Addresses**, **Transactions** and **UTXOs** beside the Inspector.
Transactions includes known history, newest first, including entries whose details
are not loaded yet. Select a row to load it if needed and focus it on the graph,
then switch to Inspector to edit labels, notes, tags or icons. The wallet context
and list remain available.

UTXOs checks already discovered addresses through your backend, including mempool
activity. Results carry a check time and explicit coverage; partial scans or failed
addresses never imply an empty wallet. Refresh to recheck, or check the next batch
for larger address sets. These observations are temporary and do not delete saved
transactions when an output is spent. The old discovered-address list has been
removed from the wallet inspector.

Wallet **Addresses** lists discovered receive and change addresses with their derivation
index and the number of outputs in loaded transactions. Counts include spent outputs
and are not a complete history or current UTXO count. Filter by address, label or
derivation path. Select a row to show the address on the graph, then use Inspector
to edit its metadata. Addresses with no loaded outputs remain selectable; opening
this list does not scan or download transaction history.
