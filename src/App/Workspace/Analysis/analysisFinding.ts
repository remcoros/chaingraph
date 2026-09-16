/** Review ordering rule recorded on a finding, never a confidence or ownership claim. */
type ReviewRule = 'fee-threshold' | 'repeated-address' | 'distinct-wallet-inputs';

export interface AnalysisFinding {
  id: string;
  algorithm: string;
  title: string;
  description: string;
  details?: string;
  guidance?: { kind: 'tip' | 'privacy' | 'next-step'; text: string };
  nodeIds: string[];
  txids: string[];
  createdAt: string;
  excluded?: boolean;
  kind?: 'observation' | 'hypothesis' | 'incomplete';
  scopeTxids?: string[];
  stale?: boolean;
  reviewRule?: ReviewRule;
}
