import { readFile } from 'node:fs/promises';

const pkg = JSON.parse(await readFile('package.json', 'utf8'));
const lock = JSON.parse(await readFile('package-lock.json', 'utf8'));
const args = process.argv.slice(2);
if (args.length !== 0 && (args.length !== 2 || args[0] !== '--tag')) {
  throw new Error('Usage: node scripts/release-check.mjs [--tag vX.Y.Z]');
}
const version =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/.exec(
    pkg.version,
  );
if (!version || version[4]?.split('.').some((part) => /^0\d+$/.test(part))) {
  throw new Error('Package version must be a release SemVer.');
}
if (lock.version !== pkg.version || lock.packages[''].version !== pkg.version) {
  throw new Error('Package and lockfile versions differ.');
}
if (pkg.license !== 'MIT') throw new Error('Expected MIT application license.');
if (args.length && args[1] !== `v${pkg.version}`) {
  throw new Error(`Tag must exactly match v${pkg.version}.`);
}
const changelog = await readFile('CHANGELOG.md', 'utf8');
if (!changelog.includes(`## [${pkg.version}]`)) {
  throw new Error('CHANGELOG.md needs an entry for this version.');
}
for (const file of [
  'Dockerfile',
  '.dockerignore',
  'compose.yaml',
  'docs/deployment.md',
  'LICENSE',
]) {
  await readFile(file);
}
console.log(`Release metadata verified: v${pkg.version}. No publication performed.`);
