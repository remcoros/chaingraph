import { createHash } from 'node:crypto';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';

export const RELEASE_CONFIG = Object.freeze({
  repository: 'remcoros/chaingraph',
  image: 'ghcr.io/remcoros/chaingraph',
  signingFingerprint: '9D1BD304339B2D31CFA5637A2F5B10B929CAC959',
  checkWorkflow: 'check.yml',
  releaseWorkflow: 'release.yml',
  branchPrefix: 'release/',
  workflowPollAttempts: 30,
  workflowPollIntervalMs: 2_000,
  releasePollAttempts: 15,
  releasePollIntervalMs: 1_000,
  allowedPreparationFiles: Object.freeze([
    'CHANGELOG.md',
    'THIRD_PARTY_NOTICES.md',
    'package-lock.json',
    'package.json',
  ]),
});

const SEMVER =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;
const DIGEST = /^sha256:[a-f0-9]{64}$/;
const CANONICAL_ORIGIN =
  /^(?:https:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)remcoros\/chaingraph(?:\.git)?\/?$/i;

export const RELEASE_HELP = `Usage:
  npm run release -- <X.Y.Z> [--dry-run] [--json]
  npm run release -- abort <X.Y.Z> [--dry-run] [--json]

Prepare a draft release PR, resume after merge, push the signed tag, and finish
the signed GitHub Release. Use abort only for an unmerged preparation.`;

export function parseReleaseArgs(args) {
  const positionals = [];
  let dryRun = false;
  let json = false;
  for (const arg of args) {
    if (arg === '--dry-run') dryRun = true;
    else if (arg === '--json') json = true;
    else if (arg.startsWith('--')) throw new Error(`Unknown option: ${arg}`);
    else positionals.push(arg);
  }

  const abort = positionals[0] === 'abort';
  const version = abort ? positionals[1] : positionals[0];
  if (!version || positionals.length !== (abort ? 2 : 1)) {
    throw new Error('Usage: npm run release -- [abort] <X.Y.Z> [--dry-run] [--json]');
  }
  const match = SEMVER.exec(version);
  if (!match || match[4]?.split('.').some((part) => /^0\d+$/.test(part))) {
    throw new Error('Version must be SemVer without a leading v or build metadata.');
  }
  return {
    abort,
    dryRun,
    json,
    prerelease: Boolean(match[4]),
    tag: `v${version}`,
    version,
  };
}

export function prepareChangelog(source, version, date) {
  const heading = `## [${version}]`;
  const matching = source.split('\n').filter((line) => line.startsWith(heading));
  if (matching.length > 1) {
    throw new Error(`CHANGELOG.md must not contain duplicate ${heading} release headings.`);
  }

  const unreleasedHeading = `${heading} - Unreleased`;
  const datedHeading = `${heading} - ${date}`;
  let result;
  if (matching.length === 0) {
    const generic = source.match(/^## \[Unreleased\]$/gm) ?? [];
    if (generic.length !== 1) {
      throw new Error(
        `CHANGELOG.md needs one [Unreleased] heading or one ${heading} - Unreleased heading.`,
      );
    }
    result = source.replace('## [Unreleased]', `## [Unreleased]\n\n${datedHeading}`);
  } else if (matching[0] === unreleasedHeading) {
    result = source.replace(unreleasedHeading, `## [Unreleased]\n\n${datedHeading}`);
  } else if (matching[0] === datedHeading) {
    result = source;
  } else {
    throw new Error(
      `${heading} must be marked Unreleased or dated ${date}; found "${matching[0]}".`,
    );
  }

  const generic = result.match(/^## \[Unreleased\](?:\s+-\s+.*)?$/gm) ?? [];
  if (generic.length !== 1 || generic[0] !== '## [Unreleased]') {
    throw new Error('CHANGELOG.md must contain exactly one fresh [Unreleased] heading.');
  }
  const notes = extractReleaseNotes(result, version);
  if (!notes.trim()) throw new Error(`CHANGELOG.md notes for ${version} are empty.`);
  return { changelog: result, notes };
}

export function validatePreparedChangelog(source, version) {
  const escapedVersion = version.replaceAll('.', '\\.');
  const headings = [
    ...source.matchAll(new RegExp(`^## \\[${escapedVersion}\\] - (\\d{4}-\\d{2}-\\d{2})$`, 'gm')),
  ];
  if (headings.length !== 1) {
    throw new Error(`CHANGELOG.md must contain exactly one dated [${version}] release heading.`);
  }
  const date = headings[0][1];
  const timestamp = Date.parse(`${date}T00:00:00.000Z`);
  if (Number.isNaN(timestamp) || new Date(timestamp).toISOString().slice(0, 10) !== date) {
    throw new Error(`CHANGELOG.md has an invalid UTC release date: ${date}.`);
  }
  const unreleased = source.match(/^## \[Unreleased\]$/gm) ?? [];
  if (unreleased.length !== 1) {
    throw new Error('CHANGELOG.md must contain exactly one fresh [Unreleased] heading.');
  }
  const notes = extractReleaseNotes(source, version);
  if (!notes.trim()) throw new Error(`CHANGELOG.md notes for ${version} are empty.`);
  return { date, notes };
}

export function extractReleaseNotes(changelog, version) {
  const lines = changelog.split('\n');
  const start = lines.findIndex((line) => line.startsWith(`## [${version}]`));
  if (start < 0) throw new Error(`CHANGELOG.md has no entry for ${version}.`);
  let end = lines.findIndex((line, index) => index > start && line.startsWith('## ['));
  if (end < 0) end = lines.length;
  return lines
    .slice(start + 1, end)
    .join('\n')
    .trim();
}

export function validateReleaseMapping(mapping, expected) {
  if (
    mapping?.schemaVersion !== 1 ||
    mapping.source?.tag !== expected.tag ||
    mapping.source?.commit !== expected.commit ||
    mapping.image?.name !== expected.image ||
    !DIGEST.test(mapping.image?.indexDigest ?? '') ||
    !DIGEST.test(mapping.image?.platforms?.['linux/amd64'] ?? '') ||
    !DIGEST.test(mapping.image?.platforms?.['linux/arm64'] ?? '') ||
    Object.keys(mapping.image?.platforms ?? {})
      .sort()
      .join(',') !== 'linux/amd64,linux/arm64'
  ) {
    throw new Error('The release mapping does not match the expected release.');
  }
}

export function validateIndex(raw, mapping) {
  const observed = `sha256:${createHash('sha256').update(raw).digest('hex')}`;
  if (observed !== mapping.image.indexDigest) {
    throw new Error(
      `Registry index digest mismatch: expected ${mapping.image.indexDigest}, observed ${observed}.`,
    );
  }
  const index = JSON.parse(raw);
  if (
    index.mediaType !== 'application/vnd.oci.image.index.v1+json' ||
    !Array.isArray(index.manifests) ||
    index.manifests.length !== 2
  ) {
    throw new Error('The immutable image is not the expected two-platform OCI index.');
  }
  const observedPlatforms = new Map();
  for (const manifest of index.manifests) {
    const platform = `${manifest.platform?.os}/${manifest.platform?.architecture}`;
    if (
      manifest.mediaType !== 'application/vnd.oci.image.manifest.v1+json' ||
      manifest.platform?.variant != null ||
      !DIGEST.test(manifest.digest ?? '') ||
      observedPlatforms.has(platform)
    ) {
      throw new Error('The immutable image contains an unexpected manifest.');
    }
    observedPlatforms.set(platform, manifest.digest);
  }
  for (const platform of ['linux/amd64', 'linux/arm64']) {
    if (observedPlatforms.get(platform) !== mapping.image.platforms[platform]) {
      throw new Error(`The ${platform} manifest does not match the release mapping.`);
    }
  }
}

function parseJson(value, description) {
  try {
    return JSON.parse(value);
  } catch {
    throw new Error(`${description} returned invalid JSON.`);
  }
}

function utcDate(now) {
  return now.toISOString().slice(0, 10);
}

function changedPaths(porcelain) {
  if (!porcelain) return [];
  return porcelain.split('\n').flatMap((line) => {
    const path = line.slice(3);
    const rename = path.lastIndexOf(' -> ');
    return rename >= 0 ? [path.slice(0, rename), path.slice(rename + 4)] : [path];
  });
}

function assertAllowedPaths(paths) {
  const allowed = new Set(RELEASE_CONFIG.allowedPreparationFiles);
  const unexpected = [...new Set(paths)].filter((path) => !allowed.has(path));
  if (unexpected.length) {
    throw new Error(
      `Release preparation changed files outside the allowlist:\n${unexpected.join('\n')}`,
    );
  }
}

function signaturePrimaryFingerprints(output) {
  return output
    .split('\n')
    .filter((line) => line.includes('[GNUPG:] VALIDSIG '))
    .map((line) => {
      const fields = line.trim().split(/\s+/);
      return fields.length >= 12 ? fields[fields.length - 1] : fields[2];
    });
}

async function exists(path) {
  try {
    await access(path, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function makeReporter(options, runtime) {
  const events = [];
  return {
    add(kind, message, detail) {
      events.push({ kind, message, ...(detail ? { detail } : {}) });
      if (!options.json) runtime.write(message);
    },
    finish(status, detail = {}) {
      const result = {
        status,
        command: options.abort ? 'abort' : 'release',
        version: options.version,
        tag: options.tag,
        ...detail,
        events,
      };
      if (options.json) runtime.write(JSON.stringify(result, null, 2));
      return result;
    },
  };
}

async function writeStatus(runtime, options, result) {
  const directory = join(runtime.cwd, 'artifacts', 'releases', options.tag);
  await mkdir(directory, { recursive: true });
  await writeFile(
    join(directory, 'status.json'),
    `${JSON.stringify({ ...result, recordedAt: runtime.now().toISOString() }, null, 2)}\n`,
  );
}

function run(runtime, command, args, options) {
  return runtime.runner.run(command, args, { cwd: runtime.cwd, ...options });
}

function output(runtime, command, args, options) {
  return run(runtime, command, args, options).stdout.trimEnd();
}

function rawOutput(runtime, command, args, options) {
  return run(runtime, command, args, options).stdout;
}

function runGh(runtime, args, options) {
  return run(runtime, 'gh', [...args, '--repo', RELEASE_CONFIG.repository], options);
}

function ghOutput(runtime, args, options) {
  return runGh(runtime, args, options).stdout.trimEnd();
}

function gitRefExists(runtime, ref) {
  const result = run(runtime, 'git', ['show-ref', '--verify', '--quiet', ref], {
    allowFailure: true,
  });
  if (result.status === 0) return true;
  if (result.status === 1) return false;
  throw new Error(`Unable to inspect local Git ref ${ref}.`);
}

function remoteBranchExists(runtime, branch) {
  return Boolean(remoteRefOid(runtime, `refs/heads/${branch}`));
}

function remoteTagExists(runtime, tag) {
  return Boolean(remoteRefOid(runtime, `refs/tags/${tag}`));
}

function remoteRefOid(runtime, ref) {
  const lines = output(runtime, 'git', ['ls-remote', 'origin', ref]).split('\n').filter(Boolean);
  if (lines.length > 1) throw new Error(`Remote ref ${ref} is ambiguous.`);
  return lines[0]?.split(/\s+/)[0] ?? null;
}

function assertClean(runtime) {
  const status = output(runtime, 'git', ['status', '--porcelain=v1', '--untracked-files=all']);
  if (status) throw new Error('The worktree must be clean before this operation.');
}

function assertCanonicalOrigin(runtime) {
  for (const args of [
    ['remote', 'get-url', '--all', 'origin'],
    ['remote', 'get-url', '--push', '--all', 'origin'],
  ]) {
    const result = run(runtime, 'git', args, { allowFailure: true });
    const urls = result.stdout
      .split('\n')
      .map((url) => url.trim())
      .filter(Boolean);
    if (
      result.status !== 0 ||
      urls.length === 0 ||
      urls.some((url) => !CANONICAL_ORIGIN.test(url))
    ) {
      throw new Error(
        'Every Git remote origin URL must target github.com/remcoros/chaingraph for fetch and push.',
      );
    }
  }
}

function getRepository(runtime) {
  const repository = parseJson(
    output(runtime, 'gh', [
      'repo',
      'view',
      RELEASE_CONFIG.repository,
      '--json',
      'nameWithOwner,defaultBranchRef',
    ]),
    'gh repo view',
  );
  if (repository.nameWithOwner.toLowerCase() !== RELEASE_CONFIG.repository) {
    throw new Error(
      `Expected GitHub repository ${RELEASE_CONFIG.repository}, found ${repository.nameWithOwner}.`,
    );
  }
  const defaultBranch = repository.defaultBranchRef?.name;
  if (!defaultBranch) throw new Error('GitHub did not report a default branch.');
  const branch = parseJson(
    output(runtime, 'gh', [
      'api',
      `repos/${RELEASE_CONFIG.repository}/branches/${encodeURIComponent(defaultBranch)}`,
      '--method',
      'GET',
    ]),
    'GitHub default branch',
  );
  return {
    defaultBranch,
    name: repository.nameWithOwner,
    protected: branch.protected === true,
  };
}

function getPullRequest(runtime, branch) {
  const pulls = parseJson(
    ghOutput(runtime, [
      'pr',
      'list',
      '--state',
      'all',
      '--head',
      branch,
      '--limit',
      '20',
      '--json',
      'number,state,isDraft,mergedAt,headRefName,headRefOid,baseRefName,mergeCommit,url',
    ]),
    'gh pr list',
  );
  if (pulls.length > 1) throw new Error(`More than one pull request uses ${branch}.`);
  return pulls[0] ?? null;
}

function getRelease(runtime, tag) {
  const result = runGh(
    runtime,
    ['release', 'view', tag, '--json', 'tagName,isDraft,isPrerelease,url,assets'],
    { allowFailure: true },
  );
  if (result.status !== 0) {
    if (result.stderr.trim() === 'release not found') return null;
    throw new Error(
      `Unable to inspect GitHub Release ${tag}: ${result.stderr.trim() || 'unknown gh error'}`,
    );
  }
  return parseJson(result.stdout, 'gh release view');
}

function assertPullRequest(runtime, pull, branch, defaultBranch) {
  if (pull.headRefName !== branch || pull.baseRefName !== defaultBranch) {
    throw new Error('The release pull request has an unexpected head or base branch.');
  }
  const paths = ghOutput(runtime, ['pr', 'diff', String(pull.number), '--name-only'])
    .split('\n')
    .filter(Boolean);
  assertAllowedPaths(paths);
  if (!paths.includes('CHANGELOG.md')) {
    throw new Error('The release pull request does not change CHANGELOG.md.');
  }
  return paths;
}

async function yesNo(runtime, options, reporter, prompt) {
  if (options.dryRun) return false;
  if (!runtime.isTTY) {
    reporter.add('checkpoint', `Human confirmation required: ${prompt}`);
    return null;
  }
  const answer = await runtime.prompt(`${prompt} [y/N] `);
  return /^y(?:es)?$/i.test(answer.trim());
}

async function pause(runtime, milliseconds) {
  if (runtime.sleep) {
    await runtime.sleep(milliseconds);
  } else {
    await delay(milliseconds);
  }
}

async function validatePreparedTree(runtime, options) {
  const pkg = parseJson(await readFile(join(runtime.cwd, 'package.json'), 'utf8'), 'package.json');
  const lock = parseJson(
    await readFile(join(runtime.cwd, 'package-lock.json'), 'utf8'),
    'package-lock.json',
  );
  if (
    pkg.version !== options.version ||
    lock.version !== options.version ||
    lock.packages?.['']?.version !== options.version
  ) {
    throw new Error('package.json and both lockfile versions must match the release.');
  }
  const changelog = await readFile(join(runtime.cwd, 'CHANGELOG.md'), 'utf8');
  return validatePreparedChangelog(changelog, options.version);
}

function validatePreparedCommit(runtime, options, commit) {
  const pkg = parseJson(
    output(runtime, 'git', ['show', `${commit}:package.json`]),
    'release package.json',
  );
  const lock = parseJson(
    output(runtime, 'git', ['show', `${commit}:package-lock.json`]),
    'release package-lock.json',
  );
  if (
    pkg.version !== options.version ||
    lock.version !== options.version ||
    lock.packages?.['']?.version !== options.version
  ) {
    throw new Error('The release PR package and lockfile versions do not match.');
  }
  const changelog = output(runtime, 'git', ['show', `${commit}:CHANGELOG.md`]);
  return validatePreparedChangelog(changelog, options.version);
}

function warnStaleDate(runtime, reporter, prepared) {
  const today = utcDate(runtime.now());
  if (prepared.date !== today) {
    reporter.add(
      'warning',
      `CHANGELOG.md is dated ${prepared.date}; current UTC date is ${today}. Update it in a follow-up commit if the delay is material.`,
    );
  }
}

async function runPreparationGates(runtime, options, reporter) {
  reporter.add('validation', 'Installing the locked dependency tree.');
  run(runtime, 'npm', ['ci'], { inherit: !options.json });
  reporter.add('validation', 'Regenerating third-party notices.');
  run(runtime, 'npm', ['run', 'licenses'], { inherit: !options.json });
  reporter.add('validation', 'Running release metadata and repository checks.');
  run(runtime, 'node', ['scripts/release-check.mjs', '--tag', options.tag], {
    inherit: !options.json,
  });
  run(runtime, 'npm', ['run', 'check'], { inherit: !options.json });
  run(runtime, 'docker', ['buildx', 'bake', '--check', 'release-platform'], {
    inherit: !options.json,
  });
}

async function preparePullRequest(runtime, options, reporter, repository) {
  const branch = `${RELEASE_CONFIG.branchPrefix}${options.tag}`;
  if (
    gitRefExists(runtime, `refs/tags/${options.tag}`) ||
    remoteTagExists(runtime, options.tag) ||
    getRelease(runtime, options.tag)
  ) {
    throw new Error(`Release identity ${options.tag} already exists.`);
  }
  const current = output(runtime, 'git', ['branch', '--show-current']);
  if (!options.dryRun) run(runtime, 'git', ['fetch', '--prune', 'origin']);
  const remoteHead = options.dryRun
    ? remoteRefOid(runtime, `refs/heads/${repository.defaultBranch}`)
    : output(runtime, 'git', ['rev-parse', `origin/${repository.defaultBranch}`]);
  if (!remoteHead) throw new Error('The remote default branch was not found.');
  const remoteExists = remoteBranchExists(runtime, branch);
  let notes;

  if (current === repository.defaultBranch) {
    assertClean(runtime);
    const head = output(runtime, 'git', ['rev-parse', 'HEAD']);
    if (head !== remoteHead) {
      throw new Error(
        `Local ${repository.defaultBranch} must exactly match origin/${repository.defaultBranch}.`,
      );
    }
    if (gitRefExists(runtime, `refs/heads/${branch}`) || remoteExists) {
      throw new Error(
        `Release branch ${branch} exists without a discoverable pull request. Switch to it to resume.`,
      );
    }

    const source = await readFile(join(runtime.cwd, 'CHANGELOG.md'), 'utf8');
    const prepared = prepareChangelog(source, options.version, utcDate(runtime.now()));
    notes = prepared.notes;
    reporter.add('plan', `Prepare ${branch} from ${head}.`);
    if (options.dryRun) {
      reporter.add('notes', `Release notes preview:\n\n${notes}`);
      const result = reporter.finish('dry-run', {
        branch,
        next: 'Run without --dry-run to create the release preparation branch.',
      });
      await writeStatus(runtime, options, result);
      return 0;
    }

    run(runtime, 'git', ['switch', '-c', branch]);
    const pkg = parseJson(
      await readFile(join(runtime.cwd, 'package.json'), 'utf8'),
      'package.json',
    );
    if (pkg.version !== options.version) {
      run(runtime, 'npm', ['version', options.version, '--no-git-tag-version'], {
        inherit: !options.json,
      });
    }
    await writeFile(join(runtime.cwd, 'CHANGELOG.md'), prepared.changelog);
  } else if (current === branch) {
    const existingPaths = changedPaths(
      output(runtime, 'git', ['status', '--porcelain=v1', '--untracked-files=all']),
    );
    assertAllowedPaths(existingPaths);
    const base = output(runtime, 'git', ['merge-base', branch, remoteHead]);
    const branchCommit = output(runtime, 'git', ['rev-parse', branch]);
    if (base !== branchCommit && base !== remoteHead) {
      throw new Error(`${branch} is not based on the expected default-branch history.`);
    }
    const changelog = await readFile(join(runtime.cwd, 'CHANGELOG.md'), 'utf8');
    notes = validatePreparedChangelog(changelog, options.version).notes;
    reporter.add('plan', `Resume release preparation on ${branch}.`);
  } else {
    throw new Error(
      `Start on ${repository.defaultBranch}, or switch to ${branch} to resume preparation.`,
    );
  }

  reporter.add('plan', `Allowed files: ${RELEASE_CONFIG.allowedPreparationFiles.join(', ')}.`);
  reporter.add('notes', `Release notes preview:\n\n${notes}`);
  if (options.dryRun) {
    const result = reporter.finish('dry-run', {
      branch,
      next: 'No repository or GitHub state was changed.',
    });
    await writeStatus(runtime, options, result);
    return 0;
  }

  await runPreparationGates(runtime, options, reporter);

  const porcelain = output(runtime, 'git', ['status', '--porcelain=v1', '--untracked-files=all']);
  const paths = changedPaths(porcelain);
  assertAllowedPaths(paths);
  await validatePreparedTree(runtime, options);
  const committedPaths = output(runtime, 'git', ['diff', '--name-only', `${remoteHead}...HEAD`])
    .split('\n')
    .filter(Boolean);
  assertAllowedPaths(committedPaths);
  if (![...paths, ...committedPaths].includes('CHANGELOG.md')) {
    throw new Error('Release preparation does not change CHANGELOG.md.');
  }
  const committedDiff = committedPaths.length
    ? output(runtime, 'git', ['diff', `${remoteHead}...HEAD`, '--', ...committedPaths])
    : '';
  const worktreeDiff = paths.length ? output(runtime, 'git', ['diff', 'HEAD', '--', ...paths]) : '';
  const diff = [committedDiff, worktreeDiff].filter(Boolean).join('\n');
  reporter.add('diff', `Release preparation diff:\n\n${diff}`);
  const approved = await yesNo(
    runtime,
    options,
    reporter,
    `Create, push, and open a draft PR for ${options.tag}?`,
  );
  if (approved !== true) {
    const result = reporter.finish(approved === null ? 'awaiting-confirmation' : 'stopped', {
      branch,
      changedFiles: [...new Set([...committedPaths, ...paths])],
      next: `Review the worktree, then re-run npm run release -- ${options.version}.`,
    });
    await writeStatus(runtime, options, result);
    return 0;
  }

  if (paths.length) {
    run(runtime, 'git', ['add', '--', ...paths]);
    run(runtime, 'git', ['commit', '-m', `chore(release): prepare ${options.tag}`], {
      inherit: !options.json,
    });
  }
  if (remoteBranchExists(runtime, branch)) {
    const localCommit = output(runtime, 'git', ['rev-parse', branch]);
    const remoteCommit = output(runtime, 'git', ['rev-parse', `origin/${branch}`]);
    if (localCommit !== remoteCommit) {
      throw new Error(
        `Local ${branch} differs from origin/${branch}; push or reconcile it explicitly.`,
      );
    }
  } else {
    run(runtime, 'git', ['push', '--set-upstream', 'origin', branch], {
      inherit: !options.json,
    });
  }
  const bodyDirectory = await mkdtemp(join(tmpdir(), 'chaingraph-release-'));
  const bodyPath = join(bodyDirectory, 'pull-request.md');
  await writeFile(
    bodyPath,
    [
      `Prepare ${options.tag} for release.`,
      '',
      'Validation:',
      '- [x] Release metadata check',
      '- [x] Full non-browser repository check',
      '- [x] Third-party notices regenerated',
      '- [x] Buildx Bake definition checked',
      '',
      'Before merge:',
      '- [ ] Review the changelog notes and UTC release date',
      '- [ ] Mark this PR ready when the release contents are final',
      '- [ ] Merge through the protected default branch',
      '',
    ].join('\n'),
  );
  try {
    runGh(
      runtime,
      [
        'pr',
        'create',
        '--draft',
        '--base',
        repository.defaultBranch,
        '--head',
        branch,
        '--title',
        `chore(release): prepare ${options.tag}`,
        '--body-file',
        bodyPath,
      ],
      { inherit: !options.json },
    );
  } finally {
    await rm(bodyDirectory, { force: true, recursive: true });
  }
  const pull = getPullRequest(runtime, branch);
  if (!pull) throw new Error('The draft release pull request was not found after creation.');
  assertPullRequest(runtime, pull, branch, repository.defaultBranch);
  const result = reporter.finish('pull-request-created', {
    branch,
    pullRequest: pull.url,
    next: 'Review the draft PR, mark it ready, and merge it through branch protection.',
  });
  await writeStatus(runtime, options, result);
  return 0;
}

function findCheckRun(runtime, commit, defaultBranch) {
  const runs = parseJson(
    ghOutput(runtime, [
      'run',
      'list',
      '--workflow',
      RELEASE_CONFIG.checkWorkflow,
      '--commit',
      commit,
      '--limit',
      '20',
      '--json',
      'databaseId,status,conclusion,headBranch,headSha,url,event',
    ]),
    'gh run list',
  ).filter(
    (candidate) =>
      candidate.headSha === commit &&
      candidate.headBranch === defaultBranch &&
      candidate.event === 'push',
  );
  return runs[0] ?? null;
}

async function requireSuccessfulCheck(runtime, options, reporter, commit, defaultBranch) {
  let check = findCheckRun(runtime, commit, defaultBranch);
  if (!check) throw new Error(`No Check workflow run exists for ${commit}.`);
  if (check.status !== 'completed') {
    const watch = await yesNo(
      runtime,
      options,
      reporter,
      `Check is ${check.status}. Watch it now?`,
    );
    if (watch === true) {
      runGh(runtime, ['run', 'watch', String(check.databaseId), '--exit-status', '--compact'], {
        inherit: !options.json,
      });
      check = findCheckRun(runtime, commit, defaultBranch);
    } else {
      reporter.add('waiting', `Check must complete successfully before tagging: ${check.url}`);
      return false;
    }
  }
  if (check.conclusion !== 'success') {
    throw new Error(`Check did not succeed for ${commit}: ${check.url}`);
  }
  reporter.add('validation', `Check succeeded for ${commit}.`);
  return true;
}

function verifyTagSignature(runtime, tag) {
  const result = run(runtime, 'git', ['verify-tag', '--raw', tag], {
    allowFailure: true,
  });
  if (result.status !== 0) {
    throw new Error(`The tag signature is invalid:\n${result.stderr || result.stdout}`);
  }
  const fingerprints = signaturePrimaryFingerprints(`${result.stdout}\n${result.stderr}`);
  if (fingerprints.length !== 1 || fingerprints[0] !== RELEASE_CONFIG.signingFingerprint) {
    throw new Error('The tag signature does not match the pinned release key.');
  }
}

function verifyRemoteTagMatchesLocal(runtime, tag) {
  const ref = `refs/tags/${tag}`;
  const remoteOid = remoteRefOid(runtime, ref);
  const localOid = output(runtime, 'git', ['rev-parse', ref]);
  if (!remoteOid || remoteOid !== localOid) {
    throw new Error('The remote release tag does not match the verified local tag object.');
  }
}

async function createOrPushTag(runtime, options, reporter, commit) {
  const localTag = gitRefExists(runtime, `refs/tags/${options.tag}`);
  const remoteTag = remoteTagExists(runtime, options.tag);
  if (remoteTag && !localTag) {
    run(runtime, 'git', ['fetch', 'origin', `refs/tags/${options.tag}:refs/tags/${options.tag}`]);
  }
  if (localTag || remoteTag) {
    verifyTagSignature(runtime, options.tag);
    const taggedCommit = output(runtime, 'git', ['rev-parse', `${options.tag}^{commit}`]);
    if (taggedCommit !== commit)
      throw new Error('The existing release tag targets another commit.');
    if (remoteTag) {
      verifyRemoteTagMatchesLocal(runtime, options.tag);
      return true;
    }
  }

  reporter.add(
    'plan',
    `${localTag ? 'Push existing' : 'Create and push'} signed tag ${options.tag} for ${commit}.`,
  );
  const approved = await yesNo(
    runtime,
    options,
    reporter,
    `${localTag ? 'Push the existing' : 'Create and push the'} signed tag ${options.tag}? This starts the publication workflow and cannot be undone by this tool.`,
  );
  if (approved !== true) return false;
  if (!localTag) {
    run(
      runtime,
      'git',
      [
        'tag',
        '-s',
        '-u',
        RELEASE_CONFIG.signingFingerprint,
        '-m',
        `Chaingraph ${options.tag}`,
        options.tag,
        commit,
      ],
      { inherit: !options.json },
    );
    verifyTagSignature(runtime, options.tag);
  }
  run(runtime, 'git', ['push', 'origin', `refs/tags/${options.tag}`], {
    inherit: !options.json,
  });
  verifyRemoteTagMatchesLocal(runtime, options.tag);
  return true;
}

function findReleaseRun(runtime, commit, tag) {
  const runs = parseJson(
    ghOutput(runtime, [
      'run',
      'list',
      '--workflow',
      RELEASE_CONFIG.releaseWorkflow,
      '--commit',
      commit,
      '--limit',
      '20',
      '--json',
      'databaseId,status,conclusion,headBranch,headSha,url,event',
    ]),
    'gh run list',
  ).filter(
    (candidate) =>
      candidate.headSha === commit && candidate.headBranch === tag && candidate.event === 'push',
  );
  return runs[0] ?? null;
}

export async function waitForReleaseDraft(runtime, options, reporter, commit) {
  let release = getRelease(runtime, options.tag);
  if (release) return release;
  let workflow = findReleaseRun(runtime, commit, options.tag);
  if (!workflow) {
    reporter.add(
      'waiting',
      'Waiting for the tag-triggered Release workflow to appear. Press Ctrl+C to stop watching; the GitHub workflow will continue.',
    );
    for (
      let attempt = 0;
      attempt < RELEASE_CONFIG.workflowPollAttempts && !workflow;
      attempt += 1
    ) {
      await pause(runtime, RELEASE_CONFIG.workflowPollIntervalMs);
      release = getRelease(runtime, options.tag);
      if (release) return release;
      workflow = findReleaseRun(runtime, commit, options.tag);
    }
    if (!workflow) {
      reporter.add(
        'waiting',
        'The Release workflow has not appeared yet. It is safe to re-run the command later.',
      );
      return null;
    }
  }
  if (workflow.status !== 'completed') {
    reporter.add(
      'waiting',
      `Watching the Release workflow at ${workflow.url}. Press Ctrl+C to stop watching; the GitHub workflow will continue.`,
    );
    runGh(runtime, ['run', 'watch', String(workflow.databaseId), '--exit-status', '--compact'], {
      inherit: !options.json,
      interruptionMessage: `Release workflow watching stopped locally. The GitHub workflow continues at ${workflow.url}; re-run npm run release -- ${options.version} to resume.`,
    });
    for (let attempt = 0; attempt < 5; attempt += 1) {
      workflow = findReleaseRun(runtime, commit, options.tag);
      if (workflow?.status === 'completed') break;
      await pause(runtime, RELEASE_CONFIG.releasePollIntervalMs);
    }
  }
  if (workflow.status !== 'completed') {
    reporter.add(
      'waiting',
      'The watcher finished but GitHub still reports the workflow as running. It is safe to re-run the command later.',
    );
    return null;
  }
  if (workflow.conclusion !== 'success') {
    throw new Error(`Release workflow failed: ${workflow.url}`);
  }
  for (let attempt = 0; attempt < RELEASE_CONFIG.releasePollAttempts; attempt += 1) {
    release = getRelease(runtime, options.tag);
    if (release) return release;
    await pause(runtime, RELEASE_CONFIG.releasePollIntervalMs);
  }
  if (!release) {
    reporter.add(
      'waiting',
      'The workflow succeeded but its draft release is not visible yet. It is safe to re-run the command later.',
    );
  }
  return release;
}

async function verifyMappingAndImage(runtime, options, commit, release) {
  const mappingName = `chaingraph-${options.tag}.release.json`;
  const signatureName = `${mappingName}.asc`;
  const assetNames = new Set((release.assets ?? []).map((asset) => asset.name));
  if (!assetNames.has(mappingName)) {
    throw new Error(`GitHub Release is missing ${mappingName}.`);
  }
  const directory = join(runtime.cwd, 'artifacts', 'releases', options.tag);
  await mkdir(directory, { recursive: true });
  runGh(runtime, [
    'release',
    'download',
    options.tag,
    '--pattern',
    mappingName,
    '--dir',
    directory,
    '--clobber',
  ]);
  const mappingPath = join(directory, mappingName);
  const mapping = parseJson(await readFile(mappingPath, 'utf8'), mappingName);
  validateReleaseMapping(mapping, {
    commit,
    image: RELEASE_CONFIG.image,
    tag: options.tag,
  });
  const raw = rawOutput(runtime, 'docker', [
    'buildx',
    'imagetools',
    'inspect',
    `${RELEASE_CONFIG.image}@${mapping.image.indexDigest}`,
    '--raw',
  ]);
  validateIndex(raw, mapping);
  return {
    assetNames,
    directory,
    mapping,
    mappingName,
    mappingPath,
    signatureName,
    signaturePath: join(directory, signatureName),
  };
}

function verifyDetachedSignature(runtime, signaturePath, mappingPath) {
  const result = run(
    runtime,
    'gpg',
    ['--batch', '--status-fd', '1', '--verify', signaturePath, mappingPath],
    { allowFailure: true },
  );
  if (result.status !== 0) {
    throw new Error(
      `The detached release signature is invalid:\n${result.stderr || result.stdout}`,
    );
  }
  const fingerprints = signaturePrimaryFingerprints(`${result.stdout}\n${result.stderr}`);
  if (fingerprints.length !== 1 || fingerprints[0] !== RELEASE_CONFIG.signingFingerprint) {
    throw new Error('The detached signature does not match the pinned release key.');
  }
}

async function ensureDetachedSignature(runtime, options, reporter, files) {
  if (files.assetNames.has(files.signatureName)) {
    runGh(runtime, [
      'release',
      'download',
      options.tag,
      '--pattern',
      files.signatureName,
      '--dir',
      files.directory,
      '--clobber',
    ]);
    verifyDetachedSignature(runtime, files.signaturePath, files.mappingPath);
    return true;
  }
  reporter.add('plan', `Sign and upload ${files.mappingName} with the pinned OpenPGP key.`);
  const approved = await yesNo(
    runtime,
    options,
    reporter,
    `Sign and upload ${files.mappingName}? GPG may prompt for the private-key PIN.`,
  );
  if (approved !== true) return false;
  if (await exists(files.signaturePath)) {
    verifyDetachedSignature(runtime, files.signaturePath, files.mappingPath);
  } else {
    run(
      runtime,
      'gpg',
      [
        '--local-user',
        RELEASE_CONFIG.signingFingerprint,
        '--armor',
        '--detach-sign',
        files.mappingPath,
      ],
      { inherit: !options.json },
    );
    verifyDetachedSignature(runtime, files.signaturePath, files.mappingPath);
  }
  runGh(runtime, ['release', 'upload', options.tag, files.signaturePath], {
    inherit: !options.json,
  });
  return true;
}

async function verifyPublishedTags(runtime, options, mapping) {
  const tags = options.prerelease
    ? [options.version]
    : [options.version, options.version.split('.').slice(0, 2).join('.'), 'latest'];
  for (const tag of tags) {
    const raw = rawOutput(runtime, 'docker', [
      'buildx',
      'imagetools',
      'inspect',
      `${RELEASE_CONFIG.image}:${tag}`,
      '--raw',
    ]);
    const digest = `sha256:${createHash('sha256').update(raw).digest('hex')}`;
    if (digest !== mapping.image.indexDigest) {
      throw new Error(`Container tag ${tag} does not resolve to the signed index.`);
    }
  }
}

async function finishRelease(runtime, options, reporter, commit) {
  const release = await waitForReleaseDraft(runtime, options, reporter, commit);
  if (!release) return 'waiting-for-workflow';
  if (release.isPrerelease !== options.prerelease) {
    throw new Error('GitHub Release prerelease status does not match the version.');
  }
  const files = await verifyMappingAndImage(runtime, options, commit, release);
  verifyTagSignature(runtime, options.tag);
  const signed = await ensureDetachedSignature(runtime, options, reporter, files);
  if (!signed) return 'awaiting-signature';

  if (release.isDraft) {
    reporter.add('plan', `Publish the verified GitHub Release ${options.tag}.`);
    const approved = await yesNo(
      runtime,
      options,
      reporter,
      `Publish GitHub Release ${options.tag}? This makes the signed release visible to users.`,
    );
    if (approved !== true) return 'awaiting-publication';
    runGh(runtime, ['release', 'edit', options.tag, '--draft=false'], {
      inherit: !options.json,
    });
  }
  const published = getRelease(runtime, options.tag);
  if (!published || published.isDraft) {
    throw new Error('GitHub Release publication could not be verified.');
  }
  await verifyPublishedTags(runtime, options, files.mapping);
  reporter.add('complete', `${options.tag} is published and matches its signed mapping.`);
  return 'complete';
}

async function resumeRelease(runtime, options, reporter, repository, pull) {
  const branch = `${RELEASE_CONFIG.branchPrefix}${options.tag}`;
  assertPullRequest(runtime, pull, branch, repository.defaultBranch);
  const pullPrepared = validatePreparedCommit(runtime, options, pull.headRefOid);
  if (!pull.mergedAt) {
    warnStaleDate(runtime, reporter, pullPrepared);
    if (pull.state === 'CLOSED') {
      const result = reporter.finish('pull-request-closed', {
        branch,
        pullRequest: pull.url,
        next: `Reopen the PR to continue, or run npm run release -- abort ${options.version} to clean up.`,
      });
      await writeStatus(runtime, options, result);
      return 0;
    }
    reporter.add(
      'waiting',
      `${pull.url} is ${pull.isDraft ? 'draft' : pull.state.toLowerCase()} and has not merged.`,
    );
    const result = reporter.finish('waiting-for-merge', {
      branch,
      pullRequest: pull.url,
      next: 'Finish review and merge the PR through branch protection.',
    });
    await writeStatus(runtime, options, result);
    return 0;
  }

  const localTag = gitRefExists(runtime, `refs/tags/${options.tag}`);
  const remoteTag = remoteTagExists(runtime, options.tag);
  if (remoteTag && !localTag) {
    run(runtime, 'git', ['fetch', 'origin', `refs/tags/${options.tag}:refs/tags/${options.tag}`]);
  }
  if (remoteTag) {
    verifyTagSignature(runtime, options.tag);
    const commit = output(runtime, 'git', ['rev-parse', `${options.tag}^{commit}`]);
    if (pull.mergeCommit?.oid !== commit) {
      throw new Error('The release tag does not target the release PR merge commit.');
    }
    verifyRemoteTagMatchesLocal(runtime, options.tag);
    warnStaleDate(runtime, reporter, validatePreparedCommit(runtime, options, commit));
    const status = await finishRelease(runtime, options, reporter, commit);
    const result = reporter.finish(status, {
      commit,
      next:
        status === 'complete'
          ? 'Release complete.'
          : `Re-run npm run release -- ${options.version} to resume.`,
    });
    await writeStatus(runtime, options, result);
    return 0;
  }

  if (localTag) {
    assertClean(runtime);
    verifyTagSignature(runtime, options.tag);
    const commit = output(runtime, 'git', ['rev-parse', `${options.tag}^{commit}`]);
    if (pull.mergeCommit?.oid !== commit) {
      throw new Error('The local release tag does not target the release PR merge commit.');
    }
    warnStaleDate(runtime, reporter, validatePreparedCommit(runtime, options, commit));
    if (
      !(await requireSuccessfulCheck(runtime, options, reporter, commit, repository.defaultBranch))
    ) {
      const result = reporter.finish('waiting-for-check', {
        commit,
        next: `Re-run npm run release -- ${options.version} after Check succeeds.`,
      });
      await writeStatus(runtime, options, result);
      return 0;
    }
    const pushed = await createOrPushTag(runtime, options, reporter, commit);
    if (!pushed) {
      const result = reporter.finish('awaiting-tag-confirmation', {
        commit,
        next: `Re-run in a TTY and approve pushing ${options.tag}.`,
      });
      await writeStatus(runtime, options, result);
      return 0;
    }
    const status = await finishRelease(runtime, options, reporter, commit);
    const result = reporter.finish(status, {
      commit,
      next:
        status === 'complete'
          ? 'Release complete.'
          : `Re-run npm run release -- ${options.version} to resume.`,
    });
    await writeStatus(runtime, options, result);
    return 0;
  }

  const current = output(runtime, 'git', ['branch', '--show-current']);
  if (current !== repository.defaultBranch) {
    throw new Error(`Switch to ${repository.defaultBranch} after the release PR is merged.`);
  }
  assertClean(runtime);
  if (!options.dryRun) run(runtime, 'git', ['fetch', '--prune', 'origin']);
  const commit = output(runtime, 'git', ['rev-parse', 'HEAD']);
  const remoteHead = options.dryRun
    ? remoteRefOid(runtime, `refs/heads/${repository.defaultBranch}`)
    : output(runtime, 'git', ['rev-parse', `origin/${repository.defaultBranch}`]);
  if (commit !== remoteHead) {
    throw new Error(
      `Local ${repository.defaultBranch} must exactly match origin/${repository.defaultBranch}.`,
    );
  }
  if (pull.mergeCommit?.oid !== commit) {
    throw new Error('The current default-branch commit is not the release PR merge commit.');
  }
  warnStaleDate(runtime, reporter, await validatePreparedTree(runtime, options));
  run(runtime, 'node', ['scripts/release-check.mjs', '--tag', options.tag], {
    inherit: !options.json,
  });
  if (
    !(await requireSuccessfulCheck(runtime, options, reporter, commit, repository.defaultBranch))
  ) {
    const result = reporter.finish('waiting-for-check', {
      commit,
      next: `Re-run npm run release -- ${options.version} after Check succeeds.`,
    });
    await writeStatus(runtime, options, result);
    return 0;
  }
  if (getRelease(runtime, options.tag) && !remoteTagExists(runtime, options.tag)) {
    throw new Error('A GitHub Release exists before the release tag was pushed.');
  }
  const pushed = await createOrPushTag(runtime, options, reporter, commit);
  if (!pushed) {
    const result = reporter.finish('awaiting-tag-confirmation', {
      commit,
      next: `Re-run in a TTY and approve pushing ${options.tag}.`,
    });
    await writeStatus(runtime, options, result);
    return 0;
  }
  const status = await finishRelease(runtime, options, reporter, commit);
  const result = reporter.finish(status, {
    commit,
    next:
      status === 'complete'
        ? 'Release complete.'
        : `Re-run npm run release -- ${options.version} to resume.`,
  });
  await writeStatus(runtime, options, result);
  return 0;
}

async function abortRelease(runtime, options, reporter, repository) {
  const branch = `${RELEASE_CONFIG.branchPrefix}${options.tag}`;
  assertClean(runtime);
  const current = output(runtime, 'git', ['branch', '--show-current']);
  if (current !== repository.defaultBranch && current !== branch) {
    throw new Error(`Abort must run from ${repository.defaultBranch} or ${branch}.`);
  }
  if (!options.dryRun) run(runtime, 'git', ['fetch', '--prune', 'origin']);
  if (gitRefExists(runtime, `refs/tags/${options.tag}`) || remoteTagExists(runtime, options.tag)) {
    throw new Error('Abort is unavailable after a local or remote release tag exists.');
  }
  if (getRelease(runtime, options.tag)) {
    throw new Error('Abort is unavailable after any GitHub Release exists.');
  }
  const pull = getPullRequest(runtime, branch);
  if (pull?.mergedAt || pull?.state === 'MERGED') {
    throw new Error(
      'The release PR is merged. Continue the release or use a normal reviewed revert PR.',
    );
  }
  if (pull) assertPullRequest(runtime, pull, branch, repository.defaultBranch);

  const local = gitRefExists(runtime, `refs/heads/${branch}`);
  const remoteBranchOid = remoteRefOid(runtime, `refs/heads/${branch}`);
  const remote = Boolean(remoteBranchOid);
  const remoteDefaultOid = remoteRefOid(runtime, `refs/heads/${repository.defaultBranch}`);
  if (!remoteDefaultOid) throw new Error('The remote default branch was not found.');
  if (!pull && !local && !remote) {
    const result = reporter.finish('already-aborted', {
      branch,
      next: 'No unmerged release preparation remains.',
    });
    await writeStatus(runtime, options, result);
    return 0;
  }
  if (pull && !remote) {
    if (pull.state === 'OPEN') {
      throw new Error('The open release PR has no matching remote branch.');
    }
  }
  if (local && remote) {
    const localCommit = output(runtime, 'git', ['rev-parse', branch]);
    const remoteCommit = remoteBranchOid;
    if (localCommit !== remoteCommit) {
      throw new Error('The local release branch has commits not present on its remote branch.');
    }
  } else if (local && !remote) {
    const localCommit = output(runtime, 'git', ['rev-parse', branch]);
    if (!pull || pull.state !== 'CLOSED' || pull.headRefOid !== localCommit) {
      throw new Error('The local release branch cannot be proven to have existed on the remote.');
    }
  }
  const comparison = remote ? remoteBranchOid : branch;
  if (local || remote) {
    const paths = output(runtime, 'git', [
      'diff',
      '--name-only',
      `${remoteDefaultOid}...${comparison}`,
    ])
      .split('\n')
      .filter(Boolean);
    assertAllowedPaths(paths);
  }
  if (gitRefExists(runtime, `refs/heads/${repository.defaultBranch}`)) {
    const canFastForward = run(
      runtime,
      'git',
      ['merge-base', '--is-ancestor', repository.defaultBranch, remoteDefaultOid],
      { allowFailure: true },
    );
    if (canFastForward.status !== 0) {
      throw new Error(
        `Local ${repository.defaultBranch} cannot fast-forward to origin/${repository.defaultBranch}.`,
      );
    }
  }

  reporter.add(
    'plan',
    [
      `Abort ${options.tag}:`,
      pull?.state === 'OPEN' ? `- close ${pull.url}` : '- no open PR to close',
      remote ? `- delete origin/${branch}` : '- remote branch already absent',
      `- switch to and fast-forward ${repository.defaultBranch}`,
      local ? `- delete local ${branch}` : '- local branch already absent',
      '- preserve ignored release artifacts',
    ].join('\n'),
  );
  if (options.dryRun) {
    const result = reporter.finish('dry-run', {
      branch,
      next: 'No Git or GitHub release state was changed.',
    });
    await writeStatus(runtime, options, result);
    return 0;
  }
  const approved = await yesNo(
    runtime,
    options,
    reporter,
    `Abort ${options.tag}? Only this unmerged release preparation will be removed.`,
  );
  if (approved !== true) {
    const result = reporter.finish(approved === null ? 'awaiting-confirmation' : 'stopped', {
      branch,
      next: `Re-run in a TTY and approve aborting ${options.tag}.`,
    });
    await writeStatus(runtime, options, result);
    return 0;
  }

  if (pull?.state === 'OPEN') {
    runGh(runtime, ['pr', 'close', String(pull.number)], {
      inherit: !options.json,
    });
  }
  if (remoteBranchExists(runtime, branch)) {
    run(runtime, 'git', ['push', 'origin', '--delete', branch], {
      inherit: !options.json,
    });
  }
  run(runtime, 'git', ['fetch', '--prune', 'origin']);
  if (output(runtime, 'git', ['branch', '--show-current']) !== repository.defaultBranch) {
    run(runtime, 'git', ['switch', repository.defaultBranch]);
  }
  run(runtime, 'git', ['merge', '--ff-only', `origin/${repository.defaultBranch}`]);
  if (gitRefExists(runtime, `refs/heads/${branch}`)) {
    run(runtime, 'git', ['branch', '-D', branch]);
  }
  const remainingPull = getPullRequest(runtime, branch);
  if (
    remoteBranchExists(runtime, branch) ||
    gitRefExists(runtime, `refs/heads/${branch}`) ||
    remainingPull?.state === 'OPEN'
  ) {
    throw new Error('Abort finished partially. Re-run to inspect and complete cleanup.');
  }
  const result = reporter.finish('aborted', {
    branch,
    next: 'The unmerged release preparation was removed; ignored artifacts were preserved.',
  });
  await writeStatus(runtime, options, result);
  return 0;
}

export async function runReleaseCli(args, runtime) {
  if (args.length === 1 && (args[0] === '--help' || args[0] === '-h')) {
    runtime.write(RELEASE_HELP);
    return 0;
  }
  const options = parseReleaseArgs(args);
  const reporter = makeReporter(options, runtime);
  const root = output(runtime, 'git', ['rev-parse', '--show-toplevel']);
  if (root !== runtime.cwd) throw new Error('Run the release command from the repository root.');
  assertCanonicalOrigin(runtime);
  const repository = getRepository(runtime);
  if (!options.abort && !repository.protected) {
    throw new Error(`GitHub default branch ${repository.defaultBranch} must be protected.`);
  }
  if (options.abort) {
    return abortRelease(runtime, options, reporter, repository);
  }

  const branch = `${RELEASE_CONFIG.branchPrefix}${options.tag}`;
  const pull = getPullRequest(runtime, branch);
  if (!pull) return preparePullRequest(runtime, options, reporter, repository);
  return resumeRelease(runtime, options, reporter, repository, pull);
}
