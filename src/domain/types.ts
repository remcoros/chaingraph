export type Network = 'mainnet' | 'testnet4';
export type ScriptType = 'p2pkh' | 'p2sh-p2wpkh' | 'p2wpkh' | 'p2tr';
export interface TxInput {
  txid?: string;
  vout?: number;
  coinbase?: string;
  sequence?: number;
}
export interface TxOutput {
  n: number;
  value: number;
  scriptPubKey: {
    hex?: string;
    address?: string;
    addresses?: string[];
    type?: string;
  };
}
export interface Transaction {
  txid: string;
  vin: TxInput[];
  vout: TxOutput[];
  confirmations?: number;
  blocktime?: number;
  time?: number;
  size?: number;
  vsize?: number;
  blockhash?: string;
}
export interface WalletAddress {
  address: string;
  scripthash: string;
  path: string;
  index: number;
  branch: 0 | 1;
  history?: { tx_hash: string; height: number }[];
}
export interface Wallet {
  id: string;
  name: string;
  key: string;
  scriptType: ScriptType;
  color: string;
  addresses: WalletAddress[];
  scannedAt?: string;
  scanComplete?: boolean;
  scanLimit?: number;
  pendingTransactionIds?: string[];
}
export interface Annotation {
  label: string;
  note: string;
  icon: string;
  bookmarked: boolean;
}
export interface AnalysisFinding {
  id: string;
  algorithm: string;
  title: string;
  description: string;
  nodeIds: string[];
  txids: string[];
  createdAt: string;
  excluded?: boolean;
}
export interface Workspace {
  version: 1;
  id: string;
  name: string;
  description?: string;
  network: Network;
  createdAt: string;
  wallets: Wallet[];
  transactions: Record<string, Transaction>;
  annotations: Record<string, Annotation>;
  findings: AnalysisFinding[];
  watchedAddresses: string[];
  demo: boolean;
  view: {
    dimensions: 2 | 3;
    sizeBy: 'uniform' | 'value' | 'degree';
    glow: boolean;
    showAddresses: boolean;
  };
}
export interface GraphNode {
  id: string;
  kind: 'transaction' | 'output' | 'address';
  label: string;
  value?: number;
  address?: string;
  txid?: string;
  vout?: number;
  cluster?: string;
  x?: number;
  y?: number;
  z?: number;
}
export interface GraphLink {
  id: string;
  source: string;
  target: string;
  kind: 'creates' | 'spends' | 'address';
}
export interface GraphData {
  nodes: GraphNode[];
  links: GraphLink[];
}
export const txNodeId = (txid: string) => `tx:${txid}`;
export const outputNodeId = (txid: string, vout: number) => `out:${txid}:${vout}`;
export const addressNodeId = (address: string) => `addr:${address}`;
export const short = (s: string, n = 8) =>
  s.length > n * 2 + 3 ? `${s.slice(0, n)}…${s.slice(-n)}` : s;
export const sats = (btc: number) => Math.round(btc * 100_000_000);
export const formatSats = (value?: number) =>
  value === undefined ? 'Unknown value' : `${value.toLocaleString()} sats`;
