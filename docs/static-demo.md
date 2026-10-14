# Static demo and loaded-data use

The demo serves static frontend assets and three captured public Bitcoin
investigations. It has no Bitcoin Core, Electrum, Chaingraph proxy or explorer
API. Example creation still asks for a name, password and confirmation and uses
the ordinary encrypted workspace lifecycle. Example data is public; edits are
saved encrypted in the visitor's browser, with public workspace names.

## Local build

Use Node 24 or newer and install dependencies in this checkout:

```sh
npm ci
npm run build:demo
npm run check:demo
```

`build:demo` builds only. It needs no GitHub credentials or running backend and
publishes nothing. It enables demo policy, defaults to the `/chaingraph/` asset
base for `https://remcoros.github.io/chaingraph/` and writes the complete site to
`dist-demo/`. Normal `npm run build` retains its root base and `dist/` output.
The two outputs are independent and both are ignored by Git.

```text
dist-demo/
  index.html
  favicon.svg
  assets/                 JavaScript, CSS, fonts, workers and captured snapshots
  examples/bip329/         Public example downloads
```

`check:demo` checks the generated files without starting a browser or server. It
checks the base-path asset links, worker/font/snapshot availability, meta policy
and absence of live chain request URLs. Run it after a fresh demo build.

For a root-hosted demo, explicitly override the base:

```sh
CHAINGRAPH_BASE_PATH=/ npm run build:demo
npm run check:demo
```

For another project path, set `CHAINGRAPH_BASE_PATH=/project-name/`. Serve the
contents of `dist-demo/` at the matching HTTP(S) path. Vite rewrites bundled
scripts, styles, fonts, workers and snapshot URLs. Public favicon and BIP329
links use the same base. The page uses in-app navigation without server routes.
Do not open `index.html` as a `file:` URL: workers, fetch and secure-context
encryption need HTTP(S). No PWA or internet-offline asset cache is provided.

## GitHub Pages deployment

The [Deploy demo workflow](../.github/workflows/demo-pages.yml) publishes one
current demo at the repository's Pages address. For this repository the standard
address is `https://remcoros.github.io/chaingraph/`.

After the workflow and demo implementation are merged into `main`, do this
one-time setup on GitHub:

1. Open **Settings → Pages → Build and deployment** and choose **GitHub Actions**
   as the source. No generated-files branch is needed.
2. Check **Settings → Environments → github-pages**. If deployment branch/tag
   restrictions are enabled, permit the `main` branch. Keep any desired
   reviewer requirement; the deploy job will wait for that approval.
3. Use HTTPS for the Pages site. No custom domain is required.

The workflow uses GitHub's Pages configuration, artifact-upload and deployment
Actions, pinned to commit SHAs. It reads the actual site base from
`configure-pages` so the build agrees with Pages. It does not enable Pages,
change repository settings or need a personal access token. See
[GitHub's custom Pages workflow documentation](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages).

**Automatic deployment:** every push to `main` triggers the workflow. The demo
previews the current product, including features that have not been released.
Tag pushes and release publication do not update it. Pushes made by automation
using GitHub Actions' [`GITHUB_TOKEN` do not trigger another push workflow](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow).

**Manual deployment:** open **Actions → Deploy demo → Run workflow** and choose
`main` as the workflow branch to rebuild and deploy its current commit. No tag
input is needed. Dispatches from other branches or tags are skipped. To roll
back the demo, revert the relevant change on `main`; the resulting push follows
the same checks.

Both paths check out the exact triggering commit, verify its identity and
package/changelog version, run `npm run check`, then run the same
`npm run build:demo` and `npm run check:demo` used locally. Only `dist-demo/` is
uploaded to Pages. The deploy job waits for the build and has the Pages/OIDC
write permissions; build jobs have read permissions. Runs are serialized across
pushes and manual dispatches, with newer pending runs replacing earlier pending
ones. Immediately before publication, the workflow checks that its source commit
still matches `main` and skips a superseded candidate. A deployment already
underway is allowed to finish, so the demo can briefly lag behind `main`. If the
latest build fails, the existing demo stays available. The run's summary records
the source commit or reason for skipping deployment; its environment link
reports the deployed site URL.

Pages serves the generated static files; it runs no Node server or chain API.
Do not configure a public API proxy or put a private backend URL into the build.
Frontend configuration deliberately does not load network environment files.
The build policy is independent of the legacy saved `workspace.demo` flag.

For other static hosts, upload all contents of `dist-demo/` together and serve
correct JavaScript, JSON, font and SVG MIME types over HTTPS or loopback HTTP.
Keep old hashed assets available while existing tabs may need them, and serve
HTML with revalidation. GitHub Pages controls its own response/cache headers.
Browser storage is per origin; a project path is not a separate origin from
other sites on the same hostname. Use a separate hostname if origin isolation
from other hosted applications is required.

## Static security policy

Demo HTML puts a Content Security Policy before its scripts and a `no-referrer`
meta policy in the head. CSP permits same-origin scripts, workers, connections
and assets, local data fonts/images, blob workers/images and existing inline
styles. It denies objects and base URL changes. Fonts and snapshots are bundled;
external source links open only when the visitor chooses them. The transport
also rejects RPC requests in a demo build before HTTP, and App skips discovery,
polling and automatic live work. CSP does not itself prohibit same-origin API
requests, so these application guards remain necessary.

A static host does not run `server/app.ts`. HTML meta policy cannot supply
`frame-ancestors`, `X-Content-Type-Options: nosniff`, API Host/Origin checks or
HTTP cache headers. In particular, `frame-ancestors` is unsupported in a meta
element, as documented by [MDN](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/frame-ancestors).
For equivalent framing protection use a host that lets you set the full server
CSP including `frame-ancestors 'none'`, plus `nosniff` and `Referrer-Policy:
no-referrer`. On a host without custom response headers the meta protections
are narrower; do not claim equivalence to the self-hosted server. These checks
do not establish browser enforcement or visual usability.

This is backend-offline support. It adds no service worker, PWA install,
internet-offline asset cache or reconnect framework. Storage belongs to the
browser origin; another hostname or port has another workspace list. Export
backups before changing origins or clearing storage.

## Captured investigations

All three dedicated snapshots were captured on 2026-10-14 through an existing
local Chaingraph read-only API, without reading runtime environment files.
Every saved transaction was compared with serialized bytes, including recomputed
txid, exact input outpoints, output amounts and scripts. Every consumed output
was independently checked against its creator's bytes and attached as canonical
input evidence. Full parent transactions are saved only where navigation needs
them. Raw bytes are not shipped; raw-byte inspection still requires live data.

| Example | Saved scope | Prepared actions |
| --- | --- | --- |
| Public BIP84 test wallet | 214 complete history transactions, receive/change indexes 0 to 9, 11 used addresses, dated UTXO checks for all 20 addresses | Review the newest records and net changes, inspect flows and observed counterparties, review categories, annotate and jump to bookmarked Graph records |
| A branching transaction path | Seven full transactions along two funding branches converging at the published large split | Reveal saved spending neighbors, compare branches and use custom connection targets to find a loaded path to the split |
| Five equal outputs | Published Whirlpool transaction and its nine-input successor, with all consumed outputs attached | Compare repeated amounts, inspect exact input/output relationships and run local analysis |

The public wallet's UTXO checks returned zero coins for those 20 addresses at
capture time. That is a genuine dated observation, not a complete wallet balance
or a current claim. Histories are complete within the captured address scope;
discovery beyond it remains incomplete (`scanComplete: false`). The seed is
public: **never send funds to this wallet**.

The branching example adapts the published split's funding side. Its outputs
have no saved later spend, so the example does not advertise a downstream chain
beyond the split. Exact links prove outpoint consumption, never allocation of
one input's value to a specific output. Whirlpool naming is attribution to the
published discovery fixture, not independent verification of protocol use,
participant identities or privacy success. Sources remain in each example and
[the example notes](example-workspaces.md).

## Ownership and capture maintenance

`src/buildMode.ts` exposes the compile-time boolean. App owns demo entry and
the exposed example catalog; `useBackendNetworks` omits discovery in this build.
`useAppState` supplies transient live admission to the existing Session
`chainDataAcquisition` owner. Cached transaction reads and loaded spending
relations remain available before live admission. Graph expansion and ancestry
reuse those paths and keep an explicit saved-data boundary. `ChainData/api.ts`
is the final build guard for every live HTTP entry, including consumers outside
session acquisition. There is no alternate backend, acquisition adapter or
workspace runtime, and no new persisted field or schema version.

The existing example worker loads and validates dedicated snapshots through the
canonical parser off the UI thread. It accepts optional canonical retained
address-UTXO observations. Captured documents retain `demo: false`, so encrypted
exports can be imported and extended by an ordinary matching-network instance.
Annotations and initial views remain code-owned, separate from captured facts.

To recapture, first verify the process/listener ownership and mainnet support
of an already-running local Chaingraph API. Then explicitly select its loopback
port, for example:

```sh
CHAINGRAPH_PROXY_URL=http://127.0.0.1:PORT \
  node --use-system-ca --import tsx scripts/capture-demo.ts
npx prettier --write src/App/Examples/templateData/demo-*.json
```

The script reads only the existing published examples and bounded public API,
limits each address to 500 history records, caps saved transactions at 1,500
and limits the whole acquisition to 15 minutes. It does not start services or
read network configuration. `--paths-only` recaptures the two transaction
examples while leaving the wallet capture untouched. Recapture is an explicit
maintenance operation, never a visitor-triggered path. Review observations,
counts, capture dates and example behavior before replacing shipped data.
