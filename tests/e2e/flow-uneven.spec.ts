import { expect, test } from '@playwright/test';
import { encryptWorkspace } from '../../src/lib/crypto';
import { newWorkspace } from '../../src/domain/workspace';
import { mockBitcoin, transactions, TX_FUNDING, TX_SPENDING } from '../fixtures/bitcoin';

test('both flow collapse controls remain reachable through uneven expanded lanes', async ({
  page,
}) => {
  const password = 'public-uneven-flow-fixture';
  const workspace = newWorkspace('Uneven transaction lanes', 'mainnet');
  workspace.transactions = {
    [TX_FUNDING]: {
      ...transactions[TX_FUNDING],
      vout: Array.from({ length: 40 }, (_, n) => ({
        ...transactions[TX_FUNDING].vout[0],
        n,
      })),
    },
    [TX_SPENDING]: {
      ...transactions[TX_SPENDING],
      vin: Array.from({ length: 40 }, (_, vout) => ({
        txid: TX_FUNDING,
        vout,
      })),
      vout: Array.from({ length: 12 }, (_, n) => ({
        ...transactions[TX_SPENDING].vout[0],
        n,
      })),
    },
  };
  workspace.view.selectionId = `tx:${TX_SPENDING}`;
  workspace.view.transactionFlow = { open: true, transactionId: TX_SPENDING };
  const envelope = await encryptWorkspace(workspace, password);
  await page.addInitScript(
    ({ id, envelope }) => {
      localStorage.setItem('chaingraph.tour.seen', '1');
      localStorage.setItem(
        'chaingraph.encrypted-workspaces.v1',
        JSON.stringify([
          {
            id,
            publicName: 'Uneven transaction lanes',
            savedAt: new Date().toISOString(),
            envelope,
          },
        ]),
      );
    },
    { id: workspace.id, envelope },
  );
  await mockBitcoin(page, false);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await page.locator('.saved-row').click();
  await page.getByRole('dialog').getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Unlock workspace', exact: true }).click();
  const flow = page.locator('.transaction-view');
  await flow.getByRole('button', { name: 'Show all 40 inputs', exact: true }).click();
  await flow.getByRole('button', { name: 'Show all 12 outputs', exact: true }).click();
  const inputs = flow.getByRole('button', {
    name: 'Collapse inputs',
    exact: true,
  });
  const outputs = flow.getByRole('button', {
    name: 'Collapse outputs',
    exact: true,
  });
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    if (width === 390)
      await page
        .locator('.mobile-switch')
        .getByRole('button', { name: 'Graph', exact: true })
        .click();
    await flow.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    await expect(flow.getByRole('button', { name: /^Input 39:/ })).toBeInViewport({ ratio: 1 });
    await expect(inputs).toBeInViewport({ ratio: 1 });
    await expect(outputs).toBeInViewport({ ratio: 1 });
    const top = (await flow.boundingBox())!.y;
    expect((await inputs.boundingBox())!.y).toBeLessThan(top + 90);
    expect((await outputs.boundingBox())!.y).toBeLessThan(top + 90);
    await page.screenshot({
      path: test.info().outputPath(`uneven-flow-${width}.png`),
    });
  }
  await outputs.click();
  await expect(
    flow.getByRole('button', { name: 'Show all 12 outputs', exact: true }),
  ).toBeInViewport({ ratio: 1 });
  await inputs.click();
  await expect.poll(() => flow.evaluate((element) => element.scrollTop)).toBe(0);
  await expect(flow.getByRole('button', { name: /^Input 0:/ })).toBeInViewport({ ratio: 1 });
  await expect(
    flow.getByRole('button', { name: `Select displayed transaction ${TX_SPENDING}`, exact: true }),
  ).toBeInViewport({ ratio: 1 });
  await expect(
    flow.getByRole('button', { name: 'Show all 40 inputs', exact: true }),
  ).toBeInViewport({ ratio: 1 });
});
