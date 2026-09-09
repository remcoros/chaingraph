import { expect, test } from '@playwright/test';
import path from 'node:path';
import { decryptWorkspace } from '../../src/lib/crypto';
import type { Workspace } from '../../src/domain/types';

// Targeted public-demo retest. Uses the existing preview and read-only backend.
const password = 'Throwaway-WQF-2026';
const artifact = path.resolve('artifacts/wallet-clean-qf');
for (const phone of [false, true]) {
  test(`Wallet QF findings ${phone ? 'phone' : 'desktop'}`, async ({ page }) => {
    test.skip(
      process.env.CHAINGRAPH_QF_RETEST !== '1',
      'Opt-in retest with preserved public review artifacts and a read-only backend',
    );
    await page.setViewportSize(phone ? { width: 390, height: 844 } : { width: 1440, height: 900 });
    await page.addInitScript(() => localStorage.setItem('chaingraph.tour.seen', '1'));
    await page.goto('/');
    await page
      .locator('input[type=file]')
      .first()
      .setInputFiles(path.join(artifact, 'demo-review.chaingraph'));
    await page.getByLabel('Password', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Open workspace', exact: true }).click();
    await page.getByText('Wallet', { exact: true }).click();
    await expect(page.getByRole('button', { name: 'Notes', exact: true })).toBeVisible();
    const suffix = phone ? 'phone' : 'desktop';
    await page.screenshot({ path: path.join(artifact, `screenshots/fix-after-${suffix}.png`) });

    await page.getByRole('button', { name: 'Transactions', exact: true }).click();
    await page.getByLabel('Filter wallet records').fill('Demo wallet spending hop 1');
    await page.getByLabel('Review state filter').selectOption('open');
    await expect(page.getByLabel('Review state filter').locator('option:checked')).toHaveText(
      'To review (0)',
    );
    await expect(page.getByText('No records match these filters.', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Clear wallet filters' }).click();
    await expect(page.getByLabel('Filter wallet records')).toHaveValue('');
    await expect(page.getByLabel('Review state filter')).toHaveValue('all');
    await page.getByLabel('Filter wallet records').fill('Demo wallet spending hop 1');
    await page
      .locator('.wallet-row-button')
      .filter({ hasText: 'Demo wallet spending hop 1' })
      .click();
    await expect(page.getByRole('button', { name: 'Mark reviewed', exact: true })).toHaveCount(0);
    await page.screenshot({
      path: path.join(artifact, `screenshots/fix-transactions-${suffix}.png`),
    });

    await page.getByRole('button', { name: 'Notes', exact: true }).click();
    const editor = page.getByRole('dialog', { name: 'Edit notes', exact: true });
    const note = page.getByLabel('Entity notes', { exact: true });
    await expect(note).toBeFocused();
    const prior = await note.inputValue();
    const marker = `WQF direct note ${suffix}\nPublic evidence only`;
    await note.fill(marker);
    await page.keyboard.press('Tab');
    await expect(editor.getByRole('button', { name: 'Done', exact: true })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(editor.getByRole('button', { name: 'Close notes editor' })).toBeFocused();
    await page.screenshot({ path: path.join(artifact, `screenshots/fix-notes-${suffix}.png`) });
    await page.keyboard.press('Escape');
    await expect(editor).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Notes', exact: true })).toBeFocused();
    await page.getByRole('button', { name: 'Show in Graph', exact: true }).click();
    await expect(page.getByLabel('Node notes', { exact: true })).toHaveValue(marker);
    await page.getByText('Wallet', { exact: true }).click();
    await expect(page.getByLabel('Filter wallet records')).toHaveValue(
      'Demo wallet spending hop 1',
    );
    // Undo survives cached Graph navigation. Phone exposes it in workspace actions.
    if (phone) await page.getByRole('button', { name: 'Workspace menu', exact: true }).click();
    await page
      .getByRole('button', { name: 'Undo workspace change', exact: true })
      .filter({ visible: true })
      .click();
    await page.getByRole('button', { name: 'Notes', exact: true }).click();
    await expect(note).toHaveValue(prior);
    await note.fill(marker);
    await editor.getByRole('button', { name: 'Done', exact: true }).click();

    // Verify the stored encrypted envelope, not merely the live React state.
    await expect
      .poll(async () => {
        const entries = await page.evaluate(() =>
          JSON.parse(localStorage.getItem('chaingraph.encrypted-workspaces.v1') ?? '[]'),
        );
        if (!entries[0]) return false;
        const stored = (await decryptWorkspace(entries[0].envelope, password)) as Workspace;
        return Object.values(stored.annotations).some((annotation) => annotation.note === marker);
      })
      .toBe(true);
    await page.reload();
    await page.locator('.saved-row').filter({ hasText: 'WQF Touch Demo' }).click();
    await page.getByLabel('Password', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Unlock workspace', exact: true }).click();
    await page.getByText('Wallet', { exact: true }).click();
    await page.getByRole('button', { name: 'Transactions', exact: true }).click();
    await page.getByLabel('Filter wallet records').fill('Demo wallet spending hop 1');
    await page.getByRole('button', { name: 'Notes', exact: true }).click();
    await expect(note).toHaveValue(marker);
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Sources', exact: true }).click();
    await page.getByLabel('Filter wallet records').fill('l4fady7q2f');
    await page.locator('.wallet-row-button').first().click();
    await expect(page.locator('.wallet-match-value')).toContainText('No match in this wallet');
    await expect(page.getByText('Unresolved script', { exact: true })).toHaveCount(0);
    await page.screenshot({ path: path.join(artifact, `screenshots/fix-source-${suffix}.png`) });
    await page.getByRole('button', { name: 'Notes', exact: true }).click();
    await note.fill(`WQF source ${suffix}`);
    // Clicking another section closes the portal and cannot transfer the draft.
    await page.getByRole('button', { name: 'Transactions', exact: true }).click();
    await expect(editor).toHaveCount(0);
    await page.getByLabel('Filter wallet records').fill('Demo wallet spending hop 1');
    await page.getByRole('button', { name: 'Notes', exact: true }).click();
    await expect(note).toHaveValue(marker);
    await note.fill('');
    await expect(note).toHaveValue('');
    await page.keyboard.press('Escape');
    if (phone) await page.getByRole('button', { name: 'Workspace menu', exact: true }).click();
    await page
      .getByRole('button', { name: 'Undo workspace change', exact: true })
      .filter({ visible: true })
      .click();
    await page.getByRole('button', { name: 'Notes', exact: true }).click();
    await expect(note).toHaveValue(marker);
    await page.keyboard.press('Escape');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  });
}
