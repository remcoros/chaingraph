// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createWorkspace } from '../../../Core/Workspace/createWorkspace';
import {
  defaultLabelExportOptions,
  defaultLabelImportOptions,
  inspectLabels,
  planLabelExport,
  planLabelImport,
} from '../../../Core/Workspace/Annotations/labels';
import type { WorkspaceController } from '../useWorkspace';
import type { WorkspaceAnnotations } from './useAnnotations';
import { LabelExchangeDialog } from './LabelExchangeDialog';

beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function importFixture() {
  const activeWorkspace = createWorkspace('Public import fixture', 'mainnet');
  const origin = (branch: number) => `wpkh(xpub${'a'.repeat(105)}PC7PW6V/${branch}/*)`;
  const inspection = inspectLabels(
    [
      { type: 'tx', ref: 'a'.repeat(64), label: 'Conflict A', origin: origin(0) },
      { type: 'tx', ref: 'a'.repeat(64), label: 'Conflict B', origin: origin(1) },
      { type: 'tx', ref: 'b'.repeat(64), label: 'x'.repeat(256) },
      { type: 'tx', ref: 'c'.repeat(64), label: 'New label' },
    ]
      .map((entry) => JSON.stringify(entry))
      .join('\n'),
    'mainnet',
  );
  const options = defaultLabelImportOptions('mainnet');
  const plan = planLabelImport(activeWorkspace, inspection, options);
  const annotations = {
    labelTransfer: {
      kind: 'import',
      workspaceId: activeWorkspace.id,
      filename: 'public.jsonl',
      inspection,
      options,
    },
    importPlan: plan,
    importReviewPlan: plan,
    previewBusy: false,
    configureLabelImport: vi.fn(),
    closeLabelTransfer: vi.fn(),
    confirmLabelImport: vi.fn(),
    retryLabelPreview: vi.fn(),
  } as unknown as WorkspaceAnnotations;
  const workspace = {
    activeWorkspace,
    annotations,
    selection: { batch: { ids: [] } },
  } as unknown as WorkspaceController;
  return { workspace, annotations, plan, inspection, origin };
}

it('shows conflict candidates and distinguishing origin endings before choosing a winner', () => {
  const { workspace, origin } = importFixture();
  render(<LabelExchangeDialog workspace={workspace} />);
  fireEvent.click(screen.getByText('Conflicting labels'));
  expect(screen.getByText('Conflict A')).toBeTruthy();
  expect(screen.getByText('Conflict B')).toBeTruthy();
  expect(screen.getByText('Line 1 · Transaction')).toBeTruthy();
  expect(screen.getByText('Line 2 · Transaction')).toBeTruthy();
  expect(screen.getAllByText(origin(0))).toHaveLength(1);
  expect(screen.getAllByText(origin(1))).toHaveLength(1);
  const account = screen.getByRole('combobox', {
    name: 'Source account / origin',
  }) as HTMLSelectElement;
  const options = [...account.options].filter((option) => option.value.startsWith('wpkh'));
  expect(options[0].textContent).not.toBe(options[1].textContent);
  expect(options[0].textContent).toContain('/0/*)');
  expect(options[1].textContent).toContain('/1/*)');
  expect(screen.getByRole('option', { name: 'Skip conflicting entries' })).toBeTruthy();
  expect(screen.getByRole('option', { name: 'Use first entry in file' })).toBeTruthy();
  expect(screen.getByRole('option', { name: 'Use last entry in file' })).toBeTruthy();
});

it('retains review controls, disclosures and focus while invalidating an actionable import', async () => {
  const { workspace, annotations, plan } = importFixture();
  const view = render(<LabelExchangeDialog workspace={workspace} />);
  const details = screen.getByText('Text too long').closest('details')!;
  fireEvent.click(screen.getByText('Text too long'));
  await waitFor(() => expect(details.open).toBe(true));
  const conflict = screen.getByRole('combobox', { name: 'Conflicting values' });
  conflict.focus();
  fireEvent.change(conflict, { target: { value: 'first' } });
  expect(annotations.configureLabelImport).toHaveBeenCalledWith({ conflicts: 'first' });
  annotations.importPlan = undefined;
  annotations.previewBusy = true;
  annotations.labelTransfer = {
    ...annotations.labelTransfer!,
    options: { ...annotations.labelTransfer!.options, conflicts: 'first' },
  } as WorkspaceAnnotations['labelTransfer'];
  view.rerender(<LabelExchangeDialog workspace={workspace} />);
  expect(screen.getByRole('combobox', { name: 'Conflicting values' })).toBe(conflict);
  expect(document.activeElement).toBe(conflict);
  expect(screen.getByText('Text too long').closest('details')).toBe(details);
  expect(details.open).toBe(true);
  expect((screen.getByRole('button', { name: 'Apply import' }) as HTMLButtonElement).disabled).toBe(
    true,
  );
  expect(screen.getByText('Updating preview…')).toBeTruthy();
  annotations.previewBusy = false;
  annotations.importPlan = plan;
  view.rerender(<LabelExchangeDialog workspace={workspace} />);
  expect(document.activeElement).toBe(conflict);
  expect(details.open).toBe(true);
  const shorten = screen.getByRole('checkbox', { name: 'Shorten over-limit values' });
  shorten.focus();
  annotations.importPlan = undefined;
  annotations.previewBusy = true;
  view.rerender(<LabelExchangeDialog workspace={workspace} />);
  expect(screen.getByRole('checkbox', { name: 'Shorten over-limit values' })).toBe(shorten);
  expect(document.activeElement).toBe(shorten);
  // After the warning is resolved, reverting either setting must also preserve
  // its control while the next plan is being prepared.
  annotations.previewBusy = false;
  annotations.importPlan = { ...plan, issues: [] };
  annotations.importReviewPlan = annotations.importPlan;
  annotations.labelTransfer = {
    ...annotations.labelTransfer!,
    options: { ...annotations.labelTransfer!.options, shorten: true },
  } as WorkspaceAnnotations['labelTransfer'];
  view.rerender(<LabelExchangeDialog workspace={workspace} />);
  expect(screen.getByRole('checkbox', { name: 'Shorten over-limit values' })).toBe(shorten);
  annotations.importPlan = undefined;
  annotations.previewBusy = true;
  annotations.labelTransfer = {
    ...annotations.labelTransfer!,
    options: { ...annotations.labelTransfer!.options, shorten: false, conflicts: 'exclude' },
  } as WorkspaceAnnotations['labelTransfer'];
  view.rerender(<LabelExchangeDialog workspace={workspace} />);
  expect(screen.getByRole('checkbox', { name: 'Shorten over-limit values' })).toBe(shorten);
  expect(screen.getByRole('combobox', { name: 'Conflicting values' })).toBe(conflict);
  expect(document.activeElement).toBe(shorten);
});

it('offers retry without changing the selected file or settings after preview failure', () => {
  const { workspace, annotations } = importFixture();
  annotations.importPlan = undefined;
  annotations.importReviewPlan = undefined;
  annotations.previewError = "Couldn't prepare the preview. Retry with the same settings.";
  const transfer = annotations.labelTransfer;
  render(<LabelExchangeDialog workspace={workspace} />);
  fireEvent.click(screen.getByRole('button', { name: 'Retry preview' }));
  expect(annotations.retryLabelPreview).toHaveBeenCalledOnce();
  expect(annotations.labelTransfer).toBe(transfer);
  expect((screen.getByRole('button', { name: 'Apply import' }) as HTMLButtonElement).disabled).toBe(
    true,
  );
});

it('retains the exact export view and page while a replacement plan is pending', () => {
  const activeWorkspace = createWorkspace('Public export fixture', 'mainnet');
  for (let n = 0; n < 10; n++)
    activeWorkspace.annotations.entities[`tx:${n.toString(16).padStart(64, '0')}`] = {
      label: `Label ${n}`,
      note: '',
      icon: '',
      bookmarked: false,
    };
  const options = defaultLabelExportOptions();
  const plan = planLabelExport(activeWorkspace, options);
  const annotations = {
    labelTransfer: { kind: 'export', workspaceId: activeWorkspace.id, options },
    exportPlan: plan,
    exportReviewPlan: plan,
    previewBusy: false,
    closeLabelTransfer: vi.fn(),
  } as unknown as WorkspaceAnnotations;
  const workspace = {
    activeWorkspace,
    annotations,
    selection: { batch: { ids: [] } },
  } as unknown as WorkspaceController;
  const view = render(<LabelExchangeDialog workspace={workspace} />);
  fireEvent.click(screen.getByRole('button', { name: 'Next records' }));
  fireEvent.click(screen.getByRole('button', { name: 'JSONL' }));
  const raw = screen.getByLabelText('Exported JSONL lines');
  const expected = plan.content.split('\n').slice(8).join('\n');
  expect(raw.textContent).toBe(expected);
  expect(screen.getByText('Unencrypted JSONL')).toBeTruthy();
  annotations.exportPlan = undefined;
  annotations.previewBusy = true;
  view.rerender(<LabelExchangeDialog workspace={workspace} />);
  expect(screen.getByLabelText('Exported JSONL lines')).toBe(raw);
  expect(raw.textContent).toBe(expected);
  expect(screen.getByText('Records 9–10 of 10')).toBeTruthy();
  expect(
    (screen.getByRole('button', { name: 'Download JSONL' }) as HTMLButtonElement).disabled,
  ).toBe(true);
  annotations.exportPlan = { ...plan };
  annotations.exportReviewPlan = annotations.exportPlan;
  annotations.previewBusy = false;
  view.rerender(<LabelExchangeDialog workspace={workspace} />);
  expect(screen.getByLabelText('Exported JSONL lines').textContent).toBe(expected);
  expect(screen.getByText('Records 9–10 of 10')).toBeTruthy();
});

it('returns menu-launched dialogs to Workspace menu and wallet-launched dialogs to their trigger', () => {
  const { workspace } = importFixture();
  const controls = render(
    <>
      <button key="menu" aria-label="Workspace menu">
        Workspace
      </button>
      <button key="item">Menu item</button>
      <button key="wallet">Wallet labels</button>
    </>,
  );
  const menu = screen.getByRole('button', { name: 'Workspace menu' });
  // Menu items can already be gone before the dialog captures its invoker.
  menu.focus();
  menu.blur();
  expect(document.activeElement).toBe(document.body);
  const bodyDialog = render(<LabelExchangeDialog workspace={workspace} />);
  bodyDialog.unmount();
  expect(document.activeElement).toBe(menu);
  const item = screen.getByRole('button', { name: 'Menu item' });
  item.focus();
  const menuDialog = render(<LabelExchangeDialog workspace={workspace} />);
  controls.rerender(
    <>
      <button key="menu" aria-label="Workspace menu">
        Workspace
      </button>
      <button key="wallet">Wallet labels</button>
    </>,
  );
  menuDialog.unmount();
  expect(document.activeElement).toBe(menu);
  const wallet = screen.getByRole('button', { name: 'Wallet labels' });
  wallet.focus();
  const walletDialog = render(<LabelExchangeDialog workspace={workspace} />);
  walletDialog.unmount();
  expect(document.activeElement).toBe(wallet);
  controls.unmount();
});
