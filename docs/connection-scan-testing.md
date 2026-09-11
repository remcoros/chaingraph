# Connection scan regression checks

Run the focused scan suite before changing traversal, meeting reconstruction,
pruning, deduplication, fetching or scan optimizations:

```sh
npx vitest run tests/connectionScan
```

These are domain and mocked transport checks. They do not start a browser or
query a real backend. The normal `npm test` command also includes them.

## What the tests protect

| Suite                                                                       | Contract                                                                                                                                                                                                                                                                                                                                     |
| --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `connectionScanScenarios`                                                   | Synthetic production-graph/adapter scans assert exact relationships and cycle edges. Root-only versus shown/hidden I/O gives the same loop; Add produces all closed-loop edges; ordinary loaded ancestry and implicit creators yield none; disconnected shared ancestors/spenders remain useful; reruns retain one loop.                     |
| `connectionScanRejectedTargets`                                             | A rejected nearer target on the reconstructed target leg cannot hide a farther genuine reconnection; the regression verifies both retained routes.                                                                                                                                                                                           |
| `connectionScanContext`                                                     | Existing route versus newly observed edge; new edges between known nodes; rejected targets remain traversable; overlapping routes; witness bounds; frozen context and cancellation; mirrored-loop deduplication.                                                                                                                             |
| `connectionScanContextRecords`                                              | Both routes survive validation and compact persistence; full Add includes their union; prefixes omit the return route; missing, tampered and conflicting proof cannot be added; bridge markers and bounds are validated.                                                                                                                     |
| `connectionScanRelationPresentation`                                        | Accurate branch/reconnection/bridge titles and hiding legacy misleading automatic direct cards.                                                                                                                                                                                                                                              |
| `connectionScanLoops`                                                       | An 11-node graph containing five inputs, their transaction and five outputs can find five-hop shared ancestry from any selected input. Other target histories cannot erase the expected input connections. Findings survive later cancellation and can be validated, retained and added.                                                     |
| `connectionScanVisibleTargets`                                              | A selected five-input/five-output transaction finds a hidden reconnection beyond its visible inputs. A 247-output creator does not block its one-input Sources direction. The exact path survives proof validation and graph acceptance.                                                                                                     |
| `connectionScanTargets`                                                     | Custom scans use only explicitly picked transactions or outputs, without inspecting or expanding transaction I/O. Deduplication, source exclusion, the target cap and encrypted custom-scope restoration remain exact.                                                                                                                       |
| `connectionScanNeighbours`                                                  | Direction-neutral breadth-first selection over loaded transaction/output links. Nearest nodes precede farther ones; ordering is stable; hidden context remains eligible; disconnected/address nodes stay out; exact-cap and overflow counts differ; target snapshots remain independent of later graph changes.                              |
| `connectionScanSymmetry`                                                    | The five-output shared-descendant mirror; uneven path lengths; late target branches joining already explored ancestry; exact outpoint identity; transaction/output hop accounting; hidden bypasses masked by shorter visible paths.                                                                                                          |
| `connectionScanOracle`                                                      | An independent exhaustive simple-path search over all 64 four-transaction DAG topologies and fixed-seed seven-transaction fixtures. Compare reachable endpoints and relationships across Sources, Destinations and Both, mixed target types, target sets, hidden targets, renamed IDs and hop caps. Check the actual returned edges as well. |
| `connectionScanBounds`                                                      | Meeting reconstruction respects deadlines, shared transaction/result caps, branch boundaries and unavailable evidence. Earlier valid findings survive limits; traversal state stays out of results.                                                                                                                                          |
| `connectionScan`                                                            | Direct paths, stopping at newly discovered target paths, direction restrictions, frozen settings, fan-out boundaries, budgets, cancellation, deterministic scheduling and result priorities.                                                                                                                                                 |
| `connectionScanFetch`, `connectionScanEvidence`                             | Loaded evidence reuse, exact spends and outpoints, bounded fallback, network/session isolation, safe failures, terminal proof and worker ownership.                                                                                                                                                                                          |
| `connectionScanConcurrency`, `connectionScanWorkerBudget` | Bounded parallel lookups, breadth-level ordering, cancellation, shared worker/fetch reservations and retaining admitted results when the transaction budget fills. |
| `connectionScanFetchBatching` | Exact spender distribution across batched outpoints, per-point fallback, shared script histories and budget/cancellation boundaries. |
| `connectionScanIntegration`, `connectionScanRecords`                        | Observed paths survive validation, compact encrypted persistence and exact graph acceptance.                                                                                                                                                                                                                                                 |
| `connectionScanGroups`, `connectionScanPresentation`, `connectionScanRetry` | Retained scan ownership, grouped results, dismissals, global stop reasons and bounded rechecks.                                                                                                                                                                                                                                              |

If a change touches the shared request scheduler or workspace persistence, also
run the relevant scheduler, network, workspace-schema, encryption-worker and
workspace-save-scheduling suites. Passing a traversal fixture does not validate
those integration boundaries.

## Keep the reference check independent

The oracle enumerates simple observed-edge paths directly. It does not reuse
production frontier, meeting, pruning or hop-count helpers. This lets it detect
an optimization that silently loses endpoints or invents paths while still
producing plausible counts.

The exhaustive oracle exercises the low-level traversal contract without a loaded
edge baseline. The named scenario/context suites exercise the automatic UI scan
contract with frozen loaded links and complete Add behavior. Both layers are
required: agreement with the traversal oracle alone cannot validate result usefulness.

Its fixtures assign each spend a distinct output and use acyclic transaction
ordering. Visible/added scopes include every displayed eligible node as a source
or frozen target. Custom-scope fixtures also display nodes outside the exact picked
target set. Additional
hidden targets are allowed. A source walk continues
through a target when its entire prefix is already displayed. An accepted new path to a target stops that directed walk. Rejected trivial
shared-creator targets remain traversable on the reconstructed target leg too. Fully displayed paths are omitted. At most one
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

The oracle exercises 96,738 source/target/direction/hop combinations, including all
four-transaction topologies and selected larger fixtures. It does not cover every
large Bitcoin graph, backend response or race. The larger named fixtures cover
selected joins and limits; mocked transport checks do not establish correctness
against a live chain.
