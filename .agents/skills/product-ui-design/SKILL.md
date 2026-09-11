---
name: product-ui-design
description: Design and implement compact, professional UI for data-rich web applications and desktop-like product workspaces. Use when creating, changing, or substantially reviewing app screens, panels, dialogs, popovers, toolbars, tables, inspectors, status surfaces, forms, and interaction flows. Optimizes for task fit, scanability, information hierarchy, restrained copy, progressive disclosure, accessibility, complete states, and visual verification. Do not use marketing-site conventions unless the task is explicitly promotional.
license: MIT
---

# Product UI Design

Design application interfaces around what users need to perceive, decide, and do. Do not render the backend model directly into UI. Do not confuse explicitness with usability.

This skill is for product UI, especially dense desktop-style web applications, analysis tools, dashboards, inspectors, editors, admin tools, and technical workspaces. It is not a marketing-page style guide.

Repository instructions, established product semantics, existing design tokens, and explicit user direction take precedence over this skill.

## Core standard

A professional product UI should feel deliberate, calm, compact, and legible. The interface should expose enough state for confident action while keeping secondary explanation and rare controls out of the main visual hierarchy.

For every visible element, ask what job it performs:

- helps the user understand current state;
- helps the user find or compare information;
- enables an action;
- prevents or recovers from an error;
- establishes necessary hierarchy or grouping.

If it does none of these, remove it.

## 1. Read the product before designing

Before changing UI, inspect the affected screen and its neighboring surfaces. Read the relevant components, design tokens, layout primitives, icons, typography, and interaction patterns.

Determine internally:

1. Who is using this surface and what domain knowledge can be assumed?
2. What is the single primary job of the surface?
3. What state or decision must be visible immediately?
4. What actions are primary, secondary, and rare?
5. What information is required now, and what can be retrieved on demand?
6. Which existing product conventions should be reused?

Do not ask discovery questions when repository context or supplied screenshots already answer them. Ask only when an unresolved choice would materially change behavior, scope, or visual direction.

## 2. Product UI, not marketing UI

Default to the interaction model of a desktop productivity application.

Prefer:

- compact toolbars and controls;
- stable workspace regions;
- lists, tables, inspectors, split panes, and contextual panels;
- readable information density;
- restrained chrome and color;
- direct, utility-first copy;
- persistent context for multi-step analysis;
- fast paths for repeat users.

Do not introduce marketing conventions into the app without a specific reason. Avoid hero sections, oversized headlines, promotional copy, feature-card grids, decorative gradients, oversized empty space, conversion-style CTAs, and ornamental dashboards.

## 3. Design the hierarchy before the component

Do not start by mapping every returned field to a label and value.

First create an internal hierarchy:

**Primary**: current state, selected object, current task, or main action.

**Secondary**: information needed to interpret the primary state or make the next decision.

**Tertiary**: metadata, explanation, history, configuration, edge cases, or implementation detail.

Primary information gets position and contrast. Secondary information stays nearby but quieter. Tertiary information is progressively disclosed or omitted.

Do not give every fact equal typographic weight, border treatment, or permanent screen space.

### Common state first

Design the normal state first. Make exceptional states prominent only when they occur.

Examples:

- An idle background scheduler should be visually quiet.
- Active work and queued work should be immediately visible when nonzero.
- Failures should gain prominence when they occur.
- Rare zero-value states such as `0 cancelled` do not need permanent emphasis unless the zero itself matters.
- Detailed concurrency limits and bookkeeping rules belong in secondary help unless they change the user's next action.

Foreground exceptions. Background routine success.

## 4. Do not ship the data model

Translate system concepts into a user-facing mental model.

Do not expose an internal distinction merely because the code has a field for it. Do not create a visible label for every property. Do not repeat the same type label on every row when the surrounding region already establishes the type.

Prefer domain language users already know over implementation language. In a technical application, established domain terms are often clearer than generic paraphrases. Keep internal scheduler names, cache terminology, transport details, and storage mechanics out of normal UI unless users need them to act or diagnose a problem.

Structure can replace visible labels when meaning remains clear. Accessible names must still exist for assistive technology.

## 5. UI copy: minimum sufficient words

Words in product UI exist to help users understand, act, recover, or build trust. They are not decoration and not embedded documentation.

### Copy budget

Use these as defaults, not absolute limits:

| Surface | Default copy budget |
| --- | --- |
| Toolbar | labels only; no explanatory paragraph |
| Status chip / footer | one compact state phrase or counters |
| Small popover | title plus data; at most one short explanatory sentence by default |
| Small dialog | title, necessary task context, controls, actions; avoid introductory prose |
| Inspector section | short heading plus structured fields/actions |
| Form field | label; helper text only for a non-obvious constraint or consequence |
| Empty state | one short explanation plus a clear next action when one exists |
| Error state | what happened, relevant cause if known, and recovery action |
| Destructive confirmation | object, consequence, and explicit confirm/cancel actions |

### Copy rules

UI copy should help the user understand the current state or take the next action. Express state through controls and labels before adding explanatory prose. Do not turn implementation constraints, validation rules, internal reasoning, or hypothetical misunderstandings into permanent disclaimers. Keep necessary qualifications next to the result or action they affect.

- When adding information, rewrite the complete text instead of appending another caveat. Read conditional fragments together as the user will encounter them; avoid joining unrelated purposes with abrupt punctuation.
- Keep descriptions, settings, and current status separate. Fix misleading state presentation rather than explaining it away: show "Not scanned" instead of a zero count followed by a disclaimer that no scan has run.
- Prefer labels, values, rows, columns, grouping, and state indicators over sentences.
- Do not add a subtitle under every heading.
- Do not add helper text just because a control can be explained.
- Do not restate information already visible in the title, selection, tab, column heading, or surrounding region.
- Do not explain implementation details in normal-state UI.
- Use active voice and action-specific labels.
- Keep terminology consistent across controls, feedback, and documentation.
- Use sentence case unless the established product language says otherwise.
- Avoid all-caps eyebrow labels and repeated category labels as decoration.
- Use numerals for counts.
- Use tabular numerals where changing values need visual comparison.
- Use monospace for identifiers, addresses, hashes, code, or other content where character shape matters, not as a generic visual style for labels.

### Progressive disclosure

Keep frequent and decision-critical information visible. Move rare, advanced, explanatory, or diagnostic detail to an appropriate secondary layer such as:

- expandable details;
- an inspector section;
- a secondary popover;
- a details drawer;
- contextual help;
- documentation linked from an error or advanced workflow.

Do not hide essential information behind hover. Tooltips are for brief clarification of a control or truncated value, not for essential instructions or interactive content.

## 6. Layout communicates meaning

Use alignment, proximity, spacing, and typography before adding containers and borders.

- Every element should align deliberately to a grid, baseline, edge, or optical center.
- Keep related controls together and separate unrelated control groups.
- Use consistent control heights within a toolbar or action row.
- Prefer whitespace or a subtle divider over another nested card.
- Use borders to communicate containment, interaction, or a meaningful boundary, not to outline every group.
- Do not create cards inside cards unless the nesting represents a real interaction or containment hierarchy.
- Avoid decorative card mosaics for data that is better represented as rows, lists, or tables.
- Keep long-lived navigation, filters, and inspectors spatially stable where possible.
- Preserve the user's context when drilling into details.

Reuse the existing spacing scale. If no scale exists, establish a small consistent scale rather than scattering one-off values.

## 7. Information density without clutter

Dense interfaces are allowed. Density is not the same as clutter.

A dense layout is successful when users can scan, compare, and act without visually parsing every decoration.

Prefer:

- compact rows for repeated records;
- columns for comparable values;
- a table when column relationships matter;
- a list when items are heterogeneous or action-focused;
- expandable rows or inspectors for secondary detail;
- units in headers or shared context when repeating them in every cell adds noise;
- restrained truncation for long technical identifiers, with reliable access to the full value;
- copy actions adjacent to technical identifiers when copying is common.

Do not solve density by shrinking essential text to unreadable sizes. Use hierarchy and removal first.

## 8. Action hierarchy

Each local region should have a clear action hierarchy.

- Prefer one visually dominant primary action per meaningful scope.
- Secondary actions should be available without competing with the primary action.
- Tertiary and rare actions can move into overflow menus or contextual controls.
- Destructive actions should not sit casually among routine actions.
- Batch actions should appear in the context of an active selection when possible rather than consuming permanent toolbar space.
- Use icons when they improve scanning and the meaning is established. Keep an accessible name. Add visible text when the icon alone is ambiguous.
- Do not make tertiary actions large or full-width without a layout reason.
- Do not add controls that merely expose implementation capability. Start from user tasks.

For expert-oriented software, support efficient repeat use with keyboard shortcuts or accelerators where appropriate, but keep the ordinary interaction discoverable.

### Control sizing and consistency

Choose an existing control density before adding buttons, inputs, selects or icon
actions. Quick editors and inspector actions should match nearby workspace
toolbars. Being inside a dialog does not by itself justify larger controls.

- Reuse a shared component or density class and its tokens. In this repository,
  `.compact-controls` provides the compact quick-editor treatment: 30px controls,
  11px button text, 12px input text, and larger targets for coarse pointers.
- Check the actual CSS cascade: font size alone does not make a control compact.
  Align minimum height, padding, line height, icon size and gaps; remove competing
  local overrides when adopting the shared treatment.
- Keep primary, secondary and icon-only actions at the same density within a
  group. Use emphasis to express priority. Reserve larger controls for workflows
  that need them, such as onboarding or touch-first forms.
- Keep action labels short and on one line. Let the group reflow when necessary;
  avoid stretched full-width secondary buttons unless the layout needs them.
- Use the same icon for the same operation across surfaces. Paired Add/Remove
  membership actions use Plus/Minus; deleting a record uses the delete icon.
  Keep an accessible name and tooltip for icon-only actions.
- Check normal, disabled, busy and narrow states without shrinking readable text
  or pointer targets. Respect the user's validation scope; do not add browser
  checks solely to confirm styling.

## 9. Status, async work, and background activity

System status must be visible without becoming the main content when nothing requires attention.

For background work:

- show whether work is idle, active, queued, blocked, or failed;
- distinguish current activity from recent history;
- show useful progress for work that takes long enough to affect user decisions;
- avoid noisy spinners for operations that usually finish immediately;
- preserve the action label while showing a control's busy state;
- announce meaningful async changes to assistive technology;
- keep normal idle/success states quiet;
- make failure and blocked states easy to inspect and recover from.

For a compact activity surface, prefer structured counters or rows over prose such as "N active, N queued, N done, N failed" embedded in sentences.

Implementation limits such as request concurrency, deduplication rules, or history retention belong in technical details unless they are necessary to interpret current behavior.

## 10. Forms and editing

- Every input has an accessible label.
- Keep visible labels when users need them to understand the field. Do not rely on placeholder text as a label.
- Helper text explains a real constraint, format, consequence, or unusual default. Otherwise omit it.
- Validate close to the field and preserve recoverable input.
- Error text should explain how to recover, not merely report an internal failure.
- Do not disable a submit action solely to hide validation feedback unless the interaction requires it.
- Warn before navigation when unsaved work could be lost.
- Keep save state and persistence behavior understandable without constant explanatory copy.

## 11. Lists, tables, filters, and inspectors

Data-heavy product surfaces should optimize scanning and comparison.

- Use short column names.
- Align numeric data consistently and use tabular numerals when useful.
- Keep filter state visible and make clearing it easy.
- Distinguish an empty dataset from no search results and from a filtered-empty result.
- Place global list/table actions together; place row-specific actions with the row or its inspector.
- Reveal batch actions after selection when possible.
- Use expansion or an inspector for secondary metadata rather than widening every row.
- Avoid duplicating selected-object details in both the list and inspector unless the repetition preserves necessary context.
- When a value has uncertain, stale, partial, or unavailable meaning, represent that state explicitly rather than substituting `0`.

## 12. Visual system and restraint

Treat the existing visual language as a system, not a loose style reference.

Reuse established:

- typography roles;
- spacing tokens;
- colors and semantic states;
- border and radius treatment;
- control heights;
- icon family and stroke weight;
- elevation strategy;
- interaction states.

Do not invent a new mini design system for each feature.

Reserve accent color for information that deserves attention such as the primary action, selection, focus, or a meaningful semantic state. Do not sprinkle accent color across labels and decoration simply to make a screen look designed.

Use shape, borders, shadows, and motion only when they communicate hierarchy, state, containment, or cause and effect.

Avoid generic generated-UI tells:

- identical rounded cards for every content group;
- excessive nested borders;
- decorative gradients without product meaning;
- large radius values applied to everything;
- arbitrary glow effects;
- an icon before every label;
- repeated uppercase micro-labels;
- explanatory subtitle text under every heading;
- excessive badges and pills;
- animations on every hover or section entrance;
- visual novelty that slows routine work.

## 13. Domain semantics must survive visual design

Visual treatment must not change the meaning of the product.

If the domain distinguishes observation, annotation, hypothesis, confidence, freshness, ownership, evidence, or scope, preserve those distinctions. Do not use strong color, certainty language, or severity styling that implies a stronger conclusion than the underlying data supports.

When a product rule conflicts with a prettier presentation, preserve the product rule.

## 14. Accessibility is a hard gate

A visually polished result is not acceptable if core interaction is inaccessible.

At minimum:

- use semantic HTML before ARIA;
- make all functionality keyboard-operable;
- provide visible, unobscured focus states;
- return focus appropriately after dialogs and temporary overlays close;
- provide accurate accessible names for icon-only and visually unlabeled controls;
- do not convey meaning through color alone;
- keep essential content available without hover;
- make drag or gesture interactions available through an alternative when feasible and required;
- respect reduced-motion preferences;
- support browser zoom and text resizing without losing core functionality;
- target WCAG 2.2 AA, including minimum pointer-target requirements or valid exceptions;
- use polite live regions for relevant asynchronous status updates;
- ensure modal dialogs trap focus, provide a close/cancel route, and close with Escape where appropriate.

Visible text may be minimal. Accessible naming may not.

## 15. Design all relevant states

Do not stop at the ideal populated state. Model the states users can actually encounter.

Depending on the feature, consider:

- initial and first-use;
- loading and progressive loading;
- idle;
- active and queued;
- empty;
- filtered empty and no results;
- selected and multi-selected;
- success;
- partial success;
- stale data;
- offline or backend unavailable;
- permission or capability unavailable;
- validation failure;
- server or RPC failure;
- cancellation;
- retry and recovery;
- disabled and busy controls.

Do not permanently display every possible state at once. Design them, then surface them when relevant.

## 16. Responsive and workspace behavior

Design from available space and task priority, not from a generic mobile-first template.

For desktop-class tools:

- preserve the primary working surface;
- collapse or move secondary inspectors before compromising the core task;
- allow dense panels to scroll independently only when that behavior is intentional and discoverable;
- avoid accidental nested scrolling;
- verify common laptop widths and at least one narrow/reflowed state;
- test long labels, long identifiers, enlarged text, and browser zoom;
- do not hide essential functions just to make a narrow screenshot cleaner.

## 17. Motion

Motion should explain cause and effect, preserve spatial continuity, or acknowledge an action.

Prefer no motion to decorative motion. If motion is used:

- keep it short and interruptible;
- animate transform and opacity where practical;
- avoid `transition: all`;
- do not animate every hover state merely for polish;
- do not delay routine expert workflows for animation;
- honor reduced-motion preferences.

## 18. Implementation discipline

When implementing a UI change:

1. Reuse existing components before creating new primitives.
2. Preserve data and behavior contracts unless the task explicitly changes them.
3. Keep visual changes scoped to the requested feature unless a shared inconsistency blocks the design.
4. Do not add a dependency for a small visual convenience when existing CSS/components can solve it cleanly.
5. Keep repeated values in tokens or shared primitives where the project already uses that pattern.
6. Use real product content and realistic edge-case fixtures for validation.

## 19. Required reduction pass

After the first implementation, perform a deletion pass before calling the UI finished.

Inspect every heading, sentence, label, icon, badge, divider, border, container, and action.

For each element ask:

1. Does it help the user understand, decide, act, recover, or navigate?
2. Is the same meaning already communicated elsewhere?
3. Can layout or grouping communicate this more efficiently?
4. Is it needed in the common state, or only in an exceptional/advanced state?
5. Would removing it materially reduce usability or accessibility?

If not, remove it.

Specifically attempt to remove 30 to 50 percent of explanatory UI copy from the first draft without reducing task comprehension. This is a forcing function, not a target metric. Keep text that is genuinely necessary.

## 20. Visual verification

Passing type checks and tests does not prove UI quality.

Browser and screenshot validation happen only on explicit request or within an agreed QA scope (see `AGENTS.md`). Selecting this skill does not authorize them.

When browser and screenshot validation is authorized, apply the following within the agreed scope:

1. Render the changed surface with realistic data.
2. Inspect it at the target desktop viewport and at least one constrained width.
3. Compare it with adjacent established product surfaces.
4. Check alignment, density, hierarchy, overflow, truncation, and interaction states.
5. Inspect a common state and at least one exceptional state such as loading, empty, or error.
6. Run the reduction pass after seeing the rendered result.

When authorized, screenshot review helps assess design quality. It is not a completion requirement outside that scope.

## 21. Approval checklist

Do not approve a substantial UI change until the relevant answers are yes:

- Can a user identify the surface's primary job at a glance?
- Is current state visible without reading explanatory paragraphs?
- Is the next likely action easy to find?
- Are primary, secondary, and tertiary information visually distinct?
- Did the design avoid rendering every backend field as a visible label/value pair?
- Is repeated context removed?
- Is advanced detail progressively disclosed rather than permanently displayed?
- Are normal states quiet and exceptional states noticeable?
- Are action hierarchy and destructive actions clear?
- Does the layout use alignment and proximity instead of excessive containers?
- Are lists/tables/inspectors used according to the structure of the data?
- Does the UI remain coherent with neighboring product surfaces?
- Are loading, empty, error, and recovery states covered where relevant?
- Is the interaction keyboard accessible with visible focus?
- Do icon-only controls have accessible names?
- Does color reinforce rather than carry meaning alone?
- Have the explicitly requested or agreed browser/screenshot checks been completed, or has omitted visual validation been stated when those checks are outside scope?
- Has the deletion pass been performed?

## 22. Relationship to review skills

This skill guides design and implementation decisions before and during UI work. A repository-specific UI review skill may impose additional checks after implementation. Use both when the task calls for a formal visual review. Do not let a generic review checklist override repository-specific product semantics or explicit user direction.

## Final principle

Design the interface around what the user needs to perceive and do, not around what data the application happens to have. Prefer hierarchy, layout, concise language, and progressive disclosure over explanatory prose. Every persistent element must earn its screen space.
