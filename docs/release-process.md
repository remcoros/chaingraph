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

## Guided release command

Run the release command with a version without a leading `v`:

```sh
npm run release -- 0.2.0
```

The command is resumable. It derives its state from Git, GitHub and the
registry, so re-run the same command after a pull request merge, a workflow
wait or a signing checkpoint. Its ignored status report is written to
`artifacts/releases/vX.Y.Z/status.json`; that report is evidence for the
operator, not release authority.

Use `--dry-run` to inspect the next action without changing Git or GitHub
release state. Use `--json` for an agent-readable report. Actions that push,
sign, publish or abort still require an interactive `y/N` confirmation.

Stable versions and SemVer prereleases are supported. Leading `v` prefixes,
build metadata and inferred version bumps are deliberately rejected.

## Prepare the release pull request

Start from a clean local checkout whose `origin` fetch and push URLs target
`github.com/remcoros/chaingraph`. The GitHub repository must have a protected
default branch, and the local default branch must exactly match its remote. The
command:

1. Creates `release/vX.Y.Z`.
2. Updates `package.json` and both package-lock version fields when needed.
3. Dates the version section in `CHANGELOG.md` using the current UTC date and
   leaves a fresh `Unreleased` section above it.
4. Installs the locked dependency tree, regenerates `THIRD_PARTY_NOTICES.md`
   and runs the metadata check, the full non-browser repository check and the
   Buildx Bake check.
5. Shows the release notes, complete diff and exact changed-file set.
6. After a normal `y/N` confirmation, stages only the release allowlist,
   commits, pushes without force and opens a draft pull request.

The preparation allowlist is `CHANGELOG.md`, `package.json`,
`package-lock.json` and `THIRD_PARTY_NOTICES.md`. Any other tracked or untracked
change stops the command. Refine release notes with normal follow-up commits.
Do not amend or force-push the preparation branch. The command never marks the
pull request ready, approves it or merges it.

The command warns when the UTC date becomes stale before merge or tagging.
Update it in a follow-up commit when the delay is material. Crossing midnight
alone does not invalidate an otherwise reviewed preparation.

## Tag from the protected default branch

After the preparation pull request merges, fetch the protected default branch,
switch to it and fast-forward it to the remote. Re-run the same command. It
requires the current commit to be the release pull request merge commit and the
normal `Check` workflow to have succeeded for that exact commit. It also
revalidates the version, changelog and changed-file boundary.

The command then shows the release commit and asks for `y/N` confirmation. It
creates an annotated tag signed by the pinned release key, verifies the tag's
`VALIDSIG` primary-key fingerprint and pushes that tag. A failed push leaves
the verified local tag available for a safe retry.

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
mapping attached. It has no release signing key.

After pushing the tag, the command waits for the matching Release workflow to
appear and watches it through completion. Press `Ctrl+C` to stop the local
watcher; this does not cancel the GitHub workflow. Re-run the same release
command later to resume. As soon as the successful workflow creates its draft
release, the command downloads the mapping and verifies its source tag, source
commit, image name, index digest and exact amd64 and arm64 manifest membership.
It asks for `y/N` confirmation before invoking GPG. The private key and PIN
remain under GPG control. It verifies the detached signature against the pinned
primary-key fingerprint before uploading it, and it never replaces an existing
signature asset.

After one more `y/N` confirmation, the command publishes the draft and verifies
that the public mutable container tags resolve to the signed index.
Stable releases verify the full version, minor version and `latest` tags.
Prereleases verify only their full prerelease version. See
[REPRODUCIBILITY.md](../REPRODUCIBILITY.md) for independent manual inspection.

## Abort an unmerged preparation

To remove an abandoned, unmerged preparation, run:

```sh
npm run release -- abort 0.2.0
```

The command first reports exactly what it will close or delete, then asks for
`y/N` confirmation. It closes the open pull request, deletes the exact remote
release branch, switches to and fast-forwards the default branch, and deletes
the exact local release branch. The operation is resumable after partial
failure, and ignored artifacts are preserved.

Abort refuses to proceed if the release pull request merged, a local or remote
tag exists, any GitHub Release exists, the branch or base is unexpected, files
outside the preparation allowlist changed, local commits were not pushed, or
the worktree is dirty. After merge, either continue the release or use a normal
reviewed revert pull request. The tool never reverts the default branch.

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
