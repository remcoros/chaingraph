// Reports React Compiler coverage across the client source tree.
//
// The compiler silently skips any component or hook it cannot prove safe, so a
// build that succeeds tells us nothing about how much was actually memoized.
// This makes the bailouts visible and reviewable.
//
//   node scripts/check-react-compiler.mjs            summary
//   node scripts/check-react-compiler.mjs --verbose  every diagnostic
//   node scripts/check-react-compiler.mjs --max 40   fail above a bailout budget

import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { transformSync } from 'oxc-transform-react';

const root = path.join(import.meta.dirname, '..', 'src');
const verbose = process.argv.includes('--verbose');
const maxIndex = process.argv.indexOf('--max');
const budget = maxIndex === -1 ? undefined : Number(process.argv[maxIndex + 1]);

// Every known bailout is listed explicitly so fixes ratchet the baseline down.
// Do not add an entry without reviewing why the affected component or hook is
// safe to leave uncompiled.
const bailoutBaseline = new Map([
  ['src/App/Workspace/useWorkspace.tsx', new Map([['Cannot access refs during render', 2]])],
]);

function* sources(dir) {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) yield* sources(full);
    else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry) && !entry.endsWith('.worker.ts'))
      yield full;
  }
}

const byReason = new Map();
const observedBaseline = new Map();
let files = 0;
let compiled = 0;
let bailouts = 0;
const affected = [];

for (const file of sources(root)) {
  const source = readFileSync(file, 'utf8');
  // Only files that can contain components or hooks are worth reporting.
  if (!file.endsWith('.tsx') && !/\buse[A-Z]/.test(source)) continue;
  files++;
  const result = transformSync(file, source, {});
  const errors = result.errors ?? [];
  if (/compiler-runtime/.test(result.code)) compiled++;
  if (!errors.length) continue;
  bailouts += errors.length;
  const relative = path.relative(path.join(root, '..'), file);
  affected.push([relative, errors.length]);
  for (const error of errors) {
    const reason = error.message.replace(/\(BuildHIR[^)]*\)\s*/, '').slice(0, 72);
    byReason.set(reason, (byReason.get(reason) ?? 0) + 1);
    const fileReasons = observedBaseline.get(relative) ?? new Map();
    fileReasons.set(reason, (fileReasons.get(reason) ?? 0) + 1);
    observedBaseline.set(relative, fileReasons);
    if (verbose) {
      const offset = error.labels?.[0]?.start;
      const line = offset == null ? 0 : source.slice(0, offset).split('\n').length;
      console.log(`${relative}:${line}  ${reason}`);
    }
  }
}

console.log(`React Compiler: ${compiled}/${files} files emit memoization, ${bailouts} bailouts`);
if (byReason.size) {
  console.log('\nBailouts by reason:');
  for (const [reason, count] of [...byReason].sort((a, b) => b[1] - a[1]))
    console.log(`  ${String(count).padStart(3)}  ${reason}`);
}
if (affected.length) {
  console.log('\nFiles with bailouts:');
  for (const [file, count] of affected.sort((a, b) => b[1] - a[1]))
    console.log(`  ${String(count).padStart(3)}  ${file}`);
}

const baselineMismatches = [];
for (const [file, reasons] of observedBaseline) {
  for (const [reason, count] of reasons) {
    const expected = bailoutBaseline.get(file)?.get(reason) ?? 0;
    if (count !== expected)
      baselineMismatches.push(`${file}: ${reason}: observed ${count}, expected ${expected}`);
  }
}
for (const [file, reasons] of bailoutBaseline) {
  for (const [reason, expected] of reasons) {
    const observed = observedBaseline.get(file)?.get(reason) ?? 0;
    if (observed !== expected && !observedBaseline.get(file)?.has(reason))
      baselineMismatches.push(`${file}: ${reason}: observed ${observed}, expected ${expected}`);
  }
}

if (baselineMismatches.length) {
  console.error('\nReact Compiler bailout baseline changed:');
  for (const mismatch of baselineMismatches) console.error(`  ${mismatch}`);
}

let failed = baselineMismatches.length > 0;
if (budget !== undefined && bailouts > budget) {
  console.error(`\nBailout budget exceeded: ${bailouts} > ${budget}`);
  failed = true;
}
if (failed) process.exit(1);
