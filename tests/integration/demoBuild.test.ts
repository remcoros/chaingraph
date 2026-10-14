import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, expect, it, vi } from 'vitest';
import { loadConfigFromFile } from 'vite';

afterEach(() => vi.unstubAllEnvs());

it.each([
  { demo: '', base: undefined, expectedBase: '/', expectedDirectory: 'dist' },
  { demo: '1', base: undefined, expectedBase: '/chaingraph/', expectedDirectory: 'dist-demo' },
  { demo: '1', base: '/', expectedBase: '/', expectedDirectory: 'dist-demo' },
  {
    demo: '1',
    base: '/another-project/',
    expectedBase: '/another-project/',
    expectedDirectory: 'dist-demo',
  },
])(
  'resolves build policy and output for $expectedBase ($expectedDirectory)',
  async ({ demo, base, expectedBase, expectedDirectory }) => {
    vi.stubEnv('CHAINGRAPH_DEMO', demo);
    vi.stubEnv('CHAINGRAPH_BASE_PATH', base);
    const loaded = await loadConfigFromFile(
      { command: 'build', mode: 'production' },
      'vite.config.ts',
    );
    expect(loaded!.config.base).toBe(expectedBase);
    expect(loaded!.config.build!.outDir).toBe(expectedDirectory);
    expect(loaded!.config.define!.__DEMO_MODE__).toBe(demo === '1');
    expect(loaded!.config.envDir).toBe(false);
  },
);

async function selectionFixture() {
  const workflow = await readFile('.github/workflows/demo-pages.yml', 'utf8');
  // Exercise the actual workflow shell, replacing only the read-only GitHub I/O.
  const selection = workflow
    .split('name: Select published stable release')[1]
    .split('        run: |\n')[1]
    .split('      - uses:')[0]
    .replace(/^          /gm, '');
  const directory = await mkdtemp(join(tmpdir(), 'chaingraph-demo-release-'));
  await writeFile(join(directory, 'gh'), '#!/bin/sh\nprintf "%s" "$FIXTURE_RELEASE"\n', {
    mode: 0o700,
  });
  const output = join(directory, 'output');
  await writeFile(output, '');
  const release = {
    tagName: 'v1.2.3',
    isDraft: false,
    isPrerelease: false,
    publishedAt: '2026-10-14T10:00:00Z',
  };
  return {
    directory,
    output,
    release,
    run: (tag = 'v1.2.3', metadata = release) =>
      spawnSync('bash', ['-c', selection], {
        encoding: 'utf8',
        timeout: 5000,
        env: {
          ...process.env,
          PATH: `${directory}:${process.env.PATH}`,
          RELEASE_TAG: tag,
          GITHUB_REPOSITORY: 'example/project',
          GITHUB_OUTPUT: output,
          FIXTURE_RELEASE: JSON.stringify(metadata),
        },
      }),
  };
}

it('admits the exact published stable tag to checkout and rejects drafts, prereleases and mismatched release metadata', async () => {
  const fixture = await selectionFixture();
  try {
    expect(fixture.run().status).toBe(0);
    expect(await readFile(fixture.output, 'utf8')).toBe('tag=v1.2.3\n');
    for (const override of [
      { isDraft: true },
      { isPrerelease: true },
      { tagName: 'v9.9.9' },
      { publishedAt: '' },
    ]) {
      expect(fixture.run('v1.2.3', { ...fixture.release, ...override }).status).not.toBe(0);
    }
  } finally {
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

it('rejects branch names, option-like inputs and shell expressions before selection', async () => {
  const fixture = await selectionFixture();
  try {
    for (const tag of [
      'main',
      '--help',
      'v1.2.3-rc.1',
      'v01.2.3',
      'v1.2.3$(exit 0)',
      'v1.2.3\ntag=main',
    ])
      expect(fixture.run(tag).status).not.toBe(0);
    expect(await readFile(fixture.output, 'utf8')).toBe('');
  } finally {
    await rm(fixture.directory, { recursive: true, force: true });
  }
});
