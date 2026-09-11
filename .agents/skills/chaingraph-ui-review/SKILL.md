---
name: chaingraph-ui-review
description: Review Chaingraph interaction changes for accessible, accurate Bitcoin analysis workflows.
---

# Chaingraph UI review

Use for substantive graph, panel, navigation or workspace interactions. Match existing styling for incremental edits; when the user asks for a redesign or isolated experiment, compare alternative hierarchies and interactions instead of treating the current layout as a constraint.

Browser and screenshot validation happen only on explicit request or within an agreed QA scope (see `AGENTS.md`). Selecting this skill does not authorize them.

Review the criteria below through source inspection and appropriate non-browser checks by default. Perform browser exercises and screenshot inspection only when authorized, in a fresh browser context and within the agreed scope.

- Check keyboard access, visible focus, control labels, modal focus return, reduced motion, and narrow screens.
- Review complete UI text in context, including conditional fragments assembled in code. Flag internal reasoning, implementation reminders, repeated caveats, blanket disclaimers, and paragraphs that mix descriptions, settings, and status. Check for awkward joins and abrupt punctuation from appended copy; propose a complete, concise rewrite that helps the user understand the state or act.
- Prefer fixing misleading controls or state labels over adding explanatory prose. For example, an unrun scan should say "Not scanned", rather than show zero and explain why it is not a result. Preserve necessary uncertainty and consequences beside the affected result or action.
- Exercise filters, empty results, missing funding, stale findings and disconnected state. Show the difference between loaded observations and hypotheses.
- Keep explicit controls to restore the whole graph and navigate back from a selection. Do not silently truncate results or call an output unspent from absent graph evidence.
- Check realistic long identifiers, labels and large transaction structures; inspect screenshots only when authorized.
- Trace a path, select an output, edit its label/note, and return to the graph. Check the number of clicks and scrolls, whether editing is immediately reachable, and whether camera movement helps orientation.
- Keep icon-only controls visually compact with accessible names. Custom selects and popovers need keyboard navigation, focus return and usable empty/disabled states.
- Compare shared selection, hover, trace and annotation actions across renderer adapters. Transaction input/output views and script inspection must work independently from the canvas.
- Verify wallet refresh preserves the camera, selection, labels and tags; new activity must remain discoverable until reviewed. Do not infer unspent status from missing loaded spends.
- Confirm annotation and trace controls are fully inside the visible panel, not merely within the browser viewport behind a clipped ancestor. Expand and collapse large transaction lists without moving the whole page.
- Edit a note and immediately change selection or lock. Verify the edit survives reopening without a Save action, and that graph restoration does not mix workspaces.
- Exercise continuous graph gestures with pending edits. Saves must wait for idle input, and immediate lock/export/switch must capture the latest view. Distinguish actual browser event timing from slow automation round trips.
- Restore hidden entities with other filters or address display disabled. Explain why an entity stays off the canvas and provide an explicit recovery action. Row removal must preserve unrelated selection and identify targets even when labels collide.
- Keep private workspace content out of URLs, logs and plaintext storage. Public workspace names are the intentional exception.
- Run authorized browser checks serially within a checkout. Parallel worktrees need separate dependencies, preview/test ports and artifact directories; use the port overrides described in CONTRIBUTING.md.
- Record actionable findings and fixes in the release review, along with what was actually tested.

Inspired by [Vercel Web Interface Guidelines](https://github.com/vercel-labs/web-interface-guidelines) and [Vercel's review skill](https://github.com/vercel-labs/agent-skills/tree/main/skills/web-design-guidelines), consulted 2026-09-08. This project-specific checklist is original MIT project text.
