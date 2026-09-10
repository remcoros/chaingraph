# Using Chaingraph

Chaingraph helps you investigate Bitcoin activity and keep your own observations alongside the graph. It is watch-only: you can import public wallet information, inspect transactions, and organize hypotheses without supplying a seed phrase or private key.

## Start a workspace

Create a workspace and give it a **Name (public)** and password. The suggested name is selected automatically, including when clicked, so typing replaces it. Once edited, the name behaves like a normal text field. Its network is shown automatically when the backend supports one network; choose mainnet or testnet4 when both are configured. The name remains visible while locked. An optional description stays encrypted and appears only while unlocked. Use **Workspace menu → Workspace details** to edit either field. Existing saved workspaces show their public name after being unlocked and saved once. Use a long, unique passphrase. Your password cannot be recovered. One backend can connect to both networks at once. Every lookup uses the selected workspace's matching Core/Fulcrum pair, so switching workspaces never redirects an in-flight request to another chain. Creation lists configured networks even when their upstreams are temporarily offline; a connection is needed for live lookups.

You can open several workspaces and switch between their tabs in the main header. The tab strip scrolls horizontally when needed. Each workspace has its own transactions, wallets, annotations, analysis results, and view settings. Open workspace tabs do not show a locked icon; locked copies are listed on the Workspaces screen. An unsaved indicator means the current changes have not yet reached encrypted browser storage. Autosave runs shortly after edits; heed a storage-error message and export a file if browser storage is full or unavailable.

For a first look without loading your own wallet, choose an example on the welcome screen or **Help and samples → Example workspaces**. Each contains real transactions with starter labels, tags, icons and bookmarks. Only networks configured on your backend appear. Choosing one opens **Create a workspace** with an editable name and description and a fixed network. Set a password to create your own encrypted copy, then explore, edit and autosave it like any other workspace. No initial chain download is needed.

Use Ctrl/Cmd+K to focus the quick input. Changes save automatically; Ctrl/Cmd+S also finishes any pending encrypted save. The first-use guided tour covers workspaces, wallet refresh, adding chain data, the 3D graph, transaction flow, labels, tags, filters, bookmarks and encrypted backups. **Tour contents** opens a topic index so you can jump in any order; **Back** and **Next** move through the topics. Skip or press Escape at any time, then restart from **Help and samples → Show guided tour**. The tour previews the relevant panels and returns to your previous layout when closed. It does not select entities or start scans. Open an example workspace first to see the flow and annotation controls with real data.

Workspace creation shows the eight-character password minimum before submission.
Use the eye buttons to reveal or hide passwords while entering them. Validation
appears inside the dialog. Reloading locks workspaces because Chaingraph never
stores the password; reopen a saved workspace to unlock it. The header **Export workspace**
button saves an encrypted workspace backup; **Export BIP329 labels · plaintext**
in the workspace menu saves unencrypted labels.

## Find activity

Use the quick input in the center of the workbench bar to load a transaction ID, an address, or an output reference written as `transaction-id:output-index`. Undo and export sit on the right. On narrow screens, the input wraps below the workbench tabs. Adding an existing entity selects, reveals and centers it immediately, including while offline. Any requested ancestry or address-history loading can continue once the entity is in view. Select an item in the graph or entity list to inspect its details and available actions.

**Load previous transactions**, on a selected transaction, adds one earlier level. For an output, **Open creating transaction** opens only the transaction that created that outpoint, loading it if needed. Use the transaction-level action to follow its inputs further. A coinbase transaction has no earlier inputs.

You can select inputs again after following a previous transaction, including a
large CoinJoin. This exposes that transaction's input placeholders and fetches
only the selected input's creator. If loading fails, the clicked input stays
selected and the displayed transaction remains open. The flow shows the failure
and **Retry previous outputs** retries the lookup without adding the root again.

For an output's current availability, use the refresh icon in the Inspector's top bar
(**Check current UTXO status**). This queries Core with mempool spends included and
timestamps the result. The notification can be dismissed and hides after eight seconds;
the last successful observation remains under **Chain evidence** for the current selection.
A positive result means **Unspent at check**. **Not in current UTXO set** does not
by itself prove a spend, since an output may also belong to a transaction outside
the active chain. Checks stay in memory for the current selection and can be
repeated. Loaded spending links and tracing actions remain available independently.

**Find spending transactions** checks for transactions consuming the selected output, or any output of a selected transaction. By default it searches script histories. An operator can enable optional Core 31 exact-output lookup with `CHAINGRAPH_USE_TXOSPENDERINDEX=true` for that network; unavailable or incomplete lookups use bounded history fallback. It checks exact outpoint references. Successful lookups add or reuse spending transactions without a popup. Incomplete searches explain how to retry or continue. If no spender is found for one output, the app checks Core's current UTXO set, including the node's mempool, and reports whether the output is unspent at that check, absent, or could not be checked. An absent output does not identify its spender. Each action checks at most 500 candidate transactions across exact lookup and history fallback; repeat the action when prompted to continue. Failed history or transaction reads keep the result partial and require a retry before continuation. This continuation is temporary and resets when switching workspaces. Changed histories can shift a batch boundary; this is a bounded investigation, not a completeness guarantee. Missing spend links never prove an output is unspent.

Use the selector beside the quick input to choose **Previous: off**, **Previous: 1**, or **Previous: 2** when adding a transaction or output. It starts at **Previous: off**, and retains this context on narrow screens. The two levels share a 500-transaction download limit and reuse loaded transactions. Large or unavailable branches produce a partial-result message. Trace individual paths to continue. Address and wallet scans keep their own bounds. A loaded spend can already include validated value and script details for its inputs without loading the complete parent transactions. Selecting an input or output still loads only the transaction that created that outpoint, even with Previous Off. The input arrow and **Open creating transaction** open just that transaction. **Load missing input details** explicitly loads parents only where those attached details are unavailable or conflicting. These input parents initially contribute only relevant outputs to the graph; select or navigate to a parent to open its wider transaction context. Explicit input loading uses four concurrent requests and a 500-parent batch, with a visible retry or continuation when needed.

The gallery offers six mainnet and three testnet4 examples. On desktop, the top two rows contain mainnet cases, with a thin divider before the testnet4 row; narrow screens use fewer columns. Mainnet cases cover equal outputs with a spending hop (Whirlpool), a large WabiSabi CoinJoin, a public xpub wallet, an OP_RETURN message, a large-value split and batched outputs. Testnet4 cases cover a known spent-output path, a 53-output fan-out and a mixed-script spending path. Start with a bookmark and follow its notes for suggested comparisons and navigation. The wallet example includes an intentionally public BIP84 test zpub, derived addresses and real activity. Never deposit funds to its addresses. Wallets shows the bounded scan and remaining transactions, with controls to continue through your backend. The starting transaction's direct input data is included. **Refresh transaction**, **Load previous transactions** and **Find spending transactions** use your backend to extend or update these snapshots. Confirmation counts are historical; a missing spender does not prove an output is currently unspent. Explorer references are optional external links. Starter labels describe observations, not wallet ownership. See [sources and verification](docs/research/workspace-templates.md).

New examples open with inputs, outputs and relevant transaction paths already visible. Small transactions show all inputs and outputs; dense examples start with a selection of up to 20 per side, including annotated comparison points. The remaining data is loaded: use the graph's input/output controls to show more. Existing saved copies keep your chosen graph view.

Older saved synthetic laboratory workspaces remain readable. Live lookups stay disabled for those artificial transaction IDs. Create a real example workspace to practice live tracing.

The graph represents transaction creation and consumption of outputs. An output can already be spent; the presence of an output node does not mean it is an available UTXO. Unknown funding outputs may appear before their parent transaction has been loaded. Address nodes are an optional additional view of script destinations, not proof of a common owner.

## Add personal wallets

Add one or more wallets to the workspace using an **account-level extended public key**. Chaingraph accepts depth-3 account keys and derives receive branch `0` and change branch `1` in your browser.

| Network  | Accepted encodings     |
| -------- | ---------------------- |
| Mainnet  | `xpub`, `ypub`, `zpub` |
| Testnet4 | `tpub`, `upub`, `vpub` |

Choose the wallet's actual address type: legacy P2PKH, nested SegWit P2SH-P2WPKH, native SegWit P2WPKH, or BIP86 Taproot. `ypub`/`upub` and `zpub`/`vpub` constrain that choice; `xpub`/`tpub` do not identify an address type. Account keys cannot prove their full parent derivation path, and testnet encodings alone cannot distinguish testnet4 from other test networks.

Preview the first receive address and compare it with your wallet before scanning. A mismatch usually means the wrong account key or script type. Master keys, descriptors, multisig wallets, private keys, and arbitrary derivation paths are not supported in this version.

Run a scan to query receive/change histories and load their transactions. Scanning happens in the browser through your backend; the extended public key is not sent as a wallet import to Bitcoin Core or Fulcrum. The queried script hashes and transaction IDs are visible to the backend and upstreams.

Scans use a gap of unused addresses, a maximum index, and a bounded number of transaction loads. Reaching a limit leaves an incomplete view. Scanning both branches does not prove that higher indexes, another account, or another script type have no activity. Cancel stops the current scan; do not treat a cancelled scan as complete.

## Navigate and annotate

Drag the background to orbit in 3D, pan with the camera controls, and scroll or pinch to zoom. Use the fit control to bring loaded activity back into view. Individual nodes cannot currently be dragged. Switch to 2D for a flat layout with rotation disabled; both views use WebGL. On smaller screens or without WebGL, use the entity list to select and inspect items.

Choose uniform sizing, value-based sizing, or degree-based sizing to emphasize different properties. Value sizing uses a fixed logarithmic radius, with a selectable minimum size and a clear contrast across common satoshi amounts. Degree describes the number of graph connections, not transaction importance or ownership confidence. Cluster colors and glow are visual aids. The **Show labels**, **Show tags**, and **Show icons** buttons independently control graph captions without deleting annotations.

Transactions are cubes, outputs are spheres, and optional addresses are diamonds. Hover a node for identifiers, values, available details, and compact actions at the top of its card. Connection lines do not open cards, reducing interruptions in dense graphs. **Load previous level** expands that path; **Edit label / notes** opens and focuses the inspector. The inspector and entity list provide the same tracing workflow without hover.

Select an item to add a label, note, icon, or bookmark in its inspector. The icon button opens a multi-row symbol palette with keyboard arrow navigation and a clear option. Labels record your observations; they do not change blockchain data. Use bookmarks to return to relevant items and undo to reverse recent workspace edits. Undo history is limited to the current session and is reset when new chain data is loaded, so undo cannot erase a later scan. Removing a transaction includes its annotations and asks for confirmation when user data is attached. Descendant inputs may still show output placeholders.

## Filter and navigate

Clicking a transaction, input or output adds only that chosen node to the graph.
Its complete transaction record stays available in the flow panel. The icons-only
right toolbar offers input/output Add, Hide and Remove actions, selection history,
centering and branch cleanup. Hover a control for its action name. **Remove
from graph** keeps evidence and annotations. Hiding or removing a transaction also
cleans up its inputs/outputs that have no remaining graph connections. Shared nodes
stay connected; batch actions evaluate all selected transactions together. **Hide**
is temporary and can be reversed with **Show all hidden**.
The right toolbar's creating/spending transaction actions preserve the camera, including
with Lock enabled. Use **Center** when you want to move to the newly added transaction.
New transactions extend beyond the clicked input/output group's outer boundary, with
clearance that grows with the group's radius. This gives large CoinJoins more room for
subsequent inputs/outputs while keeping small branches compact. Existing nodes stay in place.

In this experiment, the graph legend identifies the transaction used for input/output
context. Blue brackets mark its inputs; green rings mark its outputs. Following an
outpoint keeps the transaction chosen in the flow panel. Selecting another transaction
changes these accents without rearranging nodes. Inputs and outputs occupy compact,
rounded 3D groups on opposite sides of each transaction. Shared outpoints connect
transaction branches through those groups. New branches extend from the connected transaction through the chosen outpoint,
and newly added inputs and outputs follow that branch direction. Existing positions
stay fixed; opening a creator may leave its connecting outpoint inside an existing
group.
Spacing depends on visible nodes, so undisplayed siblings do not stretch the graph.
Use **Repack** to organize the visible branches together; it deliberately rearranges
the visible graph while retaining rounded 3D groups for terminal and shared outpoints. Orbiting changes the
screen direction, so use the markers and arrows to follow flow from any angle.

Use the play/pause **Motion** icon before Show labels in the panel bar to control flowing dots and
camera inertia. Motion starts on for each mounted graph. Selecting or hovering
nodes, or hovering connections, shows transaction direction on nearby connections.
Selecting or hovering a transaction animates its visible expanded paths upstream and
downstream, including further transactions already on the graph. All expanded paths
stay animated; terminal branches fill a target of 50 branches per direction, sampled
across each sphere. Larger animated traces use fewer dots per connection. Hovering an
input/output or connection follows the same visible trace from that outpoint.
Manual pan, orbit and zoom remain available with Motion off.

Use **Wallets** in the graph toolbar to choose several associated wallets. An entity
must match at least one chosen wallet and the other active filters. **Clear** removes
only this wallet restriction; choosing none leaves wallet membership unrestricted.
The same choices are available in **Filters** and **More filters**, and survive
locking and reopening the workspace. Connected context can still show neighboring
entities outside the matches when that option is enabled.

The **Entities** panel filters both the list and canvas. Search identifiers, labels or notes; choose transaction, output or address types; or open **More filters** for label state, tag state or one tag, wallet membership, bookmarks, whole-satoshi bounds, loaded spend evidence and missing funding details. The graph navigation has the same **Filters** popover. Sorting and pagination expose every matching entity. Invalid value bounds produce a visible error rather than silently changing the query.

Active filters appear as removable chips under the graph navigation. Remove one chip to drop one restriction, or choose **Reset filters** to clear all of them, including the canvas amount threshold. The transaction flow keeps its independent amount setting. Manual hiding is deliberately separate: a dashed chip counts manually hidden entities and restores them, and resetting filters never unhides anything. The batch toolbar and finding **Isolate** actions show an **Isolated N entities** chip. Removing it clears that isolation while retaining other filters. The navigation toggle **Isolate** instead shows a **1 hop from selection** or **2 hops from selection** chip. Wallet membership comes from derived addresses and is not proof of ownership. An output with no loaded spend is unknown, never proven unspent.

Navigation floats at the top of the graph canvas once transactions are loaded. On narrow screens, navigation uses compact icons with accessible names and tooltips.

**Show connections (+N)** appears beside filtered results in **Entities** and the graph’s active filters when it can add extra loaded nodes one connection from the matches. It acts on filter results, not the selection; use **Isolate / Paths** to explore a selected entity. It can show neighbors outside the other filters, but respects manual hiding and the selected path scope. It does not fetch more transactions or expand recursively. **Hide connections** cancels any pending expansion and returns to matches. The graph navigation shows **Filtering graph…** or **Arranging N nodes…** while work is pending; filters stay usable and the latest change replaces obsolete work. If arranging fails, the displayed graph stays available with **Retry**. **Select matching** excludes connected context, while a context entity you tick or Ctrl/Cmd click yourself stays a batch target. **Paths** restricts the view to one or two connections around the current selection. **All paths** clears these restrictions. **Isolate**, next to **Lock**, toggles the same path filter. It starts at one connection and follows your selection; choose two connections in **Paths** for a wider view. Turning **Isolate** off removes only its path restriction; other filters remain active. **Reset filters** clears all filters while preserving deliberate manual hiding. **Center** reveals selections omitted by filters and moves the camera. Manually hidden entities remain hidden until explicitly restored. Previous/next selection buttons revisit your inspection history. **Lock** keeps the camera centered as selections change from the graph, flow diagram, inspector or entity list, revealing selections hidden by filters. Its setting is saved with the workspace. **Hide panels**, beside 3D/Flat, hides desktop side panels until you choose **Show panels**. It is hidden on mobile, where panels already occupy separate views.

## Select several entities and edit them together

**Select** in the graph navigation or in **Entities** turns on selection mode. Checkboxes
appear on entity rows and transaction flow rows, and Ctrl or Cmd click toggles an entity
on the canvas, in the list or in the flow. A plain click keeps inspecting and navigating
as before. The floating selection toolbar reports how many entities are selected and how
many of them are not currently on the canvas.

**Select N matching …** takes exactly the entities matching your current filters, stating
the count and the entity type before you use it. Selections never grow because results
changed, are cleared when you switch workspaces, and lose an entity only when it is
actually removed from the workspace.

**Label**, **Tags** and **Icon** use the same quick editors as Wallet. Existing
labels and icons are preserved unless you tick **Replace existing labels** or
**Replace icons**. The label editor reports its target count; leave the label
empty with replacement enabled to clear it. Tags show their color, full name and
direct membership count. **Add** and **Remove** affect only the selected records.
To create a tag, type a name, choose its color and use **Create and assign** or
Enter. Creating closes the popup; existing-tag assignment keeps it open.
The icon palette includes an explicit **Clear icon**.
Notes, bookmarks and untargeted fields stay unchanged.

**Hide** removes the selected entities from the canvas while keeping their data, and the
hidden chip restores them. **Isolate** restricts the graph to the selection and its connected context; the isolation and context chips make both scopes visible. **Clear** empties the
selection. Every applied batch saves automatically and is a single Undo step, from the
toolbar's **Undo** or the header. Escape, the close button or clicking outside dismisses
an editor without applying an unfinished draft. Already applied tag changes remain.

## Review a wallet

Open **Wallet** and choose an imported watch-only wallet, or use **Add wallet**.
The pencil beside its name opens the name editor, also available in the Graph
sidebar. Names save automatically. The public key is read-only and masked until
you choose Show; renaming never changes the key or derived addresses.

The review queue combines
current UTXO observations, their sources and newly discovered activity. Coverage
and continuation messages describe the checked snapshot; use **Load more** when
pending items remain outside the displayed batch. One tab row contains **To review**,
**UTXOs**, **Transactions**, **Addresses**, **Sources** and **Destinations**.
Each tab shares the same list, single-item details and explicit batch details.
Start with current UTXOs and used wallet addresses. A short sentence under the
toolbar explains the review and suggests the next step. Unused derived addresses
are not queued.

Select a row to label it or record its source or destination. The side toolbar has
Label, Tags and Icon, review actions, Select related, Show and Isolate.
Show opens Graph and zooms to the selection. Isolate additionally narrows Graph to
the selection and its connected context, using the existing resettable filter.
The flow diagram highlights verified wallet matches
and the selected output. **No wallet match** means no match to discovered addresses,
not proof that someone else owns it. Use a flow card's magnifier to reveal and frame
that transaction or outpoint in Graph; clicking the card itself does not navigate. **Back to Wallet**
returns to that magnifier. Actions stay at the top of the detail panel, above the
collapsible flow. Identifiers and tags remain visible in common information.
If an address has several verified loaded transaction matches, its latest observed
transaction opens automatically. Choose another context to inspect older activity.
When no related transaction is loaded, an information box says so and identifies
known unloaded history.
Its copy control stays beside the chooser. The details card groups the address or
outpoint, wallet relationship, observed activity and tags. Related transaction and
outpoint actions sit beside their references.

Use checkboxes to select several items, then the batch detail panel to label, tag or
set their icons together. It replaces single-item details without widening the list.
Ctrl/⌘ click toggles a row; Shift click selects a range.
**Select all (N)** selects the full filtered list, including results under
Show more. It then becomes **Unselect all (N)**. Unselecting drops only those matching
rows, not selections hidden by another filter. **Select related** selects exact same-address or same-transaction
results based on the current item or selection. It replaces the selection and
never reaches outside this filtered list. A shared transaction can include both
your outputs and other participants. Batch edits apply only to that selection. Existing labels and icons are kept unless
you choose Replace. Single-item editing starts from the current value. Metadata
updates appear in the list and details without completing the review.

**Review later** advances to the next item and moves deferred work to
**Show → Review later**, separate from **To review**. It stays pending after locking
and reopening the workspace. Use Return to review or Reopen to put it back in To review.
Marking it reviewed completes that decision. Older saved Source unknown decisions
remain completed and appear under Reviewed; this is no longer offered as a new action.
Decisions belong to the selected wallet, even when another
imported wallet covers the same addresses.

**Finding types** offers the full supported category list with counts, including
zero. A row matches any selected type (OR), so overlapping counts must not be
added together. Counts use the other active filters before this category filter.
Missing a label, missing tags, and missing both are separate conditions.
**Clear types** shows no categories; **Reset to all types** restores the catalog.
Heuristic types use existing scan results and distinguish an unrun or outdated
scan from an observed zero. Partial observations do not establish completeness.

**Sources** and **Destinations** show one grouped row per canonical address in the
selected wallet's one-hop observations, excluding the selected wallet's own addresses.
Edit that address's label, tags or icon
to record a recognized exchange or shop. Underlying outpoints and transaction
contexts remain visible below the common information. Shortened values have full-value
tooltips and copy controls. Source input lookups start in a bounded background batch;
Load next and Retry handle remaining or failed lookups. Missing and non-address
outputs are counted separately instead of appearing as unidentified address rows.
A label is user context, not a proven counterparty identity.
New counterparty reviews target addresses, not individual outputs. Compatible
saved output decisions remain available under Previous output decisions.

Use **Scan** for the supported analysis on loaded data; **Refresh** checks for
new chain activity. Visible
flow inputs load a bounded set of missing previous transactions. Closing or
changing the flow cancels obsolete work; errors keep the selection and offer
Retry inputs. Unknown values remain unknown until observations arrive.

Refresh the wallet to check for new activity. Existing annotations and review
decisions remain, while newly discovered activity stays visible for review.
Labels and wallet matches help organize your observations; neither is proof of
ownership or a guarantee that spending coins together preserves privacy.

## Run analysis

The compact **Wallet**, **Graph** and **Analysis** navigation belongs to the unlocked workspace, below the workspace tabs. Open Wallet to import a watch-only wallet or review an existing one. Graph keeps its camera, layout, Inspector and wallet tabs when you move between workbenches. The Trace workbench is disabled for now; saved workspaces last used in Trace open Graph.

Open **Analysis**, choose a scope, then press **Scan** to run every applicable check. The scope menu starts with **Workspace** (the default), followed by **Selection**, with the current type in parentheses, and an entry for each wallet. Workspace includes all loaded transactions, including data outside graph filters. Selecting a wallet scans its loaded transactions, independently of the graph selection.

**Selection** follows the selected graph transaction, output or address first, then the selected wallet. Outputs include their creating transaction and loaded exact spenders. Your explicit scope choice stays with the unlocked workspace through navigation and scans. If Selection loses its target or a chosen wallet is removed, Scan is disabled until you choose an available scope. A scope with no loaded transactions stays empty.

Open **Options** to adjust each check’s parameters or **Load missing input data**. Input loading makes bounded read-only requests before scanning; turn it off to use only loaded data. Active loading is shown in the scan status.

Results open in review-priority order, highest first. Tips, privacy notes and next steps are prominent above the actions and linked evidence. General method limits remain expandable. **Affected entities** links every referenced output, address or transaction individually. Output rows include their outpoint, loaded value, saved label when present and a link to their address when known. **Supporting transactions** provides the transaction links alongside these affected entities. These links open Graph without implicitly isolating the evidence. The scan report accounts for every tool, including skipped tools, missing context and no matches. Current selection can change without changing the last scan's evidence. Temporary controls and reports stay with each unlocked workspace, including workspace tab switches. Locking clears these controls; saved findings remain encrypted.

| Tool                          | What it explains                                                                                                                                                 |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Equal-output detection        | Exact groups of equal positive, spendable outputs, with only their members highlighted. A pattern is not a CoinJoin verdict or linkability probability.          |
| Common-input ownership        | Tentative input groups, with explicit skipped equal-output candidates and missing evidence. PayJoin and other collaborative transactions remain counterexamples. |
| Address reuse                 | Repeated destinations in the selected loaded history, optionally requiring different transactions.                                                               |
| Value flow and fees           | Input/output reconciliation and fees when all input amounts are known, or explicit missing/inconsistent data.                                                    |
| Consolidation and fan-out     | Transaction shapes matching your input/output thresholds, without assigning ownership or intent.                                                                 |
| Script-type comparisons       | Observed input/output script patterns and optionally change-like hypotheses, with their limitations.                                                             |
| Imported-wallet intersections | Transactions touching multiple imported wallet records, distinguishing overlapping imports from independent coverage.                                            |

**Show on graph** selects and reveals a finding without isolating it. When a referenced input has no loaded creating transaction, it opens the supporting transaction and leaves the input value unknown. Loading that input remains an explicit action. If no usable evidence is loaded, the finding stays open with recovery guidance. **Isolate** explicitly limits the view. Graph shows removable filter chips with **Reset filters**, including saved isolation and path filters. Removing the **Isolated N entities** chip clears that isolation; other filters and manual hiding still apply. Manual hiding is reported separately and remains in place until you choose **Show** on the manual-hiding chip or another explicit restore action. Use **Back to Analysis** to return to the finding.

Exclude a finding to remove its overlay, or restore it later. New wallet or transaction evidence marks old findings stale. Annotations remain independent from analysis.

## Trace workbench

The Trace workbench is disabled pending a later iteration. Its source is retained for future work, but there are no active Trace navigation or workbench controls. Existing graph funding/spending actions and the transaction input/output view remain available. Missing spending evidence still means unknown, not unspent, and Bitcoin does not record which input funded a particular output.

## Hide, restore and remove entities

Use the eye buttons in Entities, the Inspector or a node card to hide or show an entity.
The Entities visibility filter offers **Visible**, **Hidden** and **All**; the hidden-count
shortcut clears other filters so you can find everything manually hidden. **Show all hidden**
restores manual visibility. Other graph filters and loaded context still apply.
Hidden entities retain their notes, labels, tags and icons, and can still be inspected.
Hidden addresses remain recoverable while address display is off; restoring one offers
an explicit action to enable address display.
Transaction visibility controls can hide or show its input/output groups together.

The remove button deletes a loaded transaction from the workspace or stops watching an
explicitly watched address. Annotated or tagged data requires confirmation. Transaction
removal includes its output annotations; stopping an address watch retains shared loaded
transactions. Undo restores either action. Individual inputs and outputs are hideable,
not separately deleted from Bitcoin transaction records.

## Autosave, lock, and exchange data

Workspace autosave writes encrypted contents to this browser's storage. Navigation pauses
automatic saves and coalesces camera changes until the graph is idle. Validation,
compression and encryption run in a worker. Unlock and import also decrypt, decompress and validate in a worker. Closing either dialog cancels its pending read. Lock, export and workspace
switching capture the latest camera first. Wait for the saved status before closing the
browser; an abrupt browser or device shutdown can still lose pending edits. Small saves use localStorage; larger saves use IndexedDB while the localStorage index keeps only public metadata and encrypted-payload references. Existing saves move to IndexedDB automatically when needed. New writes and exports use compressed encrypted envelope v2. Lock the workspace to close its unlocked session. Reopening requires its password. On the Workspaces screen, search saved public names or use the trash button to delete a locked browser copy. The confirmation affects only that copy, not exported files; lock an open workspace first. Browser storage is tied to the exact origin: development at port 3001 and a built app at another port have separate saved workspaces.

Export an encrypted workspace file for backup or transfer to another browser. On narrow screens, Export and Undo are in **Workspace menu** beside the lookup controls. Import it and supply the password to reopen it. If its network is not configured on this backend, the workspace still opens for offline inspection and editing. A clear backend-network error appears and live queries stay disabled until the matching pair is configured. The same applies when unlocking an existing browser workspace. Keep the password separately: there is no reset or recovery service. Exported files preserve workspace contents, not a live blockchain connection. Camera position and node coordinates are included with your view settings.

New saves use gzip only for payloads of at least 1 KiB when it makes them smaller. Compression can save substantial space, but does not reduce password derivation or wallet validation work and can increase save/unlock time. See the [synthetic benchmark and its limits](docs/research/workspace-compression-benchmark.md).

Existing uncompressed v1 backups and browser saves remain readable, including payloads without a workspace schema version. Opening them does not rewrite the original. The next save that writes changes, or an encrypted export, uses envelope v2. Older Chaingraph releases cannot open v2 files, so keep an original backup when moving between releases. Unsupported future file or workspace schema versions are rejected without replacing the original. Use a compatible app version to open them.

Saving requires Web Workers, Web Crypto, and native gzip CompressionStream/DecompressionStream support. A browser missing gzip APIs can still read v1 and v2 uncompressed saves, but new saves fail rather than silently switching formats. A compressed backup requires gzip decompression support. If saving fails, keep the unlocked tab open and retry after resolving the cause; export is a recovery option for storage failures, but also requires the compression APIs. The 32 MiB limit applies to decompressed UTF-8 JSON, with expansion stopped while streaming.

Saved workspace contents use authenticated encryption. The browser storage entry also includes the public workspace name, a workspace identifier, and save time outside the encrypted contents. File names and file sizes can reveal additional metadata. Encryption does not hide an unlocked workspace from someone using your browser or from untrusted browser extensions.

**BIP329 label exchange is different from workspace export.** Label files are plaintext JSON Lines. They can include address/output/transaction references, labels, and wallet extended public keys. They do not preserve the complete workspace, notes, bookmarks, graph settings, or analysis results. Only share them intentionally. Unsupported label record types and records that omit the label field are skipped during import, leaving existing values unchanged; an explicit empty label clears the existing label. Records with malformed references are rejected with their line numbers.

## Understand freshness and limits

Enable **Check activity every 30s** to rescan wallets and watched addresses while this workspace is unlocked. This is browser-driven polling, and configured bounds still apply. The connection indicator is also polled. It reports backend/upstream status and height, not continuous synchronization of every loaded transaction. Saved confirmation counts can be stale, and historical records are not automatically rebuilt after a reorganization. Reload a transaction when its current state matters.

Address and wallet loading currently fetch at most 500 eligible transactions per operation. Funding expansion is limited to 500 missing parent transactions at a time; spending discovery inspects at most 500 candidate transactions. Backend history and response limits can reject a particularly busy address. A successful bounded scan means that the selected bounds were processed; it does not establish a complete wallet inventory.

Workspace plaintext has a 32 MiB encryption limit. IndexedDB avoids the smaller localStorage ceiling for large graphs, but available disk space and browser quotas still apply. Workspaces are bounded to 10,000 transactions and 50,000 transaction/input/output records, including during live expansion. Export backups before a large investigation approaches browser storage limits.

## When something fails

- **Backend disconnected:** check the selected network’s Bitcoin RPC authentication and Fulcrum connection. Connection details lists each configured network independently. No workspace password is needed by the backend.
- **Network not configured:** add `.env.mainnet` or `.env.testnet4` to the backend’s configuration directory and restart it. Each file needs matching Bitcoin Core and Fulcrum services. A pair that reports the wrong chain is rejected.
- **Transaction unavailable:** the node may not have that transaction or its raw transaction index. Chaingraph tries Fulcrum's transaction lookup after Bitcoin Core; both can still be unavailable.
- **Incomplete history:** review scan limits and backend history limits. Do not infer no activity from data that could not be loaded.
- **Autosave failed:** export the unlocked workspace immediately. A conflicting browser tab requires reload after keeping your unsaved work; unavailable storage or save coordination requires a browser with IndexedDB or Web Locks enabled. Clearing site data deletes local saved workspaces.
- **Encryption unavailable:** use localhost or HTTPS and a browser supporting Web Crypto, Web Workers, CompressionStream and DecompressionStream. Unsupported formats need a compatible Chaingraph release; failed reads preserve the original.
- **Graph unavailable:** continue with the entity list, or reload in a browser with working WebGL. A flat 2D view also needs WebGL.

Use **Help and samples → About Chaingraph** for the version, license and source/release links when configured. Click the connection indicator for network details and a fresh status check. The same menu offers **Show guided tour** for an open workspace, or **Getting started** from the welcome screen.

For Docker setup, see [deployment](docs/deployment.md). For server setup and development commands, see [README.md](README.md).

## Transaction and script inspection

Transaction rows show input/output counts and a compact confirmation status. Block heights
come from recorded chain observations. **Unconfirmed** means a mempool observation was
loaded; missing information stays **Status unknown**. Refresh to check the current state.

Select a transaction or output to open the collapsible inputs/outputs view above the graph. Selecting an input follows its previous output while retaining the transaction being examined. For a selected output, the transaction chooser includes its creating transaction and all loaded spending transactions. Large lists start collapsed, with expand/collapse controls above each list and the selected row kept visible. Validated input-attached evidence can show value and script details without a full parent transaction. The selected input's creating transaction still loads automatically while the panel is open; the bulk action loads only missing details. Unavailable or bounded results provide retry or continuation. Click the central transaction block to select it, or use its label, tag and icon toolbar to edit that transaction. Row pencils open the corresponding output annotation. Attached historical output content is not proof of current unspent status, and missing spending data does not prove an output is unspent.

The Inspector’s **Scripts and raw transaction** section shows saved output script hex and normalized opcodes. **Load raw transaction** explicitly fetches and verifies serialized bytes for scriptSig, witness, version, locktime and size inspection. Raw data stays in memory only for that inspected selection. Script decoding does not execute scripts or verify signatures. See [inspection research and limits](docs/research/transaction-inspection.md).

## Tags and wallet matches

The Inspector's **Annotations** section groups the label, notes and tags with compact
icon and bookmark controls. Edits save automatically. The **Wallet** section below
links to each associated wallet's details and identifies a derived-address/script
match or, for a transaction, a matching input or output. These associations are
independent of your tags and do not establish transaction ownership.
Each assigned tag fills a row with a bin button to remove its assignment while keeping the tag.
Address-level removal asks you to confirm its effect on the address's other outputs.

Use **Add or choose tags** in the inspector to search, create and assign a group
without leaving the selection. It uses the same tag editor as Wallet and the
Graph selection toolbar, including color choices and name/description search. Choose **This output** for an individual output or
**Address + outputs** to apply it to every loaded output at that address.
The **Tags** tab beside Wallets and Entities manages groups, imports and graph filters. Address membership also applies to outputs loaded
later. It does not assign the entire creating or spending transaction to that tag.

**Group existing labels** creates tags from matching nonempty labels, including
BIP329 imports. It leaves labels, notes, and existing tag memberships alone. Labels
longer than 100 characters and references outside transaction/output/address types
are not grouped. Review these groups before treating them as known counterparties.
Use **Show on graph** to isolate a tag with its connected transactions; **Clear** or
**All paths** restores the graph. Removing a tag keeps its members and annotations.

The graph highlight selector can show wallet matches, manual tags, both, or neither.
A wallet match means a loaded output script matches an address derived from an
imported wallet. Related transactions include those creating or spending matching
outputs; they are not labeled as entirely wallet-owned. Manual tag colors take
precedence when both are shown. Analysis findings remain separate hypotheses or
observations. Tags and highlight preferences are encrypted with the workspace.

## Returning to a wallet

Unlock your saved workspace to resume its loaded snapshot. **Refresh wallet** checks
receive and change histories with the configured bounds; **Refresh all wallets**
checks each imported wallet. Last checked and partial-scan details stay visible.
Refresh adds new transactions while preserving your selection, tags, labels and
camera. It does not silently remove old annotated transactions missing from a
new history response. Confirmation counts are saved observations, not a live tip
calculation.

**Show new activity** reveals newly loaded transactions and marks that notification
as reviewed. The notification persists through later quiet checks and encrypted
reopen. **Show wallet matches** reveals all loaded script matches and their connected
transactions without acknowledging new activity. **Reset filters** clears these filters.
The optional **Check activity every 30s** monitor runs only while unlocked and must
be enabled again after reopen. Turning it off cancels its in-flight check.

Labels, notes, icons, bookmarks, tags and workspace details save automatically. Check
**Encrypted · saved** before closing the tab; **Lock workspace** waits for encryption.
Reopening restores your selected item, filters, graph camera and transaction-flow panel.
Create or choose a tag directly in the inspector. Scope it to one output or to an address
and its outputs. The transaction flow arrows follow the selected outpoint to its creating
or loaded spending transaction. Expand OP_RETURN data to select or copy the decoded text
(or hex for binary data).

### Follow larger transfers with less noise

Use **All amounts** in either the graph toolbar or the transaction flow to show
outputs greater than 546, 1,000, 10,000 or 100,000 sats. An amount exactly equal to
the selected threshold is filtered out. Each control affects only its own view,
and both settings are saved independently. Collapsing the transaction flow hides
its filter; reopening restores it. These are display thresholds, not a classification of dust attacks or
Bitcoin relay policy. Unknown values and the selected output stay visible. A
**filtered · Show** control restores omitted flow rows. You can also choose a
filtered output from Entities without resetting the threshold.

**Size by → Value** uses the fixed radius `1.6 + 0.9 × log10(1 + sats / 10,000)`.
A 150,000,000-sat output is about 2.6 times the diameter of a 20,000-sat output at
the same depth. The scale stays stable when nodes are added or filtered; it is
logarithmic visual emphasis, not proportional area or volume. New lookups focus the requested transaction, output or address automatically.
Lock additionally follows selections made throughout the workbench.

**Load previous** adds the requested parents and connecting outpoints. Other
inputs and outputs stay off the canvas until you choose them or use Add inputs/outputs. Removing the original
transaction cleans up unused input context too. Shared, independently added,
annotated or wallet-related transactions remain; Undo restores the removed branch.
Older saved data without recorded ancestry provenance is retained conservatively.

Amount filtering also hides orphan transaction/address nodes and prefetched branches
that lose their connection to the investigation. **All amounts** restores them;
Entities still lets you select a filtered item. Separately added investigations
and the current selection remain available. Direction arrows appear throughout
the transaction/output graph, with bolder connections around your selection.

### Keep the entity list aligned with a trace

Choose **Entities → Match graph** to list only nodes currently displayed on the
canvas, including retained context. This follows graph amount filters and manual
visibility, and is saved per workspace. Choose **Not hidden** or **All entities**
to inspect observations omitted by the graph amount filter, or **Hidden** to
restore manually hidden items. Changing this list mode does not remove chain data.

**Center** frames the selected node at about 24 pixels wide. **Lock** keeps the
selection centered without changing zoom.
Back and forward change selection without moving the camera, including with Lock
on. **Isolate** fits the entire isolated view.
The transaction toolbar's Hide/Remove inputs and outputs preserve further connections.
The two bottom controls hide all I/O with zero or one connection, or show all loaded
I/O for transactions on the graph. Show all clears canvas filters and amount limits;
manually hidden transactions stay hidden. No additional history is fetched.
Successful opening and tracing do not show a popup; incomplete results retain
recovery guidance.
**Fit graph** frames all displayed nodes. Both account for node sizes, displayed
labels and the floating navigation toolbar, while retaining the current viewing direction. Orbiting may
still bring nodes in front of each other; Flat and Fit provide alternate views.

## Wallet transactions and UTXOs

Select a wallet, then open **Addresses**, **Transactions** or **UTXOs** in the right panel.
Transactions lists known history once per transaction, with unconfirmed activity
first and confirmed history newest first. Unloaded entries can be selected to
fetch their details. Rows focus the graph even when selection locking is off;
the list stays open. Switch to **Inspector** to edit the selected item's metadata,
then return to the same wallet list. Select the wallet again for wallet settings.

UTXOs queries the discovered addresses when opened. It lists outputs reported
unspent by your backend at the displayed check time, including mempool activity.
Use its refresh button to update the list. At most 100 addresses are checked per
action; **Check next addresses** continues larger lists. Failed checks and partial
wallet discovery are shown explicitly. Returning after locking requires a fresh
UTXO check; this list is not a persisted balance. Selecting a UTXO loads and verifies
its creating transaction when necessary. An output leaving this list does not
remove its transaction, labels or notes from the workspace.

Wallet **Addresses** lists discovered receive and change addresses with their derivation
index and the number of outputs in loaded transactions. Counts include spent outputs
and are not a complete history or current UTXO count. Filter by address, label or
derivation path. Select a row to show the address on the graph, then use Inspector
to edit its metadata. Addresses with no loaded outputs remain selectable; opening
this list does not scan or download transaction history.
