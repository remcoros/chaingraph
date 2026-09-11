# Self-hosted deployment

Chaingraph is a single-user analysis workbench with a stateless proxy. It has no server-side workspace database or application login. Use it on a trusted machine/network, or behind your own authenticated HTTPS reverse proxy. Workspaces stay in browser storage and exported encrypted files; workspace names are public metadata. Keep encrypted exports as backups before clearing browser data or changing the site's origin.

## Network configuration

The backend discovers `.env.mainnet` and `.env.testnet4` in its working directory, or in the directory named by `CHAINGRAPH_NETWORK_CONFIG_DIR`. Configure one or both files using the public [.env.example](../.env.example) template. At least one valid network file is required at startup. Each file has its own Bitcoin RPC authentication, Fulcrum endpoint, connection/request timeouts and concurrency limits. The filename selects its network; an optional `BITCOIN_NETWORK` value must agree with it.

These files use dotenv syntax: quote values containing `#`, and keep any intentional quotes inside the chosen quoting style. Dollar signs are not expanded. Files are parsed independently, never sourced by a shell, merged into `process.env`, or supplied to Compose `env_file`. A plain `.env` file is not a runtime fallback. Do not load two network files with Node's `--env-file` options; that would merge their identically named settings before the application starts.

Core and Fulcrum must both serve the file's network. Their reported chain/genesis is checked before relevant requests. `GET /api/networks` reports configured networks; `GET /api/status?network=mainnet` checks one pair. The frontend uses the workspace network on every request and shows each pair's health independently. Newly created workspaces can select only configured networks. Importing or unlocking a workspace for an unconfigured network opens its saved data for offline inspection and editing, with a clear backend-network error and disabled live queries.

## Optional exact-output spender lookup

`CHAINGRAPH_USE_TXOSPENDERINDEX=false` is the default in each isolated network
file. Set it to `true` for a chosen network to use an already configured Core 31+
`txospenderindex`. Only the literal values `true` and `false` are accepted. This
application setting does not enable, build or change any index on Bitcoin Core.
The Core index requires an unpruned node and time to synchronize; index storage
and initialization remain the node operator's responsibility. Restart Chaingraph
and reload the browser after changing its option. Enabling mainnet does not
implicitly enable testnet4, and setting this option in the shared process
environment does not override isolated network files.

Exact spending checks explicitly require confirmed-index coverage. If Core is
older, the index is missing/syncing, a request times out, or the reply/data cannot
be validated, Chaingraph uses bounded Electrum history fallback. A failed direct
RPC pauses further upstream index attempts on that network for 30 seconds; a
later user action retries after expiry. Discovery advertises the application
opt-in, not index health. Errors are sanitized and do not distinguish missing
from syncing indexes using upstream exception text.

An opted-in backend permits 64 KiB request bodies for batches up to 500 exact
outpoints; the default body limit stays 16 KiB. Normal response, queue, concurrency
and timeout settings still apply. Browser expansion uses at most 500 candidate
transactions per action, reserving history-fallback capacity. Partial work needs
explicit continuation. Graph expansion remains explicit, saved conflicting spends
are retained, and a missing spender is never proof of an unspent output. Electrum
is still required for wallet/address discovery and fallback. See [spender-index.md](spender-index.md) for reorg and coverage limits.

## Local production container

Requires Docker with BuildKit and a current Docker Compose v2. From this repository, start with a dedicated configuration directory:

```sh
mkdir -p config
cp -n .env.example config/.env.testnet4
chmod 750 config
chmod 640 config/.env.testnet4
sudo chgrp 1000 config config/.env.testnet4
# Edit config/.env.testnet4 with upstreams reachable from the container.
docker compose --env-file /dev/null up --build -d
```

For mainnet, use `config/.env.mainnet` instead, or add that file beside the testnet4 file to serve both. Apply the same file mode and group when adding it. The example's loopback endpoints need changing for container access: container loopback refers to the container itself. No runtime config files enter the build context.

Compose mounts only this dedicated directory at `/run/chaingraph`, read-only. `CHAINGRAPH_CONFIG_DIR` chooses a different **host** directory; the container's `CHAINGRAPH_NETWORK_CONFIG_DIR` remains `/run/chaingraph`. Do not point the mount at the entire source checkout or a general secrets directory. The host directory must already exist. Restart the service after changing a network file.

The Linux permission example gives the container's UID/GID 1000 access without world-readable credentials. Keep the files owned by your editing user and readable by group 1000; parent directories need traversal permission. With rootless Docker or user-namespace remapping, grant access to the mapped container identity instead. Mount a configuration directory with one or both named files; do not combine network settings through `env_file`.

Open `http://127.0.0.1:3000`. The service binds to all interfaces **inside** the container, with its published port restricted to host loopback by default. `CHAINGRAPH_PORT` changes the host port; `CHAINGRAPH_BIND` changes the host bind address. For a remote browser, serve through HTTPS so browser workspace cryptography is available; plain HTTP on a LAN address is not a secure browser context. For a custom hostname or LAN address, set `CORS_ALLOW_ORIGINS` to the exact frontend origin (for example `https://analysis.example.org`); this also authorizes its Host header and HTTPS reverse-proxy origin. Loopback deployment needs no extra entry. Keep frontend and API on the same origin.

For a Linux host upstream, an explicit Compose override can add `host.docker.internal:host-gateway` under `extra_hosts`; set the RPC/Fulcrum hosts accordingly and ensure those services listen on an interface reachable from Docker. This does not make a host service bound only to `127.0.0.1` reachable. Preserve upstream authentication and firewall restrictions.

```sh
docker compose --env-file /dev/null ps
docker compose --env-file /dev/null logs --tail 50
docker compose --env-file /dev/null down
```

If you chose `CHAINGRAPH_CONFIG_DIR`, export it in the shell used for each Compose command. The runtime uses Node 24, UID/GID 1000, system CA certificates, a read-only filesystem, a bounded temporary directory and no Linux capabilities. The image contains compiled browser assets and a bundled server, without development dependencies. Its health check verifies that the UI is served; upstream readiness is reported separately. An unavailable configured upstream does not prevent opening saved workspaces or creating workspaces from bundled examples. Live lookups require the matching upstream to be available.

For cookie authentication, remove both RPC user/password settings from that network's file and set `BITCOIN_RPC_COOKIE_FILE` to a read-only bind-mounted cookie path. Mount the containing directory when Bitcoin rotates the cookie by replacement. Give each pair its own path if both use cookies. Ensure UID 1000 can read it; do not broaden permissions to world-readable. For a private certificate authority, mount its PEM file read-only and set the container's `NODE_EXTRA_CA_CERTS` environment value to that path. Add those mounts and the CA environment setting with a Compose override. Do not disable TLS verification. Neither cookies nor CA files belong in the image.

## Shared HTTP settings

Shared server settings come from the process environment, separately from network files. Compose forwards the origin and limit settings below, while its internal host/port remain `0.0.0.0:3000`.

| Variable | Default | Scope |
| --- | --- | --- |
| `SERVER_HOST` | `127.0.0.1` | Native HTTP bind address |
| `SERVER_PORT` | `3000` | Native HTTP port |
| `CORS_ALLOW_ORIGINS` | Empty | Comma-separated exact frontend origins |
| `SERVER_HANDLER_TIMEOUT_MS` | `120000` | Whole HTTP request budget |
| `MAX_RESPONSE_BYTES` | `5242880` | Shared response bound; each network file also sets its upstream bound |
| `RATE_LIMIT_MAX` | `0` | Inbound HTTP request maximum; zero disables rate limiting |
| `RATE_LIMIT_WINDOW_MS` | `60000` | Inbound rate-limit interval |
| `CHAINGRAPH_NETWORK_CONFIG_DIR` | Working directory | Native network file discovery directory |

For example, `SERVER_PORT=4300 CHAINGRAPH_NETWORK_CONFIG_DIR=./config npm start` serves a built native application using that dedicated directory. The dev launcher adds its loopback frontend origin and keeps upstream settings out of Vite's environment.

## Release process

`package.json` is the version authority; keep both package-lock version fields and the changelog in sync. Check locally before creating a tag (replace the version):

```sh
node scripts/release-check.mjs --tag v0.1.0
npm ci
npm run check
docker build --load -t chaingraph:0.1.0 .
```

When a matching `vX.Y.Z` tag is pushed to GitHub, `.github/workflows/release.yml` validates the version, runs non-browser checks and the narrow production runtime check against the container, then publishes `ghcr.io/remcoros/chaingraph` for linux/amd64 and linux/arm64. Stable releases receive full version, minor and latest tags; prereleases receive their prerelease version. The workflow attaches OCI metadata, provenance and an SBOM. After publication, a separate job creates a GitHub Release with the matching changelog entry and immutable image digest. Reruns preserve an existing Release and any edited notes. Only that final job receives repository contents write permission. Check package visibility in GitHub before expecting unauthenticated pulls.

Routine push/PR checks launch no browser. The release workflow installs Chromium only for `npm run test:production`; it does not run the full E2E suite. That command first runs `npm run test:production:http` for built assets, production CSP/security headers and configured-network discovery, then checks real bundled encryption-worker execution under CSP, WebGL context initialization, and encrypted workspace save, reload/unlock and export. The container check uses public synthetic network configuration and mocked browser upstream responses. It does not establish live upstream health, full worker coverage, panel usability or mobile behavior.

To run the HTTP portion locally against an already running built app or container:

```sh
CHAINGRAPH_SMOKE_URL=http://127.0.0.1:3000 npm run test:production:http
```

When the production browser runtime check is part of the agreed validation scope, install Chromium and run the combined command against that same server:

```sh
npx playwright install chromium
CHAINGRAPH_SMOKE_URL=http://127.0.0.1:3000 npm run test:production
```

Use the manual **Browser QA** workflow for a production runtime check (default) or the small E2E smoke suite. It has no push, PR or scheduled trigger and cannot publish a release. Broader navigation, copy, layout and responsive review belongs in separately scoped exploratory QA. The E2E suite is a minimal smoke check, not a full-suite release gate. Run browser checks serially within each checkout. Failure diagnostics stay under `artifacts/` and are retained by the browser/release workflows for seven days. Passing non-browser checks does not establish visual usability.

Supply `CHAINGRAPH_SOURCE_URL=https://github.com/remcoros/chaingraph` as a public build argument to include the project's GitHub link in the UI; the release workflow supplies the repository automatically. `VCS_REF` records the source commit in image metadata. Credentials must only be provided at runtime, never as build arguments, because build provenance may expose build arguments.

After a release exists, set `CHAINGRAPH_IMAGE` to its GHCR tag or preferably its verified digest. Keep the same `CHAINGRAPH_CONFIG_DIR`, then pull and start it:

```sh
# CHAINGRAPH_IMAGE and any CHAINGRAPH_CONFIG_DIR override are exported in this shell.
docker compose --env-file /dev/null pull chaingraph
docker compose --env-file /dev/null up -d --no-build --wait
```

Pulling matters when a tag already exists in the local image cache. Preserve browser exports before upgrades. Rollback selects and pulls the previous image; future workspace format changes may require restoring a compatible encrypted export. No backend database migration or Docker volume backup is needed. The Compose default runtime configuration directory is `./config`; select another directory explicitly with `CHAINGRAPH_CONFIG_DIR`.

Local image checks do not prove a future GitHub publication or native ARM behavior. Record those separately when the actual tag is published and the ARM image is exercised.
