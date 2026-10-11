# BIP329 interoperability review and implementation

This review covers the existing implementation, including import application,
export, saved validity rules and the UI entry points. It is not a branch-diff
review. Research was checked on 2026-10-11 against BIP329 and release-pinned
BTCPay Server 2.4.5, Sparrow 2.5.5, BlueWallet 8.0.2 and Bitcoin Keeper 2.5.17
source. No external wallet was launched.
The agreed behavior below is implemented in the existing Annotations capability,
with profile-aware dialogs, reviewed application and representative public
example files. Browser usability and live external-wallet interoperability have
not been validated in this scope.

## Completed first fix

Annotation labels now support 255 characters through parsing, editing, batch
mutation and encrypted persistence. The Annotations owner supplies
`MAX_ANNOTATION_LABEL_LENGTH`; the former 200-character literals are gone from
those paths. Wallets supplies `MAX_WALLET_NAME_LENGTH`, also 255, because the
explicit matching-wallet rename can use key labels. Both wallet-name
dialogs use that limit, replacing their former 100-character UI limit.

These remain JavaScript UTF-16 length limits, consistent with the existing
string operations and Sparrow's Java limits. They are not grapheme-cluster
counts or UTF-8 byte limits. BIP329 suggests 255 characters as a default; it
does not impose a universal maximum. Inspection retains longer text until the
profile maps it to labels, Notes or tags. Over-limit target values are excluded
unless explicit shortening is selected and previewed. Native Notes support
10,000 units and tag names support 100.

Regression coverage includes 201/255-character label interchange, non-ASCII
labels, batch preservation, imported labels through encrypted save/reopen,
the actual matching-xpub import action followed by canonical validation, and
200/255-character wallet names through encrypted lock/unlock. Oversized wallet
names still fail persistence while preserving the previous good save.

The exported validity constants replace repeated limits within their existing
owners. No stored fields or workspace schema version change are needed.

## Current behavior

The workspace menu and Wallet buttons open a shared compact dialog. The menu
defaults to whole-workspace scope; Wallet defaults to the active wallet. Both
offer software profiles and selected-entity scope, except that Keeper exports
require one wallet. Import inspection retains source order, physical lines,
duplicate records and origins. Address and public-key references are validated
against the active network; transaction-only files require visible source-network
context because a transaction ID does not identify a network.

The dialog follows setup, field mapping, preview and confirmation. Import's
keep/replace choice and transaction-text mapping stay visible before the
preview; less common overrides share a More options disclosure. Field hints
explain the source and destination with concrete examples. Settings use an
aligned label column that fits its contents on desktop and stacks on narrow
screens. Preview updates reserve their previous height, and confirmation
actions remain outside the scrolling content.

Import previews the full planned operation before application. Existing nonempty
text is kept and tag memberships merge by default. Clears, replacement, wallet
renaming, conflict selection and shortening are explicit. Invalid records are
excluded with reasons while the valid subset can be applied as one Undo step.
Files over 5 MB or 10,000 nonblank records are rejected as a whole. Inspection
and preview run in cancellable, short-lived Web Workers and do not fetch data.
Application rejects stale reviewed metadata/evidence and preserves unrelated
current workspace state.

Export previews one profile-specific plaintext JSONL projection before download.
Table and JSONL views use the download's exact content, share a page of eight
records and preserve file order. Table values can be expanded, and raw lines are
complete. A separate Text changes disclosure compares trimmed or shortened
values with their originals. Over-budget plans show totals and the limit but no
file preview. Import retains a Changes to apply review and groups other outcomes
in plain language, distinguishing preserved text from already matching values.
Empty labels are omitted. Key labels are off by default; wallet-name fallback
is separately opt-in. Explicit key labels win over equivalent-key fallbacks.
Destination limits are checked before download, including BTCPay's 50-unit values
and 1 MB upload and Sparrow's 16-unit key names. Over-budget exports require
narrower scope. Shortening leaves native text intact and colliding names are
excluded. The encrypted workspace export retains the complete rich state.

## Original findings and fixes

| Priority | Original finding                               | Implemented resolution                                                                                                                                   |
| -------- | ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1       | BTCPay tags collapse during import             | Preserve repeated records until mapping; merge each distinct complete string as a tag.                                                                   |
| P1       | Import ignores the active workspace network    | Validate addresses/keys at inspection and source-network context at planning; exclude wrong-network records.                                             |
| P2       | Conflicting duplicate xpub export              | Key labels and wallet-name fallback are separate; canonicalize and deduplicate exports, excluding conflicting explicit values.                           |
| P2       | Equivalent extended-key encodings do not match | Canonical BIP32 public payload identity retains active network and explicit script-policy constraints; source policy survives annotation-key resolution. |
| P2       | Export/import size policies disagree           | Enforce compatible byte/record budgets before download, including BTCPay's smaller limit.                                                                |
| P3       | Diagnostics lose physical line numbers         | Preserve physical lines across blank lines and recoverable errors.                                                                                       |

The network, duplicate xpub, equivalent-key, record-budget and physical-line
findings were reproduced with synthetic data and public test vectors.
The review also identified App-owned import application and overlapping key-label
and wallet-name export paths. Planning/application now belongs to the existing
labels capability; App applies one intention. No replacement runtime or
coordinator is introduced. Interim reviews caught hidden active conflict controls,
equivalent-key fallback duplication and BTCPay whitespace mismatch; regression
coverage accompanies those fixes. Key-validation caching and append-only record
groups keep repeated-key files bounded without repeating expensive validation.

Unsupported `pubkey`, `input` and `spscan` records, ignored `spendable`, and omitted
optional chain fields remain scope decisions. BIP329 permits unsupported
records to be ignored. Output spendability is wallet spending policy, not evidence
that an output is unspent. Explicit clears and partial import follow the accepted
contract below. Origins are retained for inspection and deliberate conflict
resolution, not persisted as per-account labels.

## Verified wallet behavior

| Behavior                         | BTCPay Server 2.4.5                                                 | Sparrow 2.5.5                                                                |
| -------------------------------- | ------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| BIP329 label meaning             | One member of a collection of labels, similar to tags               | One literal label string                                                     |
| Several labels for one reference | Several JSONL records with the same reference                       | Matching later records replace earlier labels                                |
| Separator parsing                | None in BIP329; CSV joins labels with commas                        | None in the BIP329 import path                                               |
| Exported record types            | Transaction labels                                                  | Transactions, addresses, inputs, outputs, xpubs and silent-payment scan keys |
| Imported record types            | Transactions, addresses and outputs                                 | The same six types as its export                                             |
| Destination length               | Imported labels are trimmed and truncated to 50 UTF-16 units        | Ordinary labels use 255; xpub/scan labels are keystore names limited to 16   |
| Origin                           | Omitted on export and ignored on import                             | Exported for chain records; mismatched origins are excluded during import    |
| Comments and richer data         | BIP329 omits comments and colors; native JSON/CSV includes comments | May export unlabeled records and optional chain fields                       |
| Empty label import               | Empty and missing labels are skipped                                | Blank labels are skipped                                                     |

Sparrow can apply frozen-output `spendable` records independently of labels.
Chaingraph should report those fields as unsupported rather than translating
them into chain observations. Missing-label rows in Sparrow exports are normal,
not necessarily malformed records.

| Behavior                     | BlueWallet 8.0.2                                                            | Bitcoin Keeper 2.5.17                                                                                                                    |
| ---------------------------- | --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| BIP329 meaning in the UI     | Transaction memo                                                            | One transaction Note; multiple address/output label chips                                                                                |
| Operational record types     | Transactions already known to the selected wallet                           | Transaction notes and address/output labels; enum/store acceptance of other types does not establish usable key-label support            |
| Repeated references          | The last transaction memo replaces earlier values                           | Distinct strings are stored separately; the transaction screen uses one note and editing it replaces the collection                      |
| Separator parsing            | None; punctuation remains literal                                           | None; each repeated address/output label is a complete string                                                                            |
| Origin                       | Ignored                                                                     | Normalized descriptor equality with the selected wallet; missing origin is assigned to that wallet, without a reference-membership check |
| Empty label import           | Explicit empty string clears the memo; omitted label is ignored             | No portable clear contract established; retain Chaingraph's explicit-clear policy                                                        |
| Exported information         | Transaction memos only; separate address labels and UTXO memos are excluded | `type`, `ref`, `label`, `origin`; label colors, descriptions and internal system flags are excluded                                      |
| Destination limits           | No explicit label/file/record cap found in the audited path                 | No explicit label/file/record cap found in the audited path                                                                              |
| Supported Chaingraph network | Mainnet only in the audited release                                         | Mainnet and testnet4 source integration; not live validated                                                                              |

BlueWallet's released watch-only validation uses mainnet address/key encodings;
testnet4 support is an open feature request. Disable that named destination in
a testnet4 workspace with a short explanation. Transaction-only JSONL cannot
prove its originating network from references alone. Imports must retain a
visible source-network context rather than promise detection from transaction
IDs. Absence of an explicit external limit is not a promise of unlimited runtime
capacity; Chaingraph's own safety budgets still apply.

Keeper expects an abbreviated wallet descriptor as origin. An account xpub does
not supply the missing master fingerprint and origin path, so Chaingraph must
not fabricate that descriptor. For example, a mixed Personal/Business export
with no origins, imported while Keeper's Personal wallet is open, is stored as
Personal metadata even for unrelated Business references. This affects metadata
association, not keys or funds. The accepted export rule is one selected
Chaingraph wallet, with metadata associated through known wallet addresses and
loaded transactions, and the instruction to import into the matching Keeper
wallet. Show exclusions where the loaded evidence does not establish an
association. Whole-workspace Generic BIP329 export remains available.
Keeper's transaction UI does not reliably preserve several independent notes,
so export one deliberate transaction string and treat differing imported
transaction strings as conflicts. Its address/output labels can preserve
multiple tags through repeated records.

## Accepted foundations

The first grilling round was accepted on 2026-10-11, with the profile scope
expanded to research one or two additional widely used wallets/tools.

- Keep labels, notes, multiple tags, icons and bookmarks distinct in the native
  model. BIP329 is a destination-specific projection; encrypted workspace
  backup preserves the complete data.
- Require a preview before import. Preserve existing nonempty labels by
  default, merge tag membership, and expose deliberate replacement and
  clearing controls. Apply each import as one Undo step.
- Keep one workspace label per entity in this iteration. Retain origin during
  inspection and resolve conflicting origins deliberately rather than taking
  the last record.
- Keep wallet display names separate from xpub annotations. Make matching-wallet
  rename and wallet-name export fallback explicit options.
- Offer wallet, selected-entity and whole-workspace scopes. Propose the active
  wallet when launched from Wallet and the whole workspace from its menu. Show
  unmatched references; never fetch chain data merely to import metadata.
- Keep the dialogs compact and practical for the chosen external software.
  Profile defaults carry routine behavior. Show detailed controls or exception
  handling only when they affect the transfer; do not build a generic mapping
  wizard or an always-visible configuration matrix.
- Allow a reviewed import of valid records after malformed, unsupported and
  wrong-network records are excluded. Show the excluded counts and reasons
  before application. Reject files that exceed the overall safety budget.
- Initial software profiles are Generic BIP329, Sparrow, BTCPay Server,
  BlueWallet and Bitcoin Keeper. BlueWallet and Keeper were chosen after
  comparing BitBoxApp, Nunchuk, Liana and Electrum as well.
- Exclude values that exceed the destination's field limit by default. Offer
  explicit shortening with a before/after preview. Export shortening does not
  alter native annotations. Never silently merge distinct names that collide
  after shortening.
- Skip explicit empty incoming labels by default. Applying label clears is
  explicit. Ordinary exports omit empty labels; portable clearing is not
  promised because external importers differ.
- Key labels are excluded from ordinary exports by default. Include them only
  when selected, with wallet-name fallback controlled separately.
- BTCPay imports repeated labels as tags and retains existing entity labels.
  Its export defaults to tags, with an explicit option to include entity labels
  as additional records. Generating a combined entity label from incoming tags
  is explicit. Sparrow and Generic default to literal labels.
- Single-string exports may explicitly include tags as readable text, for
  example `Shop payment [business, reviewed]`. The option defaults off. The
  resulting string stays literal on import; no configurable separator or
  automatic splitting is added.
- Export one JSONL file. When a destination size or record budget would be
  exceeded, require a narrower scope before download. Automatic chunking, ZIPs
  and separate native metadata exchange formats are outside this iteration.
- BlueWallet transaction memos and Keeper transaction notes import into Notes.
  Keeper address/output labels import as tags. Preserve existing entity labels.
  Their transaction exports use a populated note, falling back to the entity
  label; an advanced option can choose labels instead.
- Exclude differing single-value records for an entity by default. When
  relevant, offer a compact account/origin choice, followed by explicit first
  or last source value selection for remaining conflicts. Expected repeated
  tag records merge. Do not introduce a separate per-row conflict editor.
- Keeper exports require one selected wallet and include only metadata
  associated through known wallet addresses and loaded transactions. Show
  exclusions and the instruction to import into the matching Keeper wallet.
  Other profiles retain their agreed broader scopes.

## Implemented profile projections

Keep Chaingraph labels, notes, tags, icons and bookmarks separate. Treat BIP329
as a projection selected for a destination. Do not automatically split arbitrary
punctuation, assume repeated references always mean tags, or promise lossless
rich-metadata round trips through other wallets.

Include the accepted Generic BIP329, Sparrow, BTCPay, BlueWallet and Keeper
profiles. Generic/Sparrow preserve literal label strings. BTCPay collects
repeated labels as tags. BlueWallet transaction memos and Keeper transaction
notes map to Notes; Keeper address/output labels map to tags.
Offer label composition or copying into tags only as explicit transformations.
Keep native encrypted workspace backup available for complete preservation.

| Profile        | Default import mapping                                             | Default export projection                                                                           |
| -------------- | ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| Generic BIP329 | Literal labels for modeled record types                            | Populated entity labels                                                                             |
| Sparrow        | Literal labels for modeled record types                            | Populated entity labels; destination-specific limits                                                |
| BTCPay Server  | Repeated transaction/address/output labels become tags             | One record per tag membership; entity labels optional                                               |
| BlueWallet     | Transaction memos become Notes                                     | One transaction string: populated Note, otherwise entity label                                      |
| Bitcoin Keeper | Transaction text becomes Notes; address/output strings become tags | One transaction string: populated Note, otherwise entity label; repeated address/output tag records |

All exports omit empty strings. Key labels are opt-in only for destinations
with usable support. Exported readable tag composition is optional and remains
literal on re-import. None of these projections carries icons, bookmarks, tag
colors/descriptions or the complete native workspace. Native tag validity and
budgets continue to apply even when a source accepts larger strings or more
tags. Imported origins are inspection and conflict context in this iteration;
they do not establish a new persistent per-account annotation model.

Import offers one compact dialog with source profile, relevant scope and
a short summary with representative before/after rows. Created/changed/kept
labels and tags added are visible; conflicts, clears, network exclusions and
length/budget issues appear when relevant. Detailed skipped-record reasons and
rare mapping controls belong in expandable details. Apply the reviewed import
as one undoable operation. File inspection must not mutate the workspace or
fetch chain data.

Export shows destination, scope, included fields and record count. A
Sparrow-compatible export needs one deliberate string per reference. A BTCPay
export can use repeated records for tags. Show destination-specific losses
before download, including BTCPay's 50-character tags and 1 MB file limit and
Sparrow's shorter key names. Do not silently truncate or let distinct names
collapse after truncation.

## Ownership and validation

The user confirmed all product decisions through Q17 and authorized implementation,
including representative example files. `inspectLabels`, `planLabelImport`,
`applyLabelImport` and `planLabelExport` replace the old immediate `importLabels`
and `exportLabels` interface. Profile/options/plan types deepen the existing
Annotations capability. `labelRecords.ts` owns bounded record inspection;
`labelScope.ts` consumes existing script-verified Wallet matching rather than
introducing a second association model. Bitcoin supplies canonical public-key
payload identity; Annotations and Wallets supply their field validity constants.

No persisted source of truth is added: wallet names remain wallet names, explicit
key annotations remain annotations, and origins/options/previews are temporary.
Tests cover network mismatch, equivalent keys and policy ambiguity, conflict
selection, clear/keep/replace behavior, native tag budgets, Unicode length edges,
file/record budgets, shortening collisions, stale review and worker cancellation.
Session tests verify one Undo/Redo step for multi-record text/wallet and tag imports.

The six [shipped JSONL files](../public/examples/bip329/README.md) are synthetic
annotations for the bundled public wallet snapshot: five profile files and one
review-cases file. Tests load those same files into the actual example workspace,
validate canonical persistence shape and verify profile round trips. The adjacent
README describes manual testing. No browser screenshots or live external-wallet
tests were performed; source compatibility is tied to the audited releases above.

## Primary references

- [BIP329](https://github.com/bitcoin/bips/blob/master/bip-0329.mediawiki), especially the importing and origin rules.
- [BTCPay export](https://github.com/btcpayserver/btcpayserver/blob/5d0745cae6be5d8210459e38813f317673aa97b8/BTCPayServer/Services/Wallets/Export/TransactionsExport.cs#L38-L122).
- [BTCPay import parser](https://github.com/btcpayserver/btcpayserver/blob/5d0745cae6be5d8210459e38813f317673aa97b8/BTCPayServer/Services/Wallets/Import/Bip329Import.cs#L19-L62) and [import application](https://github.com/btcpayserver/btcpayserver/blob/5d0745cae6be5d8210459e38813f317673aa97b8/BTCPayServer/Plugins/Wallets/Controllers/UIWalletsController.cs#L2281-L2318).
- [BTCPay tag length](https://github.com/btcpayserver/btcpayserver/blob/5d0745cae6be5d8210459e38813f317673aa97b8/BTCPayServer/Services/WalletRepository.cs#L656-L677).
- [Sparrow import/export and origin handling](https://github.com/sparrowwallet/sparrow/blob/4da29f4e363124f9160401d9b06d1015f79a5dab/src/main/java/com/sparrowwallet/sparrow/io/WalletLabels.java).
- [Sparrow ordinary label limit](https://github.com/sparrowwallet/drongo/blob/e1c26413e4973752c9d7d43e37e39b411f21b48c/src/main/java/com/sparrowwallet/drongo/wallet/Persistable.java#L4) and [keystore label limit](https://github.com/sparrowwallet/drongo/blob/e1c26413e4973752c9d7d43e37e39b411f21b48c/src/main/java/com/sparrowwallet/drongo/wallet/Keystore.java#L22).
- [BlueWallet 8.0.2 release](https://github.com/BlueWallet/BlueWallet/releases/tag/v8.0.2), [transaction memo import](https://github.com/BlueWallet/BlueWallet/blob/a7fe068709b0f91c504b28accda8bc85ee4c3714/blue_modules/fs.ts#L78-L153) and [export](https://github.com/BlueWallet/BlueWallet/blob/a7fe068709b0f91c504b28accda8bc85ee4c3714/screen/wallets/WalletDetails.tsx#L247-L307).
- [BlueWallet mainnet watch-only validation](https://github.com/BlueWallet/BlueWallet/blob/a7fe068709b0f91c504b28accda8bc85ee4c3714/class/wallets/watch-only-wallet.ts#L64-L75) and [testnet4 feature request](https://github.com/BlueWallet/BlueWallet/issues/7801).
- [Keeper 2.5.17 release](https://github.com/KeeperCommunity/bitcoin-keeper/releases/tag/v2.5.17), [import/export and origin matching](https://github.com/KeeperCommunity/bitcoin-keeper/blob/380196e43ff4838094b6167dc7133f3ef238bd6f/src/components/ImportExportLabels/index.tsx#L65-L145), and [label storage](https://github.com/KeeperCommunity/bitcoin-keeper/blob/380196e43ff4838094b6167dc7133f3ef238bd6f/src/store/sagas/utxos.ts#L100-L190).
- [Keeper transaction Note](https://github.com/KeeperCommunity/bitcoin-keeper/blob/380196e43ff4838094b6167dc7133f3ef238bd6f/src/screens/ViewTransactions/TransactionDetails.tsx#L69-L107), [address/output label editor](https://github.com/KeeperCommunity/bitcoin-keeper/blob/380196e43ff4838094b6167dc7133f3ef238bd6f/src/screens/UTXOManagement/components/LabelsEditor.tsx#L85-L111), and [descriptor generation](https://github.com/KeeperCommunity/bitcoin-keeper/blob/380196e43ff4838094b6167dc7133f3ef238bd6f/src/utils/service-utilities/utils.ts#L45-L125).
- [Keeper testnet4 API paths](https://github.com/KeeperCommunity/bitcoin-keeper/blob/380196e43ff4838094b6167dc7133f3ef238bd6f/src/services/wallets/operations/utils.ts#L163-L198).
