---
name: chaingraph-ui-review
description: Review Chaingraph interaction changes for accessible, accurate Bitcoin analysis workflows.
---

# Chaingraph UI review

Use for substantive graph, panel, navigation or workspace interactions. Preserve the existing visual language and verify behavior in a fresh browser context.

- Check keyboard access, visible focus, control labels, modal focus return, reduced motion, and narrow screens.
- Exercise filters, empty results, missing funding, stale findings and disconnected state. Show the difference between loaded observations and hypotheses.
- Keep explicit controls to restore the whole graph and navigate back from a selection. Do not silently truncate results or call an output unspent from absent graph evidence.
- Inspect screenshots and test realistic long identifiers, labels and large transaction structures.
- Keep private workspace content out of URLs, logs and plaintext storage. Public workspace names are the intentional exception.
- Run browser suites serially to avoid shared server and artifact collisions.
- Record actionable findings and fixes in the release review, along with what was actually tested.

Inspired by [Vercel Web Interface Guidelines](https://github.com/vercel-labs/web-interface-guidelines) and [Vercel's review skill](https://github.com/vercel-labs/agent-skills/tree/main/skills/web-design-guidelines), consulted 2026-09-08. This project-specific checklist is original MIT project text.
