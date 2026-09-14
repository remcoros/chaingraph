# Source map

Start with the product area below, then follow its direct imports. Search for a
visible panel's name to find its entry point.

```text
src/
  main.tsx
  App/
    App.tsx                 app shell, home and dialogs
    useAppState.ts          app sessions, navigation and feedback
    Dialogs.tsx             create, unlock, import and edit dialogs
    FrontPage/              saved workspace list (WorkspaceHome)
    Examples/               example picker and creation worker
    Help/                   help menu, about dialog and guided tour
    Workspace/
      Workspace.tsx         toolbar, workbenches and shared status surfaces
      useWorkspace.tsx      shared state, selection and workbench coordination
      useWorkspaces.ts      sessions, undo/redo, autosave and locking
      WorkspaceToolbar.tsx  workbench navigation, lookup and workspace actions
      WorkspaceDialogs.tsx  settings, wallet edits, removal and label import wiring
      WorkspaceTour.tsx     guided tour and example preview wiring
      ChainData/            bounded evidence loading, spending notices and cancellation
      useEntityRemoval.ts   removal plans, confirmation and applied removals
      useWorkspaceLookup.ts lookup field, reset signal and loaded-id resolution
      useWorkspaceHistory.ts undo, redo and single-step batch edits
      useDialogState.ts     which workspace dialog is open and its target
      WorkspacePanel.tsx    workspace sidebar
      Entities/             entity browser and lookup form
      Inspector/            node, wallet and script inspection
      Selection/            shared selection, connection-scan targets and visibility
      Tags/                 workspace tag management
      Workbenches/
        workbenchHandoff.ts Graph capabilities Wallet and Analysis hand off to
        Wallet/             wallet overview, scan and preparation state
          WalletWorkbench.tsx controller binding and the wallet workbench view
          walletWorkbenchContext.ts shared context for the wallet panels
          useWalletActivity.ts address discovery settings and runs
          useWalletAnalysis.ts wallet-scoped analysis runs
          Records/          address and UTXO panels
          Review/           review detail, flow and input loading
        Graph/              graph surface, controls and metadata projection
          GraphWorkbench.tsx graph canvas, navigation and panel composition
          EntitiesPanel.tsx entity and wallet browsing controls
          InspectorPanel.tsx inspector, scan and wallet-record tabs
          InspectorPanelDetail.tsx selected node or wallet detail actions
          useGraphActions.ts graph navigation, visibility and filter actions
          useGraphProjection.tsx graph, entity and selection projections
          Filters/          graph and wallet filter controls
          TransactionFlow/  flow panel and its selected-entity views
            FlowPanel.tsx   panel shell, summary and view composition
            FlowPanelTransactionView.tsx transaction lanes, navigation and metadata tools
            FlowPanelAddressView.tsx address history and UTXO tabs
          ConnectionScan/   scan panel, runner, worker and bounded fetching
          Renderer/         adapter contract, Three.js, layout and picking
        Analysis/           analysis controls and reports
          AnalysisWorkbench.tsx controller binding and the analysis workbench view
          analysisSession.ts  retained scan, scope and reader filters per workspace
  Shared/
    Controls/               reusable controls and popovers
    Display/                amounts, identifiers, timestamps and evidence help
    Metadata/               annotation, icon and metadata editors
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
| Home, workspace creation or unlock     | `App/FrontPage/WorkspaceHome.tsx`, `App/Dialogs.tsx`                                    | `password-controls.test.ts`, `workspace-storage.test.ts`                                                          |
| Autosave, lock or undo                 | `App/Workspace/useWorkspaces.ts`, `Infra/Storage/`                                      | `workspace-save-scheduling.test.ts`, `workspace-encryption-worker.test.ts`, `workspace-undo-descriptions.test.ts` |
| Wallet review or records               | `App/Workspace/Workbenches/Wallet/`, `Domain/Wallet/`                                   | `wallet-review*.test.ts`, `wallet-records.test.ts`, `wallet-preparation.test.ts`                                  |
| Transaction flow or address history    | `App/Workspace/Workbenches/Graph/TransactionFlow/`, `Domain/Chain/`                     | `transactionFlow.test.ts`, `address-history.test.ts`, `flow-inputs.test.ts`                                       |
| Canvas rendering or layout             | `App/Workspace/Workbenches/Graph/Renderer/`                                             | `flow-layout.test.ts`, `graph-presentation.test.ts`, `flow-renderer-responsiveness.test.ts`                       |
| Graph filters, membership or selection | `App/Workspace/Workbenches/Graph/Filters/`, `App/Workspace/Selection/`, `Domain/Graph/` | `graph-filters.test.ts`, `graph-membership.test.ts`, `visibility.test.ts`                                         |
| Connection scans                       | `App/Workspace/Workbenches/Graph/ConnectionScan/`, `Domain/ConnectionScan/`             | `connectionScan*.test.ts`                                                                                         |
| Analysis tools or reports              | `App/Workspace/Workbenches/Analysis/`, `Domain/Analysis/`                               | `analysis*.test.ts`                                                                                               |
| Labels, tags or icons                  | `Shared/Metadata/`, `App/Workspace/Tags/`, `Domain/Metadata/`                           | `batch-*.test.ts`, `tags.test.ts`, `labels.test.ts`                                                               |
| Fetching or request coordination       | `Infra/Bitcoin/`, `App/Workspace/useTransactionFetch.tsx`                               | `network-api.test.ts`, `transaction-scheduler.test.ts`, `scanner.test.ts`                                         |

Paths in the task table are relative to `src/`. Primitive
tests live in `Domain/Wallet/wallet.test.ts` and `Infra/Storage/crypto.test.ts`;
backend tests live beside the server modules. Test commands are in
[CONTRIBUTING.md](../CONTRIBUTING.md).

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
places, so they share `AnalysisScan` and write one `findings` store. Wallet review
is separate and shares nothing with them. Inside `ConnectionScan/` the short names
are fine; anything published on the workspace controller carries its feature
prefix, because all four meet there.

## Shared responsibilities

UI, styles and area-specific hooks live together. Browser transport and encrypted
storage are separate from the server. Global styles live in `App/styles.css`, workbench
styles in `App/Workspace/Workbenches/workbenches.css`, and design tokens live
in the root `tokens.css`. Tool configuration stays at the repository root.

`App/useAppState.ts` owns app sessions, navigation, connection status and feedback,
and exports them as the `AppState` contract. `App.tsx` reads these directly;
Workspace consumes the app services it needs.
`Workspace/useWorkspace.tsx` owns shared state, selection, presentation hydration
and workbench switching/focus. Workbench action modules implement Graph, Wallet
and Analysis behavior over that state. Wallet and Analysis reach Graph only
through the `GraphHandoff` contract in `Workbenches/workbenchHandoff.ts`, never
through Graph's own modules. Each workbench file binds the controller to its own
view, which keeps a props-driven contract that tests render directly. Owned panels receive the Workspace
controller; reusable controls keep focused props. Workspace dialog and tour
components bind that controller to their UI without owning another copy of state.
The shared evidence-loading
and flow-input hooks and transaction-fetch context live at Workspace scope. The
dialog module exports modal and focus helpers used by
other areas. Graph filter controls are also used by the entity browser, and
Wallet category controls are used by Analysis.
