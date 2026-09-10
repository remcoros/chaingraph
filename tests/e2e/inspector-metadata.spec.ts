import { expect, test, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { newWorkspace } from '../../src/domain/workspace';
import { deriveAddresses } from '../../src/lib/wallet';
import { decryptWorkspace } from '../../src/lib/crypto';
import type { Workspace } from '../../src/domain/types';
import {
  mockBitcoin,
  PUBLIC_ZPUB,
  RECEIVE_ADDRESS,
  transactions,
  TX_FUNDING,
  TX_SPENDING,
} from '../fixtures/bitcoin';
import { openFixtureWorkspace } from '../fixtures/open-workspace';

const password = 'public-inspector-metadata-fixture';
const outputId = `out:${TX_FUNDING}:0`;
const walletName =
  'Public BIP84 wallet for personal research and carefully separated long-term savings';
const tagName = 'ResearchWithAnIntentionallyLongUnbrokenTagNameToExerciseNarrowInspectorWrapping';

function fixture(selectionId = outputId) {
  const workspace = newWorkspace('Inspector metadata fixture', 'mainnet');
  workspace.transactions = structuredClone(transactions);
  workspace.wallets = [
    {
      id: '40000000-0000-4000-8000-000000000004',
      name: walletName,
      key: PUBLIC_ZPUB,
      scriptType: 'p2wpkh',
      color: '#27c4a7',
      addresses: deriveAddresses(PUBLIC_ZPUB, 'mainnet', 'p2wpkh', 0, 0, 1),
    },
  ];
  workspace.view = {
    ...workspace.view,
    workbench: 'graph',
    leftTab: 'entities',
    rightTab: 'inspect',
    mobilePanel: 'right',
    selectionId,
    prefetchDepth: 0,
  };
  return workspace;
}

async function noOverflow(page: Page) {
  for (const selector of ['.selection-wallet', '.annotation-editor', '.selected-tags']) {
    expect(
      await page
        .locator(selector)
        .evaluate((element) => element.scrollWidth <= element.clientWidth),
    ).toBe(true);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}

for (const width of [1440, 390]) {
  test(`inspector metadata remains compact and survives immediate lock at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1000 });
    const calls = await mockBitcoin(page, false);
    await openFixtureWorkspace(page, fixture(), password);
    const annotations = page.getByRole('region', { name: 'Annotations', exact: true });
    const tags = annotations.getByRole('region', { name: 'Tags', exact: true });
    const association = page.getByRole('region', { name: 'Wallet', exact: true });
    await expect(association).toContainText(walletName);
    await expect(association).toContainText('Address/script match');
    await expect(association.getByRole('heading', { name: 'Wallet', exact: true })).toBeVisible();
    const annotationsBox = (await annotations.boundingBox())!;
    expect((await association.boundingBox())!.y).toBeGreaterThanOrEqual(
      annotationsBox.y + annotationsBox.height,
    );
    await expect(annotations).not.toContainText(walletName);
    await expect(tags.locator('.selected-tag-chip')).toHaveCount(0);
    await noOverflow(page);

    const icon = annotations.getByRole('button', { name: 'Node icon: None', exact: true });
    const bookmark = annotations.getByLabel('Bookmark', { exact: true });
    const iconBox = (await icon.boundingBox())!;
    const bookmarkBox = (await annotations.locator('.annotation-bookmark').boundingBox())!;
    expect(Math.abs(iconBox.height - bookmarkBox.height)).toBeLessThanOrEqual(1);
    expect(iconBox.height).toBeGreaterThanOrEqual(24);
    expect(iconBox.height).toBeLessThanOrEqual(30);
    expect(Math.abs(iconBox.y - bookmarkBox.y)).toBeLessThanOrEqual(1);
    await mkdir('artifacts/inspector-metadata', { recursive: true });
    await association.evaluate((element) => element.scrollIntoView({ block: 'end' }));
    await page.locator('.inspector-scroll').evaluate((element) => {
      element.scrollTop += 64;
    });
    await page.screenshot({ path: `artifacts/inspector-metadata/empty-${width}.png` });

    const label = annotations.getByLabel('Node label', { exact: true });
    const notes = annotations.getByLabel('Node notes', { exact: true });
    await label.fill('Reviewed incoming funds');
    await page.keyboard.press('Tab');
    await expect(notes).toBeFocused();
    await notes.fill('Public fixture annotation');
    await bookmark.check();
    await icon.click();
    await page
      .getByRole('dialog', { name: 'Choose node icon' })
      .getByRole('button', { name: 'Cold storage', exact: true })
      .click();
    const selectedIcon = annotations.getByRole('button', {
      name: 'Node icon: Cold storage',
      exact: true,
    });
    await expect(selectedIcon).toBeFocused();
    const add = tags.getByRole('button', { name: 'Add or choose tags', exact: true });
    await add.click();
    const picker = page.getByRole('dialog', { name: 'Tag selected records' });
    await expect(picker.getByLabel('Find or create tag')).toBeFocused();
    await picker.getByLabel('Find or create tag').fill(tagName);
    await picker.getByRole('button', { name: 'Color 3', exact: true }).click();
    await picker.getByLabel('Find or create tag').press('Enter');
    await expect(picker).toHaveCount(0);
    await expect(add).toBeFocused();
    await expect(
      tags.getByRole('button', { name: `Edit assignment for ${tagName}`, exact: true }),
    ).toBeVisible();
    await add.click();
    await picker.getByLabel('Find or create tag').fill('Personal');
    await picker.getByLabel('Find or create tag').press('Enter');
    await expect(picker).toHaveCount(0);
    const chips = tags.locator('.selected-tag-chip');
    await expect(chips).toHaveCount(2);
    const chipsBox = (await tags.locator('.selected-tag-chips').boundingBox())!;
    for (const chip of await chips.all()) {
      const box = (await chip.boundingBox())!;
      expect(Math.abs(box.width - chipsBox.width)).toBeLessThanOrEqual(1);
      expect(Math.abs(box.x - chipsBox.x)).toBeLessThanOrEqual(1);
    }
    await noOverflow(page);
    await association.evaluate((element) => element.scrollIntoView({ block: 'end' }));
    await page.locator('.inspector-scroll').evaluate((element) => {
      element.scrollTop += 64;
    });
    await page.screenshot({ path: `artifacts/inspector-metadata/populated-${width}.png` });

    // Lock without waiting for the debounced save: flush must include the last edit.
    await notes.fill('Final edit survives immediate lock');
    await page.getByRole('button', { name: 'Workspace menu', exact: true }).click();
    await page.getByRole('button', { name: 'Lock workspace', exact: true }).click();
    await expect(page.locator('.saved-row')).toBeVisible();
    const stored = await page.evaluate(() =>
      localStorage.getItem('chaingraph.encrypted-workspaces.v1')!,
    );
    expect(stored).not.toContain('Final edit survives immediate lock');
    const saved = (await decryptWorkspace(JSON.parse(stored)[0].envelope, password)) as Workspace;
    expect(saved.annotations[outputId]).toEqual({
      label: 'Reviewed incoming funds',
      note: 'Final edit survives immediate lock',
      icon: '❄️',
      bookmarked: true,
    });
    expect(saved.tags?.find((tag) => tag.name === tagName)).toMatchObject({
      color: '#9c9aed',
      nodeIds: [outputId],
    });
    await page.locator('.saved-row').click();
    const unlock = page.getByRole('dialog', { name: 'Unlock workspace' });
    await unlock.getByLabel('Password', { exact: true }).fill(password);
    await unlock.getByRole('button', { name: 'Unlock workspace', exact: true }).click();
    await expect(label).toHaveValue('Reviewed incoming funds');
    await expect(notes).toHaveValue('Final edit survives immediate lock');
    await expect(bookmark).toBeChecked();
    await expect(selectedIcon).toBeVisible();
    await expect(
      tags.getByRole('button', { name: `Edit assignment for ${tagName}`, exact: true }),
    ).toBeVisible();
    await notes.fill('Latest note survives opening its wallet');
    await association.getByRole('button', { name: walletName, exact: true }).click();
    await expect(
      page.locator('.right-panel').getByRole('heading', { name: walletName, exact: true }),
    ).toBeVisible();
    await expect(page.locator('.right-panel')).toContainText('WATCH-ONLY WALLET');
    if (width === 390)
      await page
        .locator('.mobile-switch')
        .getByRole('button', { name: 'Browse', exact: true })
        .click();
    await page.getByLabel('Entity type').selectOption('output');
    await page.getByLabel('Filter graph entities').fill(`${TX_FUNDING}:0`);
    await page.locator('.entity-list .entity-row').first().click();
    await expect(label).toHaveValue('Reviewed incoming funds');
    await expect(notes).toHaveValue('Latest note survives opening its wallet');
    await expect(bookmark).toBeChecked();
    await expect(selectedIcon).toBeVisible();
    await expect(
      tags.getByRole('button', { name: 'Edit assignment for Personal', exact: true }),
    ).toBeVisible();
    expect(calls).toHaveLength(0);
  });
}

test('wallet association distinguishes related transactions and leaves unmatched outputs unassigned', async ({
  page,
}) => {
  const calls = await mockBitcoin(page, false);
  await openFixtureWorkspace(page, fixture(`tx:${TX_SPENDING}`), password);
  const association = page.getByRole('region', { name: 'Wallet', exact: true });
  await expect(association).toContainText('Matching input or output');
  await association.getByRole('img', { name: 'About wallet association' }).focus();
  await expect(page.getByRole('tooltip')).toContainText(
    'does not assign the whole transaction to that wallet',
  );
  await page.keyboard.press('Escape');
  await expect(page.getByRole('tooltip')).toHaveCount(0);
  await page.getByLabel('Entity type').selectOption('output');
  await page.getByLabel('Filter graph entities').fill(`${TX_FUNDING}:1`);
  await page.locator('.entity-list .entity-row').first().click();
  await expect(page.locator(`.selection-heading code[title="${TX_FUNDING}:1"]`)).toBeVisible();
  await expect(association).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Annotations', exact: true })).toBeVisible();
  expect(calls).toHaveLength(0);
});

test('tag bins remove only the chosen memberships and disclose inherited address scope', async ({
  page,
}) => {
  const workspace = fixture();
  const otherOutput = `out:${TX_FUNDING}:1`;
  const addressId = `addr:${RECEIVE_ADDRESS}`;
  workspace.tags = [
    {
      id: '50000000-0000-4000-8000-000000000005',
      name: 'Direct group',
      color: '#65cbbb',
      nodeIds: [outputId, otherOutput],
    },
    {
      id: '60000000-0000-4000-8000-000000000006',
      name: 'Address group',
      color: '#9c9aed',
      nodeIds: [outputId, addressId, otherOutput],
    },
  ];
  const calls = await mockBitcoin(page, false);
  await openFixtureWorkspace(page, workspace, password);
  const tags = page
    .getByRole('region', { name: 'Annotations', exact: true })
    .getByRole('region', { name: 'Tags', exact: true });
  const add = tags.getByRole('button', { name: 'Add or choose tags', exact: true });
  await tags
    .getByRole('button', { name: 'Remove Direct group from selection', exact: true })
    .click();
  await expect(
    tags.getByRole('button', { name: 'Edit assignment for Direct group', exact: true }),
  ).toHaveCount(0);
  await expect(add).toBeFocused();
  const dialog = page.getByRole('dialog', { name: 'Remove address tag', exact: true });
  await expect(dialog).toHaveCount(0);

  const removeAddress = tags.getByRole('button', {
    name: 'Remove Address group from selection',
    exact: true,
  });
  await removeAddress.click();
  await expect(dialog).toContainText('also affects the address’s other outputs');
  await expect(dialog.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused();
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(removeAddress).toBeFocused();
  await removeAddress.click();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(removeAddress).toBeFocused();
  await expect(
    tags.getByRole('button', { name: 'Edit assignment for Address group', exact: true }),
  ).toBeVisible();
  await removeAddress.click();
  await dialog.getByRole('button', { name: 'Remove from address + outputs', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(tags.locator('.selected-tag-chip')).toHaveCount(0);
  await expect(add).toBeFocused();

  // Both definitions and unrelated memberships survive an immediate encrypted save.
  await page.getByRole('button', { name: 'Workspace menu', exact: true }).click();
  await page.getByRole('button', { name: 'Lock workspace', exact: true }).click();
  await expect(page.locator('.saved-row')).toBeVisible();
  const stored = await page.evaluate(() =>
    localStorage.getItem('chaingraph.encrypted-workspaces.v1')!,
  );
  const saved = (await decryptWorkspace(JSON.parse(stored)[0].envelope, password)) as Workspace;
  expect(saved.tags).toEqual(workspace.tags.map((tag) => ({ ...tag, nodeIds: [otherOutput] })));
  expect(calls).toHaveLength(0);
});
