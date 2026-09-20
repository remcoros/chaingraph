// Synthetic placement workload only. No RPC, workspace storage or GPU measurement.
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { compactLayout } from '../src/App/Workspace/Workbenches/Graph/Renderer/compactLayout';
import type {
  LayoutRequest,
  Position,
} from '../src/App/Workspace/Workbenches/Graph/Renderer/flowLayout';
const output = 'artifacts/flow-renderer-v2/compact';
const baseline = process.argv
  .find((arg) => arg.startsWith('--baseline='))
  ?.slice('--baseline='.length);
const rendererDirectory = 'src/App/Workspace/Workbenches/Graph/Renderer';
await mkdir(output, { recursive: true });
let layout = compactLayout;
if (baseline) {
  const directory = path.join(output, 'benchmark-baseline');
  await mkdir(directory, { recursive: true });
  // Historical baselines can predate the source relocation.
  const baselineDirectory = execFileSync(
    'git',
    ['ls-tree', '--name-only', baseline, rendererDirectory],
    { encoding: 'utf8' },
  ).trim()
    ? rendererDirectory
    : 'src/components/graph';
  const files = execFileSync('git', ['ls-tree', '-r', '--name-only', baseline, baselineDirectory], {
    encoding: 'utf8',
  })
    .split('\n')
    .filter((file) => file.endsWith('.ts'));
  for (const file of files) {
    const destination = path.join(directory, path.relative(baselineDirectory, file));
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, execFileSync('git', ['show', `${baseline}:${file}`]));
  }
  layout = (await import(pathToFileURL(path.resolve(directory, 'compactLayout.ts')).href))
    .compactLayout;
}
const results = [];
for (const count of [720, 1500, 5000]) {
  const nodes = Array.from({ length: count }, (_, i) => ({
    id: `n${i}`,
    shape: 'sphere' as const,
    radius: 3.2,
  }));
  const previous: [string, Position][] = nodes.map((n, i) => [
    n.id,
    {
      x: (i % 25) * 18,
      y: (Math.floor(i / 25) % 20) * 18,
      z: Math.floor(i / 500) * 18,
    },
  ]);
  const links = nodes.slice(1).map((n, i) => ({ source: n.id, target: nodes[i].id }));
  const request: LayoutRequest = {
    revision: 1,
    nodes: [
      ...nodes,
      ...Array.from({ length: 12 }, (_, i) => ({
        id: `new${i}`,
        shape: 'box' as const,
        radius: 3.2,
      })),
    ],
    previous,
    links: [
      ...links,
      ...Array.from({ length: 12 }, (_, i) => ({ source: `n${i}`, target: `new${i}` })),
    ],
  };
  const milliseconds = [];
  for (let run = 0; run < 3; run++) {
    const start = performance.now();
    const result = layout(request);
    milliseconds.push(Math.round((performance.now() - start) * 10) / 10);
    if (result.positions.length !== count + 12) throw new Error('Placement lost observations.');
  }
  results.push({ existing: count, added: 12, milliseconds });
}
const json = JSON.stringify(results, null, 2);
console.log(json);
await writeFile(`${output}/${baseline ? 'before' : 'after'}-layout.json`, json);
