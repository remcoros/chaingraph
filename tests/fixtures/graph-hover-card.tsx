import { StrictMode, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../../src/App/styles.css';
import '../../src/App/Workspace/Workbenches/Graph/TagsPanel/tags.css';
import GraphView from '../../src/App/Workspace/Workbenches/Graph/GraphView';
import { EntityBadges } from '../../src/App/Controls/Metadata/EntityBadges';
import { createDefaultAdapter } from '../../src/App/Workspace/Workbenches/Graph/Renderer/defaultAdapter';
import type {
  GraphAdapterEvents,
  GraphAdapterFactory,
} from '../../src/App/Workspace/Workbenches/Graph/Renderer/adapter';
import { buildGraph } from '../../src/App/Workspace/GraphState/graphEvidence';
import { createWorkspace } from '../../src/Core/Workspace/createWorkspace';
import { transactionReference } from '../../src/Core/Workspace/entityReferences';

// Synthetic observations stay in memory and never issue chain requests.
const txid = '1234567' + 'a'.repeat(50) + 'abcdef0';
const id = transactionReference(txid);
const longLabel = 'Personal annotation ' + 'LongUnbrokenLabel'.repeat(11);
let events: GraphAdapterEvents;
const adapterFactory: GraphAdapterFactory = (container, nextEvents) => {
  events = nextEvents;
  return createDefaultAdapter(container, nextEvents);
};
declare global {
  interface Window {
    hoverFixture: {
      hover: (type: 'node' | 'link', x: number, y: number, nodeId?: string) => void;
      clear: () => void;
      canonical: () => string;
    };
  }
}

function Fixture() {
  const [scenario, setScenario] = useState('unlabeled');
  const [selected, setSelected] = useState(id);
  const [action, setAction] = useState('none');
  const [fit, setFit] = useState(0);
  const workspace = useMemo(() => {
    const next = createWorkspace('Synthetic hover layout', 'testnet4');
    next.chainData.transactions[txid] = {
      txid,
      vin: [{ coinbase: '00' }],
      vout: [{ n: 4294967295, value: 21000000, scriptPubKey: {} }],
      status: {
        kind: 'confirmed' as const,
        confirmations: 1234567890,
        blockHeight: 1234567,
        blocktime: 1750000000,
      },
    };
    next.annotations.entities[id] = {
      label: scenario === 'long' ? longLabel : scenario === 'hex-label' ? txid : '',
      note: '',
      icon: scenario === 'long' ? '★' : '',
      bookmarked: false,
    };
    next.annotations.tags =
      scenario === 'long'
        ? [
            {
              id: 'synthetic-tag',
              name: 'UnbrokenTag'.repeat(7),
              color: '#eab66b',
              description: '',
              nodeIds: [id],
            },
          ]
        : [];
    return next;
  }, [scenario]);
  const graph = useMemo(() => {
    const next = buildGraph(workspace);
    if (scenario !== 'raw') return next;
    return {
      ...next,
      nodes: next.nodes.map((node) => (node.id === id ? { ...node, label: txid } : node)),
    };
  }, [scenario, workspace]);
  useEffect(() => {
    window.hoverFixture = {
      hover: (type, x, y, nodeId = id) =>
        events.hover({
          hit: { type, id: type === 'link' ? graph.links[0].id : nodeId },
          point: { x, y, pointerType: 'mouse' },
        }),
      clear: () => events.hover({ point: { x: 0, y: 0, pointerType: 'mouse' } }),
      canonical: () => workspace.chainData.transactions[txid].txid,
    };
  }, [graph, workspace]);
  return (
    <>
      <label>
        Scenario{' '}
        <select
          aria-label="Scenario"
          value={scenario}
          onChange={(event) => setScenario(event.target.value)}
        >
          <option value="unlabeled">Unlabeled transaction</option>
          <option value="raw">Raw transaction heading</option>
          <option value="long">Long annotation and metadata</option>
          <option value="hex-label">Human label equal to transaction ID</option>
        </select>
      </label>
      <output data-testid="action" style={{ display: 'block', overflowWrap: 'anywhere' }}>
        {action}
      </output>
      <textarea aria-label="Notes editor" id="fixture-notes" />
      <div id="fixture-graph" style={{ width: '100%', height: 620 }}>
        <GraphView
          {...graph}
          adapterFactory={adapterFactory}
          transactions={workspace.chainData.transactions}
          nodePresentation={
            scenario === 'raw'
              ? undefined
              : new Map(
                  graph.nodes.map((node) => [
                    node.id,
                    {
                      label: workspace.annotations.entities[node.id]?.label ?? '',
                      icon: workspace.annotations.entities[node.id]?.icon ?? '',
                    },
                  ]),
                )
          }
          selectedId={selected}
          onSelect={(nodeId) => {
            setSelected(nodeId);
            setAction(`select:${nodeId}`);
          }}
          onToggleSelection={(nodeId) => setAction(`batch:${nodeId}`)}
          onSetHidden={(nodeIds) => setAction(`hide:${nodeIds.join(',')}`)}
          onTrace={(nodeId) => setAction(`trace:${nodeId}`)}
          onEdit={(nodeId) => {
            setAction(`edit:${nodeId}`);
            document.getElementById('fixture-notes')?.focus();
          }}
          renderMetadata={() => (
            <EntityBadges
              tags={workspace.annotations.tags ?? []}
              wallets={scenario === 'long' ? ['LongWalletName'.repeat(10)] : []}
              related
            />
          )}
          dimensions={3}
          sizeBy="uniform"
          glow={false}
          fitToken={fit}
          navigation={
            <button onClick={() => setFit((value) => value + 1)}>Fit fixture graph</button>
          }
        />
      </div>
    </>
  );
}
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Fixture />
  </StrictMode>,
);
