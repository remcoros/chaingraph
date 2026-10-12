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

**BIP329 metadata exchange is plaintext.** The workspace menu opens an import or
export dialog for the whole workspace. The buttons beside the wallet selector
open the same dialog scoped to that wallet. You can also choose selected
entities. Select the source or destination software to use its field meanings:

| Software                 | Imported into Chaingraph                                              | Exported by default                                                 |
| ------------------------ | --------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Generic BIP329 / Sparrow | Literal entity labels                                                 | Populated entity labels                                             |
| BTCPay Server            | Each repeated label becomes a tag; existing entity labels stay intact | One record per tag membership                                       |
| BlueWallet               | Transaction memos become Notes                                        | Transaction Notes, falling back to the entity label                 |
| Bitcoin Keeper           | Transaction text becomes Notes; address/output strings become tags    | Transaction Notes with label fallback; repeated address/output tags |

Generic and Sparrow support transaction, address, output and extended-public-key
labels. Unsupported types, such as input and silent-payment scan-key records,
are listed as skipped entries. Optional source fields such as `spendable`
and height are not applied to chain observations. Commas, brackets and other
punctuation remain literal text; strings are never automatically split into tags.

**Import shows Changes to apply before confirmation.** Existing nonempty labels and
Notes are kept by default; tag memberships merge. The **Mapping** section lets
you keep or replace existing text and choose where transaction memos or notes
are saved. Expand **More options** to apply explicit empty-label clears, create
labels from imported tags, choose a source account, or rename matching wallets
from key labels. Each applied import is one Undo step. Differing source
values for the same entity are excluded until you choose an account/origin or
explicitly select the first or last entry in the file. Expand **Conflicting labels**
to compare each entry's text, source line and origin before choosing. Source account
choices keep distinguishing path endings visible; expand the selected origin to
read it in full. Repeated BTCPay and Keeper tag records
merge instead. Origins are review context and are not saved as a separate
per-account annotation model.

Malformed, unsupported and wrong-network records can be excluded while you
import the valid records shown in the preview. Expand an outcome to see the
affected source lines and items. **Existing text kept** compares current and
incoming text and explains how to replace it; **Already up to date** means the
text or tag is already saved. Skipped entries are grouped by their reason, with
the relevant recovery action. **Other file fields** lists additional fields
that are left out. Confirm the file's source network: addresses
and public keys are checked, but transaction IDs cannot reveal the network.
Whole-workspace imports can retain metadata for references without a loaded
match; the count includes only items whose metadata will change. Wallet scope includes only references associated
through known wallet addresses and loaded script evidence. No import downloads
transactions or changes wallet scan coverage.

Labels and wallet names support 255 JavaScript UTF-16 units, Notes 10,000 and
tag names 100. BIP329 suggests 255 characters as a default rather than a universal
maximum. Over-limit values are excluded by default; explicit shortening shows
original and resulting text for review. Export shortening leaves native text intact.
Shortening preserves complete Unicode characters. Distinct names that would collide
after shortening and destination trimming are excluded. Files over
5 MB or 10,000 nonblank records are rejected as a whole. Exports use those same
safety budgets, with BTCPay's smaller 1 MB file budget; narrow the scope if the
download is blocked. BTCPay values are trimmed and limited to 50 UTF-16 units.
Sparrow ordinary labels use 255 and its key names use 16.

**Export previews the actual file before download.** Switch between **Table**
and **JSONL** to inspect the same page of records in file order. The table shows
the exported `type`, `ref` and `label`; expand a value to read it in full. JSONL
shows complete serialized lines, including escaped characters. Page controls
cover the entire export. **Text changes** compares original and exported text
when shortening or trimming applies. Oversized exports show totals and the
limit, with no file preview until the scope is narrowed.

Changing settings keeps the previous review visible while the preview updates;
Apply and Download become available when the new review is ready. Conflict and
shortening choices stay available to change back, and expanded results stay open.
If a preview cannot be prepared, **Retry preview** uses the same file and settings.
Escape dismisses an open question-mark hint first; the next Escape closes the dialog
and returns focus to its opening control or the workspace menu. The export footer
identifies the download as **Unencrypted JSONL** before you save it.

Key labels are off by default
and available for Generic/Sparrow only. Including wallet names as fallback key
labels is a separate option under **More options**. The **Content** section shows
which fields supply the destination's labels or transaction memos/notes. Its
tag choice can append readable tag names to that text; question-mark hints
explain the mapping with examples. BTCPay and Keeper can explicitly include entity
labels alongside tags. Single-string destinations can explicitly compose tags
into readable text such as `Shop payment [business, reviewed]`; on re-import
that string stays literal. BlueWallet and Keeper can use entity labels instead
of Notes for transaction text. Ordinary exports omit empty labels, so portable
clearing through other wallets is not promised.

BlueWallet is available only on mainnet for the audited release. Keeper exports
require one selected wallet: **Import into the matching wallet in Keeper**.
Chaingraph exports origin-free records rather than inventing a descriptor with
an unknown master fingerprint or derivation path.

BIP329 files do not preserve icons, bookmarks, tag colors/descriptions, layout,
findings or the complete native metadata. Use encrypted workspace export for a
full backup. The [representative example files](../public/examples/bip329/README.md)
work with **Explore a public demo wallet** and include manual testing instructions
and a file with recoverable errors, conflicts, length boundaries and clears.
The import dialog offers these downloads when that public wallet is loaded.

## Look up activity

Type a transaction ID, an address or an outpoint (`txid:index`) in the quick
input (Ctrl/Cmd+K). An entity that is already loaded is selected and centered
immediately, even offline. The **Previous** selector beside the input loads one
or two levels of earlier transactions along with the lookup; it defaults to off
and both levels share a 500-transaction budget.

With a transaction selected, **Load previous txs** adds one earlier level. For an
output, **Open creating tx** loads only the transaction that created it, and
**Find spending txs** looks for transactions that spent it (or any output of a
selected transaction). If the optional Core exact-output spender lookup is
configured for that network, a complete reply is used directly, including an
empty result. An empty result is not proof that the output is unspent. Otherwise
the search checks script histories through your backend, up to 500 candidate
transactions per action; repeat the action to continue. If that bounded fallback
reaches the configured address-history limit, the feedback explains whether the
Core lookup is not configured or could not be used, and keeps any verified
spenders already loaded. For an exact output with no loaded spender, the app can
check Core's current UTXO set and report an unspent observation, absent or
unknown. Absent is not the same as spent.

The refresh icon in the Inspector's top bar checks an output's **current UTXO
status** on demand, including mempool spends. The result is timestamped and kept
under **More details** for the current selection.

### The transaction view

Selecting a transaction or output opens a collapsible inputs/outputs view above
the graph. Inputs and outputs sit around the central transaction; long lists
start collapsed. Curved arrows connect visible rows to the transaction, with
emphasis on selected rows. They do not allocate inputs to specific outputs.
Select an input to follow its previous output while keeping the
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
branches. In 3D, substantial downstream groups receive distinct spatial branch
directions while transaction order always advances along the graph's X axis.
Each transaction's input and output groups stay on its X-facing sides; a shared
output between visible transactions follows their connecting edge. Each
transaction and its unconnected input/output group gets enough X space to form
one readable event band. Block height orders compact sibling bands without
turning block gaps into empty distance. Mempool transactions and transactions
whose order is unknown use the most recent available band. New nodes extend the
established branch without moving existing ones; **Repack** rearranges everything
visible and applies newly observed ordering to all bands. By default, three or
more outputs that connect the same creating and spending transactions appear as
one **Multiple outputs** symbol and one connection path. Hover the symbol to see
its output count, or select it to create a multiple selection containing those
outputs. The orbit-style graph control turns this compaction on or off; its
legend key is shown only while compaction is enabled. **Size by** treats the
symbol as the combined group: every output is sized under the active mode, then
the group preserves their combined rendered volume. This also preserves the
effect of per-output presentation scaling. The sparse four-circle glyph receives
an additional shape compensation so its visible material does not look smaller
than the solid output spheres it replaces.

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

When an address is selected, two adjacent icon-and-count toolbar buttons reveal
outputs and the last five transactions. The output action adds or reveals every
loaded output whose script directly matches the address, including outputs that
were later spent. The transaction action uses cached observations, fetches only
missing details for that bounded set, then adds or reveals five or fewer
transaction nodes without changing the current selection. The output total is
limited to loaded address-history detail; an incomplete address history remains
incomplete evidence. The address-history button remains available for selected
inputs and outputs.

Floating controls over the canvas provide **Fit**, zoom, **Center** on the
selection, **Lock** (keep the selection centered as it changes), selection
history, **Isolate**, filters and **Repack**. **Motion** toggles flow dots and
camera inertia; the dots show transaction direction along the paths connected to
your selection. **Show labels**, **Show tags** and **Show icons** control captions
without touching annotations. **Size by** switches between uniform, value-based
(logarithmic) and degree-based node sizes. Address nodes use their observed
balance when one is available; unknown balances are not treated as zero. On
desktop, **Hide panels** collapses both side panels to give the canvas more room.

Hover a node for a card with identifiers, value, and compact actions. Connection
lines do not open cards. The Inspector and the entity list provide the same
actions with the keyboard.

### Filters

The **Filters** popover (also **More filters** in **Entities**) restricts the
canvas and the list by entity type, label or tag state, wallet membership,
satoshi bounds, loaded funding or spending evidence, and bookmarks. Active
graph filters appear as removable chips under the graph controls; **More
filters** in **Entities** shows the active count. **Reset filters** clears all of
them but never restores manually hidden entities, which have their own chip.

The link icon in **Entities** is enabled by default, so its filters also change
the graph. Turn it off to keep filters local to the panel; the graph keeps its
current filters and selection, and **Select** is disabled until the link is
restored. Restoring the link makes the panel follow the graph's current filters
and selection.

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
the list or in the transaction view. The **Entities** link icon must be enabled
for panel selection. **Select all (N)** takes the current filter results. The
floating toolbar shows the count, how many selected items are not on the canvas,
and offers **Label**, **Tags**, **Icon**, **Hide**, **Isolate** and **Clear**.
Batch labels and icons keep existing values unless you tick Replace. Every batch
is one autosave and one Undo step. Selections are cleared when you switch
workspaces.

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
Hover either for the next action. Chain refreshes preserve this history: Undo
and Redo restore your edits while keeping accepted observations. Explicitly
adding or removing a transaction remains undoable.

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

Adding a wallet opens it in the Wallet workbench and starts its first refresh.
**Refresh** discovers history, loads available transaction details, checks coins
and updates analysis when material evidence changes.

Scanning queries receive and change histories through your backend in bounded
batches, using a gap limit, a maximum index and a transaction budget. Your key
never leaves the browser, but the backend and upstreams see the queried script
hashes. Reaching a limit leaves an incomplete view; cancel means incomplete, not
empty.

### Review a wallet

The **Wallet** workbench shows one wallet at a time. The header shows the wallet
picker, observed balance, oldest contributing check date and **Refresh**.
**Coverage** discloses discovery bounds, known versus loaded history and coin
checks. Missing evidence is unknown; a partial balance is identified as partial.
The actions menu contains **Wallet details**, **Add wallet**, **Automatic refresh**
and **Refresh settings**. Account-key reveal/copy lives in Wallet details.
Refresh runs wallet analysis when its inputs change and retries failed tools.

Five tabs share the existing list and detail panel, with **Transactions** first:

- **Transactions** lists known history, newest first, including missing details.
  Received, Sent, Transfer and Unknown describe the observed wallet effect.
  The signed amount is wallet outputs minus wallet inputs; an ordinary outgoing
  payment includes its fee. Details show wallet inputs, outputs, net change and
  the whole transaction fee. Incomplete inputs leave the effect unknown and
  offer loading. Collaborative transactions do not allocate the whole fee to
  your wallet. The label icon opens the transaction label editor; the counterparty
  icon opens its sender/recipient editor; the review icon opens the
  selected assessment in Review.
- **Coins** shows observed unspent outputs from discovered scripts. Refresh checks
  every discovered address in bounded batches. Successful observations retain
  their dates in the encrypted workspace. A failed check preserves previous
  observations without renewing them. An exact loaded spender excludes an old
  coin from current candidates; its dated observation and decisions remain saved.
- **Addresses** offers **Wallet (all)**, **Wallet (receive)**, **Wallet (change)**,
  **Sources** and **Destinations** in its **Addresses** selector. Wallet rows show
  their branch and index. The inspector shows a derivation such as
  `account/1/7`, relative to the imported account key; its full origin path is
  unavailable. These choices combine with search, labels, tags and **To review**.
  Sources and
  Destinations group observed one-hop address relationships,
  excluding this wallet's scripts. Missing source inputs can be loaded in bounded
  batches. These relationships are evidence, not proven identities or ownership.
- **Counterparties** manages reusable identities across the workspace. Create or
  search for identities using the inline Sender/Recipient field or the counterparty icon in a row
  footer. Check several names without closing the selector. **Choose coins…** or
  **Choose outputs…** beside a selected name opens its assignment in the same popover.
  Keep **This payment** or choose specific received coins/payment outputs. Wallet
  outputs and data outputs are grouped separately; **Apply** saves the assignment,
  while Back or **Cancel** leaves it unchanged. Associations concern exact incoming/outgoing transaction
  activity or an explicitly chosen address/output; they do not allocate value or
  infer ownership. Identity names, notes, tags, icons and bookmarks are ordinary
  annotations. Related transactions use an exact scope. Unlinking one association
  and deleting an identity are separate actions. Links survive wallet removal
  and reimport when their concrete activity remains saved.
  Select an identity to edit **Name**, **Category**, **Tags**, **Note** or its icon
  beside each value. **Show in Transactions** filters the wallet list to its
  related activity. The **…** menu offers **Bookmark** and **Remove counterparty**,
  with confirmation before removal.
- **Review** groups unmet annotation goals and applicable finding assessments.
  A transaction label, note or tag describes its purpose; senders and recipients
  identify who was involved. Edit these fields in the record details. Answered
  questions disappear. **Needs review** appears beside the relevant field;
  click it for the question, a shortcut to its editor, and **Unknown**, **Not needed**
  or **Later**. These keep the distinct cannot-identify, no-annotation-needed and
  review-later outcomes. The purpose question appears once beside **Label**, and
  **Label**, **Note** or **Tags** can answer it. Saved identities and their output
  scopes remain visible in the fields. Inherited associations identify and edit
  their source. These annotations satisfy their question without recording **Reviewed**.
  Findings require explicit assessment. **Cannot identify**, **No annotation
  needed** and **Review later** are distinct outcomes. Material evidence changes
  can reopen attention while retaining the earlier judgment; routine check dates
  do not. Filters select state, scope and reasons with OR semantics. One finding
  has one decision even when applicable to several scopes. Historical
  acknowledgments remain inspectable with their original dates and meanings.

Used wallet addresses on both derivation branches have one **Describe wallet
address** goal each. Reported history, a verified matching output or a verified
coin observation establishes activity; unused lookahead does not create a task.
The address's own label, note or tag answers its question. The same context can
describe coins at that address or through the existing one-hop wallet receipt
links, without copying annotations or answering transaction purpose. New activity
does not reopen an address-purpose decision. Removing its description restores
the saved disposition, or the unanswered question if none exists. Choose the
**Address description** review reason to filter these tasks by receive/change
branch. Review and ordinary browsing retain their filter choices separately.

Factual lists remain available without analysis. **To review (N)** narrows them
by outstanding linked work. The same inspector presents facts, annotations and
review decisions in the factual tabs and Review. Explicit decisions remain visible
with **Reopen** or **Return to review**, and making a decision keeps the record open. The list displays 40 matching rows at a time; **Show more** reveals the
next group. Accounting and related evidence expand on demand. Filters, inspected
records and editors remain stable through refresh
and goal satisfaction. Each tab remembers its filters, inspected record, scroll
position and revealed rows separately for each wallet. Returning to a tab resumes
that position, including any linked inspector and checked selection. Checked
selections and Back history last while the workspace is unlocked; reopening
restores saved browsing positions with no checked rows.

IDs stay visible above labels. Dates sit on the left of each row footer, with label,
counterparty and review actions on the right. Copy controls are in the inspector;
review icons show the number of outstanding items. **Inputs (N) / Outputs (N)**
expands one section with two columns, stacked when the inspector is narrow.
All tabs use plain selectable rows and the same inspector layout. Related transaction
and address links in Counterparties also retain their IDs above any labels.
Transaction inspectors show direction and signed wallet amount on the first row,
with the stable ID/copy beneath. A **Needs review** chip appears for outstanding
reviews. Address inspectors use matching titles for receive, change, source and
destination addresses, with the address and copy action beneath. The header
shows **Balance**, with transaction count and wallet-address derivation below.
Known zero balances remain visible. **Check balance** or **Refresh balance**
checks the selected address through your backend. Until checked, the balance
shows **Not checked**. Checked balances show their age. Balances come from dated balance or coin checks, never
from summing historical receipts. An incomplete transaction count shows how many
details are loaded; pending balance changes appear only when present.
Their metadata and findings use the same columns as Transactions, with related
transactions in **Address activity**. Coin and output inspectors show their
type, amount and outpoint/copy in the same header layout, followed by the coin
check and recorded block information. The exact address opens its inspector
when available. Coin check dates apply only to matching observed coins.
Counterparties show their name below the type heading, with wallet transaction
and workspace association counts. **Metadata** and related **Transactions**
sit side by side, with address and association details below. **Show on graph** and
**Isolate** icons sit beside **Transaction flow**; the custom icon editor sits
beside **Metadata**. Transaction headers show the UTC block timestamp with its
age, block height or status with recorded confirmations, network fee and rate, and available transaction
size beneath the identity and amount. **Metadata** groups **Label**,
**Sender/Recipient**, **Tags** and **Note** on the left, with **Review findings**
on the right. Coins and outputs use the same metadata/findings columns.
The columns stack when the inspector is narrow. Annotation
names use a fixed-width column, with smaller muted labels and larger foreground
values. Click a value to edit it. In transaction Metadata, a plus marks empty
fields and a pencil identifies editable values. Empty fields show
**Add a label…**, **Add tags…** or **Add a note…**. **Name** and **Category** in
Counterparties follow the same pattern. Click a sender or recipient value to edit
its selection; the small navigation icon beside it opens the counterparty.
Its sender/recipient selector keeps multiple selections open. **Choose coins…** /
**Choose outputs…** opens a focused **Received from** / **Paid to** view. Specific
assignments show addresses, labels, output numbers and amounts; saved assignments
remain visible beside the name. Icons are visible even without a label.

Annotation review chips sit beside their fields, with quieter indicators for
postponed and resolved decisions. **Review findings** in transactions, addresses and coins
holds the collapsible status checklist. **Mark reviewed** and **Later** are grouped with
each finding, with **Reopen** for existing decisions. Rows show concise fee or
script information; the help icon reveals longer technical details. Address and
coin titles retain navigation to the exact review target. Annotation popovers put
**Add sender** or **Add label** above **Unknown**, **Not needed** and **Later**.
**Add sender** opens the existing sender selector; **Mark reviewed** records a
finding assessment. Answered
annotation questions disappear; explicit decisions stay available to reopen.
**Transaction flow** spans the width below these groups and starts expanded for
transactions. Curved arrows connect visible inputs and outputs to the transaction,
with matching line and arrow colors for the selected record. The transaction card
shows its ID and input/output counts, annotation icon, label and tags, followed by
block time and fee information when known. Input/output cards show the address,
using the available width while retaining its ending and copy action,
with **Your wallet** at the bottom left when matched and the amount at the bottom
right. **Show on graph** and **Isolate**
remain in the flow header. Narrow panels stack
the lanes so amounts remain readable. Collapse it to hide the diagram. **Inputs/Outputs**, **Wallet
accounting**, and related records remain available below it. Available wallet records open in the
inspector with **Back**, preserving the list and its filters. External or unavailable
records have explicit graph actions. **Related** remains available for batch
selections sharing an address or transaction.
**Show in Transactions** and links into a record's review items open a temporary
view with **Back to Counterparties**, **Back to Transactions**, or the originating
tab. This return appears beside the related-activity or review filter and restores
the originating tab's position and selection, including when you have opened a
related record in its inspector. The inspector's own **Back** returns one record
at a time. The destination tab's earlier normal position is preserved for your
next ordinary visit, without the completed return link. Nested jumps
return one step at a time; annotations and review decisions remain saved.
Checkboxes, Ctrl/Cmd+click and Shift+click build a selection. The checkbox in the
list header selects every matching record, including rows below **Show more**;
the next column shows the displayed/matching count. Filtering keeps checked
records selected and reports those outside the current filter. Batch actions
apply to the complete checked selection. Batch edits are one Undo step each. A contextual
jump offers **Back to Wallet** and restores its originating control when available.

**Automatic refresh** defaults on and is saved with the encrypted workspace.
Unlock displays saved activity then checks wallets sequentially, selected first.
The default 60-second cadence runs across workbenches while unlocked, pauses in hidden
browser tabs and checks freshness on return. Selecting a stale wallet triggers a
check. Foreground operations interrupt background refresh; completed batches stay
accepted. The header shows **Last refresh** after a complete refresh; balance
coverage retains the separate dates of its contributing coin checks. Refresh spins
without changing the layout. Limits, failures and **Retry refresh** appear inside
**Coverage**, with a warning beside its title. Use **… → Refresh settings…** to
change the interval and discovery limits. **Automatic refresh** in the same menu
turns periodic checks on or off; explicit Refresh and first-import refresh remain available.

Labels and counterparties are your annotations, not proven identities. **No wallet match**
means no match to discovered addresses. A co-spend warning describes the link
spending selected outputs together would publish; Chaingraph has no coin selection,
signing or broadcast. Hiding amounts and balances is a separate planned feature.

## Analysis

Open **Analysis**, choose a scope and press **Scan**. **Workspace** uses every
loaded transaction; **Selection** follows the selected transaction, output,
address or wallet; each wallet is also available directly. **Options** adjusts
each tool's parameters and controls whether missing input data is loaded before
scanning. Analysis keeps its **Finding types** filter for algorithm categories;
Wallet calls its broader queue facet **Review**, which also includes the
current Analysis tools. **Older or unknown findings** appears there only when
applicable. Analysis counts cover all findings in the current result scope and do not change with the priority,
evidence or list pagination controls. Empty choices and groups are available
through **Show all**.

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
chip. Both offer **Back to Analysis**. **Exclude** removes a finding's overlay
until you restore it. Changes to the inputs a finding depends on mark it
stale. Another confirmation alone does not invalidate a structure-only finding;
new input amounts can require a fee analysis to be rerun. Refreshing data is not
the same as rerunning analysis. Findings never rewrite the observed graph, and annotations stay
independent of them.

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
1,000-branch stopping point; advanced controls allow up to 8 hops, 1,000
transactions, 60 seconds and 1,000 branches.

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
