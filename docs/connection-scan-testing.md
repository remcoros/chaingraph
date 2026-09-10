# Connection scan regression checks

Run the focused scan suite before changing traversal, meeting reconstruction,
pruning, deduplication, fetching or scan optimizations:

```sh
npx vitest run tests/connectionScan
```

These are domain and mocked transport checks. They do not start a browser or
query a real backend. The normal `npm test` command also includes them.

## What the tests protect

| Suite | Contract |
| --- | --- |
| `connectionScanLoops` | An 11-node graph containing five inputs, their transaction and five outputs can find five-hop shared ancestry from any selected input. Other target histories cannot erase the expected input connections. Findings survive later cancellation and can be validated, retained and added. |
| `connectionScanVisibleTargets` | A selected five-input/five-output transaction finds a hidden reconnection beyond its visible inputs. A 247-output creator does not block its one-input Sources direction. The exact path survives proof validation and graph acceptance. |
| `connectionScanSymmetry` | The five-output shared-descendant mirror; uneven path lengths; late target branches joining already explored ancestry; exact outpoint identity; transaction/output hop accounting; hidden bypasses masked by shorter visible paths. |
| `connectionScanOracle` | An independent exhaustive simple-path search over all 64 four-transaction DAG topologies and fixed-seed seven-transaction fixtures. Compare reachable endpoints and relationships across Sources, Destinations and Both, mixed target types, target sets, hidden targets, renamed IDs and hop caps. Check the actual returned edges as well. |
| `connectionScanBounds` | Meeting reconstruction respects deadlines, shared transaction/result caps, branch boundaries and unavailable evidence. Earlier valid findings survive limits; traversal state stays out of results. |
| `connectionScan` | Direct paths, stopping at newly discovered target paths, direction restrictions, frozen settings, fan-out boundaries, budgets, cancellation, deterministic scheduling and result priorities. |
| `connectionScanFetch`, `connectionScanEvidence` | Loaded evidence reuse, exact spends and outpoints, bounded fallback, network/session isolation, safe failures, terminal proof and worker ownership. |
| `connectionScanIntegration`, `connectionScanRecords` | Observed paths survive validation, compact encrypted persistence and exact graph acceptance. |
| `connectionScanGroups`, `connectionScanPresentation`, `connectionScanRetry` | Retained scan ownership, grouped results, dismissals, global stop reasons and bounded rechecks. |

If a change touches the shared request scheduler or workspace persistence, also
run the relevant scheduler, network, workspace-schema, encryption-worker and
workspace-save-scheduling suites. Passing a traversal fixture does not validate
those integration boundaries.

## Keep the reference check independent

The oracle enumerates simple observed-edge paths directly. It does not reuse
production frontier, meeting, pruning or hop-count helpers. This lets it detect
an optimization that silently loses endpoints or invents paths while still
producing plausible counts.

Its fixtures assign each spend a distinct output and use acyclic transaction
ordering. Displayed nodes follow the UI contract: they are the source or frozen
graph targets. Additional hidden graph targets are allowed. A source walk continues
through a target when its entire prefix is already displayed. A new path to a
target stops that directed walk. Fully displayed paths are omitted. At most one
direction change is permitted for a shared ancestor or descendant.

Compare endpoint/relationship existence under ample non-hop budgets, not every
alternative path or a particular traversal order. Result saturation, branch thresholds, missing
observations and interrupted searches can reduce coverage; those cases need
explicit expected partial results rather than an exhaustive-search assertion.

## Adding a regression

For each reported miss, first reproduce the displayed graph and selected node,
including whether the source/target is a transaction or an outpoint. State the
expected directed edges and whole-path transaction-hop count. Include other
visible targets that could compete for discovery; a two-node fixture alone would
have missed the five-input bug.

Check the intended product behavior independently of the reference algorithm.
The original oracle copied the rule that every target stops a source walk. Both
implementations agreed, yet neither searched beyond a selected transaction's
already displayed inputs. Agreement with an oracle only checks its stated contract;
named regressions must also challenge that contract.

Reduce a failing generated graph to a readable named case before fixing it.
Keep assertions about the intended result independent of the implementation.
Use deterministic fixture order or fixed seeds, and test Sources/Destinations
symmetry where the transaction topology permits it.

The oracle exercises 51,234 source/target/direction/hop combinations, including all
four-transaction topologies and selected larger fixtures. It does not cover every
large Bitcoin graph, backend response or race. The larger named fixtures cover
selected joins and limits; mocked transport checks do not establish correctness
against a live chain.
