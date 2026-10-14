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

async function freshnessFixture() {
  const workflow = await readFile('.github/workflows/demo-pages.yml', 'utf8');
  // Exercise the actual workflow shell, replacing only the read-only GitHub I/O.
  const freshness = workflow
    .split('name: Check source is still current')[1]
    .split('        run: |\n')[1]
    .split('      - id: deployment')[0]
    .replace(/^          /gm, '');
  const directory = await mkdtemp(join(tmpdir(), 'chaingraph-demo-freshness-'));
  await writeFile(
    join(directory, 'gh'),
    '#!/bin/sh\nif [ "$FIXTURE_GH_STATUS" != 0 ]; then exit "$FIXTURE_GH_STATUS"; fi\nprintf "%s\\n" "$FIXTURE_MAIN_COMMIT"\n',
    { mode: 0o700 },
  );
  const output = join(directory, 'output');
  const summary = join(directory, 'summary');
  await writeFile(output, '');
  await writeFile(summary, '');
  const commit = 'a'.repeat(40);
  return {
    directory,
    output,
    summary,
    commit,
    run: (current = commit, status = 0) =>
      spawnSync('bash', ['-c', freshness], {
        encoding: 'utf8',
        timeout: 5000,
        env: {
          ...process.env,
          PATH: `${directory}:${process.env.PATH}`,
          EVENT_COMMIT: commit,
          GITHUB_REPOSITORY: 'example/project',
          GITHUB_OUTPUT: output,
          GITHUB_STEP_SUMMARY: summary,
          FIXTURE_MAIN_COMMIT: current,
          FIXTURE_GH_STATUS: String(status),
        },
      }),
  };
}

it('admits the built commit for deployment when it still matches main', async () => {
  const fixture = await freshnessFixture();
  try {
    expect(fixture.run().status).toBe(0);
    expect(await readFile(fixture.output, 'utf8')).toBe('current=true\n');
  } finally {
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

it('skips a superseded build, including an older workflow rerun', async () => {
  const fixture = await freshnessFixture();
  try {
    const current = 'b'.repeat(40);
    expect(fixture.run(current).status).toBe(0);
    expect(await readFile(fixture.output, 'utf8')).toBe('current=false\n');
    const summary = await readFile(fixture.summary, 'utf8');
    expect(summary).toContain(fixture.commit);
    expect(summary).toContain(current);
  } finally {
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

it('does not admit deployment when the current main commit cannot be checked', async () => {
  const fixture = await freshnessFixture();
  try {
    expect(fixture.run('', 1).status).not.toBe(0);
    expect(await readFile(fixture.output, 'utf8')).toBe('');
  } finally {
    await rm(fixture.directory, { recursive: true, force: true });
  }
});
