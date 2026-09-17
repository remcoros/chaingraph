import {
  AddressFlowHeader,
  FlowPanelAddressView,
  type FlowPanelAddressViewProps,
} from './FlowPanelAddressView';
import {
  FlowPanelTransactionView,
  TransactionFlowHeader,
  useFlowPanelTransaction,
  type FlowPanelTransactionViewProps,
} from './FlowPanelTransactionView';
import { WalletFlowHeader, type FlowPanelWalletViewProps } from './FlowPanelWalletView';
import { FlowPanelShell } from './FlowPanelShell';
import './flow-panel.css';

export interface FlowPanelProps
  extends FlowPanelAddressViewProps, FlowPanelTransactionViewProps, FlowPanelWalletViewProps {}

/**
 * Chooses the view for what is selected and keeps the panel's height across
 * that choice. The shell is rendered here, once, so changing view swaps only
 * the body and never makes the panel flash or lose its height.
 *
 * Every view is a branch below. A new kind of panel is a new branch and a new
 * module, and nothing in the shell changes.
 */
export function FlowPanel(props: FlowPanelProps) {
  const { workspace, selected, selectedWallet, state, onStateChange } = props;
  const transaction = useFlowPanelTransaction(props);
  const panelHeight = state?.height ?? 'expanded';
  const height = {
    open: panelHeight !== 'collapsed',
    fullHeight: panelHeight === 'full',
    onHeight: (next: typeof panelHeight) => onStateChange?.({ ...state, height: next }),
  };
  const annotation = selected ? workspace.annotations.entities[selected.id] : undefined;

  if (!selected)
    return selectedWallet ? (
      <FlowPanelShell {...height} header={<WalletFlowHeader wallet={selectedWallet} />} />
    ) : (
      <FlowPanelShell
        {...height}
        header={
          <span className="flow-panel-header">
            <span className="flow-panel-title">
              <span>No selection</span>
            </span>
          </span>
        }
      />
    );

  switch (selected.kind) {
    case 'address':
      return (
        <FlowPanelShell
          {...height}
          header={
            <AddressFlowHeader
              nodeId={selected.id}
              annotation={annotation}
              addressHistory={props.addressHistory}
              addressHistoryLoad={props.addressHistoryLoad}
              addressBalance={props.addressBalance}
            />
          }
        >
          <FlowPanelAddressView key={selected.address} panel={props} />
        </FlowPanelShell>
      );
    case 'transaction':
    case 'output':
      return (
        <FlowPanelShell
          {...height}
          header={
            <TransactionFlowHeader
              selected={selected}
              annotation={annotation}
              model={transaction}
            />
          }
        >
          <FlowPanelTransactionView panel={props} transaction={transaction} />
        </FlowPanelShell>
      );
    default: {
      // A new kind of node has to choose its view here. Leaving it out fails to
      // compile rather than quietly showing it as a transaction.
      const unsupported: never = selected.kind;
      return (
        <FlowPanelShell
          {...height}
          header={
            <span className="flow-panel-header">
              <span className="flow-panel-title">
                <span>No view for {String(unsupported)}</span>
              </span>
            </span>
          }
        />
      );
    }
  }
}
