# Source map

Start with the product area below, then follow its direct imports. Search for a
visible panel's name to find its entry point.

```text
src/
  main.tsx
  App/
    App.tsx                 app shell, home and dialogs
    useAppState.ts          workspace store, navigation and feedback
    Dialogs/                generic modal shell
    FrontPage/              saved workspace list (WorkspaceHome)
    Examples/               example picker and creation worker
    Help/                   help menu, about dialog, guided tour and its Workspace adapter
    Controls/               reusable App-owned controls, display and metadata UI
      MultiSelectFilter.tsx reusable multi-select checklist filter
      Display/              amounts, identifiers, timestamps and evidence help
      Metadata/             annotation, icon and metadata editors
    Workspace/
      workspace.ts          canonical decrypted Workspace model
      createWorkspace.ts    new-workspace factory, independent of persistence
      Workspace.tsx         toolbar, workbenches and shared status surfaces
      useWorkspace.tsx      shared state, selection and workbench coordination
      WorkspaceToolbar.tsx  workbench navigation, lookup and workspace actions
      WorkspaceDialogs.tsx  settings, wallet edits, removal and label import wiring
      Dialogs/              create, import, unlock and workspace-details dialogs
      Store/                sessions, undo/redo, autosave and persistence port
        WorkspaceStore.ts   framework-independent unlocked-session lifecycle
        useWorkspaces.ts    React subscription and autosave timer
        WorkspacePersistence.ts adapter contract consumed by WorkspaceStore
      Persistence/          encrypted Workspace save/load capability
        Format/             schema validation, migrations and format entry point
        Encryption/         authenticated envelope, compression and worker client
        Browser/            public index, IndexedDB blobs and cross-tab publication
      Evidence/             shared transaction and input-context evidence
        Transactions/       transaction fetch context, caching and observation merge
        InputContext/       partial-input evidence and undo preservation
      useWorkspaceOperation.ts cancellable workspace operation lifecycle and feedback
      Wallet/
        WalletUtxos/        transient wallet UTXO loading shared by Wallet and Graph Inspector
          index.ts           public UTXO controller and view contract
          useWalletUtxos.ts  scoped UTXO lifecycle, cancellation and pagination state
          fetchWalletUtxos.ts bounded Electrum listunspent requests
      useEntityRemoval.ts   removal plans, confirmation and applied removals
      useWorkspaceHistory.ts undo, redo and single-step batch edits
      useDialogState.ts     which workspace dialog is open and its target

      Analysis/             analysis registry, tools, scans and bounded recovery
      Annotations/          labels, tags and metadata mutations
      Selection/            shared selection, connection-scan targets and visibility
      ConnectionScan/       scan-node vocabulary shared by Selection and Graph
      GraphState/           graph evidence, membership and manual visibility
      Wallet/               wallet evidence, records, relationships, preparation and review model
        Dialogs/            add-wallet and wallet-name dialogs
      Workbenches/
        workbenchHandoff.ts Graph capabilities Wallet and Analysis hand off to
        Wallet/             wallet overview, scan and preparation state
          WalletWorkbench.tsx controller binding for the wallet workbench view
          walletWorkbenchContext.ts shared context for the wallet panels
          useWalletActivity.ts address discovery settings and runs
          useWalletAnalysis.ts wallet-scoped analysis runs
          Review/           wallet review panel, detail, flow and input loading
            WalletReviewPanel.tsx wallet review view, state, filtering and list composition
        Graph/              graph surface, controls, panels and metadata projection
          GraphWorkbench.tsx graph canvas, navigation and panel composition
          useGraphCanvas.ts  camera, fit and saved-view writes
          useGraphPanels.ts  which panels and tabs the workbench shows
          Address/          address projection, evidence loading and Graph actions
          Navigation/       lookup form/state/resolution and graph expansion
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
    Chain/                  network, transaction and observed prevout contracts
    Wallet/                 watch-only key derivation and persisted wallet contracts
    Metadata/               canonical entity references
  Infra/
    Bitcoin/                HTTP API, scheduling, ancestry and UTXO requests
    Browser/                generic browser mechanisms such as file downloads
server/                     bounded read-only Core/Electrum proxy
tests/
  integration/             tests that intentionally cross module or layer boundaries
  fixtures/                fixtures shared by more than one product concept
  e2e/                     browser product workflows
scripts/                    development, validation and release tooling
```

## Common tasks

| Task                                   | Start here                                                                            | Test location                                                                                  |
| -------------------------------------- | ------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Home, workspace creation or unlock     | `App/FrontPage/WorkspaceHome.tsx`, `App/Workspace/Dialogs/`                           | Dialog tests beside their owners; cross-storage cases in `tests/integration/workspace/`        |
| Autosave, lock or undo                 | `App/Workspace/Store/`, `App/Workspace/Persistence/Browser/`                          | Colocated unit tests and `tests/integration/workspace/`                                        |
| Wallet review or records               | `App/Workspace/Wallet/`, `Workbenches/Wallet/`, `Graph/InspectorPanel/`               | Colocated Wallet tests and `tests/integration/wallet/`                                         |
| Transaction flow or address history    | `App/Workspace/Workbenches/Graph/TransactionFlow/`, `Graph/Address/`                  | Tests beside those modules                                                                     |
| Canvas rendering or layout             | `App/Workspace/Workbenches/Graph/Renderer/`                                           | Colocated renderer tests                                                                       |
| Graph filters, membership or selection | `App/Workspace/Workbenches/Graph/Filters/`, `App/Workspace/GraphState/`, `Selection/` | Tests beside those modules; persistence cases under `tests/integration/graph/` or `workspace/` |
| Connection scans                       | `App/Workspace/Workbenches/Graph/ConnectionScan/`, `App/Workspace/ConnectionScan/`    | Colocated algorithm tests and `tests/integration/connection-scan/`                             |
| Analysis tools or reports              | `App/Workspace/Analysis/`, `App/Workspace/Workbenches/Analysis/`                      | Colocated analysis and workbench tests                                                         |
| Labels, tags or icons                  | `App/Workspace/Annotations/`, `App/Controls/Metadata/`, `Graph/TagsPanel/`            | Colocated annotation tests and `tests/integration/workspace/tags.test.ts`                      |
| Fetching or request coordination       | `Infra/Bitcoin/`, `App/Workspace/Evidence/Transactions/`, `useWorkspaceOperation.ts`  | Colocated scheduler/operation tests and `tests/integration/bitcoin/`                           |

Paths in the task table are relative to `src/`. Focused tests live beside their
production owner as `*.test.ts` or `*.test.tsx`. Cross-module tests live under
`tests/integration/`; shared fixtures stay under `tests/fixtures/`; backend tests
live beside the server modules. Test commands are in
[CONTRIBUTING.md](../CONTRIBUTING.md).

## Workspace vocabulary

`WorkspaceStore` owns two collections: `saved`, the public metadata for encrypted
workspaces at rest, and `unlocked`, the decrypted ones in memory with their
password, undo stack and autosave tracking. `useWorkspaces` subscribes React to
that store. One unlocked workspace is active at a time.

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

| Feature          | Means                                                                         | Entry point                             | Owner                                            |
| ---------------- | ----------------------------------------------------------------------------- | --------------------------------------- | ------------------------------------------------ |
| Wallet discovery | Derive branches and pull their history. "Scan wallet" or "Refresh" in the UI. | `walletDiscovery` (`useWalletActivity`) | `Domain/Wallet/wallet.ts`, `Workbenches/Wallet/` |
| Wallet analysis  | Run the analysis tools over a wallet scope. "Analyze" in the UI.              | `useWalletAnalysis`                     | `App/Workspace/Analysis/`                        |
| Wallet review    | The queue of sources, destinations and activity to label.                     | `walletActions`, review panels          | `App/Workspace/Wallet/`                          |
| Connection scan  | Find loops, dead ends and large branches in the graph.                        | `connectionScanTargets`, the scan panel | Graph `ConnectionScan/`                          |

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
map of them: `graph` (projection, canvas, panels, filters, actions, address,
navigation, lookup, flow inputs and scan targets), `wallet`, `analysis`, plus the
shared `selection`, `annotations`, `history` and `dialogs`.

Workspace navigation owns direct switches, contextual handoffs and their single
transient return point. A destination workbench owns how semantic entry focus is
resolved inside its UI; Workspace does not query another workbench's DOM.

Panel state belongs to the workbench that shows it. Graph owns its tabs, and
other workbenches reach them through `GraphHandoff` rather than writing them, so
a wallet record opening in the inspector is a handoff rather than a tab write.
Workbench implementation modules do not import sibling workbenches. Shared
transient UTXO observations live in `Wallet/WalletUtxos/`. Workbench action
modules implement Graph, Wallet and Analysis behavior over that state. Wallet and
Analysis reach Graph only through the `GraphHandoff` contract in
`Workbenches/workbenchHandoff.ts`, never through Graph's own modules. Each
workbench file binds the controller to its own view, which keeps a props-driven
contract that tests render directly. Owned panels receive the Workspace
controller; reusable controls keep focused props. Workspace dialog and tour
components bind that controller to their UI without owning another copy of state.
Shared transaction and input-context evidence lives under `Evidence/`. Graph owns
address history loading and projection under `Graph/Address/`, and lookup plus
funding/spending expansion under `Graph/Navigation/`. The flow-input hooks stay
with the workbench that shows them, under `Graph/TransactionFlow/` and
`Wallet/Review/`, and `useWorkspace` composes their explicit interfaces. The
dialog module exports modal and focus helpers used by other areas. Graph filter
controls are also used by the entity browser, and `MultiSelectFilter` is shared by
Wallet and Analysis.
