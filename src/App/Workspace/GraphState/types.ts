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
