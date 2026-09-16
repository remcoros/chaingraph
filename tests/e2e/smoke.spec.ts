import { expect, test } from '@playwright/test';
import { buildGraph } from '../../src/App/Workspace/GraphState/graphEvidence';
import { createWorkspace } from '../../src/App/Workspace/createWorkspace';
import { openFixtureWorkspace } from '../fixtures/open-workspace';

// A tiny, deliberately minimal fixture: one funding and one spending transaction.
// Smoke tests only need to confirm the app renders and wires together; keep this cheap.
function smokeWorkspace() {
  const w = createWorkspace('Smoke fixture', 'testnet4');
  w.demo = false;
  const funding = 'a'.repeat(64);
  const spending = 'b'.repeat(64);
  w.transactions[funding] = {
    txid: funding,
    vin: [{ coinbase: '00' }],
    vout: [{ n: 0, value: 1, scriptPubKey: { type: 'witness_v0_keyhash' } }],
    confirmations: 10,
  };
  w.transactions[spending] = {
    txid: spending,
    vin: [{ txid: funding, vout: 0 }],
    vout: [{ n: 0, value: 0.9, scriptPubKey: { type: 'witness_v0_keyhash' } }],
    confirmations: 5,
  };
  w.view.graphNodeIds = buildGraph(w).nodes.map((node) => node.id);
  return w;
}

// These are sanity checks, not feature tests: does the app render and do the
// major panels wire together. Keep this suite tiny and resistant to UI/copy
// changes (data-testid only) so it stays cheap to run and cheap to fix.
test('app loads and shows the workspace entry point', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('new-workspace-button')).toBeVisible();
});

test('opening a workspace renders the graph and entity list', async ({ page }) => {
  await openFixtureWorkspace(page, smokeWorkspace(), 'smoke-test-password');
  await expect(page.getByTestId('graph-view')).toBeVisible();
  await expect(page.getByTestId('graph-node-count')).not.toContainText('0 nodes');
  await page.getByTestId('panel-tab-entities').click();
  await expect(page.getByTestId('entity-row').first()).toBeVisible();
});
