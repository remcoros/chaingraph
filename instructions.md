# Using Chaingraph

Chaingraph helps you investigate Bitcoin activity and keep your own observations alongside the graph. It is watch-only: you can import public wallet information, inspect transactions, and organize hypotheses without supplying a seed phrase or private key.

## Start a workspace

Create a workspace, choose mainnet or testnet4, and give it a name and password. Use a long, unique passphrase. Your password cannot be recovered. The workspace's network must match the connected backend for live lookups; choosing a different workspace network does not reconfigure Bitcoin Core or Fulcrum.

You can open several workspaces and switch between their tabs. Each workspace has its own transactions, wallets, annotations, analysis results, and view settings. An unsaved indicator means the current changes have not yet reached encrypted browser storage. Autosave runs shortly after edits; heed a storage-error message and export a file if browser storage is full or unavailable.

For a first look without loading your own wallet, open the **CoinJoin laboratory**. Its three 150-input/150-output transactions and surrounding paths are generated examples. Their IDs, confirmations, and activity are synthetic, not real testnet transactions. Do not use the laboratory as evidence about a real wallet.

Use Ctrl/Cmd+K to focus the quick input and Ctrl/Cmd+S to save an encrypted browser snapshot. The first-use tour introduces the main controls. It can be skipped and restarted from Help.

## Find activity

Use the quick input to load a transaction ID, an address, or an output reference written as `transaction-id:output-index`. Select an item in the graph or entity list to inspect its details and available actions.

Follow funding to load the transactions that created a selected transaction's inputs. Follow spending to look for transactions consuming its outputs. These actions expand the loaded investigation; they do not scan the whole chain. Spending discovery uses address histories and is limited to outputs with a supported address representation. If discovery is partial, missing spend links must not be interpreted as proof that an output is unspent.

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

Select an item to add a label, note, icon, or bookmark in its inspector. Labels record your observations; they do not change blockchain data. Use bookmarks to return to relevant items and undo to reverse recent workspace edits. Undo history is limited to the current session and is reset when new chain data is loaded, so undo cannot erase a later scan. Remove a transaction from its inspector to reduce the graph; its saved annotations remain, and descendant inputs may still show output placeholders.

## Run analysis

Analysis uses the transactions already loaded in this workspace:

- **Equal-output detection** highlights repeated positive output amounts in multi-input transactions. The pattern can occur in collaborative transactions and other activity; it is not a CoinJoin verdict.
- **Common-input ownership** creates tentative input groups and skips transactions with three or more equal outputs. PayJoin, other collaborative spends, and missing history can invalidate the inference. Treat cluster membership as a hypothesis to inspect.
- **Address reuse** identifies addresses appearing on more than one loaded output. It describes the loaded snapshot, not necessarily the address's complete history.

Review each finding's explanation and supporting transaction references before applying a conclusion. Loading more history can change what an algorithm would find; rerun analysis when the investigation changes. User annotations and algorithm results are stored separately.

## Save, lock, and exchange data

Workspace autosave writes encrypted contents to this browser's storage. Lock the workspace to close its unlocked session. Reopening requires its password. Browser storage is tied to the exact origin: development at port 3001 and a built app at another port have separate saved workspaces.

Export an encrypted workspace file for backup or transfer to another browser. Import it and supply the password to reopen it. Keep the password separately: there is no reset or recovery service. Exported files preserve workspace contents, not a live blockchain connection. Current camera position and the temporary force layout are not saved.

Saved workspace contents use authenticated encryption. The browser storage entry also includes a workspace identifier and save time outside the encrypted contents. File names and file sizes can reveal additional metadata. Encryption does not hide an unlocked workspace from someone using your browser or from untrusted browser extensions.

**BIP329 label exchange is different from workspace export.** Label files are plaintext JSON Lines. They can include address/output/transaction references, labels, and wallet extended public keys. They do not preserve the complete workspace, notes, bookmarks, graph settings, or analysis results. Only share them intentionally. Unsupported label record types are skipped during import.

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

For server setup and development commands, see [README.md](README.md).
