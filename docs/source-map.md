# Source map

Start with the product area below, then follow its direct imports. App is the
React interface and composition code; Core contains workspace capabilities.
Each Core concept owns its models and validity rules. `Core/Workspace/workspace.ts`
composes the canonical document and cross-concept validation.
`Core/Workspace/Persistence` implements encrypted save/load using those rules.
Being serializable does not make a model persistence-owned; being a pure
function does not make it Core-owned.

```text
src/
  main.tsx
  App/
    App.tsx                         shell, home and dialogs
    useAppState.ts                  session navigation and feedback
    appServices.ts                  supplies one persistence facade to Core Session
    FrontPage/                      saved workspace list
    Examples/                       example picker and creation worker
    Help/                           help, about and guided-tour UI
    Controls/                       reusable UI and display helpers
    Dialogs/                        generic modal shell
    Workspace/
      Workspace.tsx                 toolbar, workbenches and status
      useWorkspace.tsx              composes UI controllers and workspace actions
      WorkspaceDialogs.tsx          workspace and wallet dialog wiring
      Dialogs/                      create, import, unlock and details UI
      useWorkspaces.ts              React subscriptions and autosave timer
      TransactionFetchProvider.tsx  React provider for session-bound transaction reads
      Annotations/                  editing hooks, tag proposals and projections
      Selection/                    transient selection and scan-target picking
      GraphState/                   Graph projections, membership actions and panels
        panelState.ts               openFlowPanel presentation action
        traceSource.ts              originating Graph interaction validity
      Wallets/
        Dialogs/                    add-wallet and wallet-name UI
        WalletUtxos/                shared React UTXO controller
      entityRemoval.ts              combines data removal with Graph orphan cleanup
      useWorkspaceOperation.ts      cancellable operation UI and feedback
      useWorkspaceHistory.ts        undo/redo UI actions
      Workbenches/
        workbenchHandoff.ts          deliberate cross-workbench handoff contract
        graphHandoffNavigation.ts   navigation and contextual return behavior
        Graph/
          GraphWorkbench.tsx        canvas and panel composition
          GraphView.tsx             renderer binding and interaction routing
          Address/                  address presentation and lookup orchestration
          Navigation/               lookup UI and Graph expansion actions
            ancestry.ts             bounded previous-level loading and progress
          ConnectionScan/           panel, target projection and path-add actions
          TransactionFlow/          selected-entity flows and input-loading UI
          InspectorPanel/           entity, script and wallet-record inspection
          EntitiesPanel/            entity browser and filters
          TagsPanel/                tag-management panel
          Filters/                  filter controls and Graph filtering
          Renderer/                 Three.js, layout, camera and picking
        Wallet/
          WalletWorkbench.tsx       wallet view and controller binding
          useWalletActivity.ts      discovery controls and monitoring lifecycle
          useWalletAnalysis.ts      wallet entry point into Core Analysis
          Review/                   review panel, categories, rows and flows
        Analysis/
          AnalysisWorkbench.tsx     controls, scope selection and reports
          useWorkspaceAnalysis.ts   analysis UI lifecycle and retained reports

  Core/
    Bitcoin/                        native network, key, script and outpoint primitives
      index.ts                      public primitives; no app or workspace dependencies
      network.ts                    mainnet/testnet4 names and native encoding parameters
      extendedPublicKey.ts          public payload parsing and exact BIP32 child derivation
      scripts.ts                    public-key scripts, address conversion and assembly inspection
      rawTransaction.ts             bounded native serialized-transaction decoding
      outputs.ts                    output script interpretation and content comparison
      transaction.ts                native input/output shapes
    Browser/                        generic mechanisms such as file downloads
    ChainData/                      chain models, observation rules and live queries
      index.ts                      public models, validation and query functions
      transaction.ts                one Transaction with its latest observed status
      transactionValidation.ts      transaction shape and network validity
      transactionStatus.ts          placement and history-height transformations
      observations.ts               address history, balance and UTXO observations
      prevouts.ts                   native outpoint-keyed loaded/attached output index
      transactionObservations.ts    compatible enrichment and status merging
      api.ts                        typed RPC, network capabilities and bounded chain queries
      verboseTransaction.ts         upstream transaction decoding into the canonical model
      utxoStatus.ts                 current UTXO-set checks and output verification
      transactionScheduler.ts       prioritized, bounded fetches and request scopes
      rawTransactionInspection.ts   raw-byte retrieval and loaded-observation binding
    Formatting/                     shared exact amounts and reference abbreviation
      index.ts                      public formatting functions
    Workspace/
      createWorkspace.ts            creation without storage
      workspace.ts                  canonical document schema, type and validation
      chainData.ts                  workspace chain collection and retention membership
      entityReferences.ts           workspace references, independent of Graph rendering
      view.ts                       saved panels, filters, geometry and membership
      budgets.ts                    aggregate resource limits and validation errors
      Persistence/
        index.ts                    facade, full-cycle parser and public results/errors
        workspacePersistence.ts     contract, factory and implementation
        savedWorkspace.ts           public saved-entry and encrypted-export types
        workspacePersistenceError.ts safe public errors and worker error mapping
        Browser/                    private public-index and IndexedDB publication
          workspaceStorage.ts       storage snapshots and coordinated writes
          indexedEnvelopeStorage.ts immutable ciphertext payloads
        Codec/
          parseWorkspace.ts         migration, document validation and reopen policy
          workspaceCodec.ts         encrypted workspace encoding/decoding
          workspaceCodecClient.ts   off-thread queue, cancellation and lifecycle
          workspaceCodec.worker.ts  one encoding/decoding job per worker
          encryptedEnvelope.ts      envelope format and authenticated cryptography
          workspaceCompression.ts   bounded compression and expansion
          workspaceCodecError.ts    private envelope/codec error vocabulary
        Migrations/                 historical document conversion and membership
        Integration/                module-owned persistence fault/lifecycle tests
      entityRemoval.ts              removal, retention and affected human metadata
      transactionContext.ts         chain retention and saved input scope
      flowInputContext.ts           accepts input observations and their saved scope
      Session/
        WorkspaceStore.ts           unlocked lifetime, revisions, history and saving
        chainDataAcquisition.ts     captured-session reads and guarded observation publication
        observations.ts             session ordering of accepted observations
        observationHistory.ts       accepted observations across undo/redo
        observationContextHistory.ts supported scope/provenance across history
        undoDescription.ts          descriptions attached to history entries
      Wallets/                      discovery, records and review behavior
        wallets.ts                  wallet definitions, review records and their validity
        walletDerivation.ts         account-wallet constraints and import validation
        walletMatches.ts            script-verified entity relationships
        walletPreparation.ts        session-scoped prepared review data
        WalletUtxos/
          fetchWalletUtxos.ts        bounded discovery-address UTXO checks
          walletUtxoCheck.ts         retained address-observation projection and coverage
          walletUtxoObservation.ts   checked-output verification and spender reconciliation
      Annotations/                  annotation/tag mutation and membership operations
        annotations.ts              types, schemas and tag normalization
        tagMembership.ts            entity/address tag membership semantics
      Analysis/                     algorithms, findings, recovery and invalidation
        finding.ts                  retained finding types and schema
        toolRegistry.ts             registered tools and functional scan order
        toolGroups.ts               filter grouping and presentation order
        tools/                      one definition and implementation per analysis tool
      ConnectionScan/
        connectionScans.ts          run/result types and schemas
        records.ts                  retained proof, validation and compaction
        results.ts                  result identities and deduplication
        scanNode.ts                 supported scan targets
        scanPath.ts                 path rules and scan limits
        connectionScan.ts           bounded search algorithm
        connectionScanContext.ts    frozen execution baseline
        updates.ts                  replacement and clearing of runs
        connectionScanFetch.ts      run-scoped bounded acquisition
        connectionScanRunner.ts     worker lifecycle and shared fetch budget
        connectionScan.worker.ts    search worker
        connectionScanRetry.ts      bounded endpoint rechecks
server/                             stateless read-only Core/Electrum proxy
tests/
  integration/                      intentional cross-module and storage/UI checks
  fixtures/                         shared public and synthetic fixtures
  e2e/                              browser product workflows
```

## Common tasks

| Task                         | Start here                                                 | Tests                                                        |
| ---------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------ |
| Creation, import or unlock   | App workspace dialogs, Core `createWorkspace`, Persistence | Dialog tests and workspace integration tests                 |
| Autosave, locking or undo    | Core `Session/`, App `Store/`, Persistence `Browser/`      | Colocated history tests and workspace integration tests      |
| Wallet discovery or review   | Core `Wallets/`, App Wallet workbench                      | Colocated rules; Bitcoin/wallet integration tests            |
| Connection scanning          | Core `ConnectionScan/`, App Graph `ConnectionScan/`        | Colocated engine tests and connection-scan integration tests |
| Analysis algorithms          | Core `Analysis/`                                           | Colocated algorithm/recovery tests; format integration tests |
| Metadata and labels          | Core `Annotations/`, App metadata controls                 | Colocated mutations and workspace integration tests          |
| Canvas and flow presentation | App Graph `Renderer/`, `TransactionFlow/`                  | Tests beside their presentation implementation               |
| Membership or entity removal | App `GraphState/`, Core and App `entityRemoval.ts`         | Colocated tests and graph integration tests                  |
| Fetch scheduling             | Core `ChainData/`, Core Workspace `Session/`               | Colocated scheduler tests and Bitcoin integration tests      |

Persistence paths in the table are relative to `src/Core/Workspace/`; App and
other Core paths are relative to `src/`. Unit tests live beside their
production owner as `<file>.test.ts` or `<file>.test.tsx`. Tests deliberately
combining public modules live under `tests/integration/`. Tests of private
persistence storage/crypto faults combined with Session/App behavior live in
Persistence's own `Integration/` suite. Neither location creates a production
dependency on test helpers or App.

## Dependency direction

App consumes Core capabilities and concept-owned models. Persistence also
consumes those models and validity rules, never App or Session implementation. 
Session depends on the public WorkspacePersistence contract; App composition supplies the facade.
Canonical document validation loads neither Persistence nor live query code.
Core Bitcoin owns native mechanisms; Core ChainData owns shared application chain data, typed RPC queries and scheduling, and consumes Bitcoin. Workspace consumes both and owns workspace references and
wallet constraints. Neither Bitcoin nor ChainData imports workspace models or
session execution. ChainData's existing index stays model/validation-only; live
query callers use named-file imports.

Public interfaces may be named files. Bitcoin, ChainData and workspace concepts
allow direct imports, without a mandatory index for every folder. Persistence and
Formatting retain root-only interfaces. Lint rejects their private imports,
including literal dynamic imports and re-exports. Internal imports remain direct.
There are no public Browser/Codec
indexes and no duplicate Persistence/Schema. Public factories do not initialize
browser storage until a storage operation is requested. Import cycles are rejected.

Each concept keeps its canonical data types with their schemas and validity rules.
The Persistence parser migrates, validates the workspace and applies reopen transitions.
Save/export reuse validation without interrupting running scans. Parsing and
file operations do not require browser storage. Old format and envelope details
do not leak into the live model. Pure UI helpers stay in App; transient Graph
projection exclusions are not part of the saved filter type.

Workbench implementations do not import sibling workbench internals. Wallet and
Analysis reach Graph through `GraphHandoff`, never by changing its panel state
directly. ConnectionScan's Core engine owns search and result meaning; Graph
supplies its selected/visible targets and presents or adds the returned paths.

## Workspace and scan vocabulary

`WorkspaceStore` holds public saved entries and unlocked sessions. An unlocked
session owns the decrypted document, password, history and save tracking.
`useWorkspaces` adapts that runtime to React. `edit` is the sanctioned mutation:
it rejects writes during locking, tracks revisions and applies history policy.

Wallet discovery, wallet analysis, wallet review and connection scanning are
distinct workflows. Wallet analysis and the Analysis workbench run the same
Core algorithms and write the same findings collection. Wallet review owns its
decisions and consumes those findings. A connection scan finds bounded observed
paths; it does not assign ownership or prove that no other path exists.

For domain vocabulary, see [CONTEXT.md](../CONTEXT.md). For unfinished work in the
broader observation/runtime refactor, use the current working log rather than
treating this location map as a claim that every planned behavior is done.
