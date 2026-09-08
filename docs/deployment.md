# Self-hosted deployment

Chaingraph is a single-user analysis workbench with a stateless proxy. It has no server-side workspace database or application login. Use it on a trusted machine/network, or behind your own authenticated HTTPS reverse proxy. Workspaces stay in browser storage and exported encrypted files; workspace names are public metadata. Keep encrypted exports as backups before clearing browser data or changing the site's origin.

## Local production container

Requires Docker with BuildKit and Docker Compose 2.30 or later. From this repository:

```sh
cp .env.example .env.container
chmod 600 .env.container
# Edit .env.container with your Bitcoin RPC and Fulcrum connection settings.
CHAINGRAPH_ENV_FILE=./.env.container docker compose --env-file /dev/null up --build -d
```

Open `http://127.0.0.1:3000`. Compose selects `.env.container` explicitly and does not interpolate its secrets. Use unquoted `KEY=value` lines: dollar signs and quotes are literal under Compose's raw env-file format. The `.env.example` defaults point at loopback; replace the upstream hosts with addresses reachable from the container. Container loopback refers to the container itself. No `.env` files enter the image build context.

The service binds to all interfaces **inside** the container, with its published port restricted to host loopback by default. `CHAINGRAPH_PORT` changes the host port; `CHAINGRAPH_BIND` changes the host bind address. For a remote browser, serve through HTTPS so browser workspace cryptography is available; plain HTTP on a LAN address is not a secure browser context. For a custom hostname or LAN address, set `CORS_ALLOW_ORIGINS` to the exact frontend origin (for example `https://analysis.example.org`); this also authorizes its Host header and HTTPS reverse-proxy origin. Loopback deployment needs no extra entry. Keep frontend and API on the same origin: the current browser client and content security policy use same-origin API requests.

For a Linux host upstream, an explicit Compose override can add `host.docker.internal:host-gateway` under `extra_hosts`; set the RPC/Fulcrum hosts accordingly and ensure those services listen on an interface reachable from Docker. This does not make a host service bound only to `127.0.0.1` reachable. Preserve upstream authentication and firewall restrictions.

```sh
CHAINGRAPH_ENV_FILE=./.env.container docker compose --env-file /dev/null ps
CHAINGRAPH_ENV_FILE=./.env.container docker compose --env-file /dev/null logs --tail 50
CHAINGRAPH_ENV_FILE=./.env.container docker compose --env-file /dev/null down
```

The runtime uses Node 24, UID/GID 1000, system CA certificates, a read-only filesystem, a bounded temporary directory and no Linux capabilities. The image contains compiled browser assets and a bundled server, without development dependencies. Its health check verifies that the UI is served; upstream readiness is reported by the application connection status. An unavailable upstream does not prevent opening saved workspaces or the laboratory. The proxy's RPC allowlist is unchanged in the container.

For cookie authentication, remove both RPC user/password variables and set `BITCOIN_RPC_COOKIE_FILE` to a read-only bind-mounted cookie path. Mount the containing directory when Bitcoin rotates the cookie by replacement. Ensure UID 1000 can read it; do not broaden permissions to world-readable. For a private certificate authority, mount its PEM file read-only and set `NODE_EXTRA_CA_CERTS` to that path. Do not disable TLS verification. Neither cookie nor CA files belong in the image.

## Release process

`package.json` is the version authority; keep both package-lock version fields and the changelog in sync. Version 0.2.0 is the initial release candidate. Check locally before creating a tag:

```sh
node scripts/release-check.mjs --tag v0.2.0
npm ci
npm run check
npm run test:e2e
docker build --load -t chaingraph:0.2.0 .
```

The repository has no assumed GitHub owner or published image. When an owner intentionally pushes a matching `vX.Y.Z` tag to GitHub, `.github/workflows/release.yml` validates the version, runs build/unit/browser checks, then publishes `ghcr.io/<actual-owner>/<actual-repository>` for linux/amd64 and linux/arm64. Stable releases receive full version, minor and latest tags; prereleases receive their prerelease version. The workflow attaches OCI metadata, provenance and an SBOM. After publication, a separate job creates a GitHub Release with the matching changelog entry and immutable image digest. Reruns preserve an existing Release and any edited notes. Only that final job receives repository contents write permission. Check package visibility in GitHub before expecting unauthenticated pulls.

Supply `CHAINGRAPH_SOURCE_URL=https://github.com/<owner>/<repository>` as a public build argument to include the project's GitHub link in the UI; the release workflow supplies the actual repository automatically. `VCS_REF` records the source commit in image metadata. Credentials must only be provided at runtime, never as build arguments, because build provenance may expose build arguments.

After a release exists, set `CHAINGRAPH_IMAGE` to its GHCR tag or preferably its verified digest. Keep the same explicit `CHAINGRAPH_ENV_FILE`, then pull and start it:

```sh
# CHAINGRAPH_IMAGE and CHAINGRAPH_ENV_FILE are exported in this shell.
docker compose --env-file /dev/null pull chaingraph
docker compose --env-file /dev/null up -d --no-build --wait
```

Pulling matters when a tag already exists in the local image cache. Preserve browser exports before upgrades. Rollback selects and pulls the previous image; future workspace format changes may require restoring a compatible encrypted export. No backend database migration or Docker volume backup is needed. The Compose default runtime file is `.env.container`; select another file explicitly with `CHAINGRAPH_ENV_FILE`.

Local image checks do not prove a future GitHub publication or native ARM behavior. Record those separately when the actual tag is published and the ARM image is exercised.
