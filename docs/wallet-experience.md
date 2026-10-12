# Wallet refinement experiment

This experiment builds on the existing Wallet workbench layout and styling.
Transactions are the initial view, followed by Coins, Addresses, Counterparties
and Review. Each visible tab retains its own filters, inspected record, revealed
rows, scroll and explicit selection per wallet. Addresses retains its selected
Wallet/Sources/Destinations scope as part of that position. One Addresses selector offers
Wallet (all), Wallet (receive), Wallet (change), Sources and Destinations.

## Refresh

One Session-owned Refresh intention discovers history, loads admitted transaction
details, checks every discovered address in bounded batches, and updates local
analysis when its material inputs change. Completed history and coin batches
survive cancellation or later failure. Failed checks retain prior observations.
Discovery limits, missing details and failed checks remain actionable and partial;
refresh does not promise activity beyond the configured discovery scope.

Automatic refresh defaults on and its setting belongs in the encrypted workspace.
Import refreshes immediately. Unlock shows saved activity then refreshes the
selected wallet. All wallets refresh sequentially on a default 60-second
cadence, selected first, without overlapping runs. Selecting a wallet checks it
when its last attempt is older than that interval. Periodic work pauses in hidden
browser tabs, checks freshness on return, and stops at workspace lock or switch.
Foreground operations take priority through the existing operation owner. Quiet
refreshes reuse prepared relationships, review items and findings; observation
dates update independently. The encrypted View owns the editable interval.
Background refresh shows only a fixed-size spinner in Refresh. Coverage has a
reserved warning icon for partial results or failures, with progress and recovery
actions inside its disclosure. Last refresh records completion of history, coin
checks and required analysis, separately from scan and balance-check dates.
Material evidence still invalidates the affected preparation.

Each wallet remains one imported account derivation. Balances stay separate.
Balance is an observation of discovered addresses, with coverage and the oldest
contributing check date. Unknown data never becomes zero or unspent.

## Accounting and review

Rows show IDs first with an inline direction icon and signed wallet net change;
optional labels sit below the ID. A fixed footer holds label, counterparty and
review controls on the right, with the timestamp on the left. Copy controls stay
in the inspector. Transaction inputs and outputs share one expandable section
with two columns, stacked in a narrow inspector. Metadata values
belong in the inspector. Direction is Received,
Sent, Transfer or Unknown. Net change is matching outputs minus matching inputs;
an ordinary outgoing payment includes its fee. Details expose matching inputs,
matching outputs, net change and the whole-transaction fee, without attributing a
collaborative transaction's fee to this wallet. Incomplete evidence keeps the net
effect unknown and offers a data-loading action.

Review is unmet annotation goals and explicit finding assessments. A transaction's
label, note or tag answers its purpose question. Counterparties answer who sent or
received it and do not satisfy purpose. These annotations, added from any supported
view, satisfy their own goal without fabricating a Reviewed decision.
Each derived wallet address with reported history, verified output activity or a
verified coin observation has one address-description goal, on either branch.
Its own label, note or tag satisfies it; unused lookahead does not create a goal.
Address context also supplies coin context through the existing exact address and
one-hop receipt links, without copying annotations or answering transaction purpose.
Additional activity does not reopen address-purpose dispositions. Removing context
reveals its saved disposition or restores the unanswered goal. Address goals retain
their own Review row and related transaction evidence.
Missing chain evidence, missing descriptions and unassessed
findings remain distinct. Cannot identify, No annotation needed and Review later
are distinct deliberate outcomes. Findings need assessment; material support
changes can reopen attention while preserving the earlier judgment. Routine
confirmation/check dates do not reopen work. Historical acknowledgments preserve
their original meanings and evidence; eligible finding assessments receive a
one-time baseline from validated saved support during migration.

## Counterparties and UI

Counterparties are workspace-wide human identities with exact incoming/outgoing transaction or
explicit address/output associations. Received from and Paid to support search,
creation and multiple selections in a persistent checklist. Creating or selecting
an identity keeps the selector open. Choose coins / Choose outputs beside a selected
identity opens a focused view in the same popover. Received from / Paid to names the
relationship; This payment keeps a general association, while specific assignments
show received wallet coins or payment outputs. Addresses stay primary, with labels
and output numbers below and amounts on the right. Verified wallet outputs and data
outputs remain available in separate disclosures. Back and Cancel discard scope
edits; Apply returns to the name checklist. Narrow assignments show their coin/output
count in the picker and exact outputs in the inspector. Inherited context offers an
explicit action to edit the source payment. Transfers do not prompt for external parties.
Associations do not establish ownership or allocate transaction value. Concrete
associations survive wallet removal/reimport. Removing a link and deleting an
identity are separate actions. Annotations owns names, notes, tags, icons and
bookmarks; Counterparties owns identity and association validity. Future Graph
support consumes the same model.

The compact header shows wallet picker, observed balance, Last refresh, Refresh
and the standard actions menu. Automatic refresh is a checked menu item;
Refresh settings opens the interval and discovery controls. Wallet details owns
account-key reveal/copy. Coverage is disclosed;
partial states, failures and recovery actions remain visible when needed.
Extend the existing list and detail layout, preserving inspected records, filters,
selection and active editors through refresh and goal satisfaction. Row actions
open their named editors directly: the label icon edits the record label,
the counterparty icon edits its exact selection, and the review icon opens
the selected assessment. Each record has one metadata home: Label, Sender/Recipient
(or Counterparties), Tags and Note. Transaction headers group the UTC block
timestamp and relative age, block height or status and recorded confirmations,
fee total and rate, and available size beneath the identity. Direction and signed
wallet amount share the first row; the stable ID/copy occupies the second row.
Metadata and independent Review
findings share an unbordered two-column area, approximately 45/55, stacked below
600px of available inspector width. Annotation names use a fixed-width column
and small muted text; values are larger foreground text. Addresses use the same header,
metadata/findings columns and section styling, with their own address icon and
record title. Address headers show dated balance, transaction count and available
account-relative derivation. Coins and outputs use the same metadata/findings
columns, with amount, outpoint, recorded block information and exact address in
the header area. Counterparties group Name, Category, Tags and Note beside related
Transactions.
Values open their existing editors directly. Empty fields show subtle prompts
such as Add a label, Add tags or Add a note, with the same interaction across
transactions, coins, addresses and counterparties. Counterparty values open the
exact selection; adjacent navigation icons open their identities. Inherited
associations identify and edit their source. The custom icon uses the Inspector's
empty-icon symbol and remains separate from factual transaction direction.

Annotation reviews sit beside the relevant field as a small Needs review chip.
The shared purpose question appears once beside Label; edits to Label, Note or
Tags can satisfy it. Sender and recipient questions sit beside their own values.
Click a chip for a compact contextual popover: one preferred editing action,
then a quiet row of alternative resolutions.
Add sender opens the existing field editor; Unknown, Not needed and Later retain
the existing cannot-identify, not-needed and later outcomes. Deferred and
explicitly resolved decisions stay available there to return to review or reopen.
Automatically answered annotation goals lose their chip. Editing an address does
not answer a transaction's purpose question.

Independent findings retain a compact status checklist in the collapsible Review
findings column for transactions, or Review section for other records. Full-width rows
align status, finding text and direct right-aligned assessment actions. Only text
wraps; rows use subtle separators. Mark reviewed and Later remain immediately
available, with Reopen for existing decisions. Fee rows show amount, rate and the
saved threshold result when supported; script findings use a concise summary.
Longer technical evidence is available through the existing help tooltip. Address and coin checklist
links retain navigation to the exact review item. Field reviews are not duplicated
in the checklist. Explicit reviewed decisions remain reversible; changed evidence
regains assessment actions. Making a decision preserves the inspected record.
A finding shows its own supporting records rather than the union of unrelated goals.

All tabs share compact list rows, selection styling and filters above the split
view. The first list item places select-all in the checkbox column and the
shown/matching count in the content column; it selects all matching records,
including those below Show more. Single-record details have no action toolbar
or Related dropdown. Transaction inspectors begin with direction and signed
wallet amount above the stable ID/copy, separated from the static facts by a divider. Other
inspectors retain their record-type title, custom icon and graph actions.
The transaction custom icon editor sits beside Metadata; Show on graph and
Isolate sit beside Transaction flow. Transaction flow spans the full content width below
Metadata and Review findings, with a section icon and no enclosing card. It starts
expanded for transactions and retains its existing collapse and input-loading
behavior. Other record types retain their existing flow presentation.
The flow's transaction card has one identity row (transaction icon, annotation
icon, ID/copy and input/output counts), optional label/tags, then block/fee rate
and timestamp/fee rows. Input/output identifiers expand within the card width,
keeping their suffix and copy action visible. Cards show identity above a footer with a
positive wallet match at the left when present and the amount at the right. Graph actions live only in the flow
header; the repeated wallet legend and evidence-help footer are omitted.
Below it, disclosures appear as Inputs/Outputs, Wallet accounting, then
other related records. Related wallet records open in the inspector with Back,
preserving the list and its filters; unavailable or external records use explicit
graph actions. Exact related-selection shortcuts remain in the batch toolbar.
Ordinary tab clicks resume that tab without adding a Back step. Related-activity
and exact-review jumps create temporary views with contextual Back, preserving
both the origin and the destination's normal position. The named return beside
the temporary filter restores the originating tab directly; inspector Back
returns one record at a time. Repeating a contextual jump replaces an earlier
temporary destination, so completed return links do not survive an ordinary tab
visit. Nested jumps return one step at a time without undoing edits or accepted evidence. Checked selection,
range anchors and inspector/return trails survive wallet and workbench switches
within the unlocked session; locking drops them. Per-tab browsing positions are
encrypted and restored on reopening. Filtering retains checked records and
reports hidden selections; batch actions cover the complete explicit selection.

Counterparty editing uses the shared label, tag, note and icon editors. Its
inspector uses the shared type header with the name beneath, wallet activity
and workspace association counts, and Metadata beside related Transactions.
Coin and output inspectors use the same header, with amount and exact outpoint
above coin-check/block facts and the address. Metadata and Review findings
use the transaction columns; a coin-check age requires that exact output in
the matching-network observation.
The standard overflow menu contains Bookmark and Remove counterparty; removal
requires confirmation. Related activity retains IDs above labels. Editing is
never hidden in an Edit counterparty disclosure. Wallet address rows show branch
and index; their inspectors expose account-relative derivation such as
`account/1/7`, without inventing a full origin path. These details use the same
inspector in ordinary browsing and Review. Address-description Review retains
its own branch choice, separately from the Addresses browsing selection.
Address headers use the transaction typography, with receive/change or
source/destination in the title. Balance, transaction count and available
derivation form one compact facts row. A dated zero balance is visible;
missing observations show Not checked with a balance-check action. Historical
receipt totals do not substitute for balance. Pending changes and unloaded
transaction details appear only when relevant.

New monetary displays use shared amount presentation. Lurker mode is a separate
follow-up covering visible values, tooltips and accessible text.

## Ownership and verification

Session owns request lifetime, accepted observations and the complete Refresh
operation. Wallets owns accounting, review goals and preparation. Analysis owns
computation and its dependencies. The existing operation owner arbitrates
foreground/background work. View owns encrypted settings and browsing state.
Persistence owns migration; there is no second findings collection, queue runtime,
metadata store or browser storage path.

Validate accounting with partial/co-input evidence, full batch continuation,
cancellation checkpoints, late-result rejection, foreground priority, automatic
refresh lifecycle, assessment migration and exact counterparty scopes. Run
`npm run check`. Browser/screenshot QA covers transaction, Review and
counterparty interactions, refresh stability, and narrow layouts when requested.
