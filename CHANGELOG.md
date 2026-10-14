# Release notes

## [0.1.0] - Unreleased

Chaingraph is a self-hosted, watch-only Bitcoin workbench for understanding your
wallets and following activity on chain. Its first public release brings wallet
review, transaction exploration and local analysis together in encrypted
workspaces.

### Explore and review

- **Follow transactions.** Look up a transaction, address or output in a
  chronologically ordered 3D or flat graph. Follow funding and spending links,
  filter or isolate branches, and inspect address history. The transaction view
  connects inputs and outputs to their transaction, with navigation to exact
  outputs, script inspection and raw transaction details.
- **Understand your wallets.** Import account-level extended public keys for
  single-key legacy, nested SegWit, native SegWit or Taproot wallets. Browse
  transactions, coins, addresses and counterparties, with wallet net changes,
  dated balance observations and scan coverage. Manual and automatic refresh
  check discovered activity through your own nodes.
- **Work through reviews.** Describe transactions and used wallet addresses,
  add sender or recipient context, and assess linked findings. Record what you
  cannot identify, what needs no annotation and what to review later. Filter
  outstanding work, edit several records together, and move between related
  records and the graph without losing your browsing position.
- **Investigate patterns and connections.** Seven local analysis tools examine
  equal outputs, common inputs, address reuse, value flow and fees,
  consolidation and fan-out, script types and imported-wallet intersections.
  Findings link to their evidence. Bounded connection scans find funding and
  spending paths, shared ancestors and descendants, and loops; add a discovered
  path to the graph to explore it.

### Organize and save

- **Keep your own context.** Add labels, notes, colored tags, icons and bookmarks.
  Name counterparties and associate them with specific received coins or
  payment outputs. Annotations are shared across Wallet, Graph and Analysis.
  Undo and redo edits while keeping accepted chain refreshes in the current
  session.
- **Exchange wallet metadata.** Import and export plaintext BIP329 files with
  profiles for Sparrow, BTCPay Server, BlueWallet, Bitcoin Keeper and generic
  files. Compare conflicting entries before applying an import and inspect the
  export as a table or exact JSONL. Profiles handle labels, tags and transaction
  notes according to the destination's supported fields.
- **Save encrypted workspaces.** Workspaces save automatically in your browser.
  Open several at once, lock them when finished, and export encrypted backups
  to reopen in another browser. Saved records remain available without a chain
  connection for inspection, annotation, local analysis and connection scans
  within the loaded data.
- **Start with public examples.** Nine bundled mainnet and testnet4 workspaces
  include transaction snapshots and starter annotations. A separate static demo
  build offers three prepared investigations without a chain backend. A guided
  tour introduces the workbench controls.

### Run on your own nodes

Run Chaingraph from source or with Docker Compose against your Bitcoin Core node
and Electrum server. Mainnet and testnet4 are supported, separately or together,
with an isolated node/server pair for each network. Native installs require
Node.js 24 or newer; the browser needs WebGL and a secure context such as
localhost or HTTPS for encrypted storage.

### Privacy and evidence limits

- Chaingraph never accepts private keys or seeds and cannot sign or spend.
  Wallet derivation, scanning, analysis and encryption happen in your browser.
  Extended public keys stay there, while the read-only proxy and your upstream
  services see the transaction IDs and script hashes you query. The proxy keeps
  no database or lookup cache and is intended for one trusted user.
- Workspace contents are encrypted; names remain public. Passwords are not
  stored and cannot be recovered. Keep encrypted exports as backups. BIP329
  files are plaintext metadata, not complete workspace backups.
- Chain data is a snapshot, and searches have limits. Incomplete coverage does
  not establish a complete wallet balance or the absence of activity. A missing
  spending transaction does not prove an output is unspent.
- Analysis patterns are hypotheses, and named counterparties are your
  annotations. Neither proves ownership or identifies a person. Transaction
  links do not establish which input funded a particular output.
