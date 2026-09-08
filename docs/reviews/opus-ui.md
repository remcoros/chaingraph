# UI review: opus-ui

Independent review focused on UI, interaction, information design and browser
behavior. Work done on branch `review/opus-ui`. Backend boundaries, wallet
derivation, scanning and encryption were left untouched.

## Findings and changes

### 1. Native select controls felt off-theme

Every `<select>` (size-by, prefetch depth, paths focus, entity filters, scan
limits, pagination, dialogs) rendered the browser's default control chrome. On
Chromium the open menu used the OS light/blue palette, clashing with the dark
terminal theme, and the default drop arrow did not match the custom iconography.

Change: added `color-scheme: dark` on the document so native popups, scrollbars
and form widgets render dark, and gave `select` a themed treatment
(`appearance: none`, a Lucide-style chevron drawn with the muted token color,
hover border feedback). Compact selects received matching right padding so the
chevron never overlaps their text.
Files: `src/styles.css`, `src/components/product.css`,
`src/components/entity-browser.css`.

### 2. Icon control was a wide labelled dropdown

The annotation icon control was a full-width button showing the glyph, its name
and a chevron. The reviewer brief asked for a small square that shows only the
icon and opens an emoji-like grid without option names.

Change: the trigger is now a 42px square that shows only the glyph. Its
accessible name and tooltip carry the current selection (`Node icon: <name>`),
so screen-reader and hover context are retained. The palette grid already
avoided per-option captions and was left as-is.
Files: `src/components/IconPicker.tsx`, `src/components/icon-picker.css`,
`src/styles.css`.

### 3. Editing was pushed below the fold in the inspector

For a selected node the annotation editor ("Your context") sat after all chain
details and the two large expand actions, so on a transaction it started around
950px down: label and notes were effectively off-screen.

Change: renamed the section to "Label and notes" and moved the editor directly
under the identity block (eyebrow, id, value, key facts) and above the
"Load previous / Find spending" actions. Chain evidence stays visible; the
primary editing affordance is now reachable without scrolling.
Files: `src/components/Inspector.tsx`.

### 4. Graph navigation felt awkward

Using the `3d-force-graph` (OrbitControls) wrapper:

- In Flat (2D) mode the on-screen hint said "Drag to pan" but left-drag and
  one-finger drag did nothing (rotate was disabled and pan was on the right
  button only). Left mouse and one-finger touch now pan in flat mode; 3D keeps
  left-drag orbit. The hint is now accurate.
- Scroll zoom is now zoom-to-cursor in both modes, which matters for dense
  laboratory graphs.
- Added gentle OrbitControls damping, disabled under
  `prefers-reduced-motion: reduce`.

A wholesale custom-engine rewrite was intentionally left out of scope (the
coordinator is commissioning that separately).
Files: `src/components/GraphView.tsx`.

## Test evidence

- `npm run check` (tsc build + vitest): 145 unit tests pass, build succeeds.
- Playwright e2e on an ephemeral port 4174 (fixture port 4184 untouched):
  29/29 pass, including `graph-hover`, `tracing`, `icon-picker` and the full
  `workbench` suite.
- Two `icon-picker` assertions and one `workbench` locator were updated to the
  new small-square trigger contract (accessible name conveys the value). This
  reflects the intended design change, not a weakening of coverage.
- Manual Playwright drive of the demo laboratory (903 nodes) at 1440px desktop
  and 390px mobile: verified themed select menu, small icon square, inspector
  hierarchy, flat-mode left-drag pan, zoom-to-cursor and 3D orbit, with no
  uncaught browser errors.

## Running the improved UI

Dev UI: `NODE_OPTIONS=--use-system-ca CHAINGRAPH_PROXY_TARGET=http://127.0.0.1:4000 \
node_modules/vite/bin/vite.js --host 127.0.0.1 --port 3101 --strictPort`
(served at http://127.0.0.1:3101 during the review).

## Iteration 2: inspector information hierarchy

Coordinator browser review found the earlier reorder traded one scroll problem
for another: at 1440x900 with the laboratory "Synthetic CoinJoin 1" selected the
annotation editor started around y714 and Save fell below the viewport, and
moving the editor above the trace actions pushed tracing down.

Redesigned the node inspector into a deliberate compact hierarchy instead of a
single long column:

- Compact selection summary: eyebrow with an icon-only "Center" control, label,
  the complete identifier (wrapping + copy preserved), value, a one-line caution
  for equal-output / conflicted warnings, the spending-status note, and the two
  common trace actions (Load previous / Find spending) side by side. Related
  transaction navigation (Creating / Spending links) stays here too, so it is
  never hidden behind a disclosure.
- Annotation editor ("Label and notes") directly below, with the icon, bookmark
  and Save combined into one action row so Save is reachable without scrolling.
- Secondary chain evidence (inputs/outputs, state, vsize, equal-output count,
  script type, address) moved into a collapsible "Chain evidence" details block
  placed after the editor, so it never sits as a large always-expanded wall
  ahead of editing. Refresh / Remove live in a small footer.
- Mobile: the graph-only navigation bar (paths, focus, center) is hidden on the
  single-panel widths when the active panel is Wallets or Inspector, reclaiming
  ~130px so the editor and Save are close to the fold on 390x844.

Measured result (laboratory 150-input/output transaction):
- 1440x900: editor top 714 -> ~603; Save fully visible without scrolling.
- 390x844: inspector scroll area ~356 -> ~495px; editor no longer sits under the
  evidence block; Save is a short scroll away, not behind evidence.

New e2e test `inspector keeps trace actions and label editing reachable on a
150-output selection` asserts, at 1440x900 and 390x844: trace actions precede
the editor, evidence stays below it, Save is within the viewport at desktop,
the notes draft survives an evidence toggle, and keyboard focus/Tab moves label
to notes.

Live check: created a testnet4 workspace and loaded the built-in "Follow a spent
output" example through the UI on port 3101 proxied to the coordinator bridge on
127.0.0.1:4400. The POST /api/rpc returned 200 (the 4000 backend rejects Origin
3101 with 403) and the transaction loaded (output d4e5...bb1a:1, 447,915,285
sats, 4 nodes / 3 connections / 1 transaction) with no browser errors.

Preview command (proxying to the 4400 bridge):
`NODE_OPTIONS=--use-system-ca CHAINGRAPH_PROXY_TARGET=http://127.0.0.1:4400 \
node_modules/vite/bin/vite.js --host 127.0.0.1 --port 3101 --strictPort`
