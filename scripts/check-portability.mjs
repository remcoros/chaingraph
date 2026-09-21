import { execFileSync } from 'node:child_process';
import { lstat, readFile, readlink } from 'node:fs/promises';
import { basename, dirname, isAbsolute, relative, resolve } from 'node:path';

// Scan tracked files only. Never echo matched contents or open runtime environment files.
const files = execFileSync('git', ['ls-files', '-z'], {
  encoding: 'utf8',
  maxBuffer: 16 * 1024 * 1024,
})
  .split('\0')
  .filter(Boolean);
const userHome =
  /(?:^|[\s"'`(=])(?:\/(?:home|Users)\/[^/\s"'`<>]+(?:\/|(?=$|[\s"'`<>]))|[A-Za-z]:[\\/](?:[Uu]sers|Documents and Settings)[\\/][^\\/\s"'`<>]+(?:[\\/]|(?=$|[\s"'`<>])))/;
const findings = [];
for (const file of files) {
  if (/^\.env(?:\.|$)/.test(basename(file)) && basename(file) !== '.env.example') {
    findings.push(`${file}: runtime environment file must not be tracked`);
    continue;
  }
  let info;
  try {
    info = await lstat(file);
  } catch (error) {
    if (error.code === 'ENOENT') continue; // A tracked deletion awaiting its commit.
    throw error;
  }
  if (info.isSymbolicLink()) {
    const target = await readlink(file);
    const resolvedTarget = resolve(dirname(file), target);
    if (
      isAbsolute(target) ||
      /^[A-Za-z]:[\\/]/.test(target) ||
      relative(process.cwd(), resolvedTarget).startsWith('..')
    )
      findings.push(`${file}: symlink target escapes the repository`);
    continue; // Inspect the link, never read a possibly private external target.
  }
  if (!info.isFile()) continue;
  const bytes = await readFile(file);
  if (bytes.includes(0)) continue;
  const lines = bytes.toString('utf8').split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    if (userHome.test(lines[i])) findings.push(`${file}:${i + 1}: hardcoded user-home path`);
  }
}
if (findings.length) {
  console.error(findings.join('\n'));
  process.exitCode = 1;
} else {
  console.log(`Portability check passed for ${files.length} tracked paths.`);
}
