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
