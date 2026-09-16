# Source map

Start with the product area below, then follow its direct imports. Search for a
visible panel's name to find its entry point.

```text
src/
  main.tsx
  App/
    App.tsx                 app shell, home and dialogs
    useAppState.ts          workspace store, navigation and feedback
    Dialogs/                public dialog module and private dialog components
    FrontPage/              saved workspace list (WorkspaceHome)
    Examples/               example picker and creation worker
    Help/                   help menu, about dialog, guided tour and its Workspace adapter
    Controls/               reusable App-owned controls, display and metadata UI
      MultiSelectFilter.tsx reusable multi-select checklist filter
      Display/              amounts, identifiers, timestamps and evidence help
      Metadata/             annotation, icon and metadata editors
    Workspace/
      Workspace.tsx         toolbar, workbenches and shared status surfaces
      useWorkspace.tsx      shared state, selection and workbench coordination
      useWorkspaces.ts      saved and unlocked workspaces, undo/redo, autosave, locking
      WorkspaceToolbar.tsx  workbench navigation, lookup and workspace actions
      WorkspaceDialogs.tsx  settings, wallet edits, removal and label import wiring
      ChainData/            bounded evidence loading, spending notices and cancellation
        TransactionFetch.tsx session-scoped transaction fetch context and provider
        WalletUtxos/        transient wallet UTXO loading shared by Wallet and Graph Inspector
          index.ts           public UTXO controller and view contract
          useWalletUtxos.ts  scoped UTXO lifecycle, cancellation and pagination state
          fetchWalletUtxos.ts bounded Electrum listunspent requests
      useEntityRemoval.ts   removal plans, confirmation and applied removals
      useWorkspaceLookup.ts lookup field, reset signal and loaded-id resolution
      useWorkspaceHistory.ts undo, redo and single-step batch edits
      useDialogState.ts     which workspace dialog is open and its target

      LookupForm.tsx        Workspace toolbar lookup form
      Selection/            shared selection, connection-scan targets and visibility
      Annotations/          labels, tags, icons, bookmarks and BIP329 exchange
      Workbenches/
        workbenchHandoff.ts Graph capabilities Wallet and Analysis hand off to
        Wallet/             wallet overview, scan and preparation state
          WalletWorkbench.tsx controller binding and the wallet workbench view
          walletWorkbenchContext.ts shared context for the wallet panels
          useWalletActivity.ts address discovery settings and runs
          useWalletAnalysis.ts wallet-scoped analysis runs
          Review/           review detail, flow and input loading
        Graph/              graph surface, controls, panels and metadata projection
          GraphWorkbench.tsx graph canvas, navigation and panel composition
          useGraphCanvas.ts  camera, fit and saved-view writes
          useGraphPanels.ts  which panels and tabs the workbench shows
          TagsPanel/        graph tag manager and selected-node tag UI
            index.ts         narrow tag-panel public entry
            TagsPanel.tsx    tag manager and selected tag controls
          EntitiesPanel/    graph entity, wallet and tag side panel
            EntitiesPanel.tsx panel controller binding
            EntitiesPanelDetail.tsx panel view and tab composition
            EntityBrowser.tsx entity filtering, listing and paging
          InspectorPanel/   graph inspection, scan and wallet-record side panel
            InspectorPanel.tsx panel controller binding and tab composition
            InspectorPanelDetail.tsx selected node or wallet detail actions
            Inspector.tsx node and wallet inspection views
            WalletRecordsPanel.tsx wallet address, transaction and UTXO tabs
            WalletAddressesPanel.tsx wallet address tab contents
            ScriptInspector.tsx raw transaction and script inspection
            transactionInspection.ts raw inspection fetch helper
            useUtxoStatus.ts ephemeral selected-outpoint status hook
          useGraphActions.ts graph navigation, visibility and filter actions
          useGraphProjection.tsx graph, entity and selection projections
          Filters/          graph and wallet filter controls
          TransactionFlow/  flow panel and its selected-entity views
            FlowPanel.tsx   panel shell, summary and view composition
            FlowPanelTransactionView.tsx transaction lanes, navigation and metadata tools
            FlowPanelAddressView.tsx address history and UTXO tabs
            useFlowInputs.ts loading the inputs a flow view needs
          ConnectionScan/   scan panel, runner, worker and bounded fetching
          Renderer/         adapter contract, Three.js, layout and picking
        Analysis/           analysis controls and reports
          AnalysisWorkbench.tsx controller binding and the analysis workbench view
          useWorkspaceAnalysis.ts retained sessions and the wallet-run revision
          analysisSession.ts  retained scan, scope and reader filters per workspace
  Domain/
    types.ts                shared Bitcoin and workspace contracts
    Chain/                  transaction, address and prevout evidence
    Wallet/                 key derivation, review and record projections
    Graph/                  membership, filters, handoffs and visibility
    Analysis/               analysis registry, scope and review logic
      tools/                heuristic implementations
    ConnectionScan/         bounded search, targets, records and path addition
    Metadata/               pure edits, tags, references and BIP329 labels
    Workspace/              schema, migration, removal and example catalog
      templateData/         bundled public chain snapshots
  Infra/
    Bitcoin/                HTTP API, scheduling, ancestry and UTXO requests
    Storage/                encryption worker, compression and envelope storage
server/                     bounded read-only Core/Electrum proxy
tests/                      domain and integration suites; shared fixtures
scripts/                    development, validation and release tooling
```

## Common tasks

| Task                                   | Start here                                                                              | Relevant tests in `tests/`                                                                                        |
| -------------------------------------- | --------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Home, workspace creation or unlock     | `App/FrontPage/WorkspaceHome.tsx`, `App/Dialogs/`                                        | `password-controls.test.ts`, `workspace-storage.test.ts`                                                          |
| Autosave, lock or undo                 | `App/Workspace/useWorkspaces.ts`, `Infra/Storage/`                                      | `workspace-save-scheduling.test.ts`, `workspace-encryption-worker.test.ts`, `workspace-undo-descriptions.test.ts` |
| Wallet review or records               | `App/Workspace/Workbenches/Wallet/`, `Graph/InspectorPanel/`, `Domain/Wallet/`          | `wallet-review*.test.ts`, `wallet-records.test.ts`, `wallet-preparation.test.ts`                                  |
| Transaction flow or address history    | `App/Workspace/Workbenches/Graph/TransactionFlow/`, `Domain/Chain/`                     | `transactionFlow.test.ts`, `address-history.test.ts`, `flow-inputs.test.ts`                                       |
| Canvas rendering or layout             | `App/Workspace/Workbenches/Graph/Renderer/`                                             | `flow-layout.test.ts`, `graph-presentation.test.ts`, `flow-renderer-responsiveness.test.ts`                       |
| Graph filters, membership or selection | `App/Workspace/Workbenches/Graph/Filters/`, `App/Workspace/Selection/`, `Domain/Graph/` | `graph-filters.test.ts`, `graph-membership.test.ts`, `visibility.test.ts`                                         |
| Connection scans                       | `App/Workspace/Workbenches/Graph/ConnectionScan/`, `Domain/ConnectionScan/`             | `connectionScan*.test.ts`                                                                                         |
| Analysis tools or reports              | `App/Workspace/Workbenches/Analysis/`, `Domain/Analysis/`                               | `analysis*.test.ts`                                                                                               |
| Labels, tags or icons                  | `App/Controls/Metadata/`, `Graph/TagsPanel/`, `Domain/Metadata/`                        | `batch-*.test.ts`, `tags.test.ts`, `labels.test.ts`                                                               |
| Fetching or request coordination       | `Infra/Bitcoin/`, `App/Workspace/ChainData/TransactionFetch.tsx`                        | `network-api.test.ts`, `transaction-scheduler.test.ts`, `scanner.test.ts`                                         |

Paths in the task table are relative to `src/`. Primitive
tests live in `Domain/Wallet/wallet.test.ts` and `Infra/Storage/crypto.test.ts`;
backend tests live beside the server modules. Test commands are in
[CONTRIBUTING.md](../CONTRIBUTING.md).

## Workspace vocabulary

`useWorkspaces` owns two collections: `saved`, the encrypted workspaces at rest
whose names are deliberately public, and `unlocked`, the decrypted ones in memory
with their password, undo stack and autosave tracking. One unlocked workspace is
active at a time.

| Name                | Means                                                    |
| ------------------- | -------------------------------------------------------- |
| `workspaces`        | the store holding both `saved` and `unlocked`            |
| `UnlockedWorkspace` | one decrypted workspace and everything held alongside it |
| `activeWorkspace`   | the workspace the workbench is showing                   |
| `edit`              | the sanctioned mutation of the active workspace          |

`edit` is not a setter. It refuses writes while that workspace is locking, treats
an identical result as no edit, records an undo step unless the write is
presentation-only, and can group rapid edits under one description.

## Scan, analysis and review vocabulary

Four separate features once shared the word "scan". Each keeps its own words, and
names stay unambiguous at the scope where they are exposed:

| Feature          | Means                                                                         | Entry point                             | Domain                     |
| ---------------- | ----------------------------------------------------------------------------- | --------------------------------------- | -------------------------- |
| Wallet discovery | Derive branches and pull their history. "Scan wallet" or "Refresh" in the UI. | `walletDiscovery` (`useWalletActivity`) | `Wallet/wallet.ts`         |
| Wallet analysis  | Run the analysis tools over a wallet scope. "Analyze" in the UI.              | `useWalletAnalysis`                     | `Analysis/analysisScan.ts` |
| Wallet review    | The queue of sources, destinations and activity to label.                     | `walletActions`, review panels          | `Wallet/walletReview.ts`   |
| Connection scan  | Find loops, dead ends and large branches in the graph.                        | `connectionScanTargets`, the scan panel | `ConnectionScan/`          |

Wallet analysis and the Analysis workbench are the same feature reached from two
places, so they share `AnalysisScan` and write one `findings` store. Wallet
review keeps its own decisions in `walletReviews`, but reads that same `findings`
store: a finding covering the wallet becomes a `link` item in its queue. Inside
`ConnectionScan/` the short names are fine; anything published on the workspace
controller carries its feature prefix, because all four meet there.

## Ownership and responsibilities

UI, styles and area-specific hooks live together. Browser transport and encrypted
storage are separate from the server. Global styles live in `App/styles.css`, workbench
styles in `App/Workspace/Workbenches/workbenches.css`, and design tokens live
in the root `tokens.css`. Tool configuration stays at the repository root.

`App/useAppState.ts` owns the workspace store, navigation, connection status and feedback,
and exports them as the `AppState` contract. `App.tsx` reads these directly;
Workspace consumes the app services it needs.
`Workspace/useWorkspace.tsx` composes the concepts a workspace needs and owns
only the small core: the active workspace, editing it, notices and workbench
switching. Each concept lives in its product area, so the controller reads as a
map of them: `graph` (projection, canvas, panels, filters, actions, flow inputs,
scan targets), `wallet`, `analysis`, plus the shared `selection`, `annotations`,
`evidence`, `history`, `lookup` and `dialogs`.

Panel state belongs to the workbench that shows it. Graph owns its tabs, and
other workbenches reach them through `GraphHandoff` rather than writing them, so
a wallet record opening in the inspector is a handoff rather than a tab write. Workbench implementation modules do not import sibling workbenches; shared transient UTXO observations live in `ChainData/WalletUtxos/`. Workbench action modules implement Graph, Wallet
and Analysis behavior over that state. Wallet and Analysis reach Graph only
through the `GraphHandoff` contract in `Workbenches/workbenchHandoff.ts`, never
through Graph's own modules. Each workbench file binds the controller to its own
view, which keeps a props-driven contract that tests render directly. Owned panels receive the Workspace
controller; reusable controls keep focused props. Workspace dialog and tour
components bind that controller to their UI without owning another copy of state.
Chain evidence lives at Workspace scope under `ChainData/`, split into fetching,
the selected address's record and graph expansion. The flow-input hooks stay with
the workbench that shows them, under `Graph/TransactionFlow/` and
`Wallet/Review/`, and `useWorkspace` aggregates what other areas need. The dialog
module exports modal and focus helpers used by other areas. Graph filter controls
are also used by the entity browser, and `MultiSelectFilter` is shared by Wallet
and Analysis.
