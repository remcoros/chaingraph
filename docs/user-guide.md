# Using Chaingraph

Chaingraph is watch-only. You can import public wallet information, inspect
transactions and organize your own observations without ever supplying a seed or
private key. Amounts are shown in BTC with eight decimals grouped for reading,
for example `0.00 025 000 BTC`; hover an amount for its exact satoshi value.
Amount inputs take whole satoshis and fee rates use sat/vB.

Choose an accent color using the swatches in **Help and samples**. Bitcoin orange
is the default; your choice is remembered in this browser while the app stays dark.

## Workspaces

A workspace holds transactions, wallets, annotations, analysis results and your
view. Create one with a **Name (public)** and a password of at least eight
characters. The name stays visible while the workspace is locked; the optional
description and everything else are encrypted. When the backend serves both
networks, choose mainnet or testnet4 at creation; every lookup in that workspace
uses its own Core/Electrum pair.

Open several workspaces and switch between them with the tabs in the header.
Edits save automatically; the status bar confirms when the encrypted copy has
reached browser storage, and Ctrl/Cmd+S finishes a pending save. Reloading the
page locks every workspace because the password is never stored. Reopen a saved
workspace from the Workspaces screen to unlock it, or delete a locked browser
copy there.

**Examples.** Choose an example on the welcome screen or under
**Help and samples → Example workspaces**. Each contains real mainnet or
testnet4 transactions with starter labels, tags, icons and bookmarks. Only
networks configured on your backend appear. Set a password to create your own
editable copy; no chain download is needed. Start from a bookmark and follow its
notes. The wallet example uses a deliberately published test `zpub`; never send
funds to its addresses.

**Guided tour.** The first-use tour covers the main controls. Restart it any time
from **Help and samples → Show guided tour**; use **Tour contents** to jump to a
topic. The tour only previews panels and never changes your data.

### Backups and exchange

**Export workspace** in the header writes an encrypted file. Import it in another
browser and enter the password to reopen it. If that backend does not serve the
workspace's network, it still opens for offline inspection and editing with live
lookups disabled. Exports carry the whole workspace including camera and layout;
they do not carry a blockchain connection. There is no password recovery.

Browser storage is per origin: the development server on port 3001 and a
production build on port 3000 have separate workspace lists. Small saves live
in localStorage, larger ones move to IndexedDB automatically. New saves use a
compressed encrypted envelope (v2); older uncompressed backups remain readable,
but older Chaingraph releases cannot open v2 files. Saving needs Web Workers,
Web Crypto and native gzip support; without them, existing saves stay intact
and new saves report an error.

**BIP329 labels are different.** **Export BIP329 labels · plaintext** in the
workspace menu writes unencrypted JSON Lines that can include extended public
keys. They carry labels only, not notes, bookmarks, layout or findings. Import
skips unsupported record types and records without a label; an explicit empty
label clears an existing one, and malformed references are rejected by line.

## Look up activity

Type a transaction ID, an address or an outpoint (`txid:index`) in the quick
input (Ctrl/Cmd+K). An entity that is already loaded is selected and centered
immediately, even offline. The **Previous** selector beside the input loads one
or two levels of earlier transactions along with the lookup; it defaults to off
and both levels share a 500-transaction budget.

With a transaction selected, **Load previous txs** adds one earlier level. For an
output, **Open creating tx** loads only the transaction that created it, and
**Find spending txs** looks for transactions that spent it (or any output of a
selected transaction). Spending searches check script histories through your
backend, up to 500 candidate transactions per action; repeat the action to
continue. If no spender is found, the app checks Core's current UTXO set and
reports unspent, absent or unknown. Absent is not the same as spent.

The refresh icon in the Inspector's top bar checks an output's **current UTXO
status** on demand, including mempool spends. The result is timestamped and kept
under **More details** for the current selection.

### The transaction view

Selecting a transaction or output opens a collapsible inputs/outputs view above
the graph. Inputs and outputs sit around the central transaction; long lists
start collapsed. Select an input to follow its previous output while keeping the
current transaction open; select an output to see its creating transaction and
every loaded spending transaction in a chooser. A loaded spend can already show
an input's value, address and script before its parent is loaded. **Load
missing input details** fetches parents in a bounded batch where that evidence
is missing, with retry or continuation for partial results. OP_RETURN outputs
show decoded text when possible and hex otherwise. Use the expand icon to give
the view more height.

## The graph

Transactions are cubes, outputs are spheres, and optional addresses are
diamonds. Drag the background to orbit, scroll or pinch to zoom, and use two
fingers or the camera controls to pan. **Flat** disables rotation. Both modes
need WebGL; the entity list offers the same actions without it. Individual nodes
cannot be dragged.

The graph contains only what you add. Clicking a transaction, input or output in
the transaction view adds that node; **Load previous**, **Open creating tx** and
**Find spending txs** add what they find. Inputs and outputs form rounded groups
on opposite sides of their transaction, and shared outputs connect transaction
branches. New nodes are placed near their source without moving existing ones;
**Repack** rearranges everything visible.

The transaction flow panel has collapsed, normal and full-height views. Its two
floating arrow buttons collapse, expand or restore its height; double arrows
move directly between collapsed and full height. Clicking the title collapses
an open panel or reopens it at normal height. With no applicable node selected,
the panel keeps its height and title, clears its content and disables its controls.

Selecting an address replaces the transaction lanes with a small Transactions /
UTXOs view. The address is admitted and selected immediately; history and
transaction details load in the background, so the panel can show progress and
partial rows while a long history is being fetched. Transactions show the
recorded block or mempool observation, loaded details, and amounts. Select a transaction row
to load it when needed, add or show it on the graph, and open it in the flow.
UTXOs are the unspent outputs observed for the address at the last check;
selecting one opens its creating transaction and output in the graph when
needed. Balance and check times are shown when available. A history bound,
unloaded detail, or missing balance is shown as partial or unknown; it does not
mean the address has no other activity, owns the transaction, or has an
unspent output beyond the observation.

The Transactions tab groups observed history into clickable, collapsible Pending
and Confirmed sections, with pending transactions first. The UTXOs tab is
populated only from the backend's current unspent-output observation, not from
every loaded output. It shows confirmed and pending totals with matching
collapsible sections, with pending outputs first. Both tabs render a bounded
first page and offer **Show more** for larger observations. Confirmed rows show the
observed block and transaction timestamp when the creating transaction detail
is loaded; pending rows are marked as Pending. Confirmed transactions show their
fee rate and total fee when all input values and virtual size are observed;
otherwise fee evidence remains unknown. An unavailable timestamp remains
unknown. Blockchain block timestamps use UTC `YYYY-MM-DD HH:mm:ss` without a
timezone suffix. Other stored timestamps are kept as canonical UTC instants and
shown in the user's local time using the same format.

The icon toolbar on the right adds, hides or removes a transaction's inputs and
outputs, or whole branches. **Hide** is temporary and reversible from the hidden
chip; **Remove from graph** keeps evidence and annotations in the workspace.
Removing a transaction from the workspace itself is a separate action in the
Inspector or entity list (see below).

The address button beside **Show all loaded inputs/outputs** opens the history
for a valid address carried by the selected input or output. It loads the
bounded address history and balance when no observation is available, then
selects the address so its transaction and UTXO tabs are available in the flow
panel. UTXOs and balance are fetched only when that tab or an explicit refresh
requires them, and each observation includes its last-checked time.

Floating controls over the canvas provide **Fit**, zoom, **Center** on the
selection, **Lock** (keep the selection centered as it changes), selection
history, **Isolate**, filters and **Repack**. **Motion** toggles flow dots and
camera inertia; the dots show transaction direction along the paths connected to
your selection. **Show labels**, **Show tags** and **Show icons** control captions
without touching annotations. **Size by** switches between uniform, value-based
(logarithmic) and degree-based node sizes. Address nodes use their observed
balance when one is available; unknown balances are not treated as zero. On
desktop, **Hide panels** gives the canvas the full width.

Hover a node for a card with identifiers, value, and compact actions. Connection
lines do not open cards. The Inspector and the entity list provide the same
actions with the keyboard.

### Filters

The **Filters** popover (also **More filters** in **Entities**) restricts the
canvas and the list by entity type, label or tag state, wallet membership,
satoshi bounds, loaded funding or spending evidence, and bookmarks. Active
filters appear as removable chips under the graph controls; **Reset filters**
clears all of them but never restores manually hidden entities, which have their
own chip.

**Isolate** limits the view to one or two hops around the current selection and
follows it as you navigate. **Show connections (+N)** adds loaded one-hop
neighbours of the current filter matches without fetching anything; **Hide
connections** returns to the matches. **All amounts** in the graph toolbar hides
outputs at or below a satoshi threshold; the transaction view has an
independent threshold, and the selected output and unknown values always stay
visible.

**Entities** lists and paginates every loaded item. **Match graph** keeps the
list aligned with the canvas; **Not hidden**, **Hidden** and **All** let you
find items that filters or hiding have removed from view.

### Select several items

**Select** in the graph controls or in **Entities** turns on selection mode:
checkboxes appear on rows, and Ctrl/Cmd+click toggles a node on the canvas, in
the list or in the transaction view. **Select N matching …** takes the current
filter results. The floating toolbar shows the count, how many selected items
are not on the canvas, and offers **Label**, **Tags**, **Icon**, **Hide**,
**Isolate** and **Clear**. Batch labels and icons keep existing values unless
you tick Replace. Every batch is one autosave and one Undo step. Selections are
cleared when you switch workspaces.

### Hide, restore and remove

Eye buttons in **Entities**, the Inspector and hover cards hide an entity while
keeping its annotations; **Show all hidden** restores everything. The remove
button deletes a loaded transaction from the workspace, including its
input/output annotations, or stops watching an address while keeping shared
transactions. Annotated data asks for confirmation, and Undo restores either
action. Removing a transaction also drops parent context that nothing else uses.

## Annotate

Select an item and use the Inspector's **Annotations** section for its label,
notes, tags, icon and bookmark. Edits save automatically. Labels record your
observations and never change chain data.

**Tags** group items with a name, color and optional description. Create or
assign one from **Add or choose tags** in the Inspector, from the batch toolbar,
or from the **Tags** panel, which also searches, edits, deletes and shows tag
members. Tagging an address can include all of its loaded outputs, present and
future. **Group existing labels** creates tags from matching labels, including
BIP329 imports; review those groups before treating them as known
counterparties.

The **Wallet** section below Annotations lists imported wallets whose derived
addresses match the selected item. For a transaction this means a matching
input or output, not ownership of the whole transaction. The graph highlight
selector shows wallet matches, tags, both or neither; tag colors win when both
are shown.

**Undo** and **Redo** in the header keep up to 15 steps for the current session.
Hover either for the next action. Loading new chain data clears the history so
an undo can never discard downloaded transactions.

## Wallets

### Add a wallet

Open **Wallet** and choose **Add wallet**, then paste an account-level extended
public key (depth 3):

| Network  | Accepted encodings     |
| -------- | ---------------------- |
| Mainnet  | `xpub`, `ypub`, `zpub` |
| Testnet4 | `tpub`, `upub`, `vpub` |

Pick the script type your wallet actually uses: legacy P2PKH, nested SegWit,
native SegWit or Taproot. `ypub`/`upub` and `zpub`/`vpub` constrain the choice;
`xpub`/`tpub` do not. Compare the previewed first receive address with your
wallet before scanning. Master keys, descriptors, multisig and custom derivation
paths are not supported.

Adding a wallet opens it in the Wallet workbench. Choose **Refresh** to discover
its addresses and history; importing the key does not start analysis.

Scanning queries receive and change histories through your backend in bounded
batches, using a gap limit, a maximum index and a transaction budget. Your key
never leaves the browser, but the backend and upstreams see the queried script
hashes. Reaching a limit leaves an incomplete view; cancel means incomplete, not
empty.

### Review a wallet

The **Wallet** workbench shows one wallet at a time. The coverage strip states
the last check, discovered and used addresses, loaded versus known transactions
and the current UTXO count and balance from the last verified check. If no
check has run, it says so and offers one.

Six tabs share one list and detail panel: **To review**, **UTXOs**,
**Transactions**, **Addresses**, **Sources** and **Destinations**.

- **To review** queues current UTXOs and used addresses first, then earlier
  receipts, sources, refreshed activity, destinations and analysis findings.
  Each item explains why it is here and shows its evidence. **Mark reviewed**
  completes it; **Review later** defers it to **Show → Review later** without
  losing it. Decisions are encrypted with the workspace and only reappear when
  the underlying observations change. **Finding types** filters by category with
  counts; selected types combine with OR.
- **UTXOs** checks discovered addresses through your backend when opened,
  including mempool activity, 100 addresses per action. The result carries its
  check time and coverage and is not stored as a balance.
- **Transactions** lists known history, newest first, including entries whose
  details are not loaded yet. Selecting one loads it if needed.
- **Addresses** lists derived receive and change addresses with their index and
  loaded output count. Opening it does not scan.
- **Sources** and **Destinations** group one-hop counterparties by address:
  who funded transactions that paid you, and who was paid by transactions
  spending your outputs. Your own addresses are excluded. Missing inputs are
  resolved in bounded background batches with **Load next** and **Retry**.

Select a row to label, tag or set an icon for it, then use **Show** to open it in
Graph or **Isolate** to open it with only its connected context. **Select
related** picks rows sharing the same address or transaction. Checkboxes,
Ctrl/Cmd+click and Shift+click build a selection; **Select all (N)** takes the
whole filtered list. Batch edits appear in the same detail panel and are one
Undo step each.

**Refresh** checks the wallet for new activity and keeps your selection, labels
and camera; new transactions are flagged until you review them. **Analyze** runs
the analysis tools on the wallet's loaded data. **Check activity every 30s**
polls wallets and watched addresses while the workspace is unlocked.

A label is your context, not a proven identity. **No wallet match** means no
match to discovered addresses, not proof that someone else owns the output.
When selected outputs carry different recorded sources, a note points out that
spending them together would publish that link; Chaingraph has no coin
selection, signing or broadcast.

## Analysis

Open **Analysis**, choose a scope and press **Scan**. **Workspace** uses every
loaded transaction; **Selection** follows the selected transaction, output,
address or wallet; each wallet is also available directly. **Options** adjusts
each tool's parameters and controls whether missing input data is loaded before
scanning.

| Tool                          | What it reports                                                                                    |
| ----------------------------- | -------------------------------------------------------------------------------------------------- |
| Equal-output detection        | Groups of equal, spendable outputs. A pattern, not a CoinJoin verdict.                             |
| Common-input ownership        | Tentative input groups, with skipped equal-output candidates and missing evidence made explicit.   |
| Address reuse                 | Repeated destinations in the scoped history.                                                       |
| Value flow and fees           | Input/output reconciliation and fees when all inputs are known; otherwise what is missing.         |
| Consolidation and fan-out     | Transaction shapes matching your thresholds, without assigning intent.                             |
| Script-type comparisons       | Input/output script patterns and optional change-like hypotheses.                                  |
| Imported-wallet intersections | Transactions touching more than one imported wallet, distinguishing overlap from independent data. |

Findings open in review-priority order with their tips, affected entities and
supporting transactions linked individually. **Show on graph** selects the
evidence; **Isolate** additionally filters the graph to it, with a removable
chip. **Exclude** removes a finding's overlay until you restore it. New wallet or
transaction evidence marks old findings stale. Findings never rewrite the
observed graph, and annotations stay independent of them.

## Connection scans

Select a transaction or output and open **Scan** in the Graph inspector. Choose
a direction (**Both**, **Sources**, **Destinations**) and a target scope:

- **Neighbours** (default): the nearest 1,000 loaded nodes, chosen without
  direction bias and without fetching anything.
- **Visible graph** or **All added nodes**: everything currently shown, or
  everything added including hidden and filtered nodes (up to 1,000).
- **Custom targets**: **Pick target(s)** and click transactions or outputs in
  the graph; **Done** applies, **Esc** cancels.

The scan summary shows transactions checked and the deepest hop reached from
either search side. Open its details for the number of connections found in that
run and its limits. Older saved scans may not have a recorded depth.

Defaults are 3 transaction hops, 200 examined transactions, 30 seconds and a
50-branch stopping point; advanced controls allow up to 8 hops, 1,000
transactions, 60 seconds and 200 branches.

Findings stream into cards while the scan runs:

| Finding                                                                            | Meaning                                                                     |
| ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Funding / spending path                                                            | An observed path links the selection to a target.                           |
| Reconnection                                                                       | The found path and an existing route form a loop; Add reveals both.         |
| Shared ancestor / shared descendant                                                | Two paths meet at an earlier or later transaction or output.                |
| Many inputs / many outputs                                                         | A branch threshold was reached; add the path and pick a branch to continue. |
| Unspent output, Coinbase origin, Unspendable output                                | Natural path endings, listed under **Endpoints**.                           |
| Transaction unavailable, Lookup failed, Spend status unknown, Conflicting evidence | Evidence problems; **Recheck endpoint** retries one.                        |

**Add (+N)** adds a path and its connecting links as one Undo step. Clicking a
node in a path adds just that node. Conflicting evidence allows only **Add
prefix**. Dismissed findings stay hidden if rediscovered; new scans keep earlier
results, and **Clear all results** removes them without touching the graph.
Results are encrypted with the workspace, bounded to 20 scans and 50 findings
each. Leaving Scan, switching workspaces or locking stops a running scan.

A scan does not enumerate every path or guarantee the shortest one. No
connection within the limits does not prove absence, and a shared transaction
implies neither common ownership nor which input funded which output.

## Scripts and raw transactions

Transaction rows show input/output counts and a confirmation status from
recorded observations: a block height, **Unconfirmed** for a mempool
observation, or **Status unknown**. The Inspector's **Scripts and raw
transaction** section shows saved output scripts as hex and opcodes. **Load raw
transaction** fetches and verifies the serialized bytes for scriptSig, witness,
version, locktime and size. Raw data stays in memory for the current selection
only. Decoding never executes scripts or verifies signatures.

## Freshness and limits

Loaded data is a snapshot. Confirmation counts are not recalculated against the
tip, reorganizations are not detected automatically, and the connection
indicator reports backend and upstream status, not synchronization. Reload a
transaction when its current state matters.

Address and wallet loading fetch at most 500 eligible transactions per action;
funding expansion and spending discovery are bounded the same way. Workspaces
hold up to 10,000 transactions and 50,000 records, and plaintext is limited to
32 MiB before encryption. Browser quotas apply on top. Export before an
investigation grows large.

## When something fails

- **Backend disconnected**: check that network's RPC credentials and Electrum
  endpoint. **Connection details** lists each configured network.
- **Network not configured**: add `.env.mainnet` or `.env.testnet4` to the
  backend's configuration directory and restart. Core and Electrum must serve
  the same chain.
- **Transaction unavailable**: the node may lack the transaction or `txindex`;
  Chaingraph also tries the Electrum server.
- **Incomplete history**: a bound was reached. Do not infer "no activity" from
  data that could not be loaded.
- **Autosave failed**: export the unlocked workspace immediately. Another tab
  holding the same workspace requires a reload; unavailable storage requires a
  browser with IndexedDB or Web Locks. Clearing site data deletes saved
  workspaces.
- **Encryption unavailable**: use `localhost` or HTTPS. Plain HTTP on a LAN
  address is not a secure context.

Backend setup is covered in the [deployment guide](deployment.md).
