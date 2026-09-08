import { expect, test, type Page } from '@playwright/test';
import { encryptWorkspace } from '../../src/lib/crypto';
import { newWorkspace } from '../../src/domain/workspace';
import { mockBitcoin } from '../fixtures/bitcoin';

// Synthetic decoded transaction observations, not a serialized transaction or on-chain claim.
const txid = '0123456789abcdef'.repeat(4);
const password = 'public-op-return-ui-fixture';
const message =
  'Public Bitcoin ₿ message: ' +
  'Inputs become outputs, and this text remains selectable. '.repeat(3) +
  '<img src=x onerror=alert(1)> UTF-8 tail: café 😀';
const messageHex = Buffer.from(message, 'utf8').toString('hex');
const length = messageHex.length / 2;
const textScript = `6a4d${(length & 255).toString(16).padStart(2, '0')}${(length >> 8).toString(16).padStart(2, '0')}${messageHex}`;

async function openFixture(page: Page) {
  const workspace = newWorkspace('Public OP_RETURN fixture', 'mainnet');
  workspace.transactions[txid] = {
    txid,
    vin: [{ coinbase: '0101' }],
    vout: Array.from({ length: 13 }, (_, n) => ({
      n,
      value: 0,
      scriptPubKey: {
        hex: n === 12 ? textScript : n === 0 ? '6a03ff0041' : n === 1 ? '6a0341' : '6a',
        type: 'nulldata',
      },
    })),
  };
  const envelope = await encryptWorkspace(workspace, password);
  await page.addInitScript(
    ({ id, publicName, envelope }) => {
      localStorage.setItem('chaingraph.tour.seen', '1');
      localStorage.setItem(
        'chaingraph.encrypted-workspaces.v1',
        JSON.stringify([{ id, publicName, savedAt: new Date().toISOString(), envelope }]),
      );
    },
    { id: workspace.id, publicName: workspace.name, envelope },
  );
  const calls = await mockBitcoin(page, false);
  await page.goto('/');
  await page.locator('.saved-row').click();
  const unlock = page.getByRole('dialog', { name: 'Unlock workspace' });
  await unlock.getByLabel('Password', { exact: true }).fill(password);
  await unlock.getByRole('button', { name: 'Unlock workspace', exact: true }).click();
  await page.getByRole('button', { name: 'Entities', exact: true }).click();
  await page.getByLabel('Entity type', { exact: true }).selectOption('output');
  return calls;
}

async function selectOutput(page: Page, index: number) {
  await page.getByLabel('Filter graph entities').fill(`${txid}:${index}`);
  // The search for :1 also matches :10, :11 and :12; use the full stable entity ID.
  await page.locator(`.entity-list .entity-row[title="out:${txid}:${index}"]`).click();
  await expect(page.locator('.selection-heading .selection-facts')).toContainText('Outpoint');
}

test('shows bounded OP_RETURN text in the flow, with complete hover, selectable data and clipboard actions', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  const calls = await openFixture(page);
  await selectOutput(page, 12);
  const flowRow = page.locator('.transaction-row.is-selected');
  await expect(flowRow).toHaveCount(1);
  await expect(flowRow).toContainText('OP_RETURN');
  await expect(flowRow).not.toContainText('Non-address output');
  await expect(flowRow.getByRole('button', { name: 'Check output 12 for spends' })).toHaveCount(0);

  const inspector = page.locator('.selection-heading');
  const outpoint = inspector.locator('.selection-facts code');
  await expect(outpoint).toHaveCount(1);
  await expect(inspector.getByRole('button', { name: 'Copy outpoint', exact: true })).toHaveCount(
    1,
  );
  await expect(outpoint).toHaveAttribute('title', `${txid}:12`);
  await expect(outpoint).toHaveText(/…[0-9a-f]+:12$/);
  expect((await outpoint.innerText()).length).toBeLessThan(`${txid}:12`.length);
  await inspector.getByRole('button', { name: 'Copy outpoint', exact: true }).click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(`${txid}:12`);

  const data = inspector.locator('.op-return-data');
  const summary = data.locator('summary');
  await expect(summary).toHaveText(/^OP_RETURN Public Bitcoin ₿ message:.*…$/);
  expect((await summary.innerText()).length).toBeLessThan(message.length);
  await summary.hover();
  await expect(summary).toHaveAttribute('title', message);
  await summary.click();
  await expect(data).toContainText('UTF-8 text');
  await expect(data.locator('pre')).toHaveText(message);
  await expect(data.locator('img')).toHaveCount(0);
  await data.locator('pre').evaluate((element) => {
    const range = document.createRange();
    range.selectNodeContents(element);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
  });
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe(message);
  await data.getByRole('button', { name: 'Copy OP_RETURN data', exact: true }).click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(message);
  await data.getByRole('button', { name: 'Copy OP_RETURN data hex', exact: true }).click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(messageHex);
  await expect(inspector).toContainText('OP_RETURN · Unspendable output');
  expect(calls).toHaveLength(0);
  expect(errors).toEqual([]);
});

test('keeps binary and malformed OP_RETURN payloads as explicit hex instead of guessing a message', async ({
  page,
}) => {
  const calls = await openFixture(page);
  for (const fixture of [
    { index: 0, display: '0xff0041', warning: undefined },
    {
      index: 1,
      display: '0x0341',
      warning: 'Truncated push data. Showing the original script tail.',
    },
  ]) {
    await selectOutput(page, fixture.index);
    const inspector = page.locator('.selection-heading');
    const data = inspector.locator('.op-return-data');
    await expect(data.locator('summary')).toHaveText(`OP_RETURN ${fixture.display}`);
    await expect(page.locator('.transaction-row.is-selected')).not.toContainText(
      'Non-address output',
    );
    if ((await data.getAttribute('open')) === null) await data.locator('summary').click();
    await expect(data).toContainText('Hex data');
    await expect(data.locator('pre')).toHaveText(fixture.display);
    if (fixture.warning) await expect(data.locator('.warning')).toHaveText(fixture.warning);
    else await expect(data.locator('.warning')).toHaveCount(0);
    await expect(
      data.getByRole('button', { name: 'Copy OP_RETURN data hex', exact: true }),
    ).toHaveCount(0);
    await expect(
      inspector.getByRole('button', { name: 'Find spending transactions', exact: true }),
    ).toBeDisabled();
  }
  expect(calls).toHaveLength(0);
});
