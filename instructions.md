# Using Chaingraph

Chaingraph helps you investigate Bitcoin activity and keep your own observations alongside the graph. It is watch-only: you can import public wallet information, inspect transactions, and organize hypotheses without supplying a seed phrase or private key.

## Start a workspace

Create a workspace, choose mainnet or testnet4, and give it a **Name (public)** and password. The name remains visible while locked. An optional description stays encrypted and appears only while unlocked. Use **Workspace menu → Workspace details** to edit either field. Existing saved workspaces show their public name after being unlocked and saved once. Use a long, unique passphrase. Your password cannot be recovered. The workspace's network must match the connected backend for live lookups; choosing a different workspace network does not reconfigure Bitcoin Core or Fulcrum.

You can open several workspaces and switch between their tabs. Each workspace has its own transactions, wallets, annotations, analysis results, and view settings. An unsaved indicator means the current changes have not yet reached encrypted browser storage. Autosave runs shortly after edits; heed a storage-error message and export a file if browser storage is full or unavailable.

For a first look without loading your own wallet, open the **CoinJoin laboratory**. It starts with three generated 150-input/150-output transactions. Select one and use **Load previous transactions** or **Find spending transactions** to reveal paths from the offline fixture. **Show all fixture paths** loads the complete sample; **Reset practice paths** returns to the three starting transactions and clears analysis overlays while keeping annotations. Their IDs, confirmations, and activity are synthetic, not real testnet transactions. Do not use the laboratory as evidence about a real wallet.

Use Ctrl/Cmd+K to focus the quick input and Ctrl/Cmd+S to save an encrypted browser snapshot. The first-use tour introduces the main controls. It can be skipped and restarted from Help.

## Find activity

Use the quick input to load a transaction ID, an address, or an output reference written as `transaction-id:output-index`. Select an item in the graph or entity list to inspect its details and available actions.

**Load previous transactions** adds one earlier level. For an output whose creating transaction is missing, it loads that transaction and fills in the output value and script. Once the creating transaction is loaded, the action follows its inputs. A coinbase transaction has no earlier inputs.

**Find spending transactions** checks script histories for transactions consuming the selected output, or any output of a selected transaction. It checks exact outpoint references. The result reports matches and how many were newly added, so a repeated action with an already loaded path is distinguishable from no matches. Busy histories are checked in batches of 500; repeat the action when prompted to continue. This continuation is temporary and resets when switching workspaces. Changed histories can shift a batch boundary; this is a bounded investigation, not a completeness guarantee. Missing spend links never prove an output is unspent.

Use **Prefetch previous** beside the quick input controls to choose **Off**, **1 level**, or **2 levels** when adding a transaction or output. The two levels share a 500-transaction download limit and reuse loaded transactions. Large or unavailable branches produce a partial-result message. Trace individual paths to continue. Address and wallet scans keep their own bounds.

**Testnet4 examples** offers three real outputs: a simple spent path, a two-input transaction with mixed scripts, and a 53-output fan-out. Load them in a testnet4 workspace connected to your node, then explore previous and spending paths. Explorer links are optional external references. These examples do not identify wallet owners.

The graph represents transaction creation and consumption of outputs. An output can already be spent; the presence of an output node does not mean it is an available UTXO. Unknown funding outputs may appear before their parent transaction has been loaded. Address nodes are an optional additional view of script destinations, not proof of a common owner.

## Add personal wallets

Add one or more wallets to the workspace using an **account-level extended public key**. Chaingraph accepts depth-3 account keys and derives receive branch `0` and change branch `1` in your browser.

| Network | Accepted encodings |
| --- | --- |
| Mainnet | `xpub`, `ypub`, `zpub` |
| Testnet4 | `tpub`, `upub`, `vpub` |

Choose the wallet's actual address type: legacy P2PKH, nested SegWit P2SH-P2WPKH, native SegWit P2WPKH, or BIP86 Taproot. `ypub`/`upub` and `zpub`/`vpub` constrain that choice; `xpub`/`tpub` do not identify an address type. Account keys cannot prove their full parent derivation path, and testnet encodings alone cannot distinguish testnet4 from other test networks.

Preview the first receive address and compare it with your wallet before scanning. A mismatch usually means the wrong account key or script type. Master keys, descriptors, multisig wallets, private keys, and arbitrary derivation paths are not supported in this version.

Run a scan to query receive/change histories and load their transactions. Scanning happens in the browser through your backend; the extended public key is not sent as a wallet import to Bitcoin Core or Fulcrum. The queried script hashes and transaction IDs are visible to the backend and upstreams.

Scans use a gap of unused addresses, a maximum index, and a bounded number of transaction loads. Reaching a limit leaves an incomplete view. Scanning both branches does not prove that higher indexes, another account, or another script type have no activity. Cancel stops the current scan; do not treat a cancelled scan as complete.

## Navigate and annotate

Drag the background to orbit in 3D, pan with the camera controls, and scroll or pinch to zoom. Use the fit control to bring loaded activity back into view. Individual nodes cannot currently be dragged. Switch to 2D for a flat layout with rotation disabled; both views use WebGL. On smaller screens or without WebGL, use the entity list to select and inspect items.

Choose uniform sizing, value-based sizing, or degree-based sizing to emphasize different properties. Value sizing is compressed logarithmically so large outputs do not overwhelm small ones. Degree describes the number of graph connections, not transaction importance or ownership confidence. Cluster colors and glow are visual aids.

Transactions are cubes, outputs are spheres, and optional addresses are diamonds. Hover a node or connection for identifiers, values, available details, and a small action toolbar. **Load previous level** expands that path; **Edit label / notes** opens and focuses the inspector. The inspector and entity list provide the same tracing workflow without hover.

Select an item to add a label, note, icon, or bookmark in its inspector. The icon button opens a multi-row palette with labeled symbols, keyboard arrow navigation, and a clear option. Labels record your observations; they do not change blockchain data. Use bookmarks to return to relevant items and undo to reverse recent workspace edits. Undo history is limited to the current session and is reset when new chain data is loaded, so undo cannot erase a later scan. Remove a transaction from its inspector to reduce the graph; its saved annotations remain, and descendant inputs may still show output placeholders.

## Filter and navigate

The **Entities** panel filters both the list and canvas. Search identifiers, labels or notes; choose transaction, output or address types; or open **More filters** for label state, bookmarks, whole-satoshi bounds, loaded spend evidence and missing funding details. Sorting and pagination expose every matching entity. Invalid value bounds produce a visible error rather than silently changing the query.

**Show connected context on canvas** adds adjacent entities that do not match your filters; the count distinguishes these from matches. **Paths** restricts the view to one or two connections around the current selection. **All paths** clears these restrictions. **Center selection** reveals a hidden selection and moves the camera. Previous/next selection buttons revisit your inspection history. **Focus graph** hides the side panels until you choose **Show panels**.

## Run analysis

Open **Analysis**, choose **Visible graph** or **Selected transaction**, and find a tool by name. Open **Parameters and method** to inspect thresholds and the source reference. Loaded parent transactions can supply input evidence even when outside the selected scope; running analysis makes no additional network requests.

| Tool | What it explains |
| --- | --- |
| Equal-output detection | Exact groups of equal positive, spendable outputs, with only their members highlighted. A pattern is not a CoinJoin verdict or linkability probability. |
| Common-input ownership | Tentative input groups, with explicit skipped equal-output candidates and missing evidence. PayJoin and other collaborative transactions remain counterexamples. |
| Address reuse | Repeated destinations in the selected loaded history, optionally requiring different transactions. |
| Value flow and fees | Input/output reconciliation and fees when all input amounts are known, or explicit missing/inconsistent data. |
| Consolidation and fan-out | Transaction shapes matching your input/output thresholds, without assigning ownership or intent. |
| Script-type comparisons | Observed input/output script patterns and optionally change-like hypotheses, with their limitations. |
| Imported-wallet intersections | Transactions touching multiple imported wallet records, distinguishing overlapping imports from independent coverage. |

The **Tools** and **Findings** controls jump between configuration and results. Each run reports its coverage and skipped records, including when it has no findings. Search findings or filter by tool, observation/hypothesis/incomplete evidence, and active/excluded/stale status. **Show on graph** isolates a finding's evidence with connected context; **Focus** centers its first node. **All paths** returns to the complete graph.

Exclude a finding to remove its overlay without deleting the result. Rerunning the same tool preserves exclusions when the finding's node and transaction evidence is unchanged. Loading or changing wallet/transaction data marks prior results **Needs rerun** and removes stale overlays. User annotations stay separate from algorithm results.

## Save, lock, and exchange data

Workspace autosave writes encrypted contents to this browser's storage. Lock the workspace to close its unlocked session. Reopening requires its password. On the Workspaces screen, search saved public names or use the trash button to delete a locked browser copy. The confirmation affects only that copy, not exported files; lock an open workspace first. Browser storage is tied to the exact origin: development at port 3001 and a built app at another port have separate saved workspaces.

Export an encrypted workspace file for backup or transfer to another browser. Import it and supply the password to reopen it. Keep the password separately: there is no reset or recovery service. Exported files preserve workspace contents, not a live blockchain connection. Current camera position and the temporary force layout are not saved.

Saved workspace contents use authenticated encryption. The browser storage entry also includes the public workspace name, a workspace identifier, and save time outside the encrypted contents. File names and file sizes can reveal additional metadata. Encryption does not hide an unlocked workspace from someone using your browser or from untrusted browser extensions.

**BIP329 label exchange is different from workspace export.** Label files are plaintext JSON Lines. They can include address/output/transaction references, labels, and wallet extended public keys. They do not preserve the complete workspace, notes, bookmarks, graph settings, or analysis results. Only share them intentionally. Unsupported label record types and records that omit the label field are skipped during import, leaving existing values unchanged; an explicit empty label clears the existing label. Records with malformed references are rejected with their line numbers.

## Understand freshness and limits

Enable **Check activity every 30s** to rescan wallets and watched addresses while this workspace is unlocked. This is browser-driven polling, and configured bounds still apply. The connection indicator is also polled. It reports backend/upstream status and height, not continuous synchronization of every loaded transaction. Saved confirmation counts can be stale, and historical records are not automatically rebuilt after a reorganization. Reload a transaction when its current state matters.

Address and wallet loading currently fetch at most 500 eligible transactions per operation. Funding expansion is limited to 500 missing parent transactions at a time; spending discovery inspects at most 500 candidate transactions. Backend history and response limits can reject a particularly busy address. A successful bounded scan means that the selected bounds were processed; it does not establish a complete wallet inventory.

Encrypted workspace payloads have a 32 MiB limit, while browser storage may fill much sooner. Workspaces are bounded to 10,000 transactions and 50,000 transaction/input/output records, including during live expansion. Export backups before a large investigation approaches browser storage limits.

## When something fails

- **Backend disconnected:** check the local backend process and its configured network, Bitcoin RPC authentication, and Fulcrum connection. No workspace password is needed by the backend.
- **Network mismatch:** connect to an instance configured for the workspace's network. Testnet4 requires matching Bitcoin Core and Fulcrum services.
- **Transaction unavailable:** the node may not have that transaction or its raw transaction index. Chaingraph tries Fulcrum's transaction lookup after Bitcoin Core; both can still be unavailable.
- **Incomplete history:** review scan limits and backend history limits. Do not infer no activity from data that could not be loaded.
- **Autosave failed:** export the unlocked workspace immediately. Clearing site data deletes local saved workspaces.
- **Encryption unavailable:** open the app on localhost or HTTPS in a browser supporting Web Crypto.
- **Graph unavailable:** continue with the entity list, or reload in a browser with working WebGL. A flat 2D view also needs WebGL.

Use **About** for the version, license and source/release links when configured. Click the connection indicator for network details and a fresh status check. Help contains workflow guidance, shortcuts and a restartable tour.

For Docker setup, see [deployment](docs/deployment.md). For server setup and development commands, see [README.md](README.md).

## Transaction and script inspection

Select a transaction or output to open the collapsible inputs/outputs view above the graph. Selecting an input follows its previous output while retaining the transaction being examined. For a selected output, the transaction chooser includes its creating transaction and all loaded spending transactions. Large lists start collapsed, and the selected row remains visible. Use a row’s pencil to edit its annotation, or load missing previous outputs one level at a time. Missing spending data does not prove an output is unspent.

The Inspector’s **Scripts and raw transaction** section shows saved output script hex and normalized opcodes. **Load raw transaction** explicitly fetches and verifies serialized bytes for scriptSig, witness, version, locktime and size inspection. Raw data stays in memory only for that inspected selection. The laboratory has no serialized raw data. Script decoding does not execute scripts or verify signatures. See [inspection research and limits](docs/research/transaction-inspection.md).

## Tags and wallet matches

Open **Tags** beside Wallets and Entities to create named groups for sources,
destinations, or other entities. A new tag includes the current selection. Use
**Add selection** for individual transactions or outputs, or open **Tags** in the
inspector and choose **This address and its outputs** to apply a group to every
loaded output at that address. Address membership also applies to outputs loaded
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
transactions without acknowledging new activity. **All paths** clears these filters.
The optional **Check activity every 30s** monitor runs only while unlocked and must
be enabled again after reopen. Turning it off cancels its in-flight check.
