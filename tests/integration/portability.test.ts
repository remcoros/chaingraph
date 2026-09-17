import { afterEach, expect, it } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmod, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const checker = resolve('scripts/check-portability.mjs');
const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});
async function repository(files: Record<string, string>) {
  const directory = await mkdtemp(join(tmpdir(), 'portability-test-'));
  directories.push(directory);
  execFileSync('git', ['init', '-q'], { cwd: directory });
  for (const [name, content] of Object.entries(files))
    await writeFile(join(directory, name), content);
  execFileSync('git', ['add', '--', '.'], { cwd: directory });
  return directory;
}
function check(cwd: string) {
  const result = spawnSync(process.execPath, [checker], { cwd, encoding: 'utf8' });
  return { status: result.status, output: result.stdout + result.stderr };
}

it('rejects hardcoded home paths without printing account names or matched contents', async () => {
  // Construct platform fixtures so this source itself remains portable.
  const account = 'fixture-account';
  const examples = [
    ['', 'home', account, 'project', 'file.ts'].join('/'),
    ['', 'Users', account].join('/'),
    ['C:', 'Users', account, 'project'].join('\\'),
  ];
  const directory = await repository({
    'notes.md': examples.map((path) => `Source: \`${path}\``).join('\n'),
  });
  const result = check(directory);
  expect(result.status).toBe(1);
  for (const line of [1, 2, 3])
    expect(result.output).toContain(`notes.md:${line}: hardcoded user-home path`);
  expect(result.output).not.toContain(account);
});

it('rejects a tracked environment file without reading it, and never follows external links', async () => {
  const directory = await repository({
    '.env.audit': 'NONPUBLIC_FIXTURE_VALUE',
    'notes.md': 'Portable notes',
  });
  await chmod(join(directory, '.env.audit'), 0);
  await symlink(join(directory, '.env.audit'), join(directory, 'external-link'));
  execFileSync('git', ['add', '--', 'external-link'], { cwd: directory });
  const result = check(directory);
  expect(result.status).toBe(1);
  expect(result.output).toContain('.env.audit: runtime environment file must not be tracked');
  expect(result.output).toContain('external-link: absolute symlink target is machine-specific');
  expect(result.output).not.toContain('NONPUBLIC_FIXTURE_VALUE');
  expect(result.output).not.toContain('EACCES');
});

it('accepts portable references and public attribution while leaving untracked local files alone', async () => {
  const directory = await repository({
    'notes.md':
      'See src/Core/Bitcoin/network.ts, use os.homedir(), or open http://127.0.0.1:3001.\nUpstream Author <author@example.org>\nKeyboard arrow/Home/End navigation.',
    '.env.example': 'BITCOIN_RPC_PASSWORD=replace-me',
  });
  await writeFile(join(directory, '.env.untracked'), 'LOCAL_FIXTURE_VALUE');
  await symlink('notes.md', join(directory, 'relative-link'));
  execFileSync('git', ['add', '--', 'relative-link'], { cwd: directory });
  expect(check(directory).status).toBe(0);
});
