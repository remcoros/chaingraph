I would hold a general release until the save/reopen defect below is fixed. The architecture respects the intended boundary: browser-owned scanning and encryption, with a stateless, read-only backend proxy. I found no verified authentication bypass or credential disclosure in the inspected code.

All file and line references below refer to **commit `37ddadf`**, not the changing working tree. High means potential loss of normal access to saved work; Medium means incorrect results, lost edits, or a significant workflow obstacle; Low means misleading presentation.

The following **nine defects** are verified by committed-source inspection. Five also have executable reproductions.

1. **High: importing a wallet label can make the saved workspace impossible to reopen.**
   Evidence: `src/lib/labels.ts:34–39`, `src/App.tsx:1201–1204`, `src/domain/workspace.ts:117`, `src/lib/useWorkspaces.ts:163–168, 222–240`. Label import accepts 200 characters and copies the label into `wallet.name`, whose loader limit is 100. Updates and persistence do not perform full workspace validation.
   **Reproduction:** import an xpub label containing 101 characters, save, lock, and unlock. My probe confirmed successful encrypted saving followed by rejected reopening. Exporting preserves the same invalid contents.
   **Fix:** enforce the wallet-name constraint during import and validate the complete resulting workspace before committing mutations or replacing a saved envelope. Add a repair path for affected files.

2. **Medium: imported wallet addresses are not verified against their public key.**
   Evidence: `src/domain/workspace.ts:261–285`; `src/components/Inspector.tsx:130–133`. Validation checks the address’s path text and script hash, but never derives the address from the recorded account key. The inspector then uses those addresses to count wallet outputs.
   **Reproduction:** retain wallet A’s key and replace its address record with a correctly formed record derived from wallet B. My probe confirmed that `parseWorkspace` accepts it.
   **Fix:** derive and compare each imported branch/index using the recorded key and script type. Reject inconsistent records before presenting wallet associations.

3. **Medium: unrelated workspace changes discard annotation drafts.**
   Evidence: `src/App.tsx:1008`, `src/components/Inspector.tsx:29, 445–450`, `src/lib/useWorkspaces.ts:179`. The annotation editor’s React key includes undo-history length, so changing that length remounts the editor and resets its local draft.
   **Scenario:** type an unsaved note, then toggle graph glow or dimensions. A background chain update can also reset history and remount the editor. Neither action intentionally abandons the note.
   **Fix:** key the editor by workspace and entity identity. Preserve dirty drafts across unrelated updates and explicitly reconcile actual annotation changes or undo operations.

4. **Medium: scan completion overwrites labels imported during the scan.**
   Evidence: `src/lib/api.ts:199–205`, `src/App.tsx:338, 455, 648–655, 1201–1204`. Scanning returns a copy of the wallet captured at scan start. Completion replaces the entire current wallet, while label import remains available during scanning.
   **Reproduction:** start scanning, import a new wallet label, then complete the scan. Evaluating the committed scanner and application merge reproduced the old name replacing the imported name.
   **Fix:** merge only scan-owned fields, such as addresses, continuation state, and scan timestamps, into the latest wallet record.

5. **Medium: equal-output findings highlight unequal outputs.**
   Evidence: `src/domain/analysis.ts:30–38`, `src/domain/workspace.ts:317–318`. Detection counts repeated amounts, but the finding includes every output in its highlighted node set.
   **Reproduction:** a two-input transaction with output values `[1, 1, 1, 7]` produces “3 equal outputs” containing all four output nodes. Confirmed by execution.
   **Fix:** record the actual repeated-value groups and highlight their members. Keep transaction-wide context separately so the unique output is not visually presented as equal-value evidence.

6. **Medium: rerunning analysis silently restores excluded findings.**
   Evidence: `src/App.tsx:493–500`; finding constructors in `src/domain/analysis.ts`. Rerunning removes prior results and creates fresh findings without carrying over `excluded`.
   **Reproduction:** exclude a finding, then rerun the same tool against unchanged transactions. My probe confirmed `excluded: true` becomes false in effect.
   **Fix:** preserve exclusion decisions for stable finding identities and unchanged evidence. Indicate when changed evidence warrants reconsideration.

7. **Medium: “Focus” does not bring the finding into view.**
   Evidence: `src/components/AnalysisPanel.tsx:76`, `src/App.tsx:968–970`, `src/components/GraphView.tsx:413–415, 444–446`. Focus selects the first member and changes styling. It does not move the camera or frame the finding.
   **Scenario:** pan away from a cluster and click its finding’s Focus button. The cluster remains outside the visible area.
   **Fix:** pass the finding’s node set to a camera-framing operation. Preserve the analysis panel and provide a visible selected-member list.

8. **Medium: the keyboard fallback cannot enumerate more than 200 matching entities.**
   Evidence: `src/components/WorkspacePanel.tsx:169–188`. Results are sliced to 200 without pagination or a load-more action.
   **Scenario:** inspect a transaction with more than 200 outputs using the entity list. Even filtering by its transaction ID leaves later outputs unavailable unless the user already knows a sufficiently specific identifier. This also limits the advertised WebGL-failure fallback.
   **Fix:** provide accessible pagination or incremental rendering that makes every match reachable, with full identifiers available to distinguish rows.

9. **Low: the unlock dialog incorrectly describes names as encrypted.**
   Evidence: `src/components/Dialogs.tsx:216–218`, `src/lib/useWorkspaces.ts:228–232`, `src/components/WorkspaceHome.tsx:93–95`. The dialog says names stay encrypted until unlocked, while workspace names are deliberately stored and displayed publicly.
   **Scenario:** a user deciding what information is safe to put in a workspace name receives contradictory privacy guidance.
   **Fix:** explicitly distinguish public workspace names from encrypted descriptions, wallet names, and contents.

These **four product and release recommendations** are separate from the verified defects.

10. **Medium priority: provide workspace deletion and quota recovery.**
    Evidence: `src/components/WorkspaceHome.tsx:79–110`, `src/lib/useWorkspaces.ts:234–240, 256–260`. Saved workspaces have no deletion action, and every save rewrites the complete index. Once storage fills, exporting does not free space.
    **Scenario:** accumulated laboratory workspaces or imported copies prevent saving a real investigation. Add deliberate per-workspace deletion with backup guidance and the existing cross-tab conflict protection.

11. **Medium priority: add graph filtering that supports an investigation.**
    Evidence: `src/App.tsx:480–490, 877–879`. Entity filters affect the sidebar while the renderer receives the entire graph.
    **Scenario:** after expanding a large fan-out, filtering a label still leaves all unrelated nodes visible. Add a selected-neighborhood or finding filter, with visible hidden-node counts and an obvious reset. Keep hiding separate from deleting transaction data.

12. **Medium priority: package and identify reproducible releases.**
    Evidence: the committed tree contains no Dockerfile, Compose file, or release workflow; `package.json:3, 14, 50` declares version `0.1.0` and starts the TypeScript backend using the development dependency `tsx`. `README.md:24–32` correctly requires retaining dependencies.
    **Recommendation:** provide an upstream Docker build and example deployment that preserve browser-owned storage and backend statelessness. Include the runtime dependencies explicitly, document binding and HTTPS-origin configuration, and expose the packaged version/commit in the UI or status response. Docker absence is a distribution gap, not a broken advertised feature.

13. **Medium priority: exercise the production server in CI.**
    Evidence: `.github/workflows/check.yml:15–18`, `playwright.config.ts:35–39`, `server/app.ts:18–24, 153–163`. CI builds the frontend, but browser tests launch Vite rather than the built application served by Express.
    **Scenario:** a regression in production CSP or static serving can pass browser CI. Add a fixture-backed production-server smoke covering graph loading, encryption, and reload/unlock. The manual production checks documented in `docs/validation.md` are useful evidence, but are not an automated release gate.

I inspected the committed backend routes, configuration and transport code; wallet derivation, scanning and tracing; workspace schemas, encryption and persistence; application, graph, inspector, dialog and analysis flows; package and CI configuration; architecture and validation documentation; and selected test definitions. I visually inspected `trace-workbench.png` and `mobile-tracing.png` directly from the snapshot.

I ran five isolated probes using committed modules loaded into memory, synthetic data, real encryption for the save/reopen case, and mocked scan responses. The scan-merge and analysis-rerun probes evaluated the application’s merge expressions without mounting React. An initial subprocess-based harness failed; the subsequent in-memory harness completed.

I did **not** run the full build, test suite, browser suite, live mainnet/testnet4 queries, Docker deployment, dependency audit, screen-reader testing, or native mobile GPU testing. Existing documented pass counts are not my results. No project files were edited, nothing was published, and no environment files or credentials were read. No skills, memory, other agents, user configuration, or AGENTS.md files were used.
