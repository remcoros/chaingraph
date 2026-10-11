// @vitest-environment jsdom
import { useState } from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { createWorkspace } from '../../../Core/Workspace/createWorkspace';
import {
  defaultLabelExportOptions,
  defaultLabelImportOptions,
  inspectLabels,
  planLabelExport,
  planLabelImport,
  type LabelExportPlan,
} from '../../../Core/Workspace/Annotations/labels';
import { parseExtendedPublicKey } from '../../../Core/Bitcoin';
import { PUBLIC_ZPUB } from '../../../../tests/fixtures/bitcoin';
import { ExportFilePreview, ImportChanges, TransferOutcomes } from './LabelTransferReview';

afterEach(cleanup);
const annotation = (label: string) => ({ label, note: '', icon: '', bookmarked: false });

function FilePreview({ plan }: { plan: LabelExportPlan }) {
  const [view, setView] = useState<'table' | 'jsonl'>('table');
  return <ExportFilePreview plan={plan} view={view} onViewChange={setView} />;
}

it('reviews the exact file in order, retaining the same record range when switching views', () => {
  const workspace = createWorkspace('Public preview fixture', 'mainnet');
  for (let n = 1; n <= 9; n++)
    workspace.annotations.entities[`tx:${n.toString(16).padStart(64, '0')}`] = annotation(
      n === 1 ? 'Shop "payment"\nC:\\labels\t💰' : `Transaction ${n}`,
    );
  workspace.annotations.entities[`xpub:${PUBLIC_ZPUB}`] = annotation('A longer keystore label');
  const plan = planLabelExport(workspace, {
    ...defaultLabelExportOptions(),
    profile: 'sparrow',
    includeKeyLabels: true,
    shorten: true,
  });
  const lines = plan.content.split('\n');
  expect(lines).toHaveLength(10);
  expect(plan.textChanges).toHaveLength(1);
  render(<FilePreview plan={plan} />);
  const table = screen.getByRole('table', { name: 'Exported JSONL fields' });
  expect(
    within(table)
      .getAllByRole('columnheader')
      .map((cell) => cell.textContent),
  ).toEqual(['type', 'ref', 'label']);
  const first = JSON.parse(lines[0]);
  expect(within(table).getByText(first.ref)).toBeTruthy();
  expect(within(table).getByText(first.label, { normalizer: (text) => text })).toBeTruthy();
  expect(screen.getByText('Records 1–8 of 10')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'JSONL' }));
  const firstPage = screen.getByLabelText('Exported JSONL lines').textContent;
  expect(firstPage).toBe(lines.slice(0, 8).join('\n'));
  fireEvent.click(screen.getByRole('button', { name: 'Next records' }));
  const secondPage = screen.getByLabelText('Exported JSONL lines').textContent;
  expect(secondPage).toBe(lines.slice(8).join('\n'));
  expect(`${firstPage}\n${secondPage}`).toBe(plan.content);
  fireEvent.click(screen.getByRole('button', { name: 'Table' }));
  expect(screen.getByText('Records 9–10 of 10')).toBeTruthy();
  const canonicalKey = parseExtendedPublicKey(PUBLIC_ZPUB, 'mainnet').bip32Key;
  expect(
    within(screen.getByRole('table', { name: 'Exported JSONL fields' })).getByText(canonicalKey),
  ).toBeTruthy();
  expect(
    within(screen.getByRole('table', { name: 'Exported JSONL fields' })).queryByText(PUBLIC_ZPUB),
  ).toBeNull();
  fireEvent.click(screen.getByText('Text changes (1)'));
  expect(screen.getByText('A longer keystore label')).toBeTruthy();
  expect(screen.getAllByText('A longer keystor')).toHaveLength(2);
});

it('shows repeated BTCPay tag records as separate actual file rows', () => {
  const workspace = createWorkspace('Tag fixture', 'mainnet');
  const id = `out:${'a'.repeat(64)}:7`;
  workspace.annotations.tags = ['business', 'reviewed'].map((name) => ({
    id: crypto.randomUUID(),
    name,
    color: '#72b7d2',
    nodeIds: [id],
  }));
  const plan = planLabelExport(workspace, { ...defaultLabelExportOptions(), profile: 'btcpay' });
  render(<FilePreview plan={plan} />);
  const rows = within(screen.getByRole('table')).getAllByRole('row').slice(1);
  expect(rows.map((row) => within(row).getAllByRole('cell')[0].textContent)).toEqual([
    'output',
    'output',
  ]);
  expect(screen.getAllByText(`${'a'.repeat(64)}:7`)).toHaveLength(2);
  expect(screen.getByText('business')).toBeTruthy();
  expect(screen.getByText('reviewed')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'JSONL' }));
  expect(screen.getByLabelText('Exported JSONL lines').textContent).toBe(plan.content);
});

it('does not show a pretend file when the export is blocked', () => {
  const workspace = createWorkspace('Keeper fixture', 'mainnet');
  workspace.annotations.entities[`tx:${'a'.repeat(64)}`] = annotation('Example');
  const plan = planLabelExport(workspace, { ...defaultLabelExportOptions(), profile: 'keeper' });
  expect(plan.blocked).toBeTruthy();
  render(<FilePreview plan={plan} />);
  expect(screen.queryByRole('table')).toBeNull();
  expect(screen.queryByRole('button', { name: 'JSONL' })).toBeNull();
});

it('explains skipped entries, protected text and already matching values as different outcomes', () => {
  const workspace = createWorkspace('Import review fixture', 'mainnet');
  const txid = 'a'.repeat(64),
    other = 'b'.repeat(64);
  workspace.annotations.entities[`tx:${txid}`] = annotation('My current label');
  workspace.annotations.entities[`tx:${other}`] = annotation('Already saved');
  const content = [
    { type: 'tx', ref: txid, label: 'Incoming label', height: 800000, spendable: false },
    { type: 'tx', ref: other, label: 'Already saved' },
    { type: 'tx', ref: 'c'.repeat(64) },
    { type: 'input', ref: `${txid}:0`, label: 'Unsupported input' },
    { type: 'tx', ref: 'd'.repeat(64), label: 'New label' },
  ]
    .map((entry) => JSON.stringify(entry))
    .join('\n');
  const inspection = inspectLabels(content, 'mainnet');
  const plan = planLabelImport(workspace, inspection, defaultLabelImportOptions('mainnet'));
  render(
    <>
      <ImportChanges changes={plan.changes} />
      <TransferOutcomes issues={plan.issues} ignoredFields={inspection.ignoredFields} importing />
    </>,
  );
  expect(screen.getByRole('table', { name: 'Changes to apply' })).toBeTruthy();
  expect(screen.getByText('New label')).toBeTruthy();
  expect(screen.getByText('Existing text kept')).toBeTruthy();
  expect(screen.getByText('Already up to date')).toBeTruthy();
  expect(screen.getByText('Missing label text')).toBeTruthy();
  expect(screen.getByText('Unsupported label types')).toBeTruthy();
  fireEvent.click(screen.getByText('Existing text kept'));
  expect(screen.getByText('My current label')).toBeTruthy();
  expect(screen.getByText('Incoming label')).toBeTruthy();
  expect(
    screen.getByText('Choose “Replace with imported text” above to use the file’s text instead.'),
  ).toBeTruthy();
  expect(screen.getByText('Line 1 · Transaction')).toBeTruthy();
  fireEvent.click(screen.getByText('Unsupported label types'));
  expect(screen.getByText('Line 4 · Input')).toBeTruthy();
  fireEvent.click(screen.getByText('Other file fields'));
  expect(screen.getByText('Additional fields are not imported: height, spendable.')).toBeTruthy();
  expect(screen.queryByText('Transfer details')).toBeNull();
  expect(screen.queryByText('Reference')).toBeNull();
});
