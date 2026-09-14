import { formatBitcoinAmount } from '../src/Domain/Chain/amountFormat';
import { expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { analysisTools } from '../src/Domain/Analysis/analysis';
import { newWorkspace, parseWorkspace } from '../src/Domain/Workspace/workspace';
import { AnalysisWorkbenchContent } from '../src/App/Workspace/Workbenches/Analysis/AnalysisWorkbenchContent';

function feeExample() {
  const w = newWorkspace('Public fee example', 'mainnet');
  const txid = 'a'.repeat(64);
  w.transactions[txid] = {
    txid,
    vin: [
      {
        txid: 'b'.repeat(64),
        vout: 0,
        prevout: {
          value: 0.0000514,
          scriptPubKey: { hex: '0014' + '11'.repeat(20) },
        },
      },
    ],
    vout: [{ n: 0, value: 0.00002, scriptPubKey: { hex: '0014' + '22'.repeat(20) } }],
    vsize: 110,
  };
  w.findings = analysisTools.find((tool) => tool.id === 'value-flow')!.run(w);
  return w;
}

it('explains the small-transfer fee example and saves guidance with the finding', () => {
  const w = feeExample();
  expect(w.findings[0]).toMatchObject({
    title: `Network fee: ${formatBitcoinAmount(3_140)}`,
    kind: 'observation',
    description: expect.stringContaining(
      `larger than the ${formatBitcoinAmount(2_000)} left after the fee`,
    ),
    details: expect.stringContaining('28.55 sat/vB'),
    guidance: { kind: 'tip', text: expect.stringContaining('Before sending a small amount') },
  });
  expect(parseWorkspace(JSON.parse(JSON.stringify(w))).findings).toEqual(w.findings);
  delete w.findings[0].guidance;
  delete w.findings[0].details;
  expect(parseWorkspace(w).findings[0].description).toBe(w.findings[0].description);
});

it('renders guidance and one reference per transaction, with no scan totals in finding details', () => {
  const workspace = feeExample();
  const html = renderToStaticMarkup(
    createElement(AnalysisWorkbenchContent, {
      workspace,
      active: true,
      onFindings: () => {},
      onRecovered: () => {},
      onGraph: () => {},
    }),
  );
  expect(html).toContain('aria-label="Tip"');
  expect(html).toContain('scan-guidance tip');
  expect(html).toContain('<summary>Details</summary>');
  expect(html).not.toContain('Method coverage');
  expect(html).not.toContain('Affected entities');
  for (const txid of ['a'.repeat(64), 'b'.repeat(64)])
    expect(html.split(`aria-label="Show transaction ${txid} on graph"`)).toHaveLength(2);
});
