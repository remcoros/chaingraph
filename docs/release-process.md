# Container release process

This is the maintainer and developer procedure for publishing Chaingraph
container releases. End users should follow the concise release validation in
the [README](../README.md#validating-a-release) and the normal
[deployment guide](deployment.md). Advanced users who want to rebuild a release
should use [REPRODUCIBILITY.md](../REPRODUCIBILITY.md).

## Release identities

`package.json` is the version authority. Keep both `package-lock.json` version
fields and the changelog in sync.

A PGP-signed annotated `vX.Y.Z` Git tag authenticates the source. A small
PGP-signed release mapping binds that tag and commit to the immutable OCI index
and the explicit `linux/amd64` and `linux/arm64` image manifests. The same
OpenPGP key signs both documents. Its public key must be published on the GitHub
repository owner's account so automation can verify the tag.

Mutable GHCR tags and GitHub OIDC provenance are supplementary. They are not
canonical release authority.

## Prepare and tag the release

Check the release source locally before creating the tag:

```sh
export RELEASE_TAG=v0.1.0
export RELEASE_SIGNING_KEY=replace-with-the-full-trusted-fingerprint
npm ci
node scripts/release-check.mjs --tag "$RELEASE_TAG"
npm run check
npm run licenses
git diff --exit-code -- THIRD_PARTY_NOTICES.md
docker buildx bake --check release-platform
git tag -s -u "$RELEASE_SIGNING_KEY" -m "Chaingraph $RELEASE_TAG" "$RELEASE_TAG"
git verify-tag --raw "$RELEASE_TAG"
git push origin "$RELEASE_TAG"
```

The tag workflow re-verifies the signed annotated tag, version, normal checks,
license notices, Bake definition and narrow production runtime check. Native
GitHub-hosted amd64 and arm64 runners use `docker-bake.hcl` to publish one image
manifest each. A final job joins those immutable digests into an OCI index
containing exactly the `linux/amd64` and `linux/arm64` manifests. Stable releases
receive full version, minor and `latest` tags. Prereleases receive only their
prerelease version.

A standard GitHub OIDC provenance attestation is attached separately. It is
optional supplementary evidence and is not part of the signed release mapping.

## Sign and publish the release mapping

The workflow derives the two platform digests from the published index, writes
the small release mapping, and creates a draft GitHub Release with that unsigned
mapping attached. It has no release signing key. Complete the release locally:

```sh
mapping="chaingraph-$RELEASE_TAG.release.json"
release_dir="release-$RELEASE_TAG"
mkdir "$release_dir"
gh release download "$RELEASE_TAG" --pattern "$mapping" --dir "$release_dir"
gpg --local-user "$RELEASE_SIGNING_KEY" --armor --detach-sign "$release_dir/$mapping"
gpg --verify "$release_dir/$mapping.asc" "$release_dir/$mapping"
gh release upload "$RELEASE_TAG" "$release_dir/$mapping.asc"
gh release edit "$RELEASE_TAG" --draft=false
```

Before signing, inspect the mapping, confirm its source tag and commit, and
inspect its immutable index with `docker buildx imagetools inspect` as described
in [REPRODUCIBILITY.md](../REPRODUCIBILITY.md). Do not publish a draft with a
missing or mismatched signature. The workflow refuses to replace an existing
draft or public release.

## Workflow validation

Routine push and pull-request checks launch no browser. The release workflow
installs Chromium only for `npm run test:production`; it does not run the full
E2E suite. That command first runs `npm run test:production:http` for built
assets, production CSP and security headers, and configured-network discovery.
It then checks real bundled encryption-worker execution under CSP, WebGL context
initialization, and encrypted workspace save, reload, unlock and export. The
container check uses public synthetic network configuration and mocked browser
upstream responses. It does not establish live upstream health, full worker
coverage, panel usability or mobile behavior.

To run the HTTP portion locally against an already running built app or
container:

```sh
CHAINGRAPH_SMOKE_URL=http://127.0.0.1:3000 npm run test:production:http
```

When the production browser runtime check is part of the agreed validation
scope, install Chromium and run the combined command against that same server:

```sh
npx playwright install chromium
CHAINGRAPH_SMOKE_URL=http://127.0.0.1:3000 npm run test:production
```

Use the manual **Browser QA** workflow for a production runtime check or the
small E2E smoke suite. It has no push, pull-request or scheduled trigger and
cannot publish a release. Broader navigation, copy, layout and responsive
review belongs in separately scoped exploratory QA. The E2E suite is a minimal
smoke check, not a full-suite release gate. Run browser checks serially within
each checkout. Failure diagnostics stay under `artifacts/` and are retained by
the browser and release workflows for seven days. Passing non-browser checks
does not establish visual usability.

`CHAINGRAPH_SOURCE_URL` includes the project's public GitHub link in the UI, and
`VCS_REF` records the source commit in image metadata. The Bake contract supplies
both. Credentials must only be provided at runtime, never as build arguments,
because provenance can expose build arguments.

Local image checks do not prove a future GitHub publication or native ARM
behavior. Record those separately when the actual tag is published and the ARM
image is exercised.
