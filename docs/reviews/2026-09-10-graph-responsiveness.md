# Graph responsiveness pass

Date: 2026-09-10

## Findings and changes

- An obsolete layout could occupy its worker for tens of seconds before the latest
  filter request ran. New topology requests now terminate obsolete work; stale
  replies are ignored. Cached subsets restore without simulation, so removing
  neighboring context can immediately restore the previous node positions.
- Explicit snapshot flush could run pending layout synchronously. Lock, export
  and workbench transitions now capture the current camera and displayed geometry
  without running layout on the UI thread. Layout failures preserve the displayed
  scene and expose Retry, including failure to create a worker.
- Context expansion lacked advance scope information and activity feedback.
  **Show connections (+N)** beside filtered results previews the extra loaded
  one-hop node count, and **Hide connections** reverses it. The initial context
  checkbox was removed after user feedback: selection alone did not affect its
  matches and the disabled zero-neighbor state was confusing.
  Filtering and arranging show a compact navigation status. Controls stay usable;
  selecting all matches waits for current filter results.
- Shared filtering rebuilt topology indexes and repeated equivalent list/canvas
  passes. Lazy graph-scoped indexes and shared results reduce this work. React
  defers filter projection behind control updates, keeping workspace and fit
  requests paired. This does not move domain filtering off the UI thread.
- Layout collision traversal allocated and walked spatial trees each tick.
  Adjacent-cell collision grids reduce that work without omitting nodes or links.
  Saved anchors remain exact and layouts deterministic.
- Hover projected all edges and rescanned transaction inputs. Hover now picks
  nodes only, with edge picking retained for clicks and a reused spender index.
  Presentation-only changes avoid unchanged geometry uploads.
- Min/Max sats now use native number inputs with integer steps and bounded values.
  Blank means no bound; invalid bounds keep explicit validation.

## Local measurements

Synthetic fixtures contain public, reproducible data. These are local Node timings,
not browser interaction timings or guarantees for a user's hardware.

| Fresh 3D layout |  Before |   After |
| --------------- | ------: | ------: |
| 1,000 nodes     |  1.88 s |  1.21 s |
| 5,000 nodes     | 11.37 s |  7.89 s |
| 10,000 nodes    | 24.24 s | 16.66 s |

The 1,000-node 3D fixture had no overlapping node spheres before or after. Flat
layouts retained a known overlap limitation (308 pairs before, 307 after on that
fixture); this pass does not claim to solve packing quality. Adding twelve nodes
beside 1,000/5,000/10,000 saved anchors took approximately 10/12/17 ms after changes.

Filter timings below use a 30,000-node synthetic public-key wallet, twenty measured
interleaved runs after five warmups, with exact before/after output comparison.

| Filter                     | Median before | Median after |
| -------------------------- | ------------: | -----------: |
| No restriction             |      25.70 ms |     11.18 ms |
| Amount                     |      23.32 ms |      8.94 ms |
| One output with neighbors  |      15.67 ms |      4.07 ms |
| All outputs with neighbors |      27.18 ms |     15.34 ms |
| Two-hop focus              |      15.90 ms |      3.49 ms |
| Spend/funding evidence     |      23.26 ms |     10.48 ms |

Local scripts and raw results are retained under ignored
`artifacts/graph-performance/`. Large fresh layouts still take seconds. Visible
activity and cancellation are necessary even with the measured improvement.

## Regression coverage and limits

Validation passed: production build, all 795 unit/domain/backend tests across 74
files, portability check and whitespace check. A separate source review found no
remaining material integration issues after guarding pending filter selections.

Focused tests cover rapid 10,000-node expansion/collapse, exact cached restoration,
stale and duplicate results, worker construction/dispatch/runtime failures and
retry, gesture-deferred snapshots, pending-layout flush/dispose, initial camera
capture and save-publication failure retry. Layout tests cover deterministic dense
hubs, Flat views, negative grid boundaries, radius weighting, coincident points
and exact anchors. Domain tests cover preview counts, hidden/focus boundaries,
index reuse and reversing a 20,000-node neighbor expansion.

Renderer lifecycle checks use mocked WebGL/worker infrastructure; picking tests
use real Three.js geometry and raycasting. Browser suites and screenshots are
explicitly excluded by the user's current instructions. Browser test source was
updated for the new control wording and numeric input contract without running it.
