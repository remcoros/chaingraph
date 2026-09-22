import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

// The release implementation is plain Node.js so it can run before npm install.
// @ts-expect-error TypeScript does not infer declarations for the .mjs CLI library.
import * as releaseTool from '../../scripts/release/release.lib.mjs';

const {
  parseReleaseArgs,
  prepareChangelog,
  RELEASE_CONFIG,
  RELEASE_HELP,
  runReleaseCli,
  validateIndex,
  validatePreparedChangelog,
  validateReleaseMapping,
  waitForReleaseDraft,
} = releaseTool;

describe('release library', () => {
  it('provides concise command help without repository access', async () => {
    const writes: string[] = [];
    const exitCode = await runReleaseCli(['--help'], {
      runner: {
        run() {
          throw new Error('help must not run commands');
        },
      },
      write: (message: string) => writes.push(message),
    });

    expect(exitCode).toBe(0);
    expect(writes).toEqual([RELEASE_HELP]);
    expect(RELEASE_HELP).toContain('abort <X.Y.Z>');
  });

  it('refuses to release from an unprotected default branch', async () => {
    const directory = '/synthetic/chaingraph';
    const response = (stdout = '', status = 0, stderr = '') => ({ stderr, status, stdout });

    await expect(
      runReleaseCli(['0.2.0', '--dry-run'], {
        cwd: directory,
        runner: {
          run(command: string, args: string[]) {
            const invocation = [command, ...args].join(' ');
            if (invocation === 'git rev-parse --show-toplevel') return response(directory);
            if (
              invocation === 'git remote get-url --all origin' ||
              invocation === 'git remote get-url --push --all origin'
            ) {
              return response('https://github.com/remcoros/chaingraph.git\n');
            }
            if (
              invocation ===
              'gh repo view remcoros/chaingraph --json nameWithOwner,defaultBranchRef'
            ) {
              return response(
                JSON.stringify({
                  defaultBranchRef: { name: 'main' },
                  nameWithOwner: RELEASE_CONFIG.repository,
                }),
              );
            }
            if (invocation === 'gh api repos/remcoros/chaingraph/branches/main --method GET') {
              return response(JSON.stringify({ protected: false }));
            }
            throw new Error(`Unexpected command: ${invocation}`);
          },
        },
      }),
    ).rejects.toThrow('GitHub default branch main must be protected.');
  });

  it.each([
    {
      fetchUrls: 'https://evilgithub.com/remcoros/chaingraph.git\n',
      name: 'a lookalike fetch host',
      pushUrls: 'https://github.com/remcoros/chaingraph.git\n',
    },
    {
      fetchUrls: 'https://github.com/remcoros/chaingraph.git\n',
      name: 'an additional push destination',
      pushUrls:
        'git@github.com:remcoros/chaingraph.git\ngit@evilgithub.com:remcoros/chaingraph.git\n',
    },
  ])('refuses $name on origin', async ({ fetchUrls, pushUrls }) => {
    const directory = '/synthetic/chaingraph';
    const response = (stdout = '', status = 0, stderr = '') => ({ stderr, status, stdout });

    await expect(
      runReleaseCli(['0.2.0', '--dry-run'], {
        cwd: directory,
        runner: {
          run(command: string, args: string[]) {
            const invocation = [command, ...args].join(' ');
            if (invocation === 'git rev-parse --show-toplevel') return response(directory);
            if (invocation === 'git remote get-url --all origin') return response(fetchUrls);
            if (invocation === 'git remote get-url --push --all origin') {
              return response(pushUrls);
            }
            throw new Error(`Unexpected command: ${invocation}`);
          },
        },
      }),
    ).rejects.toThrow(
      'Every Git remote origin URL must target github.com/remcoros/chaingraph for fetch and push.',
    );
  });

  it('accepts stable and prerelease versions without build metadata', () => {
    expect(parseReleaseArgs(['1.2.3'])).toMatchObject({
      abort: false,
      prerelease: false,
      tag: 'v1.2.3',
    });
    expect(parseReleaseArgs(['abort', '1.2.3-rc.1', '--dry-run'])).toMatchObject({
      abort: true,
      dryRun: true,
      prerelease: true,
      tag: 'v1.2.3-rc.1',
    });
    expect(() => parseReleaseArgs(['v1.2.3'])).toThrow(/without a leading v/);
    expect(() => parseReleaseArgs(['1.2.3+build.1'])).toThrow(/build metadata/);
    expect(() => parseReleaseArgs(['1.2.3-01'])).toThrow(/SemVer/);
  });

  it('prepares the initial version and leaves a fresh Unreleased section', () => {
    const source = '# Changelog\n\n## [0.1.0] - Unreleased\n\nFirst release.\n';
    const result = prepareChangelog(source, '0.1.0', '2026-09-22');

    expect(result.changelog).toBe(
      '# Changelog\n\n## [Unreleased]\n\n## [0.1.0] - 2026-09-22\n\nFirst release.\n',
    );
    expect(validatePreparedChangelog(result.changelog, '0.1.0')).toEqual({
      date: '2026-09-22',
      notes: 'First release.',
    });
  });

  it('moves future Unreleased notes into the requested version', () => {
    const source = [
      '# Changelog',
      '',
      '## [Unreleased]',
      '',
      '- A new feature.',
      '',
      '## [0.1.0] - 2026-09-22',
      '',
      'First release.',
      '',
    ].join('\n');
    const result = prepareChangelog(source, '0.2.0', '2026-10-03');

    expect(result.changelog).toContain(
      '## [Unreleased]\n\n## [0.2.0] - 2026-10-03\n\n- A new feature.',
    );
    expect(result.notes).toBe('- A new feature.');
  });

  it('rejects empty or ambiguous changelog entries', () => {
    expect(() =>
      prepareChangelog('# Changelog\n\n## [Unreleased]\n', '0.2.0', '2026-10-03'),
    ).toThrow(/notes.*empty/);
    expect(() =>
      validatePreparedChangelog(
        '# Changelog\n\n## [Unreleased]\n\n## [Unreleased]\n\n## [0.2.0] - 2026-10-03\n\nNotes.\n',
        '0.2.0',
      ),
    ).toThrow(/exactly one fresh/);
    expect(() =>
      validatePreparedChangelog(
        '# Changelog\n\n## [Unreleased]\n\n## [0.2.0] - 2026-02-30\n\nNotes.\n',
        '0.2.0',
      ),
    ).toThrow(/invalid UTC release date/);
  });

  it('validates the signed mapping against the immutable OCI index', () => {
    const manifests = {
      'linux/amd64': `sha256:${'a'.repeat(64)}`,
      'linux/arm64': `sha256:${'b'.repeat(64)}`,
    };
    const raw = `${JSON.stringify({
      mediaType: 'application/vnd.oci.image.index.v1+json',
      manifests: Object.entries(manifests).map(([platform, digest]) => {
        const [os, architecture] = platform.split('/');
        return {
          mediaType: 'application/vnd.oci.image.manifest.v1+json',
          digest,
          platform: { architecture, os },
        };
      }),
    })}\n`;
    const mapping = {
      schemaVersion: 1,
      source: { commit: '1'.repeat(40), tag: 'v1.2.3' },
      image: {
        name: RELEASE_CONFIG.image,
        indexDigest: `sha256:${createHash('sha256').update(raw).digest('hex')}`,
        platforms: manifests,
      },
    };

    expect(() =>
      validateReleaseMapping(mapping, {
        commit: '1'.repeat(40),
        image: RELEASE_CONFIG.image,
        tag: 'v1.2.3',
      }),
    ).not.toThrow();
    expect(() => validateIndex(raw, mapping)).not.toThrow();
    expect(() => validateIndex(raw.replace('linux', 'other'), mapping)).toThrow(/digest mismatch/);
  });

  it('keeps the workflow, CLI and trust instructions pinned to the same key', async () => {
    const [workflow, readme] = await Promise.all([
      readFile('.github/workflows/release.yml', 'utf8'),
      readFile('README.md', 'utf8'),
    ]);
    const match = workflow.match(/RELEASE_PRIMARY_FINGERPRINT: ([A-F0-9]{40})/);

    expect(match?.[1]).toBe(RELEASE_CONFIG.signingFingerprint);
    expect(workflow.match(/RELEASE_PRIMARY_FINGERPRINT:/g)).toHaveLength(1);
    expect(readme.replaceAll(/\s/g, '')).toContain(RELEASE_CONFIG.signingFingerprint);
  });

  it('waits for the tag workflow, watches it, then returns the draft release', async () => {
    const commit = '3'.repeat(40);
    const commands: string[] = [];
    const events: string[] = [];
    let releaseLookups = 0;
    let runLookups = 0;
    let sleeps = 0;
    const response = (stdout = '', status = 0, stderr = '') => ({ stderr, status, stdout });
    const draft = {
      assets: [{ name: 'chaingraph-v0.2.0.release.json' }],
      isDraft: true,
      isPrerelease: false,
      tagName: 'v0.2.0',
      url: 'https://github.com/remcoros/chaingraph/releases/tag/v0.2.0',
    };

    const release = await waitForReleaseDraft(
      {
        cwd: '/synthetic/chaingraph',
        runner: {
          run(command: string, args: string[]) {
            const invocation = [command, ...args].join(' ');
            commands.push(invocation);
            if (invocation.startsWith('gh release view v0.2.0 ')) {
              releaseLookups += 1;
              return releaseLookups < 3
                ? response('', 1, 'release not found\n')
                : response(JSON.stringify(draft));
            }
            if (invocation.startsWith('gh run list ')) {
              runLookups += 1;
              if (runLookups === 1) return response('[]');
              const completed = runLookups >= 3;
              return response(
                JSON.stringify([
                  {
                    conclusion: completed ? 'success' : '',
                    databaseId: 123,
                    event: 'push',
                    headBranch: 'v0.2.0',
                    headSha: commit,
                    status: completed ? 'completed' : 'in_progress',
                    url: 'https://github.com/remcoros/chaingraph/actions/runs/123',
                  },
                ]),
              );
            }
            if (
              invocation === 'gh run watch 123 --exit-status --compact --repo remcoros/chaingraph'
            ) {
              return response();
            }
            throw new Error(`Unexpected command: ${invocation}`);
          },
        },
        sleep: async () => {
          sleeps += 1;
        },
      },
      { json: false, tag: 'v0.2.0', version: '0.2.0' },
      {
        add(_kind: string, message: string) {
          events.push(message);
        },
      },
      commit,
    );

    expect(release).toEqual(draft);
    expect(sleeps).toBeGreaterThan(0);
    expect(commands).toContain(
      'gh run watch 123 --exit-status --compact --repo remcoros/chaingraph',
    );
    expect(events.join('\n')).toContain('Press Ctrl+C to stop watching');
  });

  it('requires a default-branch push check before tagging', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'chaingraph-release-check-test-'));
    const pullHead = '2'.repeat(40);
    const mergeCommit = '3'.repeat(40);
    const branch = 'release/v0.2.0';
    const changelog =
      '# Changelog\n\n## [Unreleased]\n\n## [0.2.0] - 2026-09-22\n\nRelease notes.\n';
    const response = (stdout = '', status = 0, stderr = '') => ({ stderr, status, stdout });
    try {
      await Promise.all([
        writeFile(join(directory, 'package.json'), JSON.stringify({ version: '0.2.0' })),
        writeFile(
          join(directory, 'package-lock.json'),
          JSON.stringify({ packages: { '': { version: '0.2.0' } }, version: '0.2.0' }),
        ),
        writeFile(join(directory, 'CHANGELOG.md'), changelog),
      ]);

      await expect(
        runReleaseCli(['0.2.0', '--dry-run'], {
          cwd: directory,
          isTTY: false,
          now: () => new Date('2026-09-22T12:00:00.000Z'),
          runner: {
            run(command: string, args: string[]) {
              const invocation = [command, ...args].join(' ');
              if (invocation === 'git rev-parse --show-toplevel') return response(directory);
              if (
                invocation === 'git remote get-url --all origin' ||
                invocation === 'git remote get-url --push --all origin'
              ) {
                return response('https://github.com/remcoros/chaingraph.git\n');
              }
              if (
                invocation ===
                'gh repo view remcoros/chaingraph --json nameWithOwner,defaultBranchRef'
              ) {
                return response(
                  JSON.stringify({
                    defaultBranchRef: { name: 'main' },
                    nameWithOwner: RELEASE_CONFIG.repository,
                  }),
                );
              }
              if (invocation === 'gh api repos/remcoros/chaingraph/branches/main --method GET') {
                return response(JSON.stringify({ protected: true }));
              }
              if (invocation.startsWith('gh pr list ')) {
                return response(
                  JSON.stringify([
                    {
                      baseRefName: 'main',
                      headRefName: branch,
                      headRefOid: pullHead,
                      isDraft: false,
                      mergeCommit: { oid: mergeCommit },
                      mergedAt: '2026-09-22T10:00:00Z',
                      number: 42,
                      state: 'MERGED',
                      url: 'https://github.com/remcoros/chaingraph/pull/42',
                    },
                  ]),
                );
              }
              if (invocation === 'gh pr diff 42 --name-only --repo remcoros/chaingraph') {
                return response('CHANGELOG.md\npackage.json\npackage-lock.json\n');
              }
              if (invocation === `git show ${pullHead}:package.json`) {
                return response(JSON.stringify({ version: '0.2.0' }));
              }
              if (invocation === `git show ${pullHead}:package-lock.json`) {
                return response(
                  JSON.stringify({ packages: { '': { version: '0.2.0' } }, version: '0.2.0' }),
                );
              }
              if (invocation === `git show ${pullHead}:CHANGELOG.md`) return response(changelog);
              if (invocation === 'git show-ref --verify --quiet refs/tags/v0.2.0') {
                return response('', 1);
              }
              if (invocation === 'git ls-remote origin refs/tags/v0.2.0') return response();
              if (invocation === 'git branch --show-current') return response('main');
              if (invocation === 'git status --porcelain=v1 --untracked-files=all') {
                return response();
              }
              if (invocation === 'git rev-parse HEAD') return response(mergeCommit);
              if (invocation === 'git ls-remote origin refs/heads/main') {
                return response(`${mergeCommit}\trefs/heads/main\n`);
              }
              if (invocation === 'node scripts/release-check.mjs --tag v0.2.0') {
                return response();
              }
              if (
                invocation ===
                `gh run list --workflow check.yml --commit ${mergeCommit} --limit 20 --json databaseId,status,conclusion,headBranch,headSha,url,event --repo remcoros/chaingraph`
              ) {
                return response(
                  JSON.stringify([
                    {
                      conclusion: 'success',
                      databaseId: 101,
                      event: 'pull_request',
                      headBranch: branch,
                      headSha: mergeCommit,
                      status: 'completed',
                      url: 'https://github.com/remcoros/chaingraph/actions/runs/101',
                    },
                    {
                      conclusion: 'success',
                      databaseId: 102,
                      event: 'push',
                      headBranch: 'other-branch',
                      headSha: mergeCommit,
                      status: 'completed',
                      url: 'https://github.com/remcoros/chaingraph/actions/runs/102',
                    },
                  ]),
                );
              }
              throw new Error(`Unexpected command: ${invocation}`);
            },
          },
          write: () => {},
        }),
      ).rejects.toThrow(`No Check workflow run exists for ${mergeCommit}.`);
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it('keeps preparation dry-runs read-only through the command seam', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'chaingraph-release-test-'));
    const commands: string[] = [];
    const writes: string[] = [];
    const commit = '1'.repeat(40);
    const response = (stdout = '', status = 0, stderr = '') => ({ stderr, status, stdout });
    try {
      await writeFile(
        join(directory, 'CHANGELOG.md'),
        '# Changelog\n\n## [0.1.0] - Unreleased\n\nFirst release.\n',
      );
      const exitCode = await runReleaseCli(['0.1.0', '--dry-run'], {
        cwd: directory,
        isTTY: false,
        now: () => new Date('2026-09-22T12:00:00.000Z'),
        prompt: () => {
          throw new Error('dry-run must not prompt');
        },
        runner: {
          run(command: string, args: string[]) {
            const invocation = [command, ...args].join(' ');
            commands.push(invocation);
            if (invocation === 'git rev-parse --show-toplevel') return response(directory);
            if (
              invocation === 'git remote get-url --all origin' ||
              invocation === 'git remote get-url --push --all origin'
            ) {
              return response('git@github.com:remcoros/chaingraph.git\n');
            }
            if (
              invocation ===
              'gh repo view remcoros/chaingraph --json nameWithOwner,defaultBranchRef'
            ) {
              return response(
                JSON.stringify({
                  defaultBranchRef: { name: 'main' },
                  nameWithOwner: RELEASE_CONFIG.repository,
                }),
              );
            }
            if (invocation === 'gh api repos/remcoros/chaingraph/branches/main --method GET') {
              return response(JSON.stringify({ protected: true }));
            }
            if (invocation.startsWith('gh pr list ')) return response('[]');
            if (invocation.startsWith('gh release view v0.1.0 ')) {
              return response('', 1, 'release not found\n');
            }
            if (invocation === 'git branch --show-current') return response('main');
            if (invocation === 'git ls-remote origin refs/heads/main') {
              return response(`${commit}\trefs/heads/main`);
            }
            if (invocation === 'git ls-remote origin refs/heads/release/v0.1.0') {
              return response();
            }
            if (invocation === 'git ls-remote origin refs/tags/v0.1.0') {
              return response();
            }
            if (invocation === 'git status --porcelain=v1 --untracked-files=all') {
              return response();
            }
            if (invocation === 'git rev-parse HEAD') return response(commit);
            if (invocation === 'git show-ref --verify --quiet refs/heads/release/v0.1.0') {
              return response('', 1);
            }
            if (invocation === 'git show-ref --verify --quiet refs/tags/v0.1.0') {
              return response('', 1);
            }
            throw new Error(`Unexpected command: ${invocation}`);
          },
        },
        write: (message: string) => writes.push(message),
      });

      expect(exitCode).toBe(0);
      expect(commands.some((command) => command.includes(' fetch '))).toBe(false);
      expect(commands.some((command) => command.includes(' switch '))).toBe(false);
      expect(commands.some((command) => command.includes(' push '))).toBe(false);
      expect(writes.join('\n')).toContain('Release notes preview');
      const status = JSON.parse(
        await readFile(join(directory, 'artifacts/releases/v0.1.0/status.json'), 'utf8'),
      );
      expect(status.status).toBe('dry-run');
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it('previews abort without closing the PR or deleting branches', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'chaingraph-abort-test-'));
    const commands: string[] = [];
    const writes: string[] = [];
    const base = '1'.repeat(40);
    const head = '2'.repeat(40);
    const branch = 'release/v0.2.0';
    const response = (stdout = '', status = 0, stderr = '') => ({ stderr, status, stdout });
    try {
      const exitCode = await runReleaseCli(['abort', '0.2.0', '--dry-run'], {
        cwd: directory,
        isTTY: false,
        now: () => new Date('2026-09-22T12:00:00.000Z'),
        prompt: () => {
          throw new Error('dry-run must not prompt');
        },
        runner: {
          run(command: string, args: string[]) {
            const invocation = [command, ...args].join(' ');
            commands.push(invocation);
            if (invocation === 'git rev-parse --show-toplevel') return response(directory);
            if (
              invocation === 'git remote get-url --all origin' ||
              invocation === 'git remote get-url --push --all origin'
            ) {
              return response('https://github.com/remcoros/chaingraph.git\n');
            }
            if (
              invocation ===
              'gh repo view remcoros/chaingraph --json nameWithOwner,defaultBranchRef'
            ) {
              return response(
                JSON.stringify({
                  defaultBranchRef: { name: 'main' },
                  nameWithOwner: RELEASE_CONFIG.repository,
                }),
              );
            }
            if (invocation === 'gh api repos/remcoros/chaingraph/branches/main --method GET') {
              return response(JSON.stringify({ protected: true }));
            }
            if (invocation === 'git status --porcelain=v1 --untracked-files=all') {
              return response();
            }
            if (invocation === 'git branch --show-current') return response(branch);
            if (invocation === 'git show-ref --verify --quiet refs/tags/v0.2.0') {
              return response('', 1);
            }
            if (invocation === 'git ls-remote origin refs/tags/v0.2.0') {
              return response();
            }
            if (invocation.startsWith('gh release view v0.2.0 ')) {
              return response('', 1, 'release not found\n');
            }
            if (invocation.startsWith('gh pr list ')) {
              return response(
                JSON.stringify([
                  {
                    baseRefName: 'main',
                    headRefName: branch,
                    headRefOid: head,
                    isDraft: true,
                    mergeCommit: null,
                    mergedAt: null,
                    number: 42,
                    state: 'OPEN',
                    url: 'https://github.com/remcoros/chaingraph/pull/42',
                  },
                ]),
              );
            }
            if (invocation === 'gh pr diff 42 --name-only --repo remcoros/chaingraph') {
              return response('CHANGELOG.md\npackage.json\npackage-lock.json\n');
            }
            if (invocation === `git show-ref --verify --quiet refs/heads/${branch}`) {
              return response();
            }
            if (invocation === `git ls-remote origin refs/heads/${branch}`) {
              return response(`${head}\trefs/heads/${branch}\n`);
            }
            if (invocation === 'git ls-remote origin refs/heads/main') {
              return response(`${base}\trefs/heads/main\n`);
            }
            if (invocation === `git rev-parse ${branch}`) return response(head);
            if (invocation === `git rev-parse origin/${branch}`) return response(head);
            if (invocation === `git diff --name-only ${base}...${head}`) {
              return response('CHANGELOG.md\npackage.json\npackage-lock.json\n');
            }
            if (invocation === 'git show-ref --verify --quiet refs/heads/main') {
              return response();
            }
            if (invocation === `git merge-base --is-ancestor main ${base}`) {
              return response();
            }
            throw new Error(`Unexpected command: ${invocation}`);
          },
        },
        write: (message: string) => writes.push(message),
      });

      expect(exitCode).toBe(0);
      expect(writes.join('\n')).toContain('Abort v0.2.0:');
      expect(commands.some((command) => command.startsWith('gh pr close '))).toBe(false);
      expect(commands.some((command) => command.includes(' push origin --delete '))).toBe(false);
      const status = JSON.parse(
        await readFile(join(directory, 'artifacts/releases/v0.2.0/status.json'), 'utf8'),
      );
      expect(status.status).toBe('dry-run');
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });
});
