import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
const lock = JSON.parse(await readFile('package-lock.json', 'utf8'));
const sections = [
  '# Third-party notices\n\nChaingraph application code is MIT-licensed. The following notices belong to installed runtime dependencies and locally served fonts. Generated with `npm run licenses` from the lockfile and installed package license files. Research-only projects are not included because their source is not shipped.\n',
];
for (const [folder, pkg] of Object.entries(lock.packages).sort(([a], [b]) => a.localeCompare(b))) {
  if (!folder || pkg.dev) continue;
  let names;
  try {
    names = await readdir(folder);
  } catch {
    continue;
  }
  const files = names.filter((n) => /^(licen[sc]e|copying|ofl)(\.|$)/i.test(n));
  if (!files.length) continue;
  sections.push(
    `## ${folder.replace(/^node_modules\//, '')} ${pkg.version}\n\nDeclared license: ${pkg.license ?? 'see notice below'}\n`,
  );
  for (const name of files) {
    const text = await readFile(path.join(folder, name), 'utf8');
    sections.push(
      `\n\`\`\`text\n${text
        .replace(/\r\n?/g, '\n')
        .split('\n')
        .map((line) => line.trimEnd())
        .join('\n')
        .trim()}\n\`\`\`\n`,
    );
  }
}
await writeFile('THIRD_PARTY_NOTICES.md', sections.join('\n'));
console.log('Runtime dependency notices regenerated.');
