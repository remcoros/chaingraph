import { expect, test, type Page } from '@playwright/test';
import { mockBitcoin, TX_FUNDING, TX_SPENDING, transactions } from '../fixtures/bitcoin';
import { encryptWorkspace } from '../../src/lib/crypto';
import { newWorkspace } from '../../src/domain/workspace';

const password = 'icon-picker-test-passphrase';
async function openWorkspace(page: Page, icon = '') {
  const workspace = newWorkspace('Icon investigation', 'mainnet');
  workspace.transactions[TX_SPENDING] = transactions[TX_SPENDING];
  workspace.annotations[`tx:${TX_SPENDING}`] = {
    label: 'Chosen transaction',
    note: '',
    icon,
    bookmarked: false,
  };
  const envelope = await encryptWorkspace(workspace, password);
  await page.addInitScript(
    ({ id, envelope }) => {
      localStorage.setItem('chaingraph.tour.seen', '1');
      localStorage.setItem(
        'chaingraph.encrypted-workspaces.v1',
        JSON.stringify([{ id, savedAt: new Date().toISOString(), envelope }]),
      );
    },
    { id: workspace.id, envelope },
  );
  await mockBitcoin(page);
  await page.goto('/');
  await page.locator('.saved-row').click();
  const dialog = page.getByRole('dialog', { name: 'Unlock workspace' });
  await dialog.getByLabel('Password').fill(password);
  await dialog.getByRole('button', { name: 'Unlock workspace', exact: true }).click();
  await page.getByRole('button', { name: 'Entities', exact: true }).click();
  await page.getByLabel('Entity type').selectOption('transaction');
  await page.locator('.entity-list .entity-row').first().click();
}

test('icon palette supports selection, clearing, arrow keys, Escape and focus return', async ({
  page,
}) => {
  await openWorkspace(page);
  const trigger = page.getByRole('button', { name: /Node icon/ });
  await trigger.click();
  const picker = page.getByRole('dialog', { name: 'Choose node icon' });
  await expect(picker.getByRole('group', { name: 'Icon choices' }).getByRole('button')).toHaveCount(
    48,
  );
  await expect(picker.getByRole('button', { name: 'Star', exact: true })).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(picker.getByRole('button', { name: 'Diamond', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(picker).not.toBeVisible();
  await expect(trigger).toBeFocused();
  await trigger.click();
  await picker.getByRole('button', { name: 'Cold storage', exact: true }).click();
  await expect(trigger).toHaveAccessibleName('Node icon: Cold storage');
  await expect(trigger).toBeFocused();
  await page.getByRole('button', { name: 'Save context', exact: true }).click();
  await trigger.click();
  await picker.getByRole('button', { name: 'Clear icon', exact: true }).click();
  await expect(trigger).toHaveAccessibleName('Node icon: None');
});

test('an arbitrary imported icon stays selected until explicitly replaced or cleared', async ({
  page,
}) => {
  await openWorkspace(page, '🪐');
  const trigger = page.getByRole('button', { name: /Node icon/ });
  await expect(trigger).toContainText('🪐');
  await trigger.click();
  const picker = page.getByRole('dialog', { name: 'Choose node icon' });
  await expect(picker.getByRole('button', { name: 'Imported icon', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.keyboard.press('Escape');
  await page.getByLabel('Node notes').fill('Keep my imported icon');
  await page.getByRole('button', { name: 'Save context', exact: true }).click();
  await expect(trigger).toContainText('🪐');
});

test('a missing funding output can load its previous transaction and does not claim unspent status', async ({
  page,
}) => {
  await openWorkspace(page);
  await page.getByRole('button', { name: 'Entities', exact: true }).click();
  await page.getByLabel('Entity type').selectOption('output');
  await page.getByLabel('Filter graph entities').fill(`${TX_FUNDING}:0`);
  await page.locator('.entity-list .entity-row').first().click();
  await expect(
    page.getByRole('button', { name: 'Load previous transactions', exact: true }),
  ).toBeEnabled();
  await expect(page.locator('.selection-heading')).toContainText(
    '1 spending transaction is loaded for this output',
  );
  await page.getByRole('button', { name: 'Load previous transactions', exact: true }).click();
  await expect(page.locator('.statusbar')).toContainText('2 transactions');
});
