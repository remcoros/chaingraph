# Dependency refresh

Checked 2026-09-10 against npm registry metadata and upstream release notes.

All 29 direct runtime/development packages were checked. Updated React and React
DOM to 19.3.0, Three.js to 0.186.0, Zod to 4.6.1, Lucide React to 1.44.0, React/DOM
types to 19.3.0 and Node types to 26.5.1. The other direct packages were already on
their current stable releases. The lockfile refresh also updates compatible
transitive dependencies, including Scheduler, Rolldown, Valibot and Bitcoin
serialization utilities. Runtime license notices were regenerated; changed
packages retain MIT or ISC licensing.

## Applicability

- [React 19.3 release notes](https://react.dev/blog/2026/09/09/react-19-3)
  include a deferred-value stale-value fix relevant to graph filtering. Hydration
  lifecycle changes do not apply to this client-rendered `createRoot` application.
- [Three.js r185 to r186 migration guide](https://github.com/mrdoob/three.js/wiki/Migration-Guide#185--186)
  adds `Object3D.dispose()`. The application has no custom subclasses overriding
  this method. The other listed migrations do not affect APIs used here.
- [Three.js ray intersection change](https://github.com/mrdoob/three.js/pull/33661)
  changes triangle boundary picking. Existing real-Three picking and renderer
  lifecycle regressions passed after installation.
- [Zod 4.6.1](https://github.com/colinhacks/zod/releases/tag/v4.6.1)
  and [Lucide 1.44.0](https://github.com/lucide-icons/lucide/releases/tag/1.44.0)
  require no application migration in the checked build and domain suite.

## Limits and validation

`@types/node` metadata advertises an older 22.x `latest` tag despite publishing
26.5.1. The existing 26.x dependency was updated within that newer stable line
instead of downgraded. `@types/three` remains at its latest published 0.185.4.
Some transitive dependencies remain below their independent latest versions
because upstream libraries require older ranges. No overrides force incompatible
major versions. npm also deduplicated Tween.js to 23.1.3, the version required by
Three's types and accepted by `three-render-objects`.

Clean `npm ci`, production build, all 795 tests across 74 files, dependency-tree
validation, portability and whitespace checks passed. npm reported zero known
vulnerabilities. Browser tests and screenshots were skipped at the user's request;
source compatibility and unit tests do not establish visual equivalence. Registry
responses and before/after package records are local ignored artifacts under
`artifacts/dependency-update/`.
