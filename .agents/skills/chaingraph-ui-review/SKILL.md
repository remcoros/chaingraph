---
name: chaingraph-ui-review
description: Review Chaingraph interaction changes for accessible, accurate Bitcoin analysis workflows.
---

# Chaingraph UI review

Use for substantive graph, panel, navigation or workspace interactions. Verify behavior in a fresh browser context. Match existing styling for incremental edits; when the user asks for a redesign or isolated experiment, compare alternative hierarchies and interactions instead of treating the current layout as a constraint.

- Check keyboard access, visible focus, control labels, modal focus return, reduced motion, and narrow screens.
- Exercise filters, empty results, missing funding, stale findings and disconnected state. Show the difference between loaded observations and hypotheses.
- Keep explicit controls to restore the whole graph and navigate back from a selection. Do not silently truncate results or call an output unspent from absent graph evidence.
- Inspect screenshots and test realistic long identifiers, labels and large transaction structures.
- Trace a path, select an output, edit its label/note, and return to the graph. Check the number of clicks and scrolls, whether editing is immediately reachable, and whether camera movement helps orientation.
- Keep icon-only controls visually compact with accessible names. Custom selects and popovers need keyboard navigation, focus return and usable empty/disabled states.
- Compare shared selection, hover, trace and annotation actions across renderer adapters. Transaction input/output views and script inspection must work independently from the canvas.
- Verify wallet refresh preserves the camera, selection, labels and tags; new activity must remain discoverable until reviewed. Do not infer unspent status from missing loaded spends.
- Confirm Save and trace controls are fully inside the visible panel, not merely within the browser viewport behind a clipped ancestor. Expand and collapse large transaction lists without moving the whole page.
- Keep private workspace content out of URLs, logs and plaintext storage. Public workspace names are the intentional exception.
- Run browser suites serially within a checkout. Parallel worktrees need separate dependencies, preview/test ports and artifact directories; use the port overrides described in CONTRIBUTING.md.
- Record actionable findings and fixes in the release review, along with what was actually tested.

Inspired by [Vercel Web Interface Guidelines](https://github.com/vercel-labs/web-interface-guidelines) and [Vercel's review skill](https://github.com/vercel-labs/agent-skills/tree/main/skills/web-design-guidelines), consulted 2026-09-08. This project-specific checklist is original MIT project text.
