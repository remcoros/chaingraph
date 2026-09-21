# Reproducing a Chaingraph container release

This is the canonical procedure for independently checking a Chaingraph
container release. The normal deployment path is in
[`docs/deployment.md`](docs/deployment.md). This procedure is for advanced
users who want to verify the signed source and rebuild one native platform.

Chaingraph's canonical release claim has two OpenPGP-authenticated documents:

1. A signed annotated Git tag authenticates the source commit.
2. A small signed JSON mapping binds that tag and commit to one immutable OCI
   image index and its `linux/amd64` and `linux/arm64` image manifests.

GitHub OIDC provenance is supplementary. Mutable image tags, workflow status,
GitHub's signature badge, and provenance are not substitutes for these two
OpenPGP checks.

## Requirements

You need Git, GnuPG, Docker with Buildx and native Linux hardware for the
platform being checked. The checked-in Bake target selects Buildx's local
platform. Do not use QEMU or another emulated platform for this comparison.

The commands below use `v0.1.0` as an example. Replace it with the release you
are checking.

Before starting, obtain the Chaingraph release-signing public key and its full
fingerprint through a channel you trust. A key downloaded from the same release
page cannot establish trust in that release. Import the trusted key into the
GnuPG keyring used by Git.

## 1. Verify the release signatures

Download these two assets from the GitHub Release page without renaming them:

```text
chaingraph-v0.1.0.release.json
chaingraph-v0.1.0.release.json.asc
```

Verify the mapping before using any digest from it:

```sh
TAG=v0.1.0
RELEASE_ASSETS=$(pwd)
MAPPING="$RELEASE_ASSETS/chaingraph-$TAG.release.json"
gpg --verify "$MAPPING.asc" "$MAPPING"
```

Confirm that GnuPG reports the full fingerprint you independently trusted.
Reject the release if the signature is absent, invalid, made by another key, or
only known through an untrusted key download.

Clone or open the canonical repository, fetch the tag, and verify it with the
same trusted key:

```sh
git clone https://github.com/remcoros/chaingraph.git
cd chaingraph
git fetch --force origin "refs/tags/$TAG:refs/tags/$TAG"
git verify-tag --raw "$TAG"
COMMIT=$(git rev-parse "$TAG^{commit}")
printf '%s\n' "$COMMIT"
```

The tag must be an annotated OpenPGP-signed tag, and `git verify-tag` must report
the same trusted primary signing identity as the mapping signature.

Open the already verified mapping. It has this deliberately small shape:

```json
{
  "schemaVersion": 1,
  "source": {
    "tag": "v0.1.0",
    "commit": "40 lowercase hexadecimal characters"
  },
  "image": {
    "name": "ghcr.io/remcoros/chaingraph",
    "indexDigest": "sha256:64 lowercase hexadecimal characters",
    "platforms": {
      "linux/amd64": "sha256:64 lowercase hexadecimal characters",
      "linux/arm64": "sha256:64 lowercase hexadecimal characters"
    }
  }
}
```

Confirm that `source.tag` equals `$TAG` and `source.commit` exactly equals the
printed `$COMMIT`. Do not continue with a mapping for another tag, commit, image
name, schema, or platform set.

## 2. Inspect the published OCI descriptors

Copy `image.name` and `image.indexDigest` from the verified mapping, then inspect
that immutable reference:

```sh
IMAGE=ghcr.io/remcoros/chaingraph
INDEX_DIGEST=sha256:replace-with-the-signed-index-digest
docker buildx imagetools inspect "$IMAGE@$INDEX_DIGEST"
```

Buildx must report the same index digest and exactly the signed `linux/amd64`
and `linux/arm64` image-manifest digests. Registry resolution by immutable digest
must succeed. Do not substitute a version, minor, or `latest` tag for this
check.

## 3. Rebuild the native platform

Check out the signed commit and require a clean tree. A different file in the
Docker build context is a different source build.

```sh
git switch --detach "$COMMIT"
test -z "$(git status --porcelain --untracked-files=all)"
docker buildx bake --check reproduce
```

Confirm the native platform before building:

| Docker host architecture | Signed mapping entry |
| ------------------------ | -------------------- |
| `linux/x86_64`           | `linux/amd64`        |
| `linux/aarch64`          | `linux/arm64`        |

```sh
docker info --format '{{.OSType}}/{{.Architecture}}'
docker buildx bake --print reproduce
```

The resolved Bake target must name only the corresponding Linux platform. Stop
if the host or target is different, or if the builder reaches that platform
through emulation.

Build from the clean signed checkout with the same public metadata used by the
release workflow:

```sh
export IMAGE=ghcr.io/remcoros/chaingraph
export VERSION="${TAG#v}"
export CHAINGRAPH_SOURCE_URL=https://github.com/remcoros/chaingraph
export VCS_REF="$COMMIT"
export SOURCE_DATE_EPOCH="$(git show -s --format=%ct "$COMMIT")"
docker buildx bake reproduce --no-cache --metadata-file local-build.json
```

The `reproduce` target does not push or load an image. It writes Buildx result
metadata while retaining the result in the builder's content store. Display the
local OCI image-manifest descriptor:

```sh
grep -A8 '"containerimage.descriptor"' local-build.json
```

Its media type must be `application/vnd.oci.image.manifest.v1+json`, its
platform must be the native platform above, and its `digest` must exactly equal
the corresponding `image.platforms` digest in the signed mapping. Equality of
those complete `sha256:` strings is a successful native reproduction.

The local build does not reproduce the multi-platform index. That index is a
registry object joining both platform manifests. Compare the local descriptor
to the signed platform manifest, and inspect the signed index separately as in
step 2.

## What the comparison means

A matching descriptor establishes that this Buildx build produced the same OCI
image manifest, configuration and ordered compressed layers as the published
release for the selected native platform. Because content digests cover those
objects, a changed file, label, command, base-image manifest or layer changes
the result.

It does not establish that the other platform matches, that the source or base
image is free of vulnerabilities, or that your compiler, Docker daemon,
hardware and network were independently trustworthy. It also does not turn
GitHub OIDC provenance into canonical release authority.

Buildx writes informational `buildx.build.provenance` into the local metadata
file even though the target disables attached provenance. The comparison field
is `containerimage.descriptor.digest`. The Bake contract fixes OCI media types,
compression, BuildKit compatibility behavior and timestamp rewriting, but a
future incompatible Docker or BuildKit change can still cause a mismatch. In
that case, keep the signed documents and full build output, identify the first
different OCI object, and do not treat the release as reproduced.
