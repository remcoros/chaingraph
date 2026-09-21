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

If that fallback exceeds `MAX_ADDRESS_HISTORY_TXS`, Chaingraph keeps verified
spenders already loaded. When the application opt-in is absent, persistent
feedback points to `txospenderindex` and
`CHAINGRAPH_USE_TXOSPENDERINDEX=true` for the affected network. When the opt-in
is advertised but the exact lookup could not be used, feedback reports that
bounded condition without diagnosing the upstream cause.

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

If Core or Fulcrum uses a private CA, add its read-only mount and `NODE_EXTRA_CA_CERTS` to the existing `chaingraph` Compose service. For example, a Start9 CA at `/usr/share/ca-certificates/start9/simple-strip.crt` can be configured as:

```yaml
services:
  chaingraph:
    environment:
      NODE_EXTRA_CA_CERTS: /run/chaingraph-ca/simple-strip.crt
    volumes:
      - /usr/share/ca-certificates/start9/simple-strip.crt:/run/chaingraph-ca/simple-strip.crt:ro
```

Keep TLS verification enabled.

Compose mounts only this dedicated directory at `/run/chaingraph`, read-only. `CHAINGRAPH_CONFIG_DIR` chooses a different **host** directory; the container's `CHAINGRAPH_NETWORK_CONFIG_DIR` remains `/run/chaingraph`. Do not point the mount at the entire source checkout or a general secrets directory. The host directory must already exist. Restart the service after changing a network file.

The Linux permission example gives the container's UID/GID 1000 access without world-readable credentials. Keep the files owned by your editing user and readable by group 1000; parent directories need traversal permission. With rootless Docker or user-namespace remapping, grant access to the mapped container identity instead. Mount a configuration directory with one or both named files; do not combine network settings through `env_file`.

Open `http://127.0.0.1:3000`. The service binds to all interfaces **inside** the container, with its published port restricted to host loopback by default. `CHAINGRAPH_PORT` changes the host port; `CHAINGRAPH_BIND` changes the host bind address. For a remote browser, serve through HTTPS so browser workspace cryptography is available; plain HTTP on a LAN address is not a secure browser context. For a custom hostname or LAN address, set `CORS_ALLOW_ORIGINS` to the exact frontend origin (for example `https://analysis.example.org`); this also authorizes its Host header and HTTPS reverse-proxy origin. Loopback deployment needs no extra entry. Keep frontend and API on the same origin.

For a Linux host upstream, an explicit Compose override can add `host.docker.internal:host-gateway` under `extra_hosts`; set the RPC/Fulcrum hosts accordingly and ensure those services listen on an interface reachable from Docker. This does not make a host service bound only to `127.0.0.1` reachable. Preserve upstream authentication and firewall restrictions.

```sh
docker compose --env-file /dev/null ps
docker compose --env-file /dev/null logs --tail 50
docker compose --env-file /dev/null down
```

If you chose `CHAINGRAPH_CONFIG_DIR`, export it in the shell used for each Compose command. The runtime uses Node 24, UID/GID 1000, Node's bundled public CA roots, a read-only filesystem, a bounded temporary directory and no Linux capabilities. The image contains compiled browser assets and a bundled server, without development dependencies. Its health check verifies that the UI is served; upstream readiness is reported separately. An unavailable configured upstream does not prevent opening saved workspaces or creating workspaces from bundled examples. Live lookups require the matching upstream to be available.

For cookie authentication, remove both RPC user/password settings from that network's file and set `BITCOIN_RPC_COOKIE_FILE` to a read-only bind-mounted cookie path. Mount the containing directory when Bitcoin rotates the cookie by replacement. Give each pair its own path if both use cookies. Ensure UID 1000 can read it; do not broaden permissions to world-readable.

For a private certificate authority, mount its PEM file read-only and set the container's `NODE_EXTRA_CA_CERTS` environment value to that path. Add those mounts and the CA environment setting with a Compose override. Do not disable TLS verification. Neither cookies nor CA files belong in the image.

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

## Use a verified public release

A public Chaingraph release has a PGP-signed `vX.Y.Z` source tag and two GitHub
Release assets named `chaingraph-vX.Y.Z.release.json` and
`chaingraph-vX.Y.Z.release.json.asc`. The signed JSON mapping is the canonical
link from the source tag and commit to the immutable OCI index and its explicit
`linux/amd64` and `linux/arm64` image manifests. Mutable GHCR tags and GitHub
OIDC provenance are supplementary.

Follow the concise [release validation steps](../README.md#validating-a-release)
before using the mapping's digest. Advanced users can
[rebuild and compare a native OCI descriptor](../REPRODUCIBILITY.md). For normal
deployment, set `CHAINGRAPH_IMAGE` to the verified
`image.name@image.indexDigest` reference from the signed mapping. Keep the same
`CHAINGRAPH_CONFIG_DIR`, then pull and start it:

```sh
# CHAINGRAPH_IMAGE and any CHAINGRAPH_CONFIG_DIR override are exported in this shell.
docker compose --env-file /dev/null pull chaingraph
docker compose --env-file /dev/null up -d --no-build --wait
```

Pulling matters when a tag already exists in the local image cache. Preserve browser exports before upgrades. Rollback selects and pulls a previous verified digest; future workspace format changes may require restoring a compatible encrypted export. No backend database migration or Docker volume backup is needed. The Compose default runtime configuration directory is `./config`; select another directory explicitly with `CHAINGRAPH_CONFIG_DIR`.
